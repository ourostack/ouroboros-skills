// Unit 21a: red contract for maintenance artifact scripts and performance
// budgets. These are release/package surfaces, not an everyday Desk CLI.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  existsSync,
  readFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const workflowPath = path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml")
const performanceBudgetsPath = path.join(mcpRoot, "config", "performance-budgets.json")
const EXPECTED_ARTIFACT_SCRIPTS = Object.freeze({
  "artifact:vector-pack:build": "node scripts/build-vector-pack.js",
  "artifact:snapshot:build": "node scripts/build-snapshot.js",
  "artifact:snapshot:verify": "node scripts/verify-snapshot.js",
  "artifact:validate": "node scripts/validate-artifacts.js",
})
const EXPECTED_SCRIPT_FILES = Object.freeze([
  "build-vector-pack.js",
  "build-snapshot.js",
  "verify-snapshot.js",
  "validate-artifacts.js",
])

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function scriptPath(scriptName) {
  return path.join(mcpRoot, "scripts", scriptName)
}

function scriptSource(scriptName) {
  return readFileSync(scriptPath(scriptName), "utf8")
}

function scriptHelp(scriptName) {
  const result = spawnSync(
    process.execPath,
    [scriptPath(scriptName), "--help"],
    {
      cwd: mcpRoot,
      encoding: "utf8",
    },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return `${result.stdout}${result.stderr}`
}

function workflowPathFilters(workflow, eventName) {
  const lines = workflow.split(/\r?\n/u)
  const eventStart = lines.findIndex((line) => line === `  ${eventName}:`)
  assert.notEqual(eventStart, -1, `workflow must define ${eventName}`)
  const eventEnd = lines.findIndex((line, index) => (
    index > eventStart
    && (/^[a-z_]+:/u.test(line) || /^  [a-z_]+:/u.test(line))
  ))
  const eventLines = lines.slice(eventStart, eventEnd === -1 ? lines.length : eventEnd)
  const pathsStart = eventLines.findIndex((line) => line === "    paths:")
  assert.notEqual(pathsStart, -1, `${eventName} must define paths`)
  const paths = []
  for (const line of eventLines.slice(pathsStart + 1)) {
    if (/^\s*$/u.test(line)) continue
    const match = line.match(/^      - "([^"]+)"$/u)
    if (match === null) break
    paths.push(match[1])
  }
  return paths
}

function workflowJob(workflow, jobName) {
  const lines = workflow.split(/\r?\n/u)
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`)
  assert.notEqual(jobStart, -1, `workflow must define job ${jobName}`)
  const jobEnd = lines.findIndex((line, index) => (
    index > jobStart
    && /^  [A-Za-z0-9_-]+:\s*$/u.test(line)
  ))
  return lines.slice(jobStart, jobEnd === -1 ? lines.length : jobEnd).join("\n")
}

function workflowStepBlocks(jobSection) {
  const blocks = []
  let currentBlock
  for (const line of jobSection.split(/\r?\n/u)) {
    if (/^      - /u.test(line)) {
      if (currentBlock !== undefined) blocks.push(currentBlock.join("\n"))
      currentBlock = [line]
      continue
    }
    if (currentBlock !== undefined) currentBlock.push(line)
  }
  if (currentBlock !== undefined) blocks.push(currentBlock.join("\n"))
  return blocks
}

function workflowStepRunText(stepBlock) {
  const lines = stepBlock.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^\s*run:\s+(.+?)\s*$/u)
    if (inline !== null && inline[1] !== "|" && inline[1] !== ">") {
      return inline[1]
    }
    if (/^\s*run:\s*[|>]\s*$/u.test(lines[index])) {
      return lines
        .slice(index + 1)
        .filter((line) => /^\s{10,}\S/u.test(line))
        .map((line) => line.replace(/^\s{10}/u, ""))
        .join("\n")
    }
  }
  return ""
}

function workflowStepWorkingDirectory(stepBlock) {
  const match = stepBlock.match(/^\s*working-directory:\s+(.+?)\s*$/mu)
  return match?.[1]?.replace(/^["']|["']$/gu, "")
}

function workflowStepAllowsFailure(stepBlock) {
  const match = stepBlock.match(/^\s*continue-on-error:\s+(.+?)\s*$/mu)
  return match !== null && !/^["']?false["']?$/iu.test(match[1])
}

function workflowStepRunsMcpScript(stepBlock, scriptName) {
  if (workflowStepAllowsFailure(stepBlock)) return false
  const runLines = workflowStepRunText(stepBlock)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
  const runsCommand = runLines.some((line) => workflowLineRunsMcpScript(line, scriptName))
  if (!runsCommand) return false
  return (
    workflowStepWorkingDirectory(stepBlock) === "plugins/desk/mcp" ||
    runLines.some((line) => workflowLineRunsMcpScript(line, scriptName, { requirePrefix: true }))
  )
}

function workflowLineRunsMcpScript(line, scriptName, { requirePrefix = false } = {}) {
  const envPrefix = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*`
  const escapedScriptName = escapeRegExp(scriptName)
  const prefixPattern = String.raw`npm\s+--prefix\s+plugins/desk/mcp\s+run\s+${escapedScriptName}(?:\s+(?<prefixArgs>.*)|$)`
  const workingDirPattern = String.raw`npm\s+run\s+${escapedScriptName}(?:\s+(?<workingDirArgs>.*)|$)`
  const match = line.match(new RegExp(`^${envPrefix}(?:${prefixPattern}${requirePrefix ? "" : `|${workingDirPattern}`})`, "u"))
  const args = match?.groups?.prefixArgs ?? match?.groups?.workingDirArgs ?? ""
  return match !== null && workflowScriptArgsAreReal(args)
}

function workflowScriptArgsAreReal(args) {
  return !/(?:^|\s)--help(?:\s|$)/u.test(args)
    && !/(?:^|\s)(?:\|\||&&|\||;)(?:\s|$)/u.test(args)
}

function assertWorkflowJobRunsMcpScript(jobSection, jobName, scriptName) {
  assert.ok(
    workflowStepBlocks(jobSection).some((stepBlock) => workflowStepRunsMcpScript(stepBlock, scriptName)),
    `workflow job ${jobName} must run ${scriptName} from plugins/desk/mcp or via npm --prefix plugins/desk/mcp`,
  )
}

function assertIncludesAll(actual, expected, label) {
  for (const item of expected) {
    assert.ok(actual.includes(item), `${label} must include ${item}`)
  }
}

function assertPositiveIntegerBudget(value, label) {
  assert.equal(Number.isInteger(value), true, `${label} must be an integer`)
  assert.ok(value > 0, `${label} must be positive`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

test("package declares artifact maintenance scripts without adding a user Desk CLI", () => {
  const packageJson = loadJson(packageJsonPath)

  assert.deepEqual(
    Object.fromEntries(
      Object.keys(EXPECTED_ARTIFACT_SCRIPTS)
        .map((scriptName) => [scriptName, packageJson.scripts?.[scriptName]]),
    ),
    EXPECTED_ARTIFACT_SCRIPTS,
  )
  assert.deepEqual(packageJson.bin, { "desk-mcp": "./index.js" })

  for (const scriptName of EXPECTED_SCRIPT_FILES) {
    const source = scriptSource(scriptName)
    assert.equal(source.startsWith("#!/usr/bin/env node\n"), true)
    assert.match(scriptHelp(scriptName), /artifact|snapshot|vector-pack|maintenance|release/iu)
  }
})

test("artifact maintenance scripts route publication through guarded canonical artifact paths", () => {
  const vectorBuild = scriptSource("build-vector-pack.js")
  const snapshotBuild = scriptSource("build-snapshot.js")
  const snapshotVerify = scriptSource("verify-snapshot.js")
  const validateArtifacts = scriptSource("validate-artifacts.js")

  assert.match(vectorBuild, /\bwriteVectorPackArtifact\b/u)
  assert.match(vectorBuild, /\bderiveVectorPackPaths\b/u)
  assert.match(vectorBuild, /\bperformance-budgets\.json\b/u)
  assert.doesNotMatch(vectorBuild, /new\s+Command|commander|yargs/u)

  assert.match(snapshotBuild, /\bwriteSnapshotArtifact\b/u)
  assert.match(snapshotBuild, /\bderiveSnapshotPaths\b/u)
  assert.match(snapshotBuild, /\bperformance-budgets\.json\b/u)
  assert.doesNotMatch(snapshotBuild, /new\s+Command|commander|yargs/u)

  assert.match(snapshotVerify, /\bvalidateSnapshotArtifact\b/u)
  assert.match(snapshotVerify, /\bperformance-budgets\.json\b/u)
  assert.doesNotMatch(snapshotVerify, /new\s+Command|commander|yargs/u)

  for (const requiredGuard of [
    "loadPublicationPolicy",
    "loadExclusionRules",
    "loadTombstoneLedger",
    "validateVectorPackFile",
    "validateSnapshotArtifact",
    "performance-budgets.json",
  ]) {
    assert.match(validateArtifacts, new RegExp(`\\b${escapeRegExp(requiredGuard)}\\b`, "u"))
  }
})

test("performance budget config declares startup, rebuild, and artifact thresholds", () => {
  assert.equal(existsSync(performanceBudgetsPath), true)
  const budgets = loadJson(performanceBudgetsPath)

  assert.equal(budgets.schema_version, 1)
  assertPositiveIntegerBudget(budgets.startup?.ensure_index_ms, "startup.ensure_index_ms")
  assert.equal(
    budgets.startup.ensure_index_ms,
    250,
    "startup.ensure_index_ms must match the bounded startup MCP registration budget",
  )
  assertPositiveIntegerBudget(budgets.startup?.snapshot_restore_ms, "startup.snapshot_restore_ms")
  assertPositiveIntegerBudget(budgets.startup?.vector_pack_import_ms, "startup.vector_pack_import_ms")
  assertPositiveIntegerBudget(budgets.rebuild?.vector_pack_rebuild_ms, "rebuild.vector_pack_rebuild_ms")
  assertPositiveIntegerBudget(budgets.rebuild?.snapshot_build_ms, "rebuild.snapshot_build_ms")
  assertPositiveIntegerBudget(budgets.artifacts?.snapshot_verify_ms, "artifacts.snapshot_verify_ms")
  assertPositiveIntegerBudget(budgets.artifacts?.validate_ms, "artifacts.validate_ms")
})

test("CI invokes artifact validation and watches artifact script inputs", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  const deskMcpJob = workflowJob(workflow, "desk-mcp-tests")

  assertWorkflowJobRunsMcpScript(deskMcpJob, "desk-mcp-tests", "artifact:validate")
  assertWorkflowJobRunsMcpScript(deskMcpJob, "desk-mcp-tests", "artifact:snapshot:verify")

  for (const [eventName, pathFilters] of [
    ["pull_request", workflowPathFilters(workflow, "pull_request")],
    ["push", workflowPathFilters(workflow, "push")],
  ]) {
    assertIncludesAll(pathFilters, [
      "plugins/desk/artifacts/vector-packs/**",
      "plugins/desk/artifacts/snapshots/**",
      "plugins/desk/artifacts/tombstones/**",
      "plugins/desk/artifacts/publication-policy.json",
      "plugins/desk/artifacts/publication-policy.schema.json",
      "plugins/desk/mcp/config/performance-budgets.json",
      "plugins/desk/mcp/scripts/build-vector-pack.js",
      "plugins/desk/mcp/scripts/build-snapshot.js",
      "plugins/desk/mcp/scripts/verify-snapshot.js",
      "plugins/desk/mcp/scripts/validate-artifacts.js",
    ], `${eventName} path filters`)
  }
})
