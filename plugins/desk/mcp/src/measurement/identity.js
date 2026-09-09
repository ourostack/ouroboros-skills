// Canonical work identity: how a private ledger entry points at the Git-backed
// desk record that actually owns the work.
//
// The ledger owns none of that authority. It does not create task cards, does
// not write to them, and does not decide their state — it resolves a reference
// through the same path authority every other desk tool uses, reads what is
// there, and reports agreement or disagreement. Validating a reference is a
// read: it must not bring the thing it validates into existence, because the
// desk workspace is a Git checkout belonging to the operator.

import { promises as fs } from "node:fs"
import * as path from "node:path"

import { readMarkdown } from "../util/fm.js"
import { personPrefix, validateWriteSegment } from "../util/paths.js"

const LABEL = "desk_work_ledger"

/**
 * Resolve `{track, slug}` against the session's own desk root and `--person`
 * binding, and confirm the task card is really there.
 *
 * Uses the shared `validateWriteSegment` and `personPrefix` authority rather
 * than a second path resolver, but performs its own read-only existence check:
 * the write-target resolver may provision a missing person subtree, and a mere
 * existence check must never do that.
 *
 * Returns { track, slug, path } with a desk-root-relative POSIX path.
 * Throws if a segment is unsafe, if the resolved path escapes the desk root, or
 * if the task card does not exist.
 */
export async function resolveTaskRef({ deskRoot, person, taskRef }) {
  if (taskRef == null) return null
  if (typeof taskRef !== "object" || Array.isArray(taskRef)) {
    throw new Error(`${LABEL}: task_ref must be an object with track and slug.`)
  }
  const { track, slug, ...rest } = taskRef
  const extra = Object.keys(rest)
  if (extra.length > 0) {
    throw new Error(
      `${LABEL}: unknown task_ref field ${JSON.stringify(extra[0])} — expected only track and slug.`,
    )
  }
  // Shared segment authority, unchanged: the refusal a caller reads here is the
  // same sentence every other desk write path produces.
  validateWriteSegment(track)
  validateWriteSegment(slug)

  // Containment needs no separate check here: validateWriteSegment above has
  // already refused separators and "..", and personPrefix refuses a traversing
  // or multi-segment alias, so the joined path cannot leave the desk root.
  const root = personPrefix(deskRoot, person)
  const filePath = path.join(root, track, slug, "task.md")

  let stat
  try {
    stat = await fs.lstat(filePath)
  } catch {
    stat = null
  }
  if (stat === null || !stat.isFile()) {
    throw new Error(
      `${LABEL}: task does not exist: ${relativeToDesk(deskRoot, filePath)}. ` +
        `A commitment may only point at a canonical task that is already there; ` +
        `the ledger does not create desk records.`,
    )
  }

  return { track, slug, path: relativeToDesk(deskRoot, filePath) }
}

/**
 * Read the canonical state of a bound task card.
 *
 * Read-only and non-creating. The class is `declared`: reading the card is an
 * observation of a recorded declaration, not verification that anything was
 * delivered, and the wire vocabulary has no sixth class for it. The card the
 * state came from is cited in `source_ref` so a reader can go and check.
 * Returns an explicit unavailable when there is no binding or the card can no
 * longer be read — never a guess, and never a write.
 */
export async function readCanonicalStatus({ deskRoot, taskRef, declaredState }) {
  if (!taskRef?.path) {
    return {
      class: "unavailable",
      reason: "no_canonical_task_bound",
      state: null,
      mismatch: "unavailable",
    }
  }
  const filePath = path.join(deskRoot, taskRef.path)
  let parsed
  try {
    parsed = await readMarkdown(filePath)
  } catch {
    return {
      class: "unavailable",
      reason: "canonical_task_unreadable",
      state: null,
      mismatch: "unavailable",
    }
  }
  const state = parsed?.data?.status ?? null
  if (state === null) {
    return {
      class: "unavailable",
      reason: "canonical_task_has_no_status",
      state: null,
      mismatch: "unavailable",
    }
  }
  return {
    class: "declared",
    source_ref: { source: "desk_task_card", track: taskRef.track, slug: taskRef.slug, path: taskRef.path },
    state,
    mismatch: state !== declaredState,
  }
}

function relativeToDesk(deskRoot, filePath) {
  return path.relative(deskRoot, filePath).split(path.sep).join("/")
}
