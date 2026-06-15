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
 * Apply schema.sql + run additive migrations.
 *
 * The base schema is idempotent (every statement uses IF NOT EXISTS).
 * Additive migrations for columns added after v1.0 are guarded by checking
 * sqlite_master / table_info so they're also idempotent.
 */
export function runMigrations(db) {
  const sql = readSchemaSql()
  db.exec(sql)

  // 1.1 migration: docs.is_archived column. Older indexes (built under
  // v1.0) don't have it; add it idempotently so callers can WHERE-filter.
  // Pre-existing rows get is_archived=0; the next reindex updates them.
  // The new index is also added defensively.
  const docCols = db.prepare("PRAGMA table_info(docs)").all()
  if (!docCols.some((c) => c.name === "is_archived")) {
    db.exec(
      "ALTER TABLE docs ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
    )
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_docs_is_archived ON docs(is_archived)")

  // 1.2 migration: stable chunk identity and embedding spec metadata.
  const chunkCols = db.prepare("PRAGMA table_info(chunks)").all()
  for (const column of [
    "chunk_key",
    "text_hash",
    "embedding_spec_id",
    "chunker_id",
    "normalization_id",
  ]) {
    if (!chunkCols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE chunks ADD COLUMN ${column} TEXT`)
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_chunk_key ON chunks(chunk_key)")
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_embedding_spec_id ON chunks(embedding_spec_id)")
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
