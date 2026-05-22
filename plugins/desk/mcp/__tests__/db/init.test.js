// db/init.test.js — schema applies cleanly, FTS5 + chunk_vecs virtual tables
// are present after openDb, and the chunks→chunks_fts trigger actually fires.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import * as os from "node:os"
import { promises as fs } from "node:fs"

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
