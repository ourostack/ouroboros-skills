import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { importRuntimeServer } from "../../src/runtime/bootstrap.js"

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const mcpVersion = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8")).version
const deskVersion = JSON.parse(readFileSync(path.join(mcpRoot, "..", "plugin.json"), "utf8")).version
const fixture = JSON.parse(process.argv[2])
const runtime = await importRuntimeServer({
  mcpRoot,
  runtimeCacheDir: path.join(fixture.base, "runtime-cache"),
})
assert.equal(runtime._deskRuntime.loaded_from_source_mirror, true)
const captured = await runtime.callTool({
  deskRoot: fixture.deskRoot,
  statusContext: { runtime: runtime._deskRuntime },
  name: "desk_feedback",
  input: { action: "capture", text: "Source-mirror feedback fixture." },
})
assert.equal(captured.isError, undefined, JSON.stringify(captured.content))
const { entry } = JSON.parse(captured.content[0].text)
assert.equal(entry.preview_version, deskVersion)
assert.notEqual(entry.preview_version, mcpVersion)

const listed = await runtime.callTool({
  deskRoot: fixture.deskRoot,
  statusContext: { runtime: runtime._deskRuntime },
  name: "desk_feedback",
  input: { action: "list" },
})
assert.equal(listed.isError, undefined, JSON.stringify(listed.content))
assert.deepEqual(JSON.parse(listed.content[0].text).entries, [entry])
process.stdout.write("source-mirror-feedback-ok\n")
