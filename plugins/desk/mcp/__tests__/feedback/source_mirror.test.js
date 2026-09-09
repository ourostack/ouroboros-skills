import { test } from "node:test"
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { cleanup, mkFeedbackFixture } from "./_helpers.js"

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const mcpVersion = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8")).version
const target = `${process.platform}-${process.arch}-node-${process.versions.modules}`
const matrix = JSON.parse(readFileSync(path.join(mcpRoot, "artifacts", "runtime-deps", mcpVersion, "support-matrix.json"), "utf8"))
const shippedTarget = matrix.targets.some(({ id }) => id === target)

test("native source-mirror feedback attributes the installed Desk, not the MCP or cache parent", {
  skip: shippedTarget ? false : `no shipped runtime pack for ${target}`,
}, async () => {
  const fixture = await mkFeedbackFixture()
  try {
    // Keep native-library handles out of the process that removes the fixture.
    const output = execFileSync(process.execPath, [
      fileURLToPath(new URL("./_source_mirror_smoke.js", import.meta.url)),
      JSON.stringify(fixture),
    ], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, XDG_STATE_HOME: fixture.stateHome },
    })
    assert.equal(output, "source-mirror-feedback-ok\n")
  } finally {
    await cleanup(fixture.base)
  }
})
