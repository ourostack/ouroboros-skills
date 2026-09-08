import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { importRuntimeServer } from "../../src/runtime/bootstrap.js"
import { cleanup, mkFeedbackFixture, useStateHome } from "./_helpers.js"

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const mcpVersion = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8")).version
const deskVersion = JSON.parse(readFileSync(path.join(mcpRoot, "..", "plugin.json"), "utf8")).version
const target = `${process.platform}-${process.arch}-node-${process.versions.modules}`
const matrix = JSON.parse(readFileSync(path.join(mcpRoot, "artifacts", "runtime-deps", mcpVersion, "support-matrix.json"), "utf8"))
const shippedTarget = matrix.targets.some(({ id }) => id === target)

test("native source-mirror feedback attributes the installed Desk, not the MCP or cache parent", {
  skip: shippedTarget ? false : `no shipped runtime pack for ${target}`,
}, async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
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
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
