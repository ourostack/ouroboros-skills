// Private qualitative-feedback store.
//
// A participant's own words about using a preview build. Deliberately NOT the
// desk-index DB (`src/db/init.js`), which is a rebuildable derivative index and
// gets dropped and reindexed; and deliberately NOT the desk workspace, which is
// a Git checkout that syncs to a remote. This store lives in the operating-system
// user's private state directory, owner-only, one partition per
// (desk root + person binding).
//
// The store holds only what the participant explicitly typed. It carries no
// flow, effort, cost, or performance measurement, and nothing here is collected,
// transmitted, or shared by this module — every read returns to the caller that
// asked, and nothing else.

import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import * as path from "node:path"

import { resolveProtectedStore, withProtectedStore } from "../protected/store.js"

// This store's identity within the shared primitive. Module-internal constants,
// never tool input: no caller can name another store's namespace, file or
// schema. `subject` is what the protection messages call this data, so those
// sentences stay exactly as callers already read them.
const FEEDBACK_STORE = {
  namespace: "feedback",
  filename: "feedback.sqlite",
  label: "desk_feedback",
  subject: "feedback",
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS feedback_entries (
  entry_id TEXT PRIMARY KEY,
  preview_version TEXT NOT NULL,
  text TEXT NOT NULL,
  task_ref TEXT,
  revision INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

/** The preview build the participant is giving feedback about. */
function previewVersion(pluginRoot) {
  const manifest = pluginRoot === undefined
    ? new URL("../../../plugin.json", import.meta.url)
    : path.join(pluginRoot, "plugin.json")
  return JSON.parse(readFileSync(manifest, "utf8")).version
}

/**
 * Resolve (and create) the owner-only directory that holds this binding's
 * private feedback DB.
 *
 * Partitioning uses the already-resolved desk root and the session's `--person`
 * binding — never anything the tool caller supplies — so one participant's
 * store cannot be addressed from another participant's session.
 */
export async function resolvePrivateStore({
  deskRoot,
  person = null,
  env = process.env,
  platform = process.platform,
}) {
  return resolveProtectedStore({ deskRoot, person, env, platform, ...FEEDBACK_STORE })
}

/**
 * Open the private store, run `body` against it, and always close the handle.
 * `body` receives a small operation surface — the DB handle never escapes.
 */
export async function withPrivateStore(binding, body) {
  // The DB handle stays inside the primitive's bounded callback; feedback
  // callers keep the narrow operation surface they already had.
  return withProtectedStore(
    { ...binding, ...FEEDBACK_STORE, schemaSql: SCHEMA_SQL },
    (store) => body(storeOperations(store.db, binding.pluginRoot)),
  )
}

function storeOperations(db, pluginRoot) {
  return {
    capture({ text, taskRef }) {
      const now = nowIso()
      const entry = {
        entry_id: randomUUID(),
        preview_version: previewVersion(pluginRoot),
        text,
        task_ref: taskRef,
        revision: 1,
        captured_at: now,
        updated_at: now,
      }
      db.prepare(
        "INSERT INTO feedback_entries " +
          "(entry_id, preview_version, text, task_ref, revision, captured_at, updated_at) " +
          "VALUES (@entry_id, @preview_version, @text, @task_ref, @revision, @captured_at, @updated_at)",
      ).run(entry)
      return entry
    },
    list: db.transaction(({ limit, offset = 0 }) => {
      const entries = db
        .prepare(
          "SELECT entry_id, preview_version, text, task_ref, revision, captured_at, updated_at " +
            "FROM feedback_entries ORDER BY captured_at DESC, entry_id DESC LIMIT ? OFFSET ?",
        )
        .all(limit, offset)
      const { total } = db
        .prepare("SELECT COUNT(*) AS total FROM feedback_entries")
        .get()
      return { entries, total }
    }),
    correct({ entryId, expectedRevision, text }) {
      const entry = db
        .prepare(
          "UPDATE feedback_entries SET text = ?, revision = revision + 1, updated_at = ? " +
            "WHERE entry_id = ? AND revision = ? " +
            "RETURNING entry_id, preview_version, text, task_ref, revision, captured_at, updated_at",
        )
        .get(text, nowIso(), entryId, expectedRevision)
      if (entry === undefined) {
        const current = db
          .prepare("SELECT revision FROM feedback_entries WHERE entry_id = ?")
          .get(entryId)
        if (current === undefined) throw unknownEntry(entryId)
        throw new Error(
          `desk_feedback: entry ${entryId} changed since it was read ` +
            `(expected_revision ${expectedRevision}, current revision ${current.revision}). ` +
            "Re-read the entry and re-apply the correction so no edit is lost.",
        )
      }
      return entry
    },
    remove({ entryId }) {
      const changed = db
        .prepare("DELETE FROM feedback_entries WHERE entry_id = ?")
        .run(entryId).changes
      if (changed === 0) throw unknownEntry(entryId)
      // secure_delete (set at open) overwrites the freed pages, so the deleted
      // words leave this file rather than lingering as a soft-deleted copy.
      return { entry_id: entryId }
    },
  }
}

function unknownEntry(entryId) {
  return new Error(`desk_feedback: no feedback entry with entry_id ${entryId}`)
}

function nowIso() {
  return new Date().toISOString()
}
