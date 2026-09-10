// desk_feedback — a participant's private qualitative feedback about the
// preview build they are using.
//
// Explicit capture only: an entry exists because the participant said so in
// this call. Nothing is inferred from tasks, conversations, or background
// activity, and nothing measures the participant.
//
// This is not telemetry and not Git-durable friction. Entries live in the
// operating-system user's private store (see ../feedback/store.js), scoped to
// the session's already-resolved desk root and `--person` binding. Reads return
// to this caller only; there is no share, export, sync, or publish action here.
// Handing feedback to a desk (a Git checkout) is a separate, visible, opted-in
// step owned by the participant's agent, not a hidden branch of this tool.

import { withPrivateStore } from "../feedback/store.js"

const MAX_TEXT_LENGTH = 4000
const MAX_TASK_REF_LENGTH = 200
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 100

const ACTION_FIELDS = {
  capture: ["action", "text", "task_ref"],
  list: ["action", "limit", "offset"],
  correct: ["action", "entry_id", "expected_revision", "text"],
  delete: ["action", "entry_id"],
}

/**
 * desk_feedback
 *
 * Input (one `action` per call; unknown actions and unknown fields are errors):
 *   { action: "capture", text: string, task_ref?: string }
 *   { action: "list",    limit?: integer 1..100, offset?: non-negative safe integer }
 *   { action: "correct", entry_id: string, expected_revision: integer, text: string }
 *   { action: "delete",  entry_id: string }
 *
 * Returns:
 *   capture → { status: "captured", entry }
 *   list    → { status: "ok", entries, count, total, limit, offset, next_offset }
 *   correct → { status: "corrected", entry }
 *   delete  → { status: "deleted", entry_id }
 *
 * An entry is { entry_id, preview_version, text, task_ref, revision,
 * captured_at, updated_at }. `revision` is the concurrency token: `correct`
 * requires the revision the caller last read, so a correction written against a
 * stale read fails loudly instead of overwriting an edit it never saw.
 */
export async function desk_feedback({ deskRoot, input, person = null, statusContext = {} }) {
  const values = input ?? {}
  const action = values.action
  if (!Object.hasOwn(ACTION_FIELDS, action)) {
    throw new Error(
      `desk_feedback: unknown action ${JSON.stringify(action ?? null)} — ` +
        `expected one of ${Object.keys(ACTION_FIELDS).join(", ")}.`,
    )
  }
  rejectUnknownFields(values, ACTION_FIELDS[action])

  const request = parseRequest(action, values)
  return withPrivateStore(
    { deskRoot, person, pluginRoot: statusContext.runtime?.plugin_root },
    (store) => runAction(store, request),
  )
}

function runAction(store, request) {
  if (request.action === "capture") {
    return {
      status: "captured",
      entry: store.capture({ text: request.text, taskRef: request.taskRef }),
    }
  }
  if (request.action === "list") {
    const { entries, total } = store.list({ limit: request.limit, offset: request.offset })
    return {
      status: "ok",
      entries,
      count: entries.length,
      total,
      limit: request.limit,
      offset: request.offset,
      next_offset: request.offset + entries.length < total ? request.offset + entries.length : null,
    }
  }
  if (request.action === "correct") {
    return {
      status: "corrected",
      entry: store.correct({
        entryId: request.entryId,
        expectedRevision: request.expectedRevision,
        text: request.text,
      }),
    }
  }
  return { status: "deleted", ...store.remove({ entryId: request.entryId }) }
}

function parseRequest(action, values) {
  if (action === "capture") {
    return {
      action,
      text: requireText(values.text, "text"),
      taskRef: optionalTaskRef(values.task_ref),
    }
  }
  if (action === "list") {
    return { action, limit: optionalLimit(values.limit), offset: optionalOffset(values.offset) }
  }
  if (action === "correct") {
    return {
      action,
      entryId: requireEntryId(values.entry_id),
      expectedRevision: requireExpectedRevision(values.expected_revision),
      text: requireText(values.text, "text"),
    }
  }
  return { action, entryId: requireEntryId(values.entry_id) }
}

function rejectUnknownFields(values, allowed) {
  const unknown = Object.keys(values).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new Error(
      `desk_feedback: unknown input field(s) ${unknown.join(", ")} for action ` +
        `${values.action} — accepted fields are ${allowed.join(", ")}.`,
    )
  }
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`desk_feedback: \`${field}\` is required and must be a non-empty string`)
  }
  const text = value.trim()
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `desk_feedback: \`${field}\` is ${text.length} characters; the limit is ${MAX_TEXT_LENGTH}. ` +
        "Capture the point in your own words and keep long material where it already lives.",
    )
  }
  return text
}

function optionalTaskRef(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("desk_feedback: `task_ref` must be a non-empty string when provided")
  }
  const taskRef = value.trim()
  if (taskRef.length > MAX_TASK_REF_LENGTH) {
    throw new Error(
      `desk_feedback: \`task_ref\` is ${taskRef.length} characters; the limit is ${MAX_TASK_REF_LENGTH}`,
    )
  }
  return taskRef
}

function optionalLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIST_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_LIMIT) {
    throw new Error(
      `desk_feedback: \`limit\` must be an integer between 1 and ${MAX_LIST_LIMIT}`,
    )
  }
  return value
}

function optionalOffset(value) {
  if (value === undefined || value === null) return 0
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("desk_feedback: `offset` must be a non-negative safe integer")
  }
  return value
}

function requireEntryId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("desk_feedback: `entry_id` is required and must be a non-empty string")
  }
  return value.trim()
}

function requireExpectedRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      "desk_feedback: `expected_revision` is required and must be the integer revision " +
        "you last read, so a concurrent correction cannot be silently overwritten",
    )
  }
  return value
}
