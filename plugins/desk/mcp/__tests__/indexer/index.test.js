// index.test.js — end-to-end indexer behaviour against a small fixture desk.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import * as os from "node:os"
import { promises as fs } from "node:fs"

import { rebuildIndex } from "../../src/indexer/index.js"
import { openDb, closeDb } from "../../src/db/init.js"

async function mkRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-idx-"))
}
async function w(root, rel, body) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, "utf8")
}

const indexOpts = { skipEmbed: true }

test("empty desk → empty index", async () => {
  const root = await mkRoot()
  const summary = await rebuildIndex(root, indexOpts)
  assert.equal(summary.docs_indexed, 0)
  assert.equal(summary.docs_skipped, 0)
  assert.equal(summary.chunks_inserted, 0)
})

test("small fixture desk → expected doc + chunk counts", async () => {
  const root = await mkRoot()
  await w(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\n# T1\n\nbody one\n\n## H2\n\nbody two",
  )
  await w(root, "trackA/task-1/planning.md", "## Plan\n\nplan body")
  await w(root, "trackA/task-1/doing.md", "# Doing\n\ndoing body")
  await w(root, "_meta/friction.md", "# Friction\n\nentry")

  const summary = await rebuildIndex(root, indexOpts)
  assert.equal(summary.docs_indexed, 4)
  assert.ok(summary.chunks_inserted >= 4)

  const db = openDb(root)
  try {
    const docCount = db.prepare("SELECT count(*) AS c FROM docs").get().c
    assert.equal(docCount, 4)
    const chunkCount = db.prepare("SELECT count(*) AS c FROM chunks").get().c
    assert.ok(chunkCount >= 4, `expected >=4 chunks; got ${chunkCount}`)

    // refs_graph picked up planning_of + doing_of for the trackA/task-1
    // task.
    const refs = db.prepare("SELECT ref_kind FROM refs_graph").all().map((r) => r.ref_kind)
    assert.ok(refs.includes("planning_of"), `refs=${refs.join(",")}`)
    assert.ok(refs.includes("doing_of"), `refs=${refs.join(",")}`)
  } finally {
    closeDb(db)
  }
})

test("re-running on an unchanged desk is a no-op (hash unchanged)", async () => {
  const root = await mkRoot()
  await w(root, "trackA/task-1/task.md", "---\nstatus: processing\n---\nbody")
  await w(root, "trackA/task-1/planning.md", "body")

  const first = await rebuildIndex(root, indexOpts)
  assert.equal(first.docs_indexed, 2)
  assert.equal(first.docs_skipped, 0)

  const second = await rebuildIndex(root, indexOpts)
  assert.equal(second.docs_indexed, 0, "no docs should reindex on no-op run")
  assert.equal(second.docs_skipped, 2)
})

test("modifying one doc → that doc reindexed, others skipped", async () => {
  const root = await mkRoot()
  await w(root, "trackA/task-1/task.md", "---\nstatus: processing\n---\nbody")
  await w(root, "trackA/task-1/planning.md", "plan v1")
  await w(root, "trackA/task-2/task.md", "---\nstatus: blocked\n---\nbody")

  await rebuildIndex(root, indexOpts)

  // Touch one file with new content.
  await w(root, "trackA/task-1/planning.md", "plan v2 has different content")
  // Bump mtime forward in case the FS gives us the same-second mtime.
  const future = new Date(Date.now() + 5000)
  await fs.utimes(path.join(root, "trackA/task-1/planning.md"), future, future)

  const summary = await rebuildIndex(root, indexOpts)
  assert.equal(summary.docs_indexed, 1)
  assert.equal(summary.docs_skipped, 2)
})

test("deleting a doc removes it from the index on next pass", async () => {
  const root = await mkRoot()
  await w(root, "trackA/task-1/task.md", "---\nstatus: processing\n---\nbody")
  await w(root, "trackA/task-1/planning.md", "plan")

  await rebuildIndex(root, indexOpts)

  await fs.unlink(path.join(root, "trackA/task-1/planning.md"))

  const summary = await rebuildIndex(root, indexOpts)
  assert.equal(summary.docs_removed, 1)

  const db = openDb(root)
  try {
    const remaining = db.prepare("SELECT path FROM docs").all().map((r) => r.path)
    assert.deepEqual(remaining, ["trackA/task-1/task.md"])
  } finally {
    closeDb(db)
  }
})

test("happy-path embedding writes chunk_vecs rows (BigInt PK binding)", async () => {
  const root = await mkRoot()
  await w(root, "trackA/t1/task.md", "---\nstatus: processing\n---\nhybrid retrieval body\n\n## H2\n\nmore text")

  // Mock fetch that returns a deterministic 768-dim vector. This exercises
  // the chunk_vecs INSERT path that requires BigInt-coerced primary keys —
  // a plain JS number bind here raises "Only integers are allows for
  // primary key values on chunk_vecs".
  const dim = 768
  const vec = Array.from({ length: dim }, (_, i) => (i % 7) / dim)
  const okFetch = async () => ({ ok: true, json: async () => ({ embedding: vec }) })

  const summary = await rebuildIndex(root, { embed: { fetch: okFetch } })
  assert.equal(summary.semantic_warnings, 0, "expected no soft-fail warnings on happy path")
  assert.ok(summary.chunks_inserted >= 1)

  const db = openDb(root)
  try {
    const vecCount = db.prepare("SELECT count(*) AS c FROM chunk_vecs").get().c
    assert.equal(vecCount, summary.chunks_inserted, "one vec row per chunk")
  } finally {
    closeDb(db)
  }
})

test("ollama-down soft-fail still populates FTS chunks", async () => {
  const root = await mkRoot()
  await w(root, "trackA/t1/task.md", "---\nstatus: processing\n---\nhybrid retrieval body")

  // Pass a mock fetch that always fails — embeddings come back null but
  // chunks still get inserted and FTS still indexes them.
  const failingFetch = async () => {
    const e = new Error("ECONNREFUSED")
    e.code = "ECONNREFUSED"
    throw e
  }
  const summary = await rebuildIndex(root, { embed: { fetch: failingFetch } })
  assert.equal(summary.docs_indexed, 1)
  assert.ok(summary.chunks_inserted >= 1)
  assert.equal(summary.semantic_warnings, 1)

  const db = openDb(root)
  try {
    const hits = db
      .prepare("SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?")
      .all("hybrid")
    assert.ok(hits.length >= 1, "expected FTS to have indexed the text")
    // No vec rows when ollama is down.
    const vecCount = db.prepare("SELECT count(*) AS c FROM chunk_vecs").get().c
    assert.equal(vecCount, 0)
  } finally {
    closeDb(db)
  }
})
