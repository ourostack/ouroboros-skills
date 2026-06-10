// server_dispatch — sanity-check that server.callTool routes every tool
// to its real implementation (no remaining stubs after Unit 6).

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { callTool } from "../../src/server.js"
import { mkTempDeskRoot } from "./_helpers.js"

function parseResult(res) {
  return JSON.parse(res.content[0].text)
}

test("server.callTool routes task_create to the real implementation", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "task_create",
    input: { track: "t", slug: "s", title: "T" },
  })
  assert.ok(!res.isError)
  const body = parseResult(res)
  assert.equal(body.status, "created")
  assert.equal(body.path, path.join("t", "s", "task.md"))
})

test("server.callTool surfaces tool errors as isError with structured body", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "task_update",
    input: { track: "nope", slug: "nada", frontmatter: { status: "x" } },
  })
  assert.ok(res.isError, "missing-task should surface as isError")
  const body = parseResult(res)
  assert.equal(body.status, "error")
  assert.match(body.message, /does not exist/)
})

test("server.callTool routes desk_thread to the real implementation", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "desk_thread",
    input: { start_path: "nope/does/not/exist.md" },
  })
  // No isError — desk_thread returns a structured `not_indexed` payload
  // for an unknown path, not a thrown error.
  const body = parseResult(res)
  assert.equal(body.error, "not_indexed")
  assert.match(body.note, /isn't in the desk-index/)
})

test("server.callTool rejects unknown tool names", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "this_does_not_exist",
    input: {},
  })
  assert.ok(res.isError)
  assert.match(res.content[0].text, /unknown tool/)
})

// Unit 1.2c: the unknown-tool + error branches must still behave with a
// `person` present on the dispatch call (the new threaded field).

test("server.callTool rejects unknown tool names even with person set", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "this_does_not_exist",
    input: {},
    person: "ari",
  })
  assert.ok(res.isError)
  assert.match(res.content[0].text, /unknown tool/)
})

test("server.callTool surfaces tool errors as isError with person set", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "task_update",
    input: { track: "nope", slug: "nada", frontmatter: { status: "x" } },
    person: "ari",
  })
  assert.ok(res.isError)
  const body = JSON.parse(res.content[0].text)
  assert.equal(body.status, "error")
  assert.match(body.message, /does not exist/)
})

test("server.callTool routes a person-scoped write end-to-end (path shows desks/<alias>/)", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "task_create",
    input: { track: "t", slug: "s", title: "T" },
    person: "ari",
  })
  assert.ok(!res.isError)
  const body = JSON.parse(res.content[0].text)
  assert.equal(body.status, "created")
  assert.equal(body.path, path.join("desks", "ari", "t", "s", "task.md"))
})

test("server.callTool surfaces an invalid-alias throw as isError", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "task_create",
    input: { track: "t", slug: "s", title: "T" },
    person: "../evil",
  })
  assert.ok(res.isError)
  const body = JSON.parse(res.content[0].text)
  assert.equal(body.status, "error")
  assert.match(body.message, /alias/i)
})
