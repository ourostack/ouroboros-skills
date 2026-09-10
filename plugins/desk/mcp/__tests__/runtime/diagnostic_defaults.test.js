import { test } from "node:test"
import { strict as assert } from "node:assert"
import { PassThrough } from "node:stream"
import { startDiagnosticServer } from "../../src/runtime/diagnostic-server.js"

test("diagnostic startup with omitted options uses ambient streams and releases their listeners", async (t) => {
  const input = new PassThrough()
  const output = new PassThrough()
  let text = ""
  output.on("data", (chunk) => { text += chunk })
  const stdin = t.mock.getter(process, "stdin", () => input)
  const stdout = t.mock.getter(process, "stdout", () => output)
  let running
  try {
    running = startDiagnosticServer()
  } finally {
    stdin.mock.restore()
    stdout.mock.restore()
  }
  input.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }))
  await running
  const response = JSON.parse(text)
  assert.equal(response.id, 1)
  assert.deepEqual(response.result.serverInfo, { name: "desk-mcp-diagnostic", version: "0.0.0" })
  for (const event of ["data", "end", "error"]) assert.equal(input.listenerCount(event), 0)
})
