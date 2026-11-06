// reindex.test.js — desk_reindex tool wraps ensureIndex (mtime-incremental)
// and the force:true rebuild path.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import { existsSync } from "node:fs"
import * as path from "node:path"

import { desk_reindex } from "../../src/tools/reindex.js"
import { indexDbPath } from "../../src/db/init.js"
import { mkTempDeskRoot } from "./_helpers.js"

// All tests use skipEmbed to keep them hermetic (no Ollama dependency).
const reindexOpts = { embed: undefined, skipEmbed: true }

async function writeFile(root, rel, body) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, "utf8")
}

test("desk_reindex — empty bundle returns ok with built=true and zero docs", async () => {
  const root = await mkTempDeskRoot()
  const res = await desk_reindex({
    deskRoot: root,
    input: {},
    opts: reindexOpts,
  })

  assert.equal(res.status, "ok")
  assert.equal(typeof res.built, "boolean")
  assert.equal(typeof res.reason, "string")
  assert.equal(res.docs_indexed, 0)
  assert.equal(res.docs_skipped, 0)
  assert.equal(res.docs_pruned, 0)
  assert.ok(typeof res.ms === "number" && res.ms >= 0)
  // First call against a fresh root has no DB on disk → built must be true.
  assert.equal(res.built, true)
  assert.equal(res.reason, "missing")
})

test("desk_reindex — after writing a doc, reindex returns docs_indexed >= 1", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nhello body\n",
  )
  const res = await desk_reindex({
    deskRoot: root,
    input: {},
    opts: reindexOpts,
  })

  assert.equal(res.status, "ok")
  assert.equal(res.built, true)
  assert.ok(
    res.docs_indexed >= 1,
    `expected docs_indexed >= 1, got ${res.docs_indexed}`,
  )
})

test("desk_reindex — second call without force returns built=false reason=fresh", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nhello body\n",
  )
  // First call seeds the index.
  await desk_reindex({ deskRoot: root, input: {}, opts: reindexOpts })

  // Second call without force: nothing has changed → fresh, built=false.
  const res = await desk_reindex({
    deskRoot: root,
    input: {},
    opts: reindexOpts,
  })
  assert.equal(res.status, "ok")
  assert.equal(res.built, false)
  assert.equal(res.reason, "fresh")
  // ensureIndex no-op path → no per-doc counts (0).
  assert.equal(res.docs_indexed, 0)
})

test("desk_reindex — force:true drops the DB and rebuilds from scratch", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nhello body\n",
  )
  // First call to seed.
  await desk_reindex({ deskRoot: root, input: {}, opts: reindexOpts })
  const dbPath = indexDbPath(root)
  assert.ok(existsSync(dbPath), "db should exist after first reindex")

  // Second call with force:true must rebuild from scratch even though
  // nothing has changed. ensureIndex sees a missing DB → built=true,
  // reason=missing.
  const res = await desk_reindex({
    deskRoot: root,
    input: { force: true },
    opts: reindexOpts,
  })
  assert.equal(res.status, "ok")
  assert.equal(res.built, true)
  assert.equal(res.reason, "missing")
  assert.ok(res.docs_indexed >= 1, "force rebuild re-indexes all docs")
  // DB exists again after the rebuild.
  assert.ok(existsSync(dbPath), "db re-created after force rebuild")
})

test("desk_reindex — force:true on a fresh root with no DB still succeeds", async () => {
  const root = await mkTempDeskRoot()
  const res = await desk_reindex({
    deskRoot: root,
    input: { force: true },
    opts: reindexOpts,
  })
  assert.equal(res.status, "ok")
  assert.equal(res.built, true)
  // No docs on disk → docs_indexed stays 0.
  assert.equal(res.docs_indexed, 0)
})
