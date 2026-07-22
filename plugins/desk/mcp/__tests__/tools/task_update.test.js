// task_update — frontmatter merge, body append, preservation of
// schema_version + created, refusal on missing task.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { task_create, task_update } from "../../src/tools/task.js"
import { writeMarkdown } from "../../src/util/fm.js"
import { mkTempDeskRoot, readFront } from "./_helpers.js"

test("task_update merges frontmatter and refreshes `updated`", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T", body: "Hello" },
  })
  const filePath = path.join(root, "t", "s", "task.md")
  const before = await readFront(filePath)

  // Force a small wait so `updated` will differ at second-precision.
  await new Promise((r) => setTimeout(r, 1100))

  const result = await task_update({
    deskRoot: root,
    input: {
      track: "t",
      slug: "s",
      frontmatter: { status: "in_progress", category: "general" },
    },
  })
  assert.equal(result.status, "updated")

  const after = await readFront(filePath)
  assert.equal(after.data.status, "in_progress")
  assert.equal(after.data.category, "general")
  assert.equal(after.data.title, "T", "title preserved")
  assert.notEqual(after.data.updated, before.data.updated, "updated bumped")
  assert.equal(after.data.created, before.data.created, "created preserved")
  assert.equal(after.data.schema_version, 1)
})

test("task_update preserves schema_version + created even if caller overrides them", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T" },
  })
  const filePath = path.join(root, "t", "s", "task.md")
  const before = await readFront(filePath)

  await task_update({
    deskRoot: root,
    input: {
      track: "t",
      slug: "s",
      frontmatter: {
        schema_version: 99,
        created: "1900-01-01T00:00:00Z",
        status: "blocked",
      },
    },
  })
  const after = await readFront(filePath)
  assert.equal(after.data.schema_version, 1, "schema_version locked to 1")
  assert.equal(after.data.created, before.data.created, "created locked")
  assert.equal(after.data.status, "blocked")
})

test("task_update adds schema_version to a legacy task without inventing created", async () => {
  const root = await mkTempDeskRoot()
  const filePath = path.join(root, "t", "s", "task.md")
  await writeMarkdown(filePath, { title: "Legacy" }, "Legacy body")

  await task_update({
    deskRoot: root,
    input: { track: "t", slug: "s", frontmatter: { status: "active" } },
  })

  const after = await readFront(filePath)
  assert.equal(after.data.schema_version, 1)
  assert.equal(after.data.created, undefined)
})

test("task_update appends to body with a blank-line separator", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T", body: "Original body" },
  })
  await task_update({
    deskRoot: root,
    input: { track: "t", slug: "s", body_append: "Second paragraph" },
  })
  const { content } = await readFront(
    path.join(root, "t", "s", "task.md"),
  )
  assert.match(content, /Original body/)
  assert.match(content, /Second paragraph/)
  assert.ok(
    content.indexOf("Original body") < content.indexOf("Second paragraph"),
    "appended content follows existing body",
  )
})

test("task_update appends without a separator to empty or blank-line-terminated bodies", async () => {
  const root = await mkTempDeskRoot()
  const emptyPath = path.join(root, "t", "empty", "task.md")
  const terminatedPath = path.join(root, "t", "terminated", "task.md")
  await fs.mkdir(path.dirname(emptyPath), { recursive: true })
  await fs.mkdir(path.dirname(terminatedPath), { recursive: true })
  await fs.writeFile(emptyPath, "---\ntitle: Empty\n---\n", "utf8")
  await fs.writeFile(
    terminatedPath,
    "---\ntitle: Terminated\n---\nBody\n\n",
    "utf8",
  )

  await task_update({
    deskRoot: root,
    input: { track: "t", slug: "empty", body_append: "First" },
  })
  await task_update({
    deskRoot: root,
    input: { track: "t", slug: "terminated", body_append: "Next" },
  })

  assert.match((await readFront(emptyPath)).content, /^\n?First/)
  assert.match((await readFront(terminatedPath)).content, /Body\n\nNext/)
})

test("task_update ignores an empty body append", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T", body: "Original" },
  })

  await task_update({
    deskRoot: root,
    input: { track: "t", slug: "s", body_append: "" },
  })

  assert.match(
    (await readFront(path.join(root, "t", "s", "task.md"))).content,
    /Original/,
  )
})

test("task_update refuses to update a missing task", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () =>
      task_update({
        deskRoot: root,
        input: { track: "nope", slug: "nada", frontmatter: { status: "x" } },
      }),
    /does not exist/,
  )
})

test("task_update requires both task identifiers", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    task_update({ deskRoot: root }),
    /track.*slug.*required/,
  )
  await assert.rejects(
    task_update({
      deskRoot: root,
      input: { slug: "s", frontmatter: { status: "x" } },
    }),
    /track.*slug.*required/,
  )
  await assert.rejects(
    task_update({
      deskRoot: root,
      input: { track: "t", frontmatter: { status: "x" } },
    }),
    /track.*slug.*required/,
  )
})
