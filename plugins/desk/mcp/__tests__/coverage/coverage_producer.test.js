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
const offlineEsmSource = "evals/offline/subject.mjs"
const offlineTypeScriptSource = "evals/offline/vendor/gauntlet/src/subject.ts"
const offlineBridgeSource = "scripts/skill-evals.cjs"

function runProducerFixture(t, { complete, includeUnexecuted = false, viaChild = false, childFromRepoRoot = false, offline = false, offlineTests = true }) {
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
  const subjectImports = [
    'import { invoke } from "../src/subject.js"',
    'import cjs from "../../../../scripts/subject.cjs"',
  ]
  const assertions = complete ? [
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
    ]
  const childPath = path.join(mcpRoot, "__tests__", "child-program.js")
  if (viaChild) write(childPath, [
    'import { strict as assert } from "node:assert"',
    ...subjectImports,
    ...assertions,
    'process.stdout.write("child assertions completed\\n")',
    "",
  ].join("\n"))
  writeSource("plugins/desk/mcp/__tests__/subject.test.js", [
    'import { test } from "node:test"',
    'import { strict as assert } from "node:assert"',
    ...(viaChild ? ['import { spawnSync } from "node:child_process"'] : subjectImports),
    'test("ESM and CommonJS execution witness", () => {',
    ...(viaChild ? [
      `  const child = spawnSync(process.execPath, [${JSON.stringify(childPath)}], { env: process.env, cwd: ${JSON.stringify(childFromRepoRoot ? repoRoot : undefined)}, encoding: "utf8", timeout: 10000 })`,
      '  assert.equal(child.status, 0, JSON.stringify({ error: child.error?.message, stderr: child.stderr }))',
      '  assert.equal(child.stdout, "child assertions completed\\n")',
    ] : assertions),
    "})",
    "",
  ].join("\n"))
  if (offline) {
    // The maintained offline evaluation implementation the root CI must exercise: top-level ESM, pinned vendor TypeScript, and the CommonJS CLI bridge that routes to them.
    writeSource(offlineEsmSource, [
      "export function evaluate(callback) {",
      "  callback()",
      "  globalThis.coverageOfflineUnreached = true",
      "}",
      "",
    ].join("\n"))
    writeSource(offlineTypeScriptSource, [
      "export interface Verdict { passed: boolean }",
      "export function verdict(passed: boolean): Verdict {",
      "  if (!passed) return { passed: false }",
      "  return { passed: true }",
      "}",
      "",
    ].join("\n"))
    writeSource(offlineBridgeSource, [
      "module.exports.route = function route(argv) {",
      '  if (argv[0] !== "offline") throw new Error("unsupported skill-evals route")',
      '  return "offline"',
      "}",
      "",
    ].join("\n"))
    // Mirrors the maintained registration pair: the instrumentation hook plus the format hook that gives the source-pinned TypeScript leaves a module format the hook will instrument.
    writeSource("evals/offline/__tests__/helpers/coverage-format.mjs", [
      "let admittedUrls = new Set()",
      "export function initialize({ urls }) { admittedUrls = new Set(urls) }",
      "export async function resolve(specifier, context, nextResolve) {",
      "  const result = await nextResolve(specifier, context)",
      '  return admittedUrls.has(result.url) ? { ...result, format: "module" } : result',
      "}",
      "",
    ].join("\n"))
    writeSource("evals/offline/__tests__/helpers/register-coverage.mjs", [
      'import { createRequire, register } from "node:module"',
      'import path from "node:path"',
      'import { fileURLToPath, pathToFileURL } from "node:url"',
      'const repository = fileURLToPath(new URL("../../../../", import.meta.url))',
      "const require = createRequire(path.join(process.env.OFFLINE_COVERAGE_PACKAGE_ROOT, \"package.json\"))",
      "const option = `--import=${import.meta.url}`",
      'if (!(process.env.NODE_OPTIONS || "").includes(option)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} ${option}`.trim()',
      'register(pathToFileURL(require.resolve("@istanbuljs/esm-loader-hook")).href)',
      'register(new URL("./coverage-format.mjs", import.meta.url), {',
      '  data: { urls: ["src/subject.ts"].map(filename => pathToFileURL(path.join(repository, "evals/offline/vendor/gauntlet", filename)).href) },',
      "})",
      "",
    ].join("\n"))
    const offlineAssertions = complete ? [
      "  evaluate(() => {})",
      "  assert.equal(globalThis.coverageOfflineUnreached, true)",
      "  assert.deepEqual(verdict(true), { passed: true })",
      "  assert.deepEqual(verdict(false), { passed: false })",
    ] : [
      '  const fail = () => { throw new Error("expected offline callback failure") }',
      "  assert.throws(() => evaluate(fail), /expected offline callback failure/)",
      '  assert.equal(Object.hasOwn(globalThis, "coverageOfflineUnreached"), false)',
      "  assert.deepEqual(verdict(true), { passed: true })",
    ]
    if (offlineTests) writeSource("evals/offline/__tests__/subject.test.mjs", [
      'import { test } from "node:test"',
      'import { strict as assert } from "node:assert"',
      'import { evaluate } from "../subject.mjs"',
      'import { verdict } from "../vendor/gauntlet/src/subject.ts"',
      'test("offline evaluation witness", () => {',
      ...offlineAssertions,
      "})",
      "",
    ].join("\n"))
    if (offlineTests) writeSource("scripts/test-skill-evals.cjs", [
      'const { test } = require("node:test")',
      'const assert = require("node:assert").strict',
      'const { route } = require("./skill-evals.cjs")',
      'test("skill-evals CLI routing contract", () => {',
      '  assert.equal(route(["offline"]), "offline")',
      '  assert.throws(() => route(["unknown"]), /unsupported skill-evals route/)',
      "})",
      "",
    ].join("\n"))
  }
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

test("the installed producer measures complete ESM and CommonJS execution in ordinary Node subprocesses", t => {
  const run = runProducerFixture(t, { complete: true, viaChild: true })
  assert.equal(run.result, 0, JSON.stringify(run.output))
  assert.equal(run.output.stderr, "")
  assert.deepEqual(
    [entry(run, esmSource).statements.covered, entry(run, esmSource).statements.total],
    [2, 2],
  )
  assert.deepEqual(
    [entry(run, cjsSource).statements.covered, entry(run, cjsSource).statements.total],
    [3, 3],
  )
})

test("the subprocess producer reports the real missed statement instead of treating executed ESM as unloaded", t => {
  const run = runProducerFixture(t, { complete: false, viaChild: true })
  assert.equal(run.result, 1, JSON.stringify(run.output))
  assert.match(run.output.stderr, /subject\.js statements coverage 50 is below 100/)
  assert.deepEqual(
    [entry(run, esmSource).statements.covered, entry(run, esmSource).statements.total],
    [1, 2],
  )
  assert.deepEqual(
    [entry(run, cjsSource).statements.covered, entry(run, cjsSource).statements.total],
    [2, 3],
  )
})

test("the installed producer resolves maintained instrumentation for children outside its dependency directory", t => {
  const run = runProducerFixture(t, { complete: true, viaChild: true, childFromRepoRoot: true })
  assert.equal(run.result, 0, JSON.stringify(run.output))
  assert.equal(run.output.stderr, "")
  assert.deepEqual(
    [entry(run, esmSource).statements.covered, entry(run, esmSource).statements.total],
    [2, 2],
  )
  assert.deepEqual(
    [entry(run, cjsSource).statements.covered, entry(run, cjsSource).statements.total],
    [3, 3],
  )
})

test("the maintained coverage entry measures the offline evaluation implementation and its CLI bridge through their own test workers", t => {
  const run = runProducerFixture(t, { complete: true, offline: true })
  assert.equal(run.result, 0, JSON.stringify(run.output))
  assert.equal(run.output.stderr, "")
  const offlineEsm = entry(run, offlineEsmSource)
  assert.deepEqual([offlineEsm.statements.covered, offlineEsm.statements.total], [2, 2])
  assert.deepEqual([offlineEsm.functions.covered, offlineEsm.functions.total], [1, 1])
  const pinned = entry(run, offlineTypeScriptSource)
  assert.deepEqual([pinned.statements.covered, pinned.statements.total], [3, 3])
  assert.deepEqual([pinned.branches.covered, pinned.branches.total], [2, 2])
  assert.deepEqual([pinned.functions.covered, pinned.functions.total], [1, 1])
  assert.ok(pinned.lines.total > 0 && pinned.lines.covered === pinned.lines.total, JSON.stringify(pinned.lines))
  const bridge = entry(run, offlineBridgeSource)
  assert.deepEqual([bridge.statements.covered, bridge.statements.total], [4, 4])
  assert.deepEqual([bridge.branches.covered, bridge.branches.total], [2, 2])
})

test("the maintained coverage entry reports the real missed offline statement rather than reporting the untested implementation as complete", t => {
  const run = runProducerFixture(t, { complete: false, offline: true })
  assert.equal(run.result, 1, JSON.stringify(run.output))
  assert.match(run.output.stderr, /subject\.mjs statements coverage 50 is below 100/)
  const offlineEsm = entry(run, offlineEsmSource)
  assert.deepEqual([offlineEsm.statements.covered, offlineEsm.statements.total], [1, 2])
  const pinned = entry(run, offlineTypeScriptSource)
  assert.deepEqual([pinned.branches.covered, pinned.branches.total], [1, 2])
})

test("an existing offline implementation without its own tests is measured and failed rather than silently omitted", t => {
  const run = runProducerFixture(t, { complete: true, offline: true, offlineTests: false })
  assert.equal(run.result, 1, JSON.stringify(run.output))
  assert.match(run.output.stderr, /subject\.mjs statements coverage 0 is below 100/)
  assert.match(run.output.stderr, /subject\.ts statements coverage 0 is below 100/)
  const pinned = entry(run, offlineTypeScriptSource)
  assert.deepEqual([pinned.statements.covered, pinned.statements.total], [0, 3])
})
