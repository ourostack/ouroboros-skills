import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import processOnSpawn from "process-on-spawn"
import { runCoverageCommand } from "../../src/coverage/runner.js"

const esmSource = "plugins/desk/mcp/src/subject.js"
const cjsSource = "scripts/subject.cjs"
const unexecutedSource = "plugins/desk/mcp/src/unexecuted.js"

function runProducerFixture(t, { complete, includeUnexecuted = false }) {
  const root = mkdtempSync(path.join(tmpdir(), "desk-coverage-producer-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repoRoot = path.join(root, "repo")
  const physicalRoot = path.join(root, "physical")
  mkdirSync(physicalRoot)
  symlinkSync(physicalRoot, repoRoot, "junction")
  const mcpRoot = path.join(repoRoot, "plugins/desk/mcp")
  const reportDirectory = path.join(root, "report")
  const write = (file, text) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
    return file
  }
  const writeSource = (file, text) => write(path.join(repoRoot, file), text)
  const templateDirectory = path.join(root, "empty-template")
  mkdirSync(templateDirectory)
  const globalConfig = write(path.join(root, "empty-git-config"), "")
  const env = Object.fromEntries(
    ["PATH", "HOME", "SystemRoot", "WINDIR", "TEMP", "TMP"]
      .filter(name => process.env[name] !== undefined)
      .map(name => [name, process.env[name]]),
  )
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: templateDirectory,
  })
  const git = spawnSync("git", ["init", "--quiet", repoRoot], { env, encoding: "utf8" })
  assert.equal(git.status, 0, git.stderr)
  const configPath = writeSource("plugins/desk/mcp/config/coverage-gate.json", JSON.stringify({
    thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    exclusions: [],
  }))
  const packageJsonPath = writeSource("plugins/desk/mcp/package.json", JSON.stringify({
    type: "module",
    scripts: { "test:coverage": "node scripts/run-coverage.js" },
  }))
  const workflowPath = writeSource(".github/workflows/desk-mcp-tests.yml", [
    "on:",
    "  pull_request:",
    "    paths:",
    '      - "scripts/*.cjs"',
    "  push:",
    "    paths:",
    '      - "scripts/*.cjs"',
    "jobs:",
    "  tests:",
    "    steps:",
    "      - run: npm run test:coverage",
  ].join("\n"))
  writeSource(esmSource, [
    "export function invoke(callback) {",
    "  callback()",
    "  globalThis.coverageUnreached = true",
    "}",
    "",
  ].join("\n"))
  writeSource(cjsSource, [
    "module.exports.invoke = function invoke(callback) {",
    "  callback()",
    "  globalThis.coverageCjsUnreached = true",
    "}",
    "",
  ].join("\n"))
  if (includeUnexecuted) writeSource(unexecutedSource, "export const unexecuted = true\n")
  writeSource("plugins/desk/mcp/__tests__/subject.test.js", [
    'import { test } from "node:test"',
    'import { strict as assert } from "node:assert"',
    'import { invoke } from "../src/subject.js"',
    'import cjs from "../../../../scripts/subject.cjs"',
    'test("ESM and CommonJS execution witness", () => {',
    ...(complete ? [
      "  invoke(() => {})",
      "  cjs.invoke(() => {})",
      "  assert.equal(globalThis.coverageUnreached, true)",
      "  assert.equal(globalThis.coverageCjsUnreached, true)",
    ] : [
      '  const fail = () => { throw new Error("expected callback failure") }',
      '  assert.throws(() => invoke(fail), /expected callback failure/)',
      '  assert.throws(() => cjs.invoke(fail), /expected callback failure/)',
      '  assert.equal(Object.hasOwn(globalThis, "coverageUnreached"), false)',
      '  assert.equal(Object.hasOwn(globalThis, "coverageCjsUnreached"), false)',
    ]),
    "})",
    "",
  ].join("\n"))
  const output = { stdout: "", stderr: "" }
  const executions = []
  let summary
  let coverage
  const result = runCoverageCommand({
    paths: { repoRoot, mcpRoot, configPath, packageJsonPath, workflowPath },
    env,
    io: {
      stdout: { write: text => { output.stdout += text } },
      stderr: { write: text => { output.stderr += text } },
    },
    fsOps: {
      makeTempDir: () => {
        mkdirSync(reportDirectory)
        return reportDirectory
      },
      readText: file => readFileSync(file, "utf8"),
      writeText: (file, text) => writeFileSync(file, text),
      removeDir: directory => {
        const summaryFile = path.join(directory, "coverage-summary.json")
        const coverageFile = path.join(directory, "coverage-final.json")
        if (existsSync(summaryFile)) summary = JSON.parse(readFileSync(summaryFile, "utf8"))
        if (existsSync(coverageFile)) coverage = JSON.parse(readFileSync(coverageFile, "utf8"))
        rmSync(directory, { recursive: true, force: true })
      },
    },
    spawn: (command, args, options) => {
      // A nested nyc process must not inherit the outer test run's measurement configuration.
      const isolateProducer = child => {
        if (command === process.execPath) child.env = { ...(options.env ?? env) }
      }
      processOnSpawn.addListener(isolateProducer)
      try {
        const child = spawnSync(command, args, { env, ...options, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
        executions.push({ command, args, cwd: options.cwd, status: child.status, signal: child.signal })
        return child
      } finally {
        processOnSpawn.removeListener(isolateProducer)
      }
    },
  })
  assert.equal(existsSync(reportDirectory), false)
  t.diagnostic(JSON.stringify({ result, executions, summary, coverage, output }))
  return { result, output, summary, coverage, repoRoot }
}

function entry(run, file) {
  const observed = run.summary[path.join(realpathSync(run.repoRoot), file)] ?? run.summary[file]
  assert.ok(observed, `missing canonical producer entry for ${file}`)
  return observed
}

test("the installed producer rejects genuinely unexecuted ESM and CommonJS statements through the owning gate", t => {
  const run = runProducerFixture(t, { complete: false })
  assert.equal(run.result, 1, JSON.stringify(run.output))
  assert.match(run.output.stderr, /subject\.js statements coverage 50 is below 100/)
  assert.match(run.output.stderr, /subject\.cjs statements coverage 66\.66 is below 100/)
  assert.deepEqual(
    [entry(run, esmSource).statements.covered, entry(run, esmSource).statements.total],
    [1, 2],
  )
  assert.deepEqual(
    [entry(run, cjsSource).statements.covered, entry(run, cjsSource).statements.total],
    [2, 3],
  )
})

test("the installed producer admits complete ESM and CommonJS execution from an aliased root without runtime warnings", t => {
  const run = runProducerFixture(t, { complete: true })
  assert.equal(run.result, 0, JSON.stringify(run.output))
  assert.equal(run.output.stderr, "")
  assert.equal(run.summary.total.statements.covered, 5)
  assert.equal(run.summary.total.statements.total, 5)
  assert.equal(run.summary.total.statements.pct, 100)
  assert.equal(Object.keys(run.coverage).length, 2)
})

test("the selected producer measures unloaded required source rather than omitting or inventing coverage", t => {
  const run = runProducerFixture(t, { complete: true, includeUnexecuted: true })
  assert.equal(run.result, 1, JSON.stringify(run.output))
  assert.match(run.output.stderr, /unexecuted\.js statements coverage 0 is below 100/)
  assert.deepEqual(
    [entry(run, unexecutedSource).statements.covered, entry(run, unexecutedSource).statements.total],
    [0, 1],
  )
})
