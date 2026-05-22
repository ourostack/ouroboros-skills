// recall.test.js — desk_recall semantic-only loose-recall.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { desk_recall } from "../../src/tools/search.js"
import {
  buildFixtureIndex,
  makeEmbedFetch,
  makeFailingFetch,
  mkTempDeskRoot,
  writeFile,
} from "./_search_helpers.js"

test("desk_recall — happy path returns semantic matches", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha retry detail\n",
  )
  await writeFile(
    root,
    "trackB/task-2/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nbravo widget thoughts\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_recall({
    deskRoot: root,
    input: { topic: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.ok(Array.isArray(res.results), "results is an array")
  assert.ok(res.results.length >= 1, "at least one result")
  // Alpha-family doc should rank above bravo-family.
  assert.match(res.results[0].snippet.toLowerCase(), /alpha/)
  assert.ok(typeof res.results[0].score === "number")
  assert.equal(res.cluster_count, res.results.length, "MVP cluster_count = results.length")
})

test("desk_recall — Ollama-down returns semantic_unavailable error", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha content\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_recall({
    deskRoot: root,
    input: { topic: "alpha" },
    opts: { embed: { fetch: makeFailingFetch() } },
  })

  assert.equal(res.error, "semantic_unavailable")
  assert.match(res.note, /Ollama/)
  assert.equal(res.results, undefined, "no results in error payload")
})

test("desk_recall — empty topic returns empty results", async () => {
  const root = await mkTempDeskRoot()
  await buildFixtureIndex(root)

  const res = await desk_recall({
    deskRoot: root,
    input: { topic: "" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.deepEqual(res.results, [])
})

test("desk_recall — limit is honoured", async () => {
  const root = await mkTempDeskRoot()
  for (let i = 0; i < 8; i++) {
    await writeFile(
      root,
      `trackA/task-${i}/task.md`,
      `---\nstatus: processing\nschema_version: 1\n---\nalpha note ${i}\n`,
    )
  }
  await buildFixtureIndex(root)

  const res = await desk_recall({
    deskRoot: root,
    input: { topic: "alpha", limit: 3 },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.ok(res.results.length <= 3, `expected <=3, got ${res.results.length}`)
})

test("desk_recall — dedupes by doc_id (one entry per doc)", async () => {
  const root = await mkTempDeskRoot()
  // A doc with multiple chunks — should still produce a single recall entry.
  const longBody = Array.from({ length: 5 }, (_, i) =>
    `## Section ${i}\n\nalpha-section-${i} content body text repeated`,
  ).join("\n\n")
  await writeFile(
    root,
    "trackA/task-1/task.md",
    `---\nstatus: processing\nschema_version: 1\n---\n${longBody}\n`,
  )
  await buildFixtureIndex(root)

  const res = await desk_recall({
    deskRoot: root,
    input: { topic: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  const paths = res.results.map((r) => r.path)
  const unique = new Set(paths)
  assert.equal(paths.length, unique.size, "no duplicate paths")
})
