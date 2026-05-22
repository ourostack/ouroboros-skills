// track_create — happy path + duplicate refusal + optional fields.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { track_create } from "../../src/tools/track.js"
import { mkTempDeskRoot, readFront, exists } from "./_helpers.js"

test("track_create writes a v1 track.md with required + default fields", async () => {
  const root = await mkTempDeskRoot()
  const result = await track_create({
    deskRoot: root,
    input: { slug: "europe-trip", title: "Europe trip 2026" },
  })
  assert.equal(result.status, "created")
  assert.equal(result.path, path.join("europe-trip", "track.md"))

  const filePath = path.join(root, "europe-trip", "track.md")
  assert.ok(await exists(filePath))

  const { data } = await readFront(filePath)
  assert.equal(data.schema_version, 1)
  assert.equal(data.title, "Europe trip 2026")
  assert.equal(data.status, "active")
  assert.ok(data.created)
  assert.equal(data.created, data.updated)
})

test("track_create refuses to overwrite an existing track", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    input: { slug: "t1", title: "first" },
  })
  await assert.rejects(
    () =>
      track_create({
        deskRoot: root,
        input: { slug: "t1", title: "second" },
      }),
    /already exists/,
  )
})

test("track_create accepts optional predecessor + planning fields", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    input: {
      slug: "succ",
      title: "Successor track",
      status: "active",
      predecessor: { slug: "old", title: "Old track", status: "closed" },
      planning: "./_planning/planning.md",
      body: "## Scope\n\nDoing stuff.",
    },
  })
  const filePath = path.join(root, "succ", "track.md")
  const { data, content } = await readFront(filePath)
  assert.deepEqual(data.predecessor, {
    slug: "old",
    title: "Old track",
    status: "closed",
  })
  assert.equal(data.planning, "./_planning/planning.md")
  assert.match(content, /## Scope/)
})

test("track_create rejects missing required fields", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () => track_create({ deskRoot: root, input: { title: "x" } }),
    /slug.*required/,
  )
  await assert.rejects(
    () => track_create({ deskRoot: root, input: { slug: "x" } }),
    /title.*required/,
  )
})
