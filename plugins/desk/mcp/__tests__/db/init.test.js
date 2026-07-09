// db/init.test.js — schema applies cleanly, FTS5 + chunk_vecs virtual tables
// are present after openDb, and the chunks→chunks_fts trigger actually fires.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import * as os from "node:os"
import { promises as fs } from "node:fs"
import Database from "better-sqlite3"

import {
  openDb,
  closeDb,
  runMigrations,
  getMeta,
  setMeta,
} from "../../src/db/init.js"

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-init-"))
}

test("openDb creates parent .state dir + applies schema idempotently", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    // Re-applying migrations on an already-initialized DB is a no-op.
    assert.doesNotThrow(() => runMigrations(db))
    // .state dir got created.
    const stateDir = path.join(root, ".state")
    const stat = await fs.stat(stateDir)
    assert.ok(stat.isDirectory(), "expected <root>/.state to exist")
  } finally {
    closeDb(db)
  }
})

test("openDb installs all required tables (docs, chunks, refs_graph, meta)", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
      .all()
      .map((r) => r.name)
    for (const t of ["docs", "chunks", "refs_graph", "meta"]) {
      assert.ok(rows.includes(t), `missing table ${t}; got: ${rows.join(", ")}`)
    }
  } finally {
    closeDb(db)
  }
})

test("schema exposes chunk key and embedding spec metadata surfaces", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual') ORDER BY name")
      .all()
      .map((r) => r.name)
    assert.ok(tables.includes("embedding_specs"), `missing embedding_specs; got: ${tables.join(", ")}`)
    assert.ok(
      tables.includes("chunk_embedding_failures"),
      `missing chunk_embedding_failures; got: ${tables.join(", ")}`,
    )

    const chunkCols = db.prepare("PRAGMA table_info(chunks)").all().map((c) => c.name)
    for (const column of ["chunk_key", "text_hash", "embedding_spec_id", "chunker_id", "normalization_id"]) {
      assert.ok(chunkCols.includes(column), `missing chunks.${column}; got: ${chunkCols.join(", ")}`)
    }

    const specCols = db.prepare("PRAGMA table_info(embedding_specs)").all().map((c) => c.name)
    for (const column of ["id", "model", "model_revision", "dimension", "chunker_id", "normalization_id", "is_active"]) {
      assert.ok(specCols.includes(column), `missing embedding_specs.${column}; got: ${specCols.join(", ")}`)
    }

    const failureCols = db.prepare("PRAGMA table_info(chunk_embedding_failures)").all().map((c) => c.name)
    for (const column of ["chunk_key", "text_hash", "embedding_spec_id", "chunker_id", "normalization_id", "reason", "message", "failed_at"]) {
      assert.ok(
        failureCols.includes(column),
        `missing chunk_embedding_failures.${column}; got: ${failureCols.join(", ")}`,
      )
    }
  } finally {
    closeDb(db)
  }
})

test("migrations upgrade older chunk tables with key and spec metadata columns", async () => {
  const root = await tmpRoot()
  const stateDir = path.join(root, ".state")
  await fs.mkdir(stateDir, { recursive: true })
  const dbPath = path.join(stateDir, "desk-index.sqlite")
  const legacy = new Database(dbPath)
  try {
    legacy.exec(`
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        heading TEXT,
        start_offset INTEGER,
        end_offset INTEGER
      );
    `)
  } finally {
    legacy.close()
  }

  const db = openDb(root)
  try {
    const chunkCols = db.prepare("PRAGMA table_info(chunks)").all().map((c) => c.name)
    for (const column of ["chunk_key", "text_hash", "embedding_spec_id", "chunker_id", "normalization_id"]) {
      assert.ok(chunkCols.includes(column), `migration missing chunks.${column}; got: ${chunkCols.join(", ")}`)
    }
  } finally {
    closeDb(db)
  }
})

test("migrations upgrade older docs tables with archive metadata", async () => {
  const root = await tmpRoot()
  const stateDir = path.join(root, ".state")
  await fs.mkdir(stateDir, { recursive: true })
  const dbPath = path.join(stateDir, "desk-index.sqlite")
  const legacy = new Database(dbPath)
  try {
    legacy.exec(`
      CREATE TABLE docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        track TEXT,
        task_slug TEXT,
        status TEXT,
        schema_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT,
        updated_at TEXT,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        frontmatter TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        heading TEXT,
        start_offset INTEGER,
        end_offset INTEGER
      );
    `)
  } finally {
    legacy.close()
  }

  const db = openDb(root)
  try {
    const docCols = db.prepare("PRAGMA table_info(docs)").all().map((c) => c.name)
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all()
      .map((row) => row.name)

    assert.ok(docCols.includes("is_archived"), `migration missing docs.is_archived; got: ${docCols.join(", ")}`)
    assert.ok(indexes.includes("idx_docs_is_archived"), `migration missing archive index; got: ${indexes.join(", ")}`)
  } finally {
    closeDb(db)
  }
})

test("FTS5 virtual table chunks_fts is queryable", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    // sqlite_master reports FTS5 as 'table' kind, but the underlying
    // shadow tables (chunks_fts_data etc.) confirm FTS5 wired up correctly.
    const shadow = db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'chunks_fts%'")
      .all()
      .map((r) => r.name)
    assert.ok(
      shadow.includes("chunks_fts"),
      `expected chunks_fts; got: ${shadow.join(", ")}`,
    )
    // A bare MATCH query against an empty FTS table should return zero rows
    // (not error out).
    const hits = db.prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?").all("hello")
    assert.equal(hits.length, 0)
  } finally {
    closeDb(db)
  }
})

test("chunk_vecs vec0 virtual table accepts a 768-dim float vector", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    // Insert a chunk row first so the chunk_id FK target exists logically.
    const docId = db
      .prepare(
        "INSERT INTO docs (path, kind, hash, mtime) VALUES ('t.md','task','h',0) RETURNING id",
      )
      .get().id
    const chunkId = db
      .prepare(
        "INSERT INTO chunks (doc_id, chunk_index, text) VALUES (?, 0, 'hi') RETURNING id",
      )
      .get(docId).id
    const vec = new Float32Array(768)
    vec[0] = 1.0
    // sqlite-vec rejects non-integer bound values on a vec0 primary-key
    // column; chunkId comes back as a JS number from RETURNING, so we
    // coerce to BigInt at the bind boundary (this mirrors what the
    // indexer does in src/indexer/index.js).
    db.prepare("INSERT INTO chunk_vecs (chunk_id, embedding) VALUES (?, ?)").run(BigInt(chunkId), vec)
    const back = db
      .prepare("SELECT chunk_id FROM chunk_vecs WHERE chunk_id = ?")
      .get(chunkId)
    assert.ok(back, "expected chunk_vecs row back")
  } finally {
    closeDb(db)
  }
})

test("insert into chunks triggers a chunks_fts row via the AFTER INSERT trigger", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    const docId = db
      .prepare(
        "INSERT INTO docs (path, kind, hash, mtime) VALUES ('a.md','task','h',0) RETURNING id",
      )
      .get().id
    const chunkId = db
      .prepare(
        "INSERT INTO chunks (doc_id, chunk_index, text) VALUES (?, 0, 'hybrid retrieval makes search fast') RETURNING id",
      )
      .get(docId).id

    const hits = db
      .prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH 'hybrid' ORDER BY rowid")
      .all()
    assert.ok(
      hits.some((r) => r.rowid === chunkId),
      `chunk inserted but not in FTS5 index; got hits=${JSON.stringify(hits)}`,
    )
  } finally {
    closeDb(db)
  }
})

test("meta key set/get roundtrips", async () => {
  const root = await tmpRoot()
  const db = openDb(root)
  try {
    assert.equal(getMeta(db, "k"), null)
    setMeta(db, "k", "v")
    assert.equal(getMeta(db, "k"), "v")
    setMeta(db, "k", "v2")
    assert.equal(getMeta(db, "k"), "v2")
  } finally {
    closeDb(db)
  }
})
