import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

const COVERAGE_SCRIPT = "node scripts/run-coverage.js"
const DEFAULT_THRESHOLDS = {
  lines: 100,
  branches: 100,
  functions: 100,
  statements: 100,
}

export function evaluateCoverageReport({
  repoRoot,
  reportPath,
  requiredFiles,
  exclusions = [],
  thresholds = DEFAULT_THRESHOLDS,
}) {
  const issues = []
  const checkedFiles = []
  const excludedFiles = []
  const normalizedRequired = normalizePathList(requiredFiles)

  if (!existsSync(reportPath)) {
    return {
      ok: false,
      issues: [`coverage report is missing: ${reportPath}`],
      checkedFiles,
      excludedFiles,
    }
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  const reportEntries = normalizeReportEntries(repoRoot, report)
  const exclusionMap = normalizeExclusions(exclusions)

  for (const file of normalizedRequired) {
    const exclusion = exclusionMap.get(file)
    if (exclusion) {
      if (!hasText(exclusion.owner) || !hasText(exclusion.reason)) {
        issues.push(`coverage exclusion for ${file} requires owner and reason`)
      } else {
        excludedFiles.push(file)
      }
      continue
    }

    checkedFiles.push(file)
    const entry = reportEntries.get(file)
    if (!entry) {
      issues.push(`missing coverage for ${file}`)
      continue
    }

    for (const metric of Object.keys(thresholds)) {
      const pct = entry?.[metric]?.pct
      if (typeof pct !== "number" || pct < thresholds[metric]) {
        issues.push(
          `${file} ${metric} coverage ${String(pct)} is below ${thresholds[metric]}`,
        )
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    checkedFiles,
    excludedFiles,
  }
}

export function assertCoverageCommandParity({ packageJsonPath, workflowPath }) {
  const issues = []
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const script = packageJson.scripts?.["test:coverage"]
  if (script !== COVERAGE_SCRIPT) {
    issues.push(`package.json test:coverage must be ${COVERAGE_SCRIPT}; got ${script}`)
  }

  const workflow = readFileSync(workflowPath, "utf8")
  if (!workflow.includes("npm run test:coverage")) {
    issues.push("desk MCP CI must run npm run test:coverage")
  }
  if (/run:\s*npm test\b/.test(workflow)) {
    issues.push("desk MCP CI still runs npm test instead of npm run test:coverage")
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}

export function collectCoverageRequiredFiles({ repoRoot }) {
  return normalizePathList([
    ...collectFiles(path.join(repoRoot, "plugins", "desk", "mcp", "src"), ".js")
      .filter(isProductionJs),
    ...collectFiles(path.join(repoRoot, "plugins", "desk", "mcp", "scripts"), ".js")
      .filter(isProductionJs),
    ...collectFiles(path.join(repoRoot, "scripts"), ".cjs")
      .filter(isProductionCjs),
  ].map((file) => normalizeRelative(repoRoot, file)))
}

function normalizePathList(files) {
  return [...new Set(files.map((file) => normalizePath(file)))].sort()
}

function normalizeReportEntries(repoRoot, report) {
  const entries = new Map()
  for (const [rawFile, metrics] of Object.entries(report)) {
    if (rawFile === "total") continue
    const file = path.isAbsolute(rawFile)
      ? normalizeRelative(repoRoot, rawFile)
      : normalizePath(rawFile)
    entries.set(file, metrics)
  }
  return entries
}

function normalizeExclusions(exclusions) {
  const out = new Map()
  for (const exclusion of exclusions) {
    out.set(normalizePath(exclusion.path ?? ""), exclusion)
  }
  return out
}

function collectFiles(dir, extension) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry)
    const stat = statSync(file)
    if (stat.isDirectory()) {
      out.push(...collectFiles(file, extension))
    } else if (stat.isFile() && file.endsWith(extension)) {
      out.push(file)
    }
  }
  return out
}

function isProductionJs(file) {
  const normalized = normalizePath(file)
  return (
    !normalized.includes("/__tests__/") &&
    !normalized.endsWith(".test.js") &&
    !path.basename(normalized).startsWith("test-")
  )
}

function isProductionCjs(file) {
  const normalized = normalizePath(file)
  return !path.basename(normalized).startsWith("test-")
}

function normalizeRelative(root, file) {
  return normalizePath(path.relative(root, file))
}

function normalizePath(file) {
  return file.replaceAll(path.sep, "/")
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}
