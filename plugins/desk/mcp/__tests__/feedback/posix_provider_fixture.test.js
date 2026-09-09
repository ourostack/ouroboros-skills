import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { writePosixNodeProvider } from "./_helpers.js"

test("POSIX provider shim retains Node options, literal arguments, stdin, diagnostics and exit status", {
  skip: process.platform === "win32" ? "POSIX stand-in contract; native Windows uses the actual provider" : false,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "provider fixture-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const providerPath = path.join(root, "powershell.exe")
  const marker = "--stack-trace-limit=51"
  const priorOptions = process.env.NODE_OPTIONS ?? ""
  const imports = [...priorOptions.matchAll(/--import=(\S+)/gu)].map((match) => match[1])
  await writePosixNodeProvider(providerPath, `
let input = ""
process.stdin.on("data", chunk => { input += chunk })
process.stdin.on("end", () => {
  const options = process.env.NODE_OPTIONS || ""
  process.stdout.write(JSON.stringify({
    args: process.argv.slice(2), input,
    marker: options.includes(${JSON.stringify(marker)}),
    inheritedImports: ${JSON.stringify(imports)}.every(value => options.includes(value))
  }))
  process.stderr.write("fixture diagnostic\\n")
  process.exitCode = 7
})
`)
  const args = ["--literal", "spaces here", "quote'\""]
  const result = spawnSync(providerPath, args, {
    cwd: root, encoding: "utf8", input: "fixture input",
    env: { ...process.env, NODE_OPTIONS: `${priorOptions} ${marker}`.trim() },
  })
  assert.equal(result.status, 7, result.stderr)
  assert.equal(result.stderr, "fixture diagnostic\n")
  assert.deepEqual(JSON.parse(result.stdout), {
    args, input: "fixture input", marker: true, inheritedImports: true,
  })
  assert.equal(process.env.NODE_OPTIONS ?? "", priorOptions)
})
