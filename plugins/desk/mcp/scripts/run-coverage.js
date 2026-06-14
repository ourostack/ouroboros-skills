#!/usr/bin/env node

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
} from "../src/coverage/gate.js"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const mcpRoot = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(mcpRoot, "..", "..", "..")
const configPath = path.join(mcpRoot, "config", "coverage-gate.json")
const packageJsonPath = path.join(mcpRoot, "package.json")
const workflowPath = path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml")

function main() {
  const config = JSON.parse(readFileSync(configPath, "utf8"))
  const requiredFiles = collectChangedCoverageFiles()
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-mcp-coverage-"))

  try {
    const testResult = runNodeCoverage(requiredFiles)
    process.stdout.write(testResult.stdout)
    process.stderr.write(testResult.stderr)
    if (testResult.status !== 0) {
      process.exit(testResult.status ?? 1)
    }

    const reportPath = path.join(tmp, "coverage-summary.json")
    writeFileSync(
      reportPath,
      JSON.stringify(parseNodeCoverageReport(`${testResult.stdout}\n${testResult.stderr}`), null, 2),
      "utf8",
    )

    const coverage = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles,
      exclusions: config.exclusions,
      thresholds: config.thresholds,
    })
    const parity = assertCoverageCommandParity({ packageJsonPath, workflowPath })
    const issues = [...coverage.issues, ...parity.issues]
    if (issues.length) {
      console.error("[coverage-gate] failed")
      for (const issue of issues) console.error(`- ${issue}`)
      process.exit(1)
    }

    console.log(
      `[coverage-gate] passed for ${coverage.checkedFiles.length} changed production file(s)`,
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function collectChangedCoverageFiles() {
  const changed = new Set(collectChangedFiles(repoRoot))
  return collectCoverageRequiredFiles({ repoRoot })
    .filter((file) => changed.has(file))
}

function collectChangedFiles(root) {
  return unique([
    ...changedSinceMergeBase(root),
    ...gitLines(root, ["diff", "--name-only", "--diff-filter=AM"]),
    ...gitLines(root, ["diff", "--cached", "--name-only", "--diff-filter=AM"]),
    ...gitLines(root, ["ls-files", "--others", "--exclude-standard"]),
  ].map(normalizePath))
}

function changedSinceMergeBase(root) {
  const base =
    gitText(root, ["merge-base", "origin/main", "HEAD"]) ||
    gitText(root, ["merge-base", "main", "HEAD"])
  return base ? gitLines(root, ["diff", "--name-only", "--diff-filter=AM", `${base}..HEAD`]) : []
}

function runNodeCoverage(requiredFiles) {
  const args = [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-exclude=plugins/desk/mcp/__tests__/**",
    "--test-coverage-exclude=plugins/desk/mcp/node_modules/**",
    ...requiredFiles.map((file) => `--test-coverage-include=${file}`),
    "plugins/desk/mcp/__tests__/**/*.test.js",
  ]
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  })
}

function parseNodeCoverageReport(output) {
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

function gitText(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : ""
}

function gitLines(root, args) {
  return gitText(root, args).split("\n").filter(Boolean)
}

function normalizePath(file) {
  return file.replaceAll(path.sep, "/")
}

function unique(values) {
  return [...new Set(values)]
}

main()
