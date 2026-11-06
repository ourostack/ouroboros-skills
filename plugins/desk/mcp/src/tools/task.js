// Runtime CRUD tools for `task.md` cards — task_create, task_update, task_archive.
//
// Each export is invoked from server.js with a parsed { deskRoot, input }
// pair. The implementation owns the on-disk layout under
// `<root>/<track>/<slug>/task.md` and obeys the schema documented in
// `plugins/desk/skills/task-card-format/SKILL.md` (schema_version 1).

import { promises as fs } from "node:fs"
import * as path from "node:path"
import {
  nowIso,
  readMarkdown,
  writeMarkdown,
  pathExists,
} from "../util/fm.js"
import { personPrefix } from "../util/paths.js"

const TERMINAL_STATUSES = new Set(["done", "cancelled"])

// Optional runtime fields the operator (or harness) may pass at create time.
// Kept explicit so we don't silently accept arbitrary keys.
const OPTIONAL_RUNTIME_FIELDS = [
  "category",
  "cadence",
  "scheduledAt",
  "requester",
  "validator",
  "artifacts",
  "active_bridge",
  "bridge_sessions",
  "planning_complete",
  "adopted_at",
  "repos",
  "iterations",
  "predecessor",
]

// Builders take `base` = the effective write root (personPrefix(deskRoot,
// person)). `relPath` stays anchored at the real deskRoot so returned paths
// show the `desks/<alias>/` prefix when --person is on.
function taskDir(base, track, slug) {
  return path.join(base, track, slug)
}

function taskFile(base, track, slug) {
  return path.join(taskDir(base, track, slug), "task.md")
}

function relPath(deskRoot, absPath) {
  return path.relative(deskRoot, absPath)
}

/**
 * task_create
 *
 * Input:
 *   {
 *     track: string,            // required
 *     slug: string,             // required
 *     title: string,            // required
 *     status?: string,          // default "drafting"
 *     body?: string,            // markdown body (no frontmatter)
 *     ...optional runtime fields per task-card schema
 *   }
 *
 * Side effects: creates `<root>/<track>/<slug>/task.md` (and parent dirs).
 *
 * Errors: refuses if the target task.md already exists.
 *
 * Returns: { status: "created", path: "<track>/<slug>/task.md" }
 */
export async function task_create({ deskRoot, input, person = null }) {
  const { track, slug, title } = input ?? {}
  if (!track || typeof track !== "string") {
    throw new Error("task_create: `track` is required (string)")
  }
  if (!slug || typeof slug !== "string") {
    throw new Error("task_create: `slug` is required (string)")
  }
  if (!title || typeof title !== "string") {
    throw new Error("task_create: `title` is required (string)")
  }

  const base = personPrefix(deskRoot, person)
  const filePath = taskFile(base, track, slug)
  if (await pathExists(filePath)) {
    throw new Error(
      `task_create: task already exists at ${relPath(deskRoot, filePath)}`,
    )
  }

  const ts = nowIso()
  const data = {
    schema_version: 1,
    title,
    status: input.status ?? "drafting",
    created: ts,
    updated: ts,
    track,
  }
  for (const k of OPTIONAL_RUNTIME_FIELDS) {
    if (input[k] !== undefined) data[k] = input[k]
  }

  await writeMarkdown(filePath, data, input.body ?? "")
  return { status: "created", path: relPath(deskRoot, filePath) }
}

/**
 * task_update
 *
 * Input:
 *   {
 *     track: string,
 *     slug: string,
 *     frontmatter?: object,   // shallow-merged into existing frontmatter
 *     body_append?: string,   // appended to existing body (blank line sep)
 *   }
 *
 * Side effects: rewrites `<root>/<track>/<slug>/task.md` in place.
 *
 * Preserves: `schema_version`, `created`. Always refreshes `updated` to now.
 *
 * Errors: refuses if the task doesn't exist.
 *
 * Returns: { status: "updated", path }
 */
export async function task_update({ deskRoot, input, person = null }) {
  const { track, slug, frontmatter, body_append } = input ?? {}
  if (!track || !slug) {
    throw new Error("task_update: `track` and `slug` are required")
  }

  const base = personPrefix(deskRoot, person)
  const filePath = taskFile(base, track, slug)
  if (!(await pathExists(filePath))) {
    throw new Error(
      `task_update: task does not exist at ${relPath(deskRoot, filePath)}`,
    )
  }

  const existing = await readMarkdown(filePath)
  const merged = { ...existing.data, ...(frontmatter ?? {}) }

  // Preserve immutable fields even if the caller passed them.
  if (existing.data.schema_version !== undefined) {
    merged.schema_version = existing.data.schema_version
  } else {
    merged.schema_version = 1
  }
  if (existing.data.created !== undefined) {
    merged.created = existing.data.created
  }
  merged.updated = nowIso()

  let newBody = existing.content
  if (body_append && typeof body_append === "string" && body_append.length) {
    const sep = newBody.endsWith("\n\n") || newBody.length === 0 ? "" : "\n\n"
    newBody = `${newBody}${sep}${body_append}`
  }

  await writeMarkdown(filePath, merged, newBody)
  return { status: "updated", path: relPath(deskRoot, filePath) }
}

/**
 * task_archive
 *
 * Input: { track, slug }
 *
 * Side effects: moves `<root>/<track>/<slug>/` → `<root>/<track>/_archive/<slug>/`.
 * Marks the task `done` if not already in a terminal status.
 *
 * Idempotent: if the source dir doesn't exist AND `_archive/<slug>` does,
 * returns `{ status: "already_archived" }`. Throws if neither exists.
 *
 * Returns: { status: "archived" | "already_archived", path }
 */
export async function task_archive({ deskRoot, input, person = null }) {
  const { track, slug } = input ?? {}
  if (!track || !slug) {
    throw new Error("task_archive: `track` and `slug` are required")
  }

  const base = personPrefix(deskRoot, person)
  const srcDir = taskDir(base, track, slug)
  const archiveDir = path.join(base, track, "_archive", slug)
  const archivedFile = path.join(archiveDir, "task.md")

  const srcExists = await pathExists(srcDir)
  const dstExists = await pathExists(archiveDir)

  if (!srcExists && dstExists) {
    return {
      status: "already_archived",
      path: relPath(deskRoot, archivedFile),
    }
  }
  if (!srcExists && !dstExists) {
    throw new Error(
      `task_archive: task does not exist at ${relPath(deskRoot, srcDir)}`,
    )
  }
  if (srcExists && dstExists) {
    throw new Error(
      `task_archive: archive destination already exists at ${relPath(
        deskRoot,
        archiveDir,
      )} but source ${relPath(deskRoot, srcDir)} also exists`,
    )
  }

  // Move the dir. fs.rename is atomic on the same filesystem.
  await fs.mkdir(path.dirname(archiveDir), { recursive: true })
  await fs.rename(srcDir, archiveDir)

  // Bump task status to `done` (and refresh `updated`) if not already terminal.
  const filePath = path.join(archiveDir, "task.md")
  if (await pathExists(filePath)) {
    const existing = await readMarkdown(filePath)
    const currentStatus = existing.data.status
    if (!TERMINAL_STATUSES.has(currentStatus)) {
      const merged = {
        ...existing.data,
        status: "done",
        updated: nowIso(),
      }
      await writeMarkdown(filePath, merged, existing.content)
    }
  }

  return { status: "archived", path: relPath(deskRoot, filePath) }
}
