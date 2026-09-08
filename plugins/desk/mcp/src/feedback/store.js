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

import { createHash, randomUUID } from "node:crypto"
import childProcess from "node:child_process"
import { promises as fs, readFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import Database from "better-sqlite3"

import { expandHome, isPathContained, personPrefix } from "../util/paths.js"
import { assertWindowsAclAvailable, protectWindowsPaths } from "./windows-acl.js"

const OWNER_ONLY_DIR_MODE = 0o700
const OWNER_ONLY_FILE_MODE = 0o600
const STORE_SEGMENTS = ["ouroboros-skills", "desk", "feedback"]
const DB_FILENAME = "feedback.sqlite"

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
  if (platform === "win32") {
    assertWindowsAclAvailable({ env })
  }

  const alias = bindingAlias(deskRoot, person)
  const realDeskRoot = await realPathOrThrow(
    deskRoot,
    "desk root could not be resolved",
  )

  const stateHome = resolveStateHome(env)
  await fs.mkdir(stateHome, { recursive: true, mode: OWNER_ONLY_DIR_MODE })
  const realStateHome = await realPathOrThrow(
    stateHome,
    "state home could not be resolved",
  )

  const partition = partitionId(realDeskRoot, alias)
  const storeDir = path.join(realStateHome, ...STORE_SEGMENTS, partition)
  await assertOutsideGitWorkspace({ realStateHome, storeDir, realDeskRoot })

  let cursor = realStateHome
  const ownedDirectories = []
  for (const segment of [...STORE_SEGMENTS, partition]) {
    cursor = path.join(cursor, segment)
    const created = await ensureOwnerOnlyDirectory(cursor, platform)
    await assertNotGitCheckout(cursor)
    ownedDirectories.push({ path: cursor, kind: "directory", created })
  }
  if (platform === "win32") {
    await protectWindowsPaths(ownedDirectories, { env })
  }

  return { storeDir, dbPath: path.join(storeDir, DB_FILENAME) }
}

/**
 * Open the private store, run `body` against it, and always close the handle.
 * `body` receives a small operation surface — the DB handle never escapes.
 */
export async function withPrivateStore(binding, body) {
  const { dbPath } = await resolvePrivateStore(binding)
  const { platform = process.platform, env = process.env } = binding
  const db = await openPrivateDb(dbPath, { platform, env })
  try {
    return await body(storeOperations(db, binding.pluginRoot))
  } finally {
    db.close()
  }
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

async function openPrivateDb(dbPath, { platform, env }) {
  let created = false
  try {
    await fs.writeFile(dbPath, "", { flag: "wx", mode: OWNER_ONLY_FILE_MODE })
    created = true
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
  const existing = await lstatIfPresent(dbPath)
  if (existing !== null && existing.isSymbolicLink()) {
    throw new Error(
      `desk_feedback: private feedback DB path is a symlink and will not be used: ${dbPath}`,
    )
  }
  if (existing === null || !existing.isFile()) {
    throw new Error(`desk_feedback: private feedback store at ${dbPath} could not be opened: not a regular file`)
  }
  if (existing.nlink !== 1) {
    throw new Error(`desk_feedback: private feedback DB is hard-linked and will not be used: ${dbPath}`)
  }
  if (platform === "win32") {
    await protectWindowsPaths([{ path: dbPath, kind: "file", created }], { env })
  } else {
    clearExtendedAcl(dbPath, platform)
    await fs.chmod(dbPath, OWNER_ONLY_FILE_MODE)
  }
  let db
  try {
    db = new Database(dbPath)
    // DELETE journalling keeps the words in one file instead of leaving copies
    // in a -wal sidecar; secure_delete zeroes freed pages so a deletion removes
    // the text rather than unlinking a still-readable page.
    db.pragma("journal_mode = DELETE")
    db.pragma("secure_delete = ON")
    db.exec(SCHEMA_SQL)
  } catch (error) {
    if (db !== undefined) db.close()
    throw new Error(
      `desk_feedback: private feedback store at ${dbPath} could not be opened: ${error.message}`,
    )
  }
  return db
}

function unknownEntry(entryId) {
  return new Error(`desk_feedback: no feedback entry with entry_id ${entryId}`)
}

function bindingAlias(deskRoot, person) {
  // personPrefix owns alias validation (rejects traversal and multi-segment
  // aliases); reuse it here so the private store and the desk write paths agree
  // on what a person binding may be.
  const prefix = personPrefix(deskRoot, person)
  return prefix === deskRoot ? null : path.basename(prefix)
}

function partitionId(realDeskRoot, alias) {
  return createHash("sha256")
    .update(JSON.stringify({ desk_root: realDeskRoot, person: alias }))
    .digest("hex")
    .slice(0, 32)
}

function resolveStateHome(env) {
  const home = env.HOME ?? os.homedir()
  const configured = env.XDG_STATE_HOME
  if (typeof configured === "string" && configured.trim() !== "") {
    return path.resolve(expandHome(configured, home))
  }
  return path.join(home, ".local", "state")
}

async function assertOutsideGitWorkspace({ realStateHome, storeDir, realDeskRoot }) {
  if (isPathContained(realDeskRoot, storeDir)) {
    throw new Error(
      `desk_feedback: refusing to write private feedback inside the desk workspace: ${storeDir}. ` +
        "The desk workspace is a Git checkout; private feedback must stay out of it.",
    )
  }
  let cursor = realStateHome
  while (true) {
    await assertNotGitCheckout(cursor)
    const parent = path.dirname(cursor)
    if (parent === cursor) return
    cursor = parent
  }
}

async function assertNotGitCheckout(dir) {
  if ((await lstatIfPresent(path.join(dir, ".git"))) !== null) {
    throw new Error(
      `desk_feedback: refusing to write private feedback inside the Git checkout at ${dir}. ` +
        "Point XDG_STATE_HOME at a directory that is not under version control.",
    )
  }
}

async function ensureOwnerOnlyDirectory(dir, platform) {
  let existing = await lstatIfPresent(dir)
  let created = false
  if (existing === null) {
    try {
      await fs.mkdir(dir, { mode: OWNER_ONLY_DIR_MODE })
      created = true
    } catch (error) {
      if (error.code !== "EEXIST") throw error
    }
    existing = await fs.lstat(dir)
  }
  if (existing.isSymbolicLink()) {
    throw new Error(
      `desk_feedback: private feedback path component is a symlink and will not be used: ${dir}`,
    )
  }
  if (!existing.isDirectory()) {
    throw new Error(`desk_feedback: private feedback path component is not a directory: ${dir}`)
  }
  if (platform !== "win32") {
    clearExtendedAcl(dir, platform)
    if ((existing.mode & 0o777) !== OWNER_ONLY_DIR_MODE) {
      await fs.chmod(dir, OWNER_ONLY_DIR_MODE)
    }
  }
  return created
}

function clearExtendedAcl(target, platform) {
  if (platform !== "darwin") return
  const options = { encoding: "utf8", timeout: 5000, maxBuffer: 65536 }
  // macOS ACL grants can survive chmod 0700/0600. Restrict only our own paths.
  childProcess.execFileSync("/bin/chmod", ["-N", target], options)
  const listing = childProcess.execFileSync("/bin/ls", ["-ldeq", target], options)
  if (/^\s*\d+:/mu.test(listing)) {
    throw new Error(`desk_feedback: private feedback path retains an extended ACL: ${target}`)
  }
}

async function realPathOrThrow(candidate, reason) {
  try {
    return await fs.realpath(candidate)
  } catch (error) {
    throw new Error(`desk_feedback: ${reason}: ${candidate} (${error.code})`)
  }
}

async function lstatIfPresent(candidate) {
  try {
    return await fs.lstat(candidate)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw new Error(
      `desk_feedback: private feedback path ${candidate} could not be inspected (${error.code})`,
    )
  }
}

function nowIso() {
  return new Date().toISOString()
}
