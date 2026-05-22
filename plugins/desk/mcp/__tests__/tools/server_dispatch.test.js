// server_dispatch — sanity-check that server.callTool routes the 7 runtime
// tools to their real implementations and still stubs the search tools.

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

test("server.callTool returns not_implemented for search tools (still stubs)", async () => {
  const root = await mkTempDeskRoot()
  const res = await callTool({
    deskRoot: root,
    name: "desk_search",
    input: { q: "anything" },
  })
  const body = parseResult(res)
  assert.equal(body.status, "not_implemented")
  assert.equal(body.tool, "desk_search")
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
