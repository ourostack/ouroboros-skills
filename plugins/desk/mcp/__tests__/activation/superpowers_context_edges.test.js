import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { resolveSuperpowersContext } from "../../src/activation/superpowers-context.js"

const cli = fileURLToPath(new URL("../../src/activation/superpowers-context.js", import.meta.url))
const input = { deskRoot: "/desk", taskPath: "/desk/task", iterationPath: "/desk/task/iteration", planPath: "/desk/task/iteration/planning.md", evidenceRoot: "/evidence", step: 1, attempt: 1 }
for (const [args, expected] of [
  [["--step"], "value required for --step"],
  [["--step", "--attempt", "2"], "value required for --step"],
  [["constructor", "2"], "unknown argument constructor"],
  [["__proto__", "2"], "unknown argument __proto__"],
]) {
  test(`context CLI refuses ${args.join(" ")} with its exact diagnostic`, () => {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.equal(result.stderr, `Superpowers context: ${expected}\n`)
  })
}
test("context rejects whitespace-only required paths", async () => {
  await assert.rejects(resolveSuperpowersContext({ ...input, evidenceRoot: " \t " }), { message: "Superpowers context: evidenceRoot is required" })
})
for (const key of ["step", "attempt"]) {
  test(`context rejects non-integer ${key} without filesystem work`, async () => {
    await assert.rejects(resolveSuperpowersContext({ ...input, [key]: 1.5 }), { message: `Superpowers context: ${key} must be a positive integer` })
  })
}
test("context preserves an unexpected canonical-file stat error", async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "superpowers-stat-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const taskPath = path.join(root, "task")
  const iterationPath = path.join(taskPath, "iteration")
  await fs.mkdir(iterationPath, { recursive: true })
  await fs.writeFile(path.join(taskPath, "task.md"), "task\n")
  await fs.writeFile(path.join(iterationPath, "doing.md"), "progress\n")
  await fs.writeFile(path.join(iterationPath, "planning.md"), "plan\n")
  const failure = Object.assign(new Error("fixture canonical stat denied"), { code: "EACCES" })
  t.mock.method(fs, "stat", async () => { throw failure })
  syncBuiltinESMExports()
  try {
    await assert.rejects(resolveSuperpowersContext({ ...input, deskRoot: root, taskPath, iterationPath, planPath: path.join(iterationPath, "planning.md") }), (error) => error === failure)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
