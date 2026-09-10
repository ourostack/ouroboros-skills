import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"

const pluginRoot = new URL("../../../", import.meta.url)

for (const surface of ["agents/worker.toml", "output-styles/worker.md"]) {
  test(`${surface} binds long-running work to bounded process continuity`, () => {
    const source = readFileSync(new URL(surface, pluginRoot), "utf8")
    assert.match(source, /Long-lived work, bounded processes/u)
    assert.match(source, /session-resumption.*checkpoint|checkpoint.*session-resumption/u)
    assert.match(source, /process exit is not task completion/u)
  })
}
