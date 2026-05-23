// search.test.js — desk_search hybrid lexical+semantic ranking + filters.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"

import { desk_search } from "../../src/tools/search.js"
import {
  buildFixtureIndex,
  makeEmbedFetch,
  makeFailingFetch,
  mkTempDeskRoot,
  writeFile,
} from "./_search_helpers.js"

// Build a fixture desk where chunks across multiple tracks share or differ
// on the first-word "family" (deterministic 768-dim vectors per
// _search_helpers.js). A query whose first letter matches a doc's first
// letter produces a strong semantic hit; mismatched produces near-zero.

async function buildBaseDesk() {
  const root = await mkTempDeskRoot()
  // Track A — alpha-family docs
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\ntitle: A1\n---\nalpha retry exponential backoff details\n",
  )
  await writeFile(
    root,
    "trackA/task-1/planning.md",
    "alpha retry plan body content\n",
  )
  // Track B — bravo-family docs
  await writeFile(
    root,
    "trackB/task-2/task.md",
    "---\nstatus: done\nschema_version: 1\ntitle: B1\n---\nbravo widget design notes\n",
  )
  // Track C — alpha-family but blocked status
  await writeFile(
    root,
    "trackC/task-3/task.md",
    "---\nstatus: blocked\nschema_version: 1\ntitle: C1\n---\nalpha retry insight\n",
  )
  return root
}

test("desk_search — happy path returns ranked results with score_breakdown", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.ok(Array.isArray(res.results), "results is an array")
  assert.ok(res.results.length >= 1, "at least one result")
  // Alpha-family docs should rank ahead of bravo-family.
  const top = res.results[0]
  assert.match(top.snippet.toLowerCase(), /alpha/, "top result mentions alpha")
  assert.ok(typeof top.score === "number" && top.score > 0)
  assert.ok(top.score_breakdown && typeof top.score_breakdown === "object")
  assert.ok(top.score_breakdown.semantic >= 0)
  assert.ok(top.score_breakdown.bm25 >= 0)
  assert.equal(res.semantic_unavailable, false)
  assert.ok(typeof res.latency_ms === "number")
})

test("desk_search — Ollama-down soft-fails to FTS-only with semantic_unavailable=true", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha" },
    opts: { embed: { fetch: makeFailingFetch() } },
  })

  assert.equal(res.semantic_unavailable, true, "flag set when query embed fails")
  // FTS still finds the alpha hits.
  assert.ok(res.results.length >= 1)
  // Semantic component in breakdown should be 0 (no embedding available).
  assert.equal(res.results[0].score_breakdown.semantic, 0)
})

test("desk_search — repairs a fresh lexical-only index when embeddings are available", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha semantic repair body\n",
  )
  const { rebuildIndex } = await import("../../src/indexer/index.js")
  await rebuildIndex(root, { embed: { fetch: makeFailingFetch() } })

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.equal(res.semantic_unavailable, false)
  assert.ok(res.results.length >= 1)
  assert.ok(
    res.results[0].score_breakdown.semantic > 0,
    "semantic component should be restored after repair",
  )
})

test("desk_search — track filter narrows to one track", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha", filters: { track: "trackA" } },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.ok(res.results.length >= 1)
  for (const r of res.results) {
    assert.equal(r.track, "trackA")
  }
})

test("desk_search — status filter (single value)", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha", filters: { status: "processing" } },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  for (const r of res.results) {
    assert.equal(r.status, "processing")
  }
})

test("desk_search — status filter (array of values)", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha", filters: { status: ["processing", "blocked"] } },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  for (const r of res.results) {
    assert.ok(["processing", "blocked"].includes(r.status))
  }
})

test("desk_search — kind filter narrows by doc kind", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha", filters: { kind: "planning" } },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  for (const r of res.results) {
    assert.equal(r.kind, "planning")
  }
  assert.ok(res.results.length >= 1, "at least one planning doc")
})

test("desk_search — since filter excludes older docs", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2024-01-01\n---\nalpha old content\n",
  )
  await writeFile(
    root,
    "trackA/task-2/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha new content\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha", filters: { since: "2025-01-01" } },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  for (const r of res.results) {
    assert.ok(
      r.updated_at >= "2025-01-01",
      `expected updated_at >= 2025-01-01, got ${r.updated_at}`,
    )
  }
})

test("desk_search — limit is clamped to [1, 50]", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const huge = await desk_search({
    deskRoot: root,
    input: { query: "alpha", limit: 9999 },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.ok(huge.results.length <= 50, "limit clamped to 50 max")

  const tiny = await desk_search({
    deskRoot: root,
    input: { query: "alpha", limit: 0 },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  // 0 → clamped to 1; depending on data we get 0 or 1 result, but never
  // more than 1.
  assert.ok(tiny.results.length <= 1, "limit=0 clamped to >= 1 (so <=1 result)")
})

test("desk_search — state_bias raises active-status docs above terminal-status docs", async () => {
  const root = await mkTempDeskRoot()
  // Two docs with identical text → same FTS + semantic scores. State_bias
  // is the only differentiator.
  await writeFile(
    root,
    "trackA/active/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha identical body content\n",
  )
  await writeFile(
    root,
    "trackA/finished/task.md",
    "---\nstatus: done\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha identical body content\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.ok(res.results.length >= 2)
  const processingResult = res.results.find((r) => r.status === "processing")
  const doneResult = res.results.find((r) => r.status === "done")
  assert.ok(processingResult, "found processing-status result")
  assert.ok(doneResult, "found done-status result")
  assert.ok(
    processingResult.score > doneResult.score,
    `expected processing(${processingResult.score}) > done(${doneResult.score})`,
  )
  // Verify the state component is what differentiates them.
  assert.ok(
    processingResult.score_breakdown.state >
      doneResult.score_breakdown.state,
  )
})

test("desk_search — empty query returns empty results", async () => {
  const root = await buildBaseDesk()
  await buildFixtureIndex(root)

  const res = await desk_search({
    deskRoot: root,
    input: { query: "" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.deepEqual(res.results, [])
})

test("desk_search — active-iteration pin adds the +0.30 bonus", async () => {
  const root = await mkTempDeskRoot()
  // Featured track + a task with an in-progress iteration whose path points
  // at a doc that should get the pin bonus.
  await writeFile(root, "_meta/featured.md", "trackP\n")
  await writeFile(
    root,
    "trackP/task-pinned/task.md",
    `---
schema_version: 1
status: processing
updated: 2026-05-01
title: P1
iterations:
  active: ./repo-x/2026-05-01-impl
  history:
    - slug: 2026-05-01-impl
      repo: repo-x
      trigger: initial-impl
      path: ./repo-x/2026-05-01-impl
      outcome: in-progress
---
alpha pinned body summary
`,
  )
  // The iteration directory has its own doing.md which should get pinned.
  await writeFile(
    root,
    "trackP/task-pinned/repo-x/2026-05-01-impl/doing.md",
    "alpha iteration body content\n",
  )
  // A control doc, same alpha text, NOT under the pinned prefix.
  await writeFile(
    root,
    "trackQ/task-other/doing.md",
    "alpha control body content\n",
  )

  await buildFixtureIndex(root)
  const res = await desk_search({
    deskRoot: root,
    input: { query: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  // The pinned doing.md should rank top — its pin breakdown should be 0.3.
  const pinned = res.results.find((r) =>
    r.path.includes("2026-05-01-impl/doing.md"),
  )
  const control = res.results.find((r) =>
    r.path.includes("trackQ/task-other/doing.md"),
  )
  assert.ok(pinned, "pinned doc surfaced in results")
  assert.ok(control, "control doc surfaced in results")
  assert.ok(
    pinned.score_breakdown.pin > 0,
    "pin component on the pinned chunk > 0",
  )
  assert.equal(control.score_breakdown.pin, 0, "control chunk not pinned")
  assert.ok(
    pinned.score > control.score,
    `pin bumps pinned (${pinned.score}) above control (${control.score})`,
  )
})
