import { test } from "node:test"
import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import TestExclude from "test-exclude"
import { runCoverageCommand } from "../../src/coverage/runner.js"

const mcpRoot = fileURLToPath(new URL("../../", import.meta.url))
const sourceFile = "plugins/desk/mcp/src/covered.js"
const nativeFileRow = `# ${sourceFile} | 100.00 | 100.00 | 100.00 |`
const nativeOutput = [
  "# file | line % | branch % | funcs % | uncovered lines",
  nativeFileRow,
  "# all files | 100.00 | 100.00 | 100.00 |",
].join("\n")

function metrics(statements = 100) {
  return {
    lines: { pct: 100 },
    branches: { pct: 100 },
    functions: { pct: 100 },
    statements: { pct: statements },
  }
}

function runFixture(t, summary, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "desk-coverage-provenance-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repoRoot = path.join(root, "repo")
  const reportDirectory = path.join(root, "report")
  const write = (relative, body) => {
    const file = path.join(repoRoot, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, body)
    return file
  }
  const configPath = write("plugins/desk/mcp/config/coverage-gate.json", JSON.stringify({
    thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    exclusions: options.exclusions ?? [],
  }))
  const packageJsonPath = write("plugins/desk/mcp/package.json", JSON.stringify({
    scripts: { "test:coverage": "node scripts/run-coverage.js" },
  }))
  const workflowPath = write(".github/workflows/desk-mcp-tests.yml", [
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
  write(sourceFile, "export const covered = true\n")
  for (const file of options.additionalFiles ?? []) write(file, "module.exports = true\n")
  const output = { stdout: "", stderr: "" }
  let invocation
  let reportBytes
  let producerConfig
  const execute = () => runCoverageCommand({
    paths: {
      repoRoot,
      mcpRoot: path.join(repoRoot, "plugins/desk/mcp"),
      configPath,
      packageJsonPath,
      workflowPath,
    },
    env: options.env ?? {},
    io: {
      stdout: { write: text => { output.stdout += text } },
      stderr: { write: text => { output.stderr += text } },
    },
    fsOps: {
      makeTempDir: () => {
        mkdirSync(reportDirectory)
        return reportDirectory
      },
      removeDir: directory => {
        const report = path.join(directory, "coverage-summary.json")
        if (existsSync(report)) reportBytes = readFileSync(report, "utf8")
        rmSync(directory, { recursive: true, force: true })
      },
      readText: file => readFileSync(file, "utf8"),
      writeText: (file, text) => {
        if (options.writeError) throw options.writeError
        writeFileSync(file, text)
      },
    },
    spawn: (command, args, spawnOptions) => {
      if (command === process.execPath) {
        invocation = { command, args, options: spawnOptions }
        const configIndex = args.indexOf("--nycrc-path")
        if (configIndex !== -1) {
          producerConfig = JSON.parse(readFileSync(args[configIndex + 1], "utf8"))
        }
        if (options.spawnError) throw options.spawnError
        if (summary !== undefined || options.reportText !== undefined) {
          writeFileSync(
            path.join(reportDirectory, "coverage-summary.json"),
            options.reportText ?? JSON.stringify(summary),
          )
        }
        return { status: 0, stdout: nativeOutput, stderr: "" }
      }
      assert.equal(command, "git")
      if (args.join(" ") === "merge-base origin/main HEAD") {
        return { status: 0, stdout: "base\n", stderr: "" }
      }
      if (args.join(" ") === "diff --name-only --diff-filter=AM base..HEAD") {
        const changedFiles = options.changedFiles ?? [sourceFile, ...(options.additionalFiles ?? [])]
        return { status: 0, stdout: changedFiles.join("\n"), stderr: "" }
      }
      return { status: 0, stdout: "", stderr: "" }
    },
  })
  let result
  if (options.expectedError) {
    assert.throws(execute, options.expectedError)
  } else {
    result = execute()
  }
  assert.equal(existsSync(reportDirectory), false, "owned temporary report must be cleaned")
  return { result, output, invocation, reportBytes, producerConfig, repoRoot, canonicalRepoRoot: realpathSync(repoRoot), reportDirectory }
}

test("coverage admission refuses missing producer JSON despite perfect stdout percentages", t => {
  const run = runFixture(t)
  assert.equal(run.result, 1)
  assert.match(run.output.stderr, /coverage report is missing/)
})

test("malformed producer JSON propagates without a success message and removes the owned report", t => {
  const run = runFixture(t, undefined, {
    reportText: "{not-json",
    expectedError: SyntaxError,
  })
  assert.ok(run.invocation, "the producer must have run before its malformed result is read")
  assert.equal(run.reportBytes, "{not-json", "the failed result must not be rewritten")
  assert.doesNotMatch(run.output.stdout, /passed/)
})

test("a producer configuration write failure propagates before spawn and removes the owned report", t => {
  const failure = new Error("fixture configuration write failed")
  const run = runFixture(t, undefined, {
    writeError: failure,
    expectedError: error => error === failure,
  })
  assert.equal(run.invocation, undefined, "a failed configuration must never launch tests")
  assert.doesNotMatch(run.output.stdout, /passed/)
})

test("a producer spawn exception propagates and removes the owned report", t => {
  const failure = new Error("fixture producer spawn failed")
  const run = runFixture(t, undefined, {
    spawnError: failure,
    expectedError: error => error === failure,
  })
  assert.ok(run.invocation, "the configured producer spawn must have been attempted")
  assert.doesNotMatch(run.output.stdout, /passed/)
})

test("coverage admission uses producer statement metrics instead of overwriting them from stdout", t => {
  const run = runFixture(t, { [sourceFile]: metrics(75), total: metrics(75) })
  assert.equal(run.result, 1)
  assert.match(run.output.stderr, /covered\.js statements coverage 75 is below 100/)
})

test("coverage admission cannot fill a missing producer statement metric from native line coverage", t => {
  const observed = metrics()
  delete observed.statements
  const run = runFixture(t, { [sourceFile]: observed })
  assert.equal(run.result, 1)
  assert.match(run.output.stderr, /statements coverage undefined is below 100/)
})

test("coverage admission retains a complete independently supplied metric report", t => {
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() })
  assert.equal(run.result, 0)
  assert.match(run.output.stdout, /passed for 1 changed production file/)
})

test("the producer's non-perfect aggregate is preserved rather than replaced with 100 percent", t => {
  const summary = { [sourceFile]: metrics(), total: metrics(75) }
  const run = runFixture(t, summary)
  assert.equal(run.result, 0)
  assert.deepEqual(JSON.parse(run.reportBytes), summary)
})

test("an absent producer aggregate is not manufactured from native output", t => {
  const run = runFixture(t, { [sourceFile]: metrics() })
  assert.equal(run.result, 0)
  assert.equal(Object.hasOwn(JSON.parse(run.reportBytes), "total"), false)
})

test("the actual producer invocation binds the maintained loader, dependency cwd, source cwd and report", t => {
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() })
  const { args, options } = run.invocation
  assert.match(args[0].replaceAll(path.sep, "/"), /\/nyc\/bin\/nyc\.js$/)
  assert.equal(path.resolve(options.cwd), path.resolve(mcpRoot))
  assert.equal(args[args.indexOf("--cwd") + 1], run.canonicalRepoRoot)
  assert.equal(args[args.indexOf("--nycrc-path") + 1], path.join(run.reportDirectory, "nyc.json"))
  assert.equal(run.producerConfig.cwd, run.canonicalRepoRoot)
  assert.equal(run.producerConfig.reportDir, run.reportDirectory)
  assert.equal(run.producerConfig.tempDir, path.join(run.reportDirectory, "raw"))
  assert.deepEqual(run.producerConfig.reporter, ["json-summary", "json"])
  const importIndex = args.indexOf("--import")
  assert.notEqual(importIndex, -1)
  assert.equal(args[importIndex - 1], process.execPath)
  const registration = decodeURIComponent(args[importIndex + 1].replace("data:text/javascript,", ""))
  const loader = pathToFileURL(path.join(mcpRoot, "node_modules", "@istanbuljs", "esm-loader-hook", "index.js")).href
  assert.equal(registration, `import { register } from "node:module"; register(${JSON.stringify(loader)});`)
  assert.deepEqual(args.slice(importIndex + 2), [
    "--test",
    path.join(run.canonicalRepoRoot, "plugins/desk/mcp/__tests__/**/*.test.js"),
  ])
})

test("the maintained producer measures the selected files without owning coverage thresholds", t => {
  const excludedFile = "scripts/audit-work-suite-runtime.cjs"
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics(75) }, {
    additionalFiles: [excludedFile],
    exclusions: [{ path: excludedFile, owner: "fixture", reason: "separate maintained command" }],
  })
  assert.ok(run.producerConfig, "an explicit producer config must reach the child")
  assert.deepEqual(run.producerConfig.include, [sourceFile])
  assert.deepEqual(run.producerConfig.extension, [".js", ".cjs"])
  assert.deepEqual(run.producerConfig.exclude, [
    "plugins/desk/mcp/__tests__/**",
    "plugins/desk/mcp/node_modules/**",
  ])
  assert.equal(run.producerConfig.all, true)
  assert.equal(run.producerConfig.cache, false)
  assert.equal(run.producerConfig.checkCoverage, false)
  for (const metric of ["lines", "branches", "functions", "statements"]) {
    assert.equal(Object.hasOwn(run.producerConfig, metric), false)
  }
  assert.equal(run.invocation.args.some(arg => arg.startsWith("--check-coverage")), false)
  assert.equal(run.result, 0, "the existing per-file gate, not a global aggregate, owns admission")
})

test("an empty changed-source selection still runs tests without expanding measurement to the entire repository", t => {
  const run = runFixture(t, { total: metrics() }, { changedFiles: [] })
  assert.ok(run.invocation, "the maintained tests must still execute")
  assert.ok(run.producerConfig, "the empty selection must be explicit")
  assert.deepEqual(run.producerConfig.include, [])
  assert.deepEqual(run.producerConfig.exclude, ["**"])
  assert.equal(run.result, 0)
  assert.match(run.output.stdout, /passed for 0 changed production file/)
})

test("an inherited recursion marker cannot report an unmeasured coverage pass", t => {
  const run = runFixture(t, undefined, { env: { DESK_COVERAGE_RUNNER_CHILD: "1" } })
  assert.equal(run.result, 1)
  assert.equal(run.invocation, undefined)
  assert.match(run.output.stderr, /nested coverage invocation.*no coverage was measured/i)
  assert.doesNotMatch(run.output.stdout, /passed/)
})

test("the package pins the qualified AST producer without changing runtime dependencies", () => {
  const manifest = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8"))
  assert.equal(manifest.devDependencies.nyc, "18.0.0")
  assert.equal(manifest.devDependencies["@istanbuljs/esm-loader-hook"], "0.3.0")
  assert.equal(manifest.overrides["test-exclude"], "8.0.0")
  for (const name of ["nyc", "@istanbuljs/esm-loader-hook", "test-exclude", "c8"]) {
    assert.equal(Object.hasOwn(manifest.dependencies, name), false)
  }
  assert.equal(Object.hasOwn(manifest.devDependencies, "c8"), false)
})

test("the public package lock retains only public registry acquisition URLs", () => {
  const lock = JSON.parse(readFileSync(path.join(mcpRoot, "package-lock.json"), "utf8"))
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!entry.resolved) continue
    assert.equal(new URL(entry.resolved).origin, "https://registry.npmjs.org", name)
    assert.match(entry.integrity, /^sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*$/, name)
  }
})

test("the reviewed test-exclude override honors the actual configured source selectors", t => {
  const cjsFile = "scripts/covered.cjs"
  const run = runFixture(t, {
    [sourceFile]: metrics(),
    [cjsFile]: metrics(),
    total: metrics(),
  }, { additionalFiles: [cjsFile] })
  const selector = new TestExclude(run.producerConfig)
  for (const file of [sourceFile, cjsFile]) {
    assert.equal(selector.shouldInstrument(path.join(run.canonicalRepoRoot, file)), true, file)
  }
  for (const file of [
    "plugins/desk/mcp/__tests__/covered.test.js",
    "plugins/desk/mcp/node_modules/dependency/index.js",
    "plugins/desk/mcp/src/covered.mjs",
    "scripts/unselected.cjs",
    "../outside.js",
  ]) {
    assert.equal(selector.shouldInstrument(path.resolve(run.canonicalRepoRoot, file)), false, file)
  }
})
