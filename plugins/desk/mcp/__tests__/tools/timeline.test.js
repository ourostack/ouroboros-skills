// timeline.test.js — desk_timeline temporal queries.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { desk_timeline } from "../../src/tools/search.js"
import { openDb, closeDb } from "../../src/db/init.js"
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

test("desk_timeline — default embed options use global fetch", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)
  const originalFetch = globalThis.fetch
  globalThis.fetch = makeEmbedFetch()
  try {
    const res = await desk_timeline({
      deskRoot: root,
      input: {
        from: "2025-01-01",
        to: "2026-12-31",
        query: "alpha",
      },
    })
    assert.equal(res.search_mode, "hybrid")
    assert.equal(res.semantic_unavailable, false)
    assert.ok(res.results.some((result) => result.path.includes("/recent/")))
  } finally {
    if (originalFetch === undefined) {
      delete globalThis.fetch
    } else {
      globalThis.fetch = originalFetch
    }
  }
})

test("desk_timeline — single-character query uses semantic candidates without FTS", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { query: "a" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.equal(res.search_mode, "hybrid")
  assert.equal(res.semantic_unavailable, false)
  assert.ok(res.results.length >= 1)
})

test("desk_timeline — query window skips semantic candidates outside bounds", async () => {
  const root = await buildTimelineDesk()
  await buildFixtureIndex(root)

  const res = await desk_timeline({
    deskRoot: root,
    input: { query: "a", to: "2025-12-31" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  const paths = res.results.map((result) => result.path)
  assert.ok(paths.some((p) => p.includes("/old/")))
  assert.ok(!paths.some((p) => p.includes("/recent/")))
})

test("desk_timeline — scope can restrict archived entries", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/active/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha active content\n",
  )
  await writeFile(
    root,
    "trackA/_archive/old/task.md",
    "---\nstatus: done\nschema_version: 1\nupdated: 2026-05-02\n---\nalpha archived content\n",
  )
  await buildFixtureIndex(root)

  const archived = await desk_timeline({
    deskRoot: root,
    input: { query: "alpha", scope: "archived" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })

  assert.ok(archived.results.length >= 1)
  assert.ok(archived.results.every((result) => result.path.includes("_archive")))
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

test("desk_timeline — no-query snippets trim long first chunks", async () => {
  const root = await mkTempDeskRoot()
  const longBody = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ")
  await writeFile(
    root,
    "trackA/long/task.md",
    `---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\n${longBody}\n`,
  )
  await buildFixtureIndex(root)

  const res = await desk_timeline({ deskRoot: root, input: {} })
  assert.equal(res.search_mode, "temporal")
  assert.ok(res.results[0].snippet.length <= 283)
  assert.match(res.results[0].snippet, /\.\.\.$/u)
})

test("desk_timeline — no-query path tolerates empty docs and missing timestamps", async () => {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/empty/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\n",
  )
  await writeFile(
    root,
    "trackA/full/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-02\n---\nalpha full content\n",
  )
  await buildFixtureIndex(root)

  const db = openDb(root)
  try {
    db.prepare("UPDATE docs SET updated_at = NULL WHERE path = ?").run(
      "trackA/empty/task.md",
    )
  } finally {
    closeDb(db)
  }

  const res = await desk_timeline({ deskRoot: root, input: {} })
  assert.ok(res.results.some((result) => result.path === "trackA/empty/task.md"))
  const empty = res.results.find((result) => result.path === "trackA/empty/task.md")
  assert.equal(empty.snippet, "")
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
