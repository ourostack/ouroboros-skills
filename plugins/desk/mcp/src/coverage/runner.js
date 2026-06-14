import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertCoverageCommandParity,
  collectCoverageRequiredFiles,
  evaluateCoverageReport,
} from "./gate.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultMcpRoot = path.resolve(moduleDir, "..", "..")
const defaultRepoRoot = path.resolve(defaultMcpRoot, "..", "..", "..")

export function runCoverageCommand(options = {}) {
  const env = options.env ?? process.env
  const spawn = options.spawn ?? spawnSync
  if (env.DESK_COVERAGE_RUNNER_CHILD === "1") return 0

  const paths = options.paths ?? defaultPaths()
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  }
  const fsOps = options.fsOps ?? defaultFsOps()
  const config = JSON.parse(fsOps.readText(paths.configPath))
  const requiredFiles = collectChangedCoverageFiles({
    repoRoot: paths.repoRoot,
    spawn,
  })
  const tmp = fsOps.makeTempDir()

  try {
    const testResult = runNodeCoverage({
      repoRoot: paths.repoRoot,
      requiredFiles,
      spawn,
      env,
    })
    io.stdout.write(testResult.stdout ?? "")
    io.stderr.write(testResult.stderr ?? "")
    if (testResult.status !== 0) {
      return testResult.status ?? 1
    }

    const reportPath = path.join(tmp, "coverage-summary.json")
    fsOps.writeText(
      reportPath,
      JSON.stringify(
        parseNodeCoverageReport(`${testResult.stdout ?? ""}\n${testResult.stderr ?? ""}`),
        null,
        2,
      ),
    )

    const coverage = evaluateCoverageReport({
      repoRoot: paths.repoRoot,
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

export function runNodeCoverage({
  repoRoot,
  requiredFiles,
  spawn = spawnSync,
  env = process.env,
}) {
  const args = [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-exclude=plugins/desk/mcp/__tests__/**",
    "--test-coverage-exclude=plugins/desk/mcp/node_modules/**",
    ...requiredFiles.map((file) => `--test-coverage-include=${file}`),
    "plugins/desk/mcp/__tests__/**/*.test.js",
  ]
  return spawn(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...env,
      DESK_COVERAGE_RUNNER_CHILD: "1",
    },
  })
}

export function parseNodeCoverageReport(output) {
  const report = { total: metricBlock(100, 100, 100) }
  const stack = []
  for (const line of output.split("\n")) {
    const raw = line.replace(/^# ?/, "")
    if (!raw.includes("|")) continue
    const parts = raw.split("|").map((part) => part.trimEnd())
    if (parts.length < 4) continue
    const nameCell = parts[0]
    const name = nameCell.trim()
    if (
      !name ||
      name === "file" ||
      name === "all files" ||
      name.startsWith("-")
    ) {
      continue
    }

    const linePct = parseMetric(parts[1])
    const branchPct = parseMetric(parts[2])
    const functionPct = parseMetric(parts[3])
    const depth = nameCell.length - nameCell.trimStart().length
    if (linePct == null && branchPct == null && functionPct == null) {
      stack[depth] = name
      stack.length = depth + 1
      continue
    }

    const parent = stack.slice(0, depth).filter(Boolean)
    const file = normalizePath(path.join(...parent, name))
    report[file] = metricBlock(linePct, branchPct, functionPct)
  }
  return report
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

function metricBlock(lines, branches, functions) {
  return {
    lines: { pct: lines },
    branches: { pct: branches },
    functions: { pct: functions },
    statements: { pct: lines },
  }
}

function parseMetric(value) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const number = Number(trimmed)
  return Number.isFinite(number) ? number : null
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
