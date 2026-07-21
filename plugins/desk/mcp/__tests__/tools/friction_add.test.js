// friction_add — cross-cutting (no track) vs track-local; append semantics.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { friction_add } from "../../src/tools/friction.js"
import { mkTempDeskRoot, exists } from "./_helpers.js"

test("friction_add (no track) writes to _meta/friction.md", async () => {
  const root = await mkTempDeskRoot()
  const result = await friction_add({
    deskRoot: root,
    input: { body: "## 2026-05-22 — onboarding hurts\n\nFoo." },
  })
  assert.equal(result.status, "added")
  assert.equal(result.path, path.join("_meta", "friction.md"))

  const filePath = path.join(root, "_meta", "friction.md")
  assert.ok(await exists(filePath))
  const content = await fs.readFile(filePath, "utf8")
  assert.match(content, /onboarding hurts/)
})

test("friction_add (with track) writes to <track>/_friction/<date>-<theme>.md", async () => {
  const root = await mkTempDeskRoot()
  const result = await friction_add({
    deskRoot: root,
    input: {
      track: "europe-trip",
      theme: "Visa Logistics",
      body: "## Visa friction\n\nDetails.",
    },
  })
  assert.equal(result.status, "added")
  assert.match(result.path, /^europe-trip\/_friction\/\d{4}-\d{2}-\d{2}-visa-logistics\.md$/)

  const filePath = path.join(root, result.path)
  const content = await fs.readFile(filePath, "utf8")
  assert.match(content, /Visa friction/)
})

test("friction_add appends with a separator on the second call", async () => {
  const root = await mkTempDeskRoot()
  await friction_add({
    deskRoot: root,
    input: { body: "first entry body" },
  })
  await friction_add({
    deskRoot: root,
    input: { body: "second entry body" },
  })

  const content = await fs.readFile(
    path.join(root, "_meta", "friction.md"),
    "utf8",
  )
  assert.match(content, /first entry body/)
  assert.match(content, /second entry body/)
  assert.match(content, /---/, "separator between entries")
  assert.ok(
    content.indexOf("first entry") < content.indexOf("second entry"),
    "order preserved",
  )
})

test("friction_add normalizes trailing newlines and appends to a file without one", async () => {
  const root = await mkTempDeskRoot()
  const filePath = path.join(root, "_meta", "friction.md")
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, "existing entry without newline", "utf8")

  await friction_add({
    deskRoot: root,
    input: { body: "new entry with newline\n" },
  })

  const content = await fs.readFile(filePath, "utf8")
  assert.match(content, /existing entry without newline\n\n---\n\nnew entry with newline\n$/)
})

test("friction_add defaults theme to 'untitled' if missing", async () => {
  const root = await mkTempDeskRoot()
  const result = await friction_add({
    deskRoot: root,
    input: { track: "t1", body: "Untitled friction" },
  })
  assert.match(result.path, /-untitled\.md$/)
})

test("friction_add requires a body", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () => friction_add({ deskRoot: root }),
    /body.*required/,
  )
  await assert.rejects(
    () => friction_add({ deskRoot: root, input: {} }),
    /body.*required/,
  )
  await assert.rejects(
    () => friction_add({ deskRoot: root, input: { body: 123 } }),
    /body.*required/,
  )
})
