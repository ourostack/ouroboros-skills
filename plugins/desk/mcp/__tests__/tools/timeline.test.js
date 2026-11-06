// timeline.test.js — desk_timeline temporal queries.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { desk_timeline } from "../../src/tools/search.js"
import {
  buildFixtureIndex,
  makeEmbedFetch,
  mkTempDeskRoot,
  writeFile,
} from "./_search_helpers.js"

async function buildTimelineDesk() {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/old/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2024-06-01\n---\nalpha old content\n",
  )
  await writeFile(
    root,
    "trackA/middle/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2025-09-15\n---\nbravo middle content\n",
  )
  await writeFile(
    root,
    "trackA/recent/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha recent content\n",
  )
  return root
}

test("desk_timeline — without query: chronological listing within window", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { from: "2025-01-01", to: "2026-12-31" },
  })

  assert.ok(Array.isArray(res.results))
  // Only the middle + recent docs fall inside the window.
  const paths = res.results.map((r) => r.path)
  assert.ok(paths.some((p) => p.includes("/middle/")))
  assert.ok(paths.some((p) => p.includes("/recent/")))
  assert.ok(!paths.some((p) => p.includes("/old/")), "old doc excluded")
  // Ordering: updated_at DESC.
  for (let i = 1; i < res.results.length; i++) {
    assert.ok(
      (res.results[i - 1].updated_at ?? "") >=
        (res.results[i].updated_at ?? ""),
      "results ordered by updated_at DESC",
    )
  }
})

test("desk_timeline — with query: hybrid ranking inside the window", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: {
      from: "2025-01-01",
      to: "2026-12-31",
      query: "alpha",
    },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  // Only docs in window with "alpha" content should match — that's just
  // the 'recent' task (alpha + in-window). 'middle' is bravo. 'old' is
  // out-of-window.
  const paths = res.results.map((r) => r.path)
  assert.ok(paths.some((p) => p.includes("/recent/")))
  assert.ok(!paths.some((p) => p.includes("/old/")), "old out of window")
})

test("desk_timeline — `from` alone is honoured", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { from: "2026-01-01" },
  })
  for (const r of res.results) {
    assert.ok(
      (r.updated_at ?? "") >= "2026-01-01",
      `expected >= 2026-01-01, got ${r.updated_at}`,
    )
  }
})

test("desk_timeline — `to` alone is honoured", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { to: "2025-01-01" },
  })
  for (const r of res.results) {
    assert.ok(
      (r.updated_at ?? "") <= "2025-01-01",
      `expected <= 2025-01-01, got ${r.updated_at}`,
    )
  }
})

test("desk_timeline — no window args lists everything (recency-ordered)", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({ deskRoot: root, input: {} })
  assert.ok(res.results.length >= 3)
})

test("desk_timeline — limit clamped to [1, 50]", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { limit: 9999 },
  })
  assert.ok(res.results.length <= 50)
})
