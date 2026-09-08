// lesson_add — initial write vs subsequent update; slugify topic; reject empty.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { lesson_add } from "../../src/tools/lesson.js"
import { mkTempDeskRoot, exists } from "./_helpers.js"

test("lesson_add creates _meta/tips/<topic-slug>.md with header on first write", async () => {
  const root = await mkTempDeskRoot()
  const result = await lesson_add({
    deskRoot: root,
    input: {
      topic: "Working with gh CLI on EMU",
      body: "Use `gh auth switch -u <alias>_microsoft`.",
    },
  })
  assert.equal(result.status, "added")
  assert.equal(
    result.path,
    path.join("_meta", "tips", "working-with-gh-cli-on-emu.md"),
  )
  const filePath = path.join(root, result.path)
  assert.ok(await exists(filePath))

  const content = await fs.readFile(filePath, "utf8")
  assert.match(content, /^# Working with gh CLI on EMU/, "h1 header derived from topic")
  assert.match(content, /gh auth switch/)
})

test("lesson_add appends an `## Update <date>` section when file exists", async () => {
  const root = await mkTempDeskRoot()
  await lesson_add({
    deskRoot: root,
    input: { topic: "topic-x", body: "First lesson." },
  })
  await lesson_add({
    deskRoot: root,
    input: { topic: "topic-x", body: "Second lesson, learned later." },
  })
  const content = await fs.readFile(
    path.join(root, "_meta", "tips", "topic-x.md"),
    "utf8",
  )
  assert.match(content, /First lesson/)
  assert.match(content, /## Update \d{4}-\d{2}-\d{2}/)
  assert.match(content, /Second lesson/)
  assert.ok(
    content.indexOf("First lesson") < content.indexOf("Second lesson"),
    "first lesson precedes the update",
  )
})

test("lesson_add normalizes trailing newlines and appends to a file without one", async () => {
  const root = await mkTempDeskRoot()
  const filePath = path.join(root, "_meta", "tips", "topic-x.md")
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, "# Existing lesson", "utf8")

  await lesson_add({
    deskRoot: root,
    input: { topic: "topic-x", body: "New lesson.\n" },
  })

  const content = await fs.readFile(filePath, "utf8")
  assert.match(content, /# Existing lesson\n\n## Update \d{4}-\d{2}-\d{2}\n\nNew lesson\.\n$/)
})

test("lesson_add rejects empty topic or body", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () => lesson_add({ deskRoot: root }),
    /topic.*required/,
  )
  await assert.rejects(
    () => lesson_add({ deskRoot: root, input: { body: "x" } }),
    /topic.*required/,
  )
  await assert.rejects(
    () => lesson_add({ deskRoot: root, input: { topic: "x" } }),
    /body.*required/,
  )
  await assert.rejects(
    () => lesson_add({ deskRoot: root, input: { topic: 123, body: "x" } }),
    /topic.*required/,
  )
  await assert.rejects(
    () => lesson_add({ deskRoot: root, input: { topic: "x", body: 123 } }),
    /body.*required/,
  )
  await assert.rejects(
    () => lesson_add({ deskRoot: root, input: { topic: "!!!", body: "x" } }),
    /slugified to empty/,
  )
})
