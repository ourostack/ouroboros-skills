import { test } from "node:test"
import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import TestExclude from "test-exclude"
import { runCoverageCommand } from "../../src/coverage/runner.js"

const mcpRoot = fileURLToPath(new URL("../../", import.meta.url))
const realRepoRoot = path.resolve(mcpRoot, "..", "..", "..")
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
  for (const file of options.additionalTestFiles ?? []) write(file, "// fixture test file\n")
  const output = { stdout: "", stderr: "" }
  const invocations = []
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
        invocations.push(invocation)
        if (options.failPassIndex === invocations.length) {
          return { status: 1, stdout: `pass ${invocations.length} failed`, stderr: "pass failure" }
        }
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
        if (options.bareStdio) return { status: 0 }
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
  return { result, output, invocation, invocations, reportBytes, producerConfig, repoRoot, canonicalRepoRoot: realpathSync(repoRoot), reportDirectory }
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
  assert.equal(options.env.NODE_OPTIONS, `--import=${args[importIndex + 1]}`)
  assert.equal(options.env.NODE_PATH, path.join(mcpRoot, "node_modules"))
  assert.deepEqual(args.slice(importIndex + 2), ["--test"])
})

test("a repository holding deadline-sensitive files runs both passes and merges their coverage", t => {
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() }, {
    additionalTestFiles: [
      "plugins/desk/mcp/__tests__/runtime/startup_status.test.js",
      "plugins/desk/mcp/__tests__/indexer/vector_packs.test.js",
      "plugins/desk/mcp/__tests__/tools/ordinary.test.js",
    ],
  })
  assert.equal(run.result, 0)
  assert.equal(run.invocations.length, 2, "one parallel pass and one serial pass")

  const [bulk, deadline] = run.invocations
  // The bulk pass carries the ordinary file and no concurrency cap.
  assert.deepEqual(bulk.args.filter(arg => arg.startsWith("--test-concurrency=")), [])
  assert.equal(bulk.args.some(arg => arg.endsWith("ordinary.test.js")), true)
  assert.equal(bulk.args.some(arg => arg.endsWith("startup_status.test.js")), false)
  assert.equal(bulk.args.includes("--no-clean"), false, "the first pass owns the temp directory")

  // The deadline pass carries only the deadline-sensitive files, serially, and preserves
  // the first pass's raw coverage so the report it writes is the merge of both.
  assert.deepEqual(deadline.args.filter(arg => arg.startsWith("--test-concurrency=")), ["--test-concurrency=1"])
  assert.equal(deadline.args.includes("--no-clean"), true)
  assert.equal(deadline.args.some(arg => arg.endsWith("ordinary.test.js")), false)
  assert.deepEqual(
    deadline.args.filter(arg => arg.endsWith(".test.js")).map(arg => path.basename(arg)).sort(),
    ["startup_status.test.js", "vector_packs.test.js"],
  )
})

test("merging two passes tolerates a producer that reports no stdio", t => {
  // spawnSync can return undefined stdout/stderr (for example when a caller sets
  // stdio: "inherit"), and the merge must not turn that into the string "undefined".
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() }, {
    additionalTestFiles: ["plugins/desk/mcp/__tests__/runtime/startup_status.test.js"],
    bareStdio: true,
  })
  assert.equal(run.result, 0)
  assert.equal(run.invocations.length, 2)
  assert.doesNotMatch(run.output.stdout, /undefined/)
})

test("a failing bulk pass never starts the deadline pass", t => {
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() }, {
    additionalTestFiles: ["plugins/desk/mcp/__tests__/runtime/startup_status.test.js"],
    failPassIndex: 1,
  })
  assert.equal(run.result, 1)
  assert.equal(run.invocations.length, 1, "the serial pass must not run after a failed bulk pass")
})

test("the bulk pass runs in parallel on every host size while deadline-sensitive files run alone", async t => {
  const { default: os } = await import("node:os")
  const { syncBuiltinESMExports } = await import("node:module")
  for (const cpus of [1, 2, 4, 5, 12]) {
    await t.test(`${cpus} available CPUs leave the bulk pass uncapped`, child => {
      const mocked = child.mock.method(os, "availableParallelism", () => cpus)
      syncBuiltinESMExports()
      try {
        const run = runFixture(child, { [sourceFile]: metrics(), total: metrics() })
        assert.equal(run.result, 0)
        // No concurrency flag at all: Node picks one worker per CPU. Pinning a number here
        // is what cost the suite roughly 4x, and the deadline assertions it protected are
        // protected by their own pass instead.
        assert.deepEqual(
          run.invocation.args.filter(arg => arg.startsWith("--test-concurrency=")),
          [],
        )
        assert.doesNotMatch(run.invocation.options.env.NODE_OPTIONS, /test-concurrency/u)
      } finally {
        mocked.mock.restore()
        syncBuiltinESMExports()
      }
    })
  }
})

test("deadline-sensitive test files get their own serial pass that merges into one report", async t => {
  const { collectSuiteTestFiles, partitionTestFiles } = await import(
    pathToFileURL(path.join(mcpRoot, "src", "coverage", "runner.js"))
  )
  const files = collectSuiteTestFiles({ repoRoot: realRepoRoot })
  assert.ok(files.length > 100, `expected the real suite, found ${files.length} files`)
  const { parallel, serial } = partitionTestFiles({ repoRoot: realRepoRoot, files })
  assert.equal(parallel.length + serial.length, files.length)
  const relative = serial.map(file => path.relative(realRepoRoot, file).replaceAll(path.sep, "/")).sort()

  // Every readiness test runs alone: they drive one per-user OS controller endpoint, so two
  // of them at once contend for it and hang. The directory rule means a readiness test added
  // later inherits the serial pass rather than silently hanging the suite.
  const readiness = files
    .map(file => path.relative(realRepoRoot, file).replaceAll(path.sep, "/"))
    .filter(file => file.startsWith("plugins/desk/mcp/__tests__/readiness/"))
  assert.ok(readiness.length > 0, "the readiness suite must exist")
  for (const file of readiness) assert.ok(relative.includes(file), `${file} must run alone`)

  // Plus the named files, which run alone for the other reason: they time themselves.
  assert.ok(relative.includes("plugins/desk/mcp/__tests__/indexer/vector_packs.test.js"))
  assert.ok(relative.includes("plugins/desk/mcp/__tests__/runtime/startup_status.test.js"))
  assert.ok(parallel.length > serial.length, "the parallel pass must still carry the bulk")
  // Every deadline-sensitive file must exist, or the partition silently stops protecting it.
  for (const file of serial) assert.ok(existsSync(file), `${file} must exist`)
  for (const file of parallel) assert.equal(serial.includes(file), false)
})

test("every test file asserting on elapsed wall-clock time is in the serial pass", async () => {
  const { collectSuiteTestFiles, partitionTestFiles } = await import(
    pathToFileURL(path.join(mcpRoot, "src", "coverage", "runner.js"))
  )
  const files = collectSuiteTestFiles({ repoRoot: realRepoRoot })
  const { serial } = partitionTestFiles({ repoRoot: realRepoRoot, files })
  const serialSet = new Set(serial)

  // A new wall-clock assertion in a parallel file would flake under CPU contention, and
  // nothing else in the suite would notice. This is that notice: add the file to
  // DEADLINE_SENSITIVE_TESTS, or assert on the observable outcome instead of the clock.
  const measuresElapsedTime = /assert[^\n]*\b(elapsedMs|elapsed|durationMs)\b[^\n]*[<>]/u
  const offenders = files
    .filter(file => !serialSet.has(file))
    // This file states the pattern in order to search for it, so it always matches itself.
    .filter(file => file !== fileURLToPath(import.meta.url))
    .filter(file => measuresElapsedTime.test(readFileSync(file, "utf8")))
    .map(file => path.relative(realRepoRoot, file).replaceAll(path.sep, "/"))
  assert.deepEqual(offenders, [], "these files time themselves but run in the parallel pass")

  // Guard against a vacuous guard: the pattern must still match the files it was written
  // for, or a regression in the pattern would silently pass this test forever.
  assert.deepEqual(
    serial
      .filter(file => measuresElapsedTime.test(readFileSync(file, "utf8")))
      .map(file => path.basename(file))
      .sort(),
    ["vector_packs.test.js"],
  )
})

test("a repository with no test directory runs a single pass", async t => {
  const { collectSuiteTestFiles, partitionTestFiles } = await import(
    pathToFileURL(path.join(mcpRoot, "src", "coverage", "runner.js"))
  )
  const empty = mkdtempSync(path.join(tmpdir(), "desk-coverage-empty-"))
  t.after(() => rmSync(empty, { recursive: true, force: true }))
  const files = collectSuiteTestFiles({ repoRoot: empty })
  assert.deepEqual(files, [])
  assert.deepEqual(partitionTestFiles({ repoRoot: empty, files }), { parallel: [], serial: [] })
})

test("the loader reaches descendants without replacing caller Node options or mutating the parent environment", t => {
  const env = { NODE_OPTIONS: "--trace-warnings", NODE_PATH: "caller-modules", RETAINED_VALUE: "original" }
  const run = runFixture(t, { [sourceFile]: metrics(), total: metrics() }, { env })
  const { args, options } = run.invocation
  assert.equal(run.result, 0)
  assert.equal(options.env.NODE_OPTIONS, `--trace-warnings --import=${args[args.indexOf("--import") + 1]}`)
  assert.equal(options.env.NODE_PATH, `${path.join(mcpRoot, "node_modules")}${path.delimiter}caller-modules`)
  assert.equal(options.env.RETAINED_VALUE, "original")
  assert.deepEqual(env, { NODE_OPTIONS: "--trace-warnings", NODE_PATH: "caller-modules", RETAINED_VALUE: "original" })
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
