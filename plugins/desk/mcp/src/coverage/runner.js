import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { availableParallelism, tmpdir } from "node:os"
import * as path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  assertCoverageCommandParity,
  collectCoverageRequiredFiles,
  evaluateCoverageReport,
  isOfflineEvaluationScope,
} from "./gate.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultMcpRoot = path.resolve(moduleDir, "..", "..")
const defaultRepoRoot = path.resolve(defaultMcpRoot, "..", "..", "..")
const require = createRequire(import.meta.url)

export function runCoverageCommand(options = {}) {
  const env = options.env ?? process.env
  const spawn = options.spawn ?? spawnSync
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  }
  if (env.DESK_COVERAGE_RUNNER_CHILD === "1") {
    io.stderr.write("[coverage-gate] refusing nested coverage invocation; no coverage was measured\n")
    return 1
  }

  const paths = options.paths ?? defaultPaths()
  const repoRoot = realpathSync(paths.repoRoot)
  const fsOps = options.fsOps ?? defaultFsOps()
  const config = JSON.parse(fsOps.readText(paths.configPath))
  const requiredFiles = collectChangedCoverageFiles({
    repoRoot,
    spawn,
  })
  const coverageIncludeFiles = filterCoverageIncludeFiles({
    requiredFiles,
    exclusions: config.exclusions,
  })
  const tmp = fsOps.makeTempDir()

  try {
    const testResult = runInstrumentedTests({
      repoRoot,
      requiredFiles: coverageIncludeFiles,
      reportDirectory: tmp,
      fsOps,
      spawn,
      env,
    })
    io.stdout.write(testResult.stdout ?? "")
    io.stderr.write(testResult.stderr ?? "")
    if (testResult.status !== 0) {
      return testResult.status ?? 1
    }

    const reportPath = path.join(tmp, "coverage-summary.json")
    const coverage = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles,
      exclusions: config.exclusions,
      thresholds: config.thresholds,
    })
    const parity = assertCoverageCommandParity({
      packageJsonPath: paths.packageJsonPath,
      workflowPath: paths.workflowPath,
    })
    const issues = [...coverage.issues, ...parity.issues]
    if (issues.length) {
      io.stderr.write("[coverage-gate] failed\n")
      for (const issue of issues) io.stderr.write(`- ${issue}\n`)
      return 1
    }

    io.stdout.write(
      `[coverage-gate] passed for ${coverage.checkedFiles.length} changed production file(s)\n`,
    )
    return 0
  } finally {
    fsOps.removeDir(tmp)
  }
}

export function collectChangedCoverageFiles({ repoRoot, spawn = spawnSync }) {
  const changed = new Set(collectChangedFiles({ repoRoot, spawn }))
  return collectCoverageRequiredFiles({ repoRoot })
    .filter((file) => changed.has(file))
}

export function filterCoverageIncludeFiles({ requiredFiles, exclusions = [] }) {
  const excludedPaths = new Set(
    exclusions
      .map((exclusion) => normalizePath(exclusion.path ?? ""))
      .filter(Boolean),
  )
  return requiredFiles.filter((file) => !excludedPaths.has(normalizePath(file)))
}

export function collectChangedFiles({ repoRoot, spawn = spawnSync }) {
  return unique([
    ...changedSinceMergeBase({ repoRoot, spawn }),
    ...gitLines({ repoRoot, spawn, args: ["diff", "--name-only", "--diff-filter=AM"] }),
    ...gitLines({ repoRoot, spawn, args: ["diff", "--cached", "--name-only", "--diff-filter=AM"] }),
    ...gitLines({ repoRoot, spawn, args: ["ls-files", "--others", "--exclude-standard"] }),
  ].map(normalizePath))
}

export function changedSinceMergeBase({ repoRoot, spawn = spawnSync }) {
  const base =
    gitText({ repoRoot, spawn, args: ["merge-base", "origin/main", "HEAD"] }) ||
    gitText({ repoRoot, spawn, args: ["merge-base", "main", "HEAD"] })
  return base
    ? gitLines({ repoRoot, spawn, args: ["diff", "--name-only", "--diff-filter=AM", `${base}..HEAD`] })
    : []
}

function runInstrumentedTests({
  repoRoot,
  requiredFiles,
  reportDirectory,
  fsOps,
  spawn,
  env,
}) {
  const offline = resolveOfflineEvaluationScope({ repoRoot, requiredFiles })
  const configPath = path.join(reportDirectory, "nyc.json")
  fsOps.writeText(configPath, JSON.stringify({
    cwd: repoRoot,
    all: true,
    include: requiredFiles,
    exclude: requiredFiles.length ? [
      "plugins/desk/mcp/__tests__/**",
      "plugins/desk/mcp/node_modules/**",
      ...(offline.selected ? ["evals/offline/__tests__/**"] : []),
    ] : ["**"],
    // The maintained offline selection is only parsed and measured when its own extensions are admitted; without them nyc silently reports no entry at all for those production leaves.
    extension: [".js", ".cjs", ...(offline.selected ? [".mjs", ".ts"] : [])],
    ...(offline.requiresTypeScript ? { parserPlugins: ["typescript"] } : {}),
    reporter: ["json-summary", "json"],
    reportDir: reportDirectory,
    tempDir: path.join(reportDirectory, "raw"),
    cache: false,
    checkCoverage: false,
  }))
  const loader = pathToFileURL(require.resolve("@istanbuljs/esm-loader-hook")).href
  const registration = `import { register } from "node:module"; register(${JSON.stringify(loader)});`
  // The repository's own offline registration helper is a superset of this registration: it installs the same maintained hook and additionally gives the source-pinned TypeScript leaves a module format that hook will instrument.
  const registrationUrl = offline.registrationPath
    ? pathToFileURL(offline.registrationPath).href
    : `data:text/javascript,${encodeURIComponent(registration)}`
  const args = [
    require.resolve("nyc/bin/nyc.js"),
    "--cwd", repoRoot,
    "--nycrc-path", configPath,
    process.execPath,
    "--import", registrationUrl,
    "--test",
    `--test-concurrency=${Math.max(1, Math.min(4, availableParallelism() - 1))}`,
    path.join(repoRoot, "plugins/desk/mcp/__tests__/**/*.test.js"),
    // Separate path arguments run as separate test workers, so the offline suite and the CLI contract keep their own hooks.
    ...offline.testTargets,
  ]
  return spawn(process.execPath, args, {
    cwd: defaultMcpRoot,
    encoding: "utf8",
    env: {
      ...env,
      // Ordinary Node descendants do not inherit the parent's execArgv.
      NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${registrationUrl}`.trim(),
      NODE_PATH: [path.join(defaultMcpRoot, "node_modules"), env.NODE_PATH].filter(Boolean).join(path.delimiter),
      ...(offline.registrationPath ? { OFFLINE_COVERAGE_PACKAGE_ROOT: defaultMcpRoot } : {}),
      DESK_COVERAGE_RUNNER_CHILD: "1",
    },
  })
}

function resolveOfflineEvaluationScope({ repoRoot, requiredFiles }) {
  const required = requiredFiles.filter(isOfflineEvaluationScope)
  if (!required.length) return { selected: false, requiresTypeScript: false, registrationPath: null, testTargets: [] }
  const testDirectory = path.join(repoRoot, "evals", "offline", "__tests__")
  const hasOfflineTests = existsSync(testDirectory) &&
    readdirSync(testDirectory).some((entry) => entry.endsWith(".test.mjs"))
  const contractTest = path.join(repoRoot, "scripts", "test-skill-evals.cjs")
  const registrationPath = path.join(testDirectory, "helpers", "register-coverage.mjs")
  return {
    selected: true,
    requiresTypeScript: required.some((file) => file.endsWith(".ts")),
    registrationPath: existsSync(registrationPath) ? registrationPath : null,
    // A required production leaf whose tests are absent stays measured and fails the gate; an unmatched selection argument would end the run before any measurement instead.
    testTargets: [
      ...(hasOfflineTests ? [path.join(testDirectory, "*.test.mjs")] : []),
      ...(existsSync(contractTest) ? [contractTest] : []),
    ],
  }
}

function defaultPaths() {
  return {
    repoRoot: defaultRepoRoot,
    mcpRoot: defaultMcpRoot,
    configPath: path.join(defaultMcpRoot, "config", "coverage-gate.json"),
    packageJsonPath: path.join(defaultMcpRoot, "package.json"),
    workflowPath: path.join(defaultRepoRoot, ".github", "workflows", "desk-mcp-tests.yml"),
  }
}

function defaultFsOps() {
  return {
    makeTempDir: () => mkdtempSync(path.join(tmpdir(), "desk-mcp-coverage-")),
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    readText: (file) => readFileSync(file, "utf8"),
    writeText: (file, text) => writeFileSync(file, text, "utf8"),
  }
}

function gitText({ repoRoot, spawn, args }) {
  const result = spawn("git", args, { cwd: repoRoot, encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : ""
}

function gitLines({ repoRoot, spawn, args }) {
  return gitText({ repoRoot, spawn, args }).split("\n").filter(Boolean)
}

function normalizePath(file) {
  return file.replaceAll(path.sep, "/")
}

function unique(values) {
  return [...new Set(values)]
}
