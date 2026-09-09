import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

for (const [helper, prefix] of [
  ["_search_helpers.js", "desk-search-test-"],
  ["_helpers.js", "desk-test-"],
]) {
  for (const outcome of ["success", "failure", "abort"]) {
    test(`${helper} removes its fixtures after ${outcome} without removing sibling fixtures`, () => {
      const sandbox = mkdtempSync(path.join(tmpdir(), "desk-fixture-cleanup-"))
      try {
        const sibling = mkdtempSync(path.join(sandbox, prefix))
        writeFileSync(path.join(sibling, "unrelated.txt"), "keep this fixture", "utf8")
        const script = path.join(sandbox, "fixture-case.mjs")
        writeFileSync(script, [
          `import { test } from "node:test"`,
          `import { strict as assert } from "node:assert"`,
          `import { existsSync } from "node:fs"`,
          `import { mkTempDeskRoot } from ${JSON.stringify(new URL(helper, import.meta.url).href)}`,
          `const controller = new AbortController()`,
          `test("fixture lifecycle", { signal: controller.signal }, async (t) => {`,
          `  const roots = [await mkTempDeskRoot(), await mkTempDeskRoot()]`,
          `  process.stdout.write("fixture-roots:" + JSON.stringify(roots) + "\\n")`,
          `  t.after(() => roots.forEach(root => assert.equal(existsSync(root), true, "fixtures must remain available to test teardown")))`,
          `  if (${JSON.stringify(outcome)} === "failure") throw new Error("expected fixture body failure")`,
          `  if (${JSON.stringify(outcome)} === "abort") {`,
          `    controller.abort()`,
          `    process.stdout.write("fixture-aborted:" + controller.signal.aborted + "\\n")`,
          `    await new Promise(() => {})`,
          `  }`,
          `})`,
          ``,
        ].join("\n"), "utf8")
        const env = { ...process.env, TMPDIR: sandbox, TMP: sandbox, TEMP: sandbox }
        delete env.NODE_TEST_CONTEXT
        const result = spawnSync(process.execPath, ["--test", script], {
          env,
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        })
        assert.equal(result.error, undefined, result.error?.message)
        assert.equal(result.signal, null, result.stderr)
        assert.equal(result.status, outcome === "success" ? 0 : 1, result.stderr || result.stdout)
        if (outcome === "abort") assert.match(result.stdout, /fixture-aborted:true/u)
        const reported = result.stdout.match(/fixture-roots:(\[[^\n]+\])/u)
        assert.ok(reported, result.stderr || result.stdout)
        const roots = JSON.parse(reported[1])
        assert.equal(roots.length, 2)
        for (const root of roots) {
          assert.equal(realpathSync(path.dirname(root)), realpathSync(sandbox))
          assert.ok(path.basename(root).startsWith(prefix))
          assert.equal(existsSync(root), false, `fixture survived completed ${outcome}: ${root}`)
        }
        assert.equal(readFileSync(path.join(sibling, "unrelated.txt"), "utf8"), "keep this fixture")
      } finally {
        rmSync(sandbox, { recursive: true, force: true })
      }
    })
  }
}
