// SQLite index init.
//
// Opens (or creates) `<deskRoot>/.state/desk-index.sqlite`, loads sqlite-vec,
// applies the schema.sql migrations idempotently, and returns a
// better-sqlite3 Database handle. All other indexer code goes through
// openDb() so the sqlite-vec extension is guaranteed loaded.

import { readFileSync, mkdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Read the schema.sql file as a string. Exposed for tests + diagnostics. */
export function readSchemaSql() {
  return readFileSync(path.join(__dirname, "schema.sql"), "utf-8")
}

/**
 * Resolve the on-disk path where the index DB lives for a given desk root.
 * Lives under `<root>/.state/` per desk-search-design §3.
 */
export function indexDbPath(deskRoot) {
  return path.join(deskRoot, ".state", "desk-index.sqlite")
}

/**
 * Open (or create) the desk index DB. Loads sqlite-vec, applies migrations,
 * returns a ready-to-use better-sqlite3 handle.
 *
 * @param {string} deskRoot — absolute path to the desk workspace.
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — override the resolved DB path (used by tests).
 * @returns {import("better-sqlite3").Database}
 */
export function openDb(deskRoot, opts = {}) {
  const dbPath = opts.dbPath ?? indexDbPath(deskRoot)
  const dbDir = path.dirname(dbPath)
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  const db = new Database(dbPath)
  // Pragmas: WAL gives concurrent-reader friendliness (the search tools will
  // read while the indexer writes). foreign_keys lets ON DELETE CASCADE
  // actually cascade. synchronous=NORMAL is the WAL recommendation.
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")
  // sqlite-vec must be loaded before any vec0 virtual-table reference resolves.
  sqliteVec.load(db)
  runMigrations(db)
  return db
}

/**
 * Apply schema.sql. Idempotent — every statement uses IF NOT EXISTS so
 * repeated invocations are safe.
 */
export function runMigrations(db) {
  const sql = readSchemaSql()
  db.exec(sql)
}

/** Clean shutdown — close DB handle. Safe to call multiple times. */
export function closeDb(db) {
  if (db && db.open) {
    db.close()
  }
}

/** Read a meta key. Returns null if absent. */
export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key)
  return row ? row.value : null
}

/** Set (or upsert) a meta key. */
export function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value)
}
