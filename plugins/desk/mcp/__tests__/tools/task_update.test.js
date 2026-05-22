// task_update — frontmatter merge, body append, preservation of
// schema_version + created, refusal on missing task.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { task_create, task_update } from "../../src/tools/task.js"
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
