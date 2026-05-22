// track_update — merge frontmatter, preserve schema_version + created,
// body append, refusal on missing track.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { track_create, track_update } from "../../src/tools/track.js"
import { mkTempDeskRoot, readFront } from "./_helpers.js"

test("track_update merges frontmatter and refreshes `updated`", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    input: { slug: "t", title: "T" },
  })
  const filePath = path.join(root, "t", "track.md")
  const before = await readFront(filePath)

  await new Promise((r) => setTimeout(r, 1100))

  const result = await track_update({
    deskRoot: root,
    input: { slug: "t", frontmatter: { status: "closed" } },
  })
  assert.equal(result.status, "updated")

  const after = await readFront(filePath)
  assert.equal(after.data.status, "closed")
  assert.equal(after.data.title, "T")
  assert.notEqual(after.data.updated, before.data.updated)
  assert.equal(after.data.created, before.data.created)
})

test("track_update preserves schema_version + created against override", async () => {
  const root = await mkTempDeskRoot()
  await track_create({ deskRoot: root, input: { slug: "t", title: "T" } })
  const filePath = path.join(root, "t", "track.md")
  const before = await readFront(filePath)

  await track_update({
    deskRoot: root,
    input: {
      slug: "t",
      frontmatter: { schema_version: 42, created: "1999-01-01T00:00:00Z" },
    },
  })
  const after = await readFront(filePath)
  assert.equal(after.data.schema_version, 1)
  assert.equal(after.data.created, before.data.created)
})

test("track_update appends to body", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    input: { slug: "t", title: "T", body: "## Scope\n\nOriginal." },
  })
  await track_update({
    deskRoot: root,
    input: { slug: "t", body_append: "## Update\n\nMore." },
  })
  const { content } = await readFront(path.join(root, "t", "track.md"))
  assert.match(content, /Original\./)
  assert.match(content, /## Update/)
})

test("track_update refuses to update a missing track", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () =>
      track_update({
        deskRoot: root,
        input: { slug: "ghost", frontmatter: { status: "active" } },
      }),
    /does not exist/,
  )
})
