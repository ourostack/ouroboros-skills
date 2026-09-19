import { strict as assert } from "node:assert"
import { test } from "node:test"
import { createRequire } from "node:module"
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const require = createRequire(import.meta.url)
const loadCheck = require(path.join(repoRoot, "scripts", "check-claude-plugin-load.cjs"))

// A stand-in for the Claude Code CLI: records installs in its profile and
// lists them back, reporting errors named in FAKE_CLAUDE_ERRORS.
const fakeClaudeSource = `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const args = process.argv.slice(2)
const state = () => path.join(process.env.CLAUDE_CONFIG_DIR, "installed.json")
const read = () => (fs.existsSync(state()) ? JSON.parse(fs.readFileSync(state(), "utf8")) : [])
if (args[0] === "--version") process.stdout.write("9.9.9 (Claude Code)\\n")
else if (args[1] === "marketplace") fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true })
else if (args[1] === "install") fs.writeFileSync(state(), JSON.stringify([...read(), args[2]]))
else if (args[1] === "list") {
  const errors = JSON.parse(process.env.FAKE_CLAUDE_ERRORS || "{}")
  process.stdout.write(JSON.stringify(read().map((id) => ({ id, version: "1.0.0", errors: errors[id] }))))
}
`

function withScratch(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "claude-load-test-"))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeFixtureRepo(root, plugins) {
  const repo = path.join(root, "repo")
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true })
  writeFileSync(path.join(repo, ".claude-plugin", "marketplace.json"), JSON.stringify({
    name: "fixture",
    plugins: plugins.map((name) => ({ name, source: `./plugins/${name}` })),
  }))
  return repo
}

function writeFakeClaude(root) {
  const bin = path.join(root, "bin")
  mkdirSync(bin)
  const claude = path.join(bin, "claude")
  writeFileSync(claude, fakeClaudeSource)
  chmodSync(claude, 0o755)
  return { bin, claude }
}

function capture() {
  const chunks = []
  return { write: (chunk) => chunks.push(chunk), text: () => chunks.join("") }
}

// Scripted responses keyed by Claude CLI subcommand, for failure paths the
// fake executable does not model.
function scriptedClaude({ install, list }) {
  let current
  return (args) => {
    if (args[0] === "--version") return "1.2.3 (Claude Code)\n"
    if (args[1] === "install") {
      current = args[2]
      return install(current)
    }
    if (args[1] === "list") return JSON.stringify(list(current))
    return ""
  }
}

test("passes when every plugin and dependency loads, using the real Claude runner", () => withScratch((root) => {
  const repo = writeFixtureRepo(root, ["desk", "crew"])
  const { bin } = writeFakeClaude(root)
  const scratch = path.join(root, "tmp")
  mkdirSync(scratch)
  const stdout = capture()
  const stderr = capture()

  const code = loadCheck.run({
    repoRoot: repo,
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CLAUDE_BIN: "" },
    tmpDir: scratch,
    stdout,
    stderr,
  })

  assert.equal(code, 0, stderr.text())
  assert.equal(stdout.text(), [
    "Claude Code 9.9.9 (Claude Code)",
    "ok desk@fixture (loaded desk@fixture 1.0.0)",
    "ok crew@fixture (loaded crew@fixture 1.0.0)",
    "",
  ].join("\n"))
  assert.equal(stderr.text(), "")
  assert.deepEqual(readdirSync(scratch), [], "each throwaway profile is removed")
}))

test("reports load errors for the plugin and for the dependencies it pulled in", () => withScratch((root) => {
  const repo = writeFixtureRepo(root, ["desk"])
  const { claude } = writeFakeClaude(root)
  const stdout = capture()
  const stderr = capture()
  const env = { ...process.env, CLAUDE_BIN: claude }
  const runClaude = loadCheck.claudeRunner({ claude, repoRoot: repo })

  const failures = loadCheck.checkPlugin("desk@fixture", {
    run: (args, profileEnv) => {
      const output = runClaude(args, profileEnv)
      if (args[1] === "install") runClaude(["plugin", "install", "superpowers@fixture"], profileEnv)
      return output
    },
    repoRoot: repo,
    baseEnv: {
      ...env,
      FAKE_CLAUDE_ERRORS: JSON.stringify({
        "desk@fixture": ["Hook load failed"],
        "superpowers@fixture": ["Requires plain-language 0.2.0"],
      }),
    },
    tmpDir: root,
  }).failures

  assert.deepEqual(failures, [
    "desk@fixture: Hook load failed",
    "desk@fixture (dependency superpowers@fixture): Requires plain-language 0.2.0",
  ])
  assert.equal(stdout.text(), "")
  assert.equal(stderr.text(), "")
}))

test("fails with every install error, missing plugin and load error it finds", () => withScratch((root) => {
  const repo = writeFixtureRepo(root, ["with-stderr", "without-stderr", "missing", "broken"])
  const stdout = capture()
  const stderr = capture()

  const code = loadCheck.run({
    repoRoot: repo,
    env: {},
    tmpDir: root,
    stdout,
    stderr,
    runClaude: scriptedClaude({
      install: (id) => {
        if (id === "with-stderr@fixture") throw Object.assign(new Error("exit 1"), { stderr: " conflicting versions \n" })
        if (id === "without-stderr@fixture") throw new Error("spawn claude ENOENT")
        return ""
      },
      list: (id) => (id === "broken@fixture"
        ? [{ id, version: "1.0.0", errors: ["Duplicate hooks file"] }]
        : []),
    }),
  })

  assert.equal(code, 1)
  assert.equal(stdout.text(), "Claude Code 1.2.3 (Claude Code)\n")
  assert.equal(stderr.text(), [
    "",
    "Claude Code failed to load 4 plugin(s) or dependencies:",
    "  with-stderr@fixture: install failed: conflicting versions",
    "  without-stderr@fixture: install failed: spawn claude ENOENT",
    "  missing@fixture: not installed",
    "  broken@fixture: Duplicate hooks file",
    "",
  ].join("\n"))
  assert.deepEqual(readdirSync(root).filter((name) => name.startsWith("claude-plugin-load-")), [])
}))

test("defaults to this repository, the process environment and CLAUDE_BIN", () => withScratch((root) => {
  const { claude } = writeFakeClaude(root)
  const previous = process.env.CLAUDE_BIN
  process.env.CLAUDE_BIN = claude
  try {
    // With no arguments, run() writes to the process streams; capture them so
    // its "ok" lines do not reach this test's TAP output.
    const stdout = capture()
    const originalWrite = process.stdout.write
    process.stdout.write = stdout.write
    let code
    try {
      code = loadCheck.run()
    } finally {
      process.stdout.write = originalWrite
    }
    assert.equal(code, 0)
    assert.match(stdout.text(), /^Claude Code 9\.9\.9 \(Claude Code\)\nok desk@ouroboros-skills \(loaded desk@ouroboros-skills 1\.0\.0\)\n/u)
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN
    else process.env.CLAUDE_BIN = previous
  }
}))

test("startCli runs only as the main module and sets the exit code", () => {
  assert.equal(loadCheck.startCli({ isMain: false, runFn: () => assert.fail("must not run") }), null)

  const codes = []
  assert.equal(loadCheck.startCli({ isMain: true, runFn: () => 1, setExitCode: (code) => codes.push(code) }), 1)
  assert.deepEqual(codes, [1])

  const previous = process.exitCode
  try {
    assert.equal(loadCheck.startCli({ isMain: true, runFn: () => 0 }), 0)
    assert.equal(process.exitCode, 0)
  } finally {
    process.exitCode = previous
  }
})
