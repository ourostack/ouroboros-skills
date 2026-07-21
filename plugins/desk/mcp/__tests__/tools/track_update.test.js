// track_update — merge frontmatter, preserve schema_version + created,
// body append, refusal on missing track.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { track_create, track_update } from "../../src/tools/track.js"
import { writeMarkdown } from "../../src/util/fm.js"
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

test("track_update adds schema_version to a legacy track without inventing created", async () => {
  const root = await mkTempDeskRoot()
  const filePath = path.join(root, "t", "track.md")
  await writeMarkdown(filePath, { title: "Legacy" }, "Legacy body")

  await track_update({
    deskRoot: root,
    input: { slug: "t", frontmatter: { status: "active" } },
  })

  const after = await readFront(filePath)
  assert.equal(after.data.schema_version, 1)
  assert.equal(after.data.created, undefined)
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

test("track_update appends without a separator to empty or blank-line-terminated bodies", async () => {
  const root = await mkTempDeskRoot()
  const emptyPath = path.join(root, "empty", "track.md")
  const terminatedPath = path.join(root, "terminated", "track.md")
  await fs.mkdir(path.dirname(emptyPath), { recursive: true })
  await fs.mkdir(path.dirname(terminatedPath), { recursive: true })
  await fs.writeFile(emptyPath, "---\ntitle: Empty\n---\n", "utf8")
  await fs.writeFile(
    terminatedPath,
    "---\ntitle: Terminated\n---\nBody\n\n",
    "utf8",
  )

  await track_update({
    deskRoot: root,
    input: { slug: "empty", body_append: "First" },
  })
  await track_update({
    deskRoot: root,
    input: { slug: "terminated", body_append: "Next" },
  })

  assert.match((await readFront(emptyPath)).content, /^\n?First/)
  assert.match((await readFront(terminatedPath)).content, /Body\n\nNext/)
})

test("track_update ignores an empty body append", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    input: { slug: "t", title: "T", body: "Original" },
  })

  await track_update({
    deskRoot: root,
    input: { slug: "t", body_append: "" },
  })

  assert.match((await readFront(path.join(root, "t", "track.md"))).content, /Original/)
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

test("track_update requires a slug", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    track_update({ deskRoot: root }),
    /slug.*required/,
  )
  await assert.rejects(
    track_update({
      deskRoot: root,
      input: { frontmatter: { status: "active" } },
    }),
    /slug.*required/,
  )
})
