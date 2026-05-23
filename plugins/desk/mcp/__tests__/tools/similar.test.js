// similar.test.js — desk_similar centroid-based "more like this".

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { desk_similar } from "../../src/tools/search.js"
import {
  buildFixtureIndex,
  makeEmbedFetch,
  makeFailingFetch,
  mkTempDeskRoot,
  writeFile,
} from "./_search_helpers.js"

test("desk_similar — happy path returns docs near the seed centroid", async () => {
  const root = await mkTempDeskRoot()
  // Seed doc — alpha family.
  await writeFile(
    root,
    "trackA/seed/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha original seed body\n",
  )
  // Two alpha-family neighbours (should rank high).
  await writeFile(
    root,
    "trackB/n1/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha neighbour one body\n",
  )
  await writeFile(
    root,
    "trackC/n2/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha neighbour two body\n",
  )
  // A cross-family doc (should rank lower or not at all).
  await writeFile(
    root,
    "trackD/far/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nzebra far away body\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_similar({
    deskRoot: root,
    input: { path: "trackA/seed/task.md" },
  })

  assert.ok(Array.isArray(res.results), "results is an array")
  assert.ok(res.results.length >= 2, "at least the two alpha neighbours")
  // Seed must not appear in its own similar-results.
  for (const r of res.results) {
    assert.notEqual(r.path, "trackA/seed/task.md", "seed excluded")
  }
  // Alpha neighbours should outrank the cross-family doc.
  const alphaScores = res.results
    .filter((r) => r.path.includes("/n1/") || r.path.includes("/n2/"))
    .map((r) => r.score)
  const zebraResult = res.results.find((r) => r.path.includes("/far/"))
  if (zebraResult) {
    for (const s of alphaScores) {
      assert.ok(
        s > zebraResult.score,
        `alpha neighbour ${s} should outrank zebra ${zebraResult.score}`,
      )
    }
  }
})

test("desk_similar — nonexistent path → not_found error", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/seed/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha body\n",
  )
  await buildFixtureIndex(root)

  const res = await desk_similar({
    deskRoot: root,
    input: { path: "this/does/not/exist.md" },
  })
  assert.equal(res.error, "not_found")
})

test("desk_similar — missing path arg → invalid_input error", async () => {
  const root = await mkTempDeskRoot()
  await buildFixtureIndex(root)
  const res = await desk_similar({ deskRoot: root, input: {} })
  assert.equal(res.error, "invalid_input")
})

test("desk_similar — seed without embeddings returns semantic_unavailable", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/seed/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha body\n",
  )
  // Build the index with Ollama-down → no chunk_vecs rows.
  const { rebuildIndex } = await import("../../src/indexer/index.js")
  await rebuildIndex(root, { embed: { fetch: makeFailingFetch() } })

  const res = await desk_similar({
    deskRoot: root,
    input: { path: "trackA/seed/task.md" },
    opts: { embed: { fetch: makeFailingFetch() } },
  })
  assert.equal(res.error, "semantic_unavailable")
  assert.match(res.semantic_repair, /desk_reindex/)
})

test("desk_similar — dedupes by doc_id (one entry per similar doc)", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/seed/task.md",
    "---\nstatus: processing\nschema_version: 1\n---\nalpha seed body\n",
  )
  // A neighbour with many chunks — should still produce one similar entry.
  const longBody = Array.from({ length: 6 }, (_, i) =>
    `## Section ${i}\n\nalpha-multichunk-${i} content`,
  ).join("\n\n")
  await writeFile(
    root,
    "trackB/multichunk/task.md",
    `---\nstatus: processing\nschema_version: 1\n---\n${longBody}\n`,
  )
  await buildFixtureIndex(root)

  const res = await desk_similar({
    deskRoot: root,
    input: { path: "trackA/seed/task.md" },
  })
  const paths = res.results.map((r) => r.path)
  const unique = new Set(paths)
  assert.equal(paths.length, unique.size, "no duplicate doc paths in results")
})
