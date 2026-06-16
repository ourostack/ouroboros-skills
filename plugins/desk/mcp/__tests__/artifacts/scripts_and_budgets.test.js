// Unit 21a: red contract for maintenance artifact scripts and performance
// budgets. These are release/package surfaces, not an everyday Desk CLI.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { main as startMcpServer } from "../../index.js"
import { rebuildIndex } from "../../src/indexer/index.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const workflowPath = path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml")
const performanceBudgetsPath = path.join(mcpRoot, "config", "performance-budgets.json")
const policySchemaPath = path.join(
  repoRoot,
  "plugins",
  "desk",
  "artifacts",
  "publication-policy.schema.json",
)
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
const ARTIFACT_SCRIPT_TARGETS = Object.freeze([
  Object.freeze({
    artifactType: "vector-pack",
    scriptName: "artifact:vector-pack:build",
    idArg: "--pack-id",
    id: "guarded-pack",
    primaryRel: path.join(
      "artifacts",
      "vector-packs",
      ACTIVE_EMBEDDING_SPEC.id,
      "guarded-pack.jsonl",
    ),
  }),
  Object.freeze({
    artifactType: "snapshot",
    scriptName: "artifact:snapshot:build",
    idArg: "--snapshot-id",
    id: "guarded-snapshot",
    primaryRel: path.join(
      "artifacts",
      "snapshots",
      ACTIVE_EMBEDDING_SPEC.id,
      "guarded-snapshot.sqlite.zst",
    ),
  }),
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

function makeTempDir(prefix = "desk-artifact-scripts-") {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function writeFile(root, rel, body) {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body, "utf8")
  return abs
}

function writeJson(root, rel, value) {
  writeFile(root, rel, `${JSON.stringify(value, null, 2)}\n`)
}

function validPolicy(overrides = {}) {
  return {
    schema_version: 1,
    default_publication: "deny",
    repo_visibility: "public",
    sensitive_repo: true,
    approved_artifact_types: [],
    approval_required: true,
    approvals: [],
    updated_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  }
}

function repoApproval(artifactType) {
  return {
    scope: "repo",
    artifact_type: artifactType,
    approved_by: "unit-test-reviewer",
    approved_at: "2026-06-15T00:00:00.000Z",
    reason: "explicit artifact-script fixture approval",
  }
}

function writePolicyFixture(pluginRoot, policy) {
  mkdirSync(path.join(pluginRoot, "artifacts"), { recursive: true })
  writeFileSync(
    path.join(pluginRoot, "artifacts", "publication-policy.schema.json"),
    readFileSync(policySchemaPath),
  )
  writeJson(pluginRoot, path.join("artifacts", "publication-policy.json"), policy)
}

function writeApprovedPolicy(pluginRoot) {
  writePolicyFixture(pluginRoot, validPolicy({
    approved_artifact_types: ["vector-pack", "snapshot"],
    approvals: [repoApproval("vector-pack"), repoApproval("snapshot")],
  }))
}

function writeDeniedPolicy(pluginRoot) {
  writePolicyFixture(pluginRoot, validPolicy())
}

function writeTombstoneLedger(pluginRoot, rows) {
  mkdirSync(path.join(pluginRoot, "artifacts", "tombstones"), { recursive: true })
  writeFileSync(
    path.join(pluginRoot, "artifacts", "tombstones", "tombstones.jsonl"),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  )
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function embedFetch() {
  return async () => ({
    ok: true,
    json: async () => ({
      embedding: Array.from(
        { length: ACTIVE_EMBEDDING_SPEC.dimension },
        (_, index) => index / ACTIVE_EMBEDDING_SPEC.dimension,
      ),
    }),
  })
}

async function seedIndexedDesk({ deskRoot, docPath = "trackA/task-1/task.md", body }) {
  const documentBody = body ?? "---\nstatus: processing\n---\nrelease fixture text\n"
  writeFile(deskRoot, docPath, documentBody)
  await rebuildIndex(deskRoot, { embed: { fetch: embedFetch() } })
  return {
    docPath,
    body: documentBody,
    hash: sha256(documentBody),
  }
}

function runNpmScript(scriptName, args = []) {
  return spawnSync(
    "npm",
    ["--prefix", "plugins/desk/mcp", "run", scriptName, "--", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        DESK_EMBED_TIMEOUT_MS: "10",
      },
    },
  )
}

function artifactArgs({ target, deskRoot, pluginRoot, id = target.id, budgetConfig } = {}) {
  const args = [
    "--desk-root",
    deskRoot,
    "--plugin-root",
    pluginRoot,
    target.idArg,
    id,
    "--from-local-db",
  ]
  if (budgetConfig) args.push("--budget-config", budgetConfig)
  return args
}

function scriptOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`
}

function assertScriptFailedWithCode(result, code) {
  assert.notEqual(result.status, 0, result.stdout || result.stderr)
  assert.match(scriptOutput(result), new RegExp(`\\b${escapeRegExp(code)}\\b`, "u"))
}

function assertScriptSucceeded(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

function assertOutputDoesNotLeak(result, body) {
  assert.doesNotMatch(scriptOutput(result), new RegExp(escapeRegExp(body), "u"))
}

function filesUnder(root) {
  const out = []
  function walk(current) {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs).split(path.sep).join("/"))
      }
    }
  }
  walk(root)
  return out.sort()
}

function artifactTree(pluginRoot) {
  return filesUnder(path.join(pluginRoot, "artifacts"))
    .filter((file) => (
      !file.startsWith("publication-policy.") &&
      !file.startsWith("tombstones/")
    ))
}

function assertArtifactTreeUnchanged(pluginRoot, before) {
  assert.deepEqual(artifactTree(pluginRoot), before)
}

function writeBudgetConfig(file, overrides = {}) {
  const base = {
    schema_version: 1,
    startup: {
      ensure_index_ms: 250,
      snapshot_restore_ms: 250,
      vector_pack_import_ms: 250,
    },
    rebuild: {
      vector_pack_rebuild_ms: 1000,
      snapshot_build_ms: 1000,
    },
    artifacts: {
      snapshot_verify_ms: 1000,
      validate_ms: 1000,
    },
  }
  writeFileSync(
    file,
    `${JSON.stringify({
      ...base,
      ...overrides,
      startup: { ...base.startup, ...overrides.startup },
      rebuild: { ...base.rebuild, ...overrides.rebuild },
      artifacts: { ...base.artifacts, ...overrides.artifacts },
    }, null, 2)}\n`,
    "utf8",
  )
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

function runtimeServerWithEnsureIndex(ensureIndexResult = { built: false, reason: "fresh" }) {
  const ensureCalls = []
  const startCalls = []
  return {
    ensureCalls,
    startCalls,
    async ensureIndex(deskRoot, opts = {}) {
      ensureCalls.push({ deskRoot, opts })
      return ensureIndexResult
    },
    async startServer(args) {
      startCalls.push(args)
    },
  }
}

async function withSeededArtifactFixture(fn) {
  const deskRoot = makeTempDir("desk-artifact-scripts-budget-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-budget-plugin-")
  try {
    writeApprovedPolicy(pluginRoot)
    await seedIndexedDesk({ deskRoot })
    const vectorTarget = ARTIFACT_SCRIPT_TARGETS[0]
    const vectorRun = runNpmScript(
      vectorTarget.scriptName,
      artifactArgs({ target: vectorTarget, deskRoot, pluginRoot }),
    )
    assertScriptSucceeded(vectorRun)
    const snapshotTarget = ARTIFACT_SCRIPT_TARGETS[1]
    const snapshotRun = runNpmScript(
      snapshotTarget.scriptName,
      [
        ...artifactArgs({ target: snapshotTarget, deskRoot, pluginRoot }),
        "--included-pack-id",
        vectorTarget.id,
      ],
    )
    assertScriptSucceeded(snapshotRun)
    await fn({ deskRoot, pluginRoot, snapshotTarget, vectorTarget })
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
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
    assert.doesNotMatch(source, /new\s+Command|commander|yargs/u)
  }
})

test("artifact build scripts publish allowed artifacts only under canonical dirs", async () => {
  const deskRoot = makeTempDir("desk-artifact-scripts-allowed-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-allowed-plugin-")
  try {
    writeApprovedPolicy(pluginRoot)
    await seedIndexedDesk({ deskRoot })

    const vectorTarget = ARTIFACT_SCRIPT_TARGETS[0]
    const vectorRun = runNpmScript(
      vectorTarget.scriptName,
      artifactArgs({ target: vectorTarget, deskRoot, pluginRoot }),
    )
    assertScriptSucceeded(vectorRun)
    assert.deepEqual(
      filesUnder(path.join(pluginRoot, "artifacts", "vector-packs", ACTIVE_EMBEDDING_SPEC.id)),
      [
        "guarded-pack.jsonl",
        "guarded-pack.manifest.json",
        "guarded-pack.sha256",
      ],
    )

    const snapshotTarget = ARTIFACT_SCRIPT_TARGETS[1]
    const snapshotRun = runNpmScript(
      snapshotTarget.scriptName,
      [
        ...artifactArgs({ target: snapshotTarget, deskRoot, pluginRoot }),
        "--included-pack-id",
        vectorTarget.id,
      ],
    )
    assertScriptSucceeded(snapshotRun)
    assert.deepEqual(
      filesUnder(path.join(pluginRoot, "artifacts", "snapshots", ACTIVE_EMBEDDING_SPEC.id)),
      [
        "guarded-snapshot.manifest.json",
        "guarded-snapshot.sha256",
        "guarded-snapshot.sqlite.zst",
      ],
    )

    const artifactFiles = filesUnder(path.join(pluginRoot, "artifacts"))
    assert.equal(artifactFiles.includes("guarded-pack.jsonl"), false)
    assert.equal(artifactFiles.includes("guarded-snapshot.sqlite.zst"), false)
    assert.ok(artifactFiles.every((file) => (
      file.startsWith("publication-policy.") ||
      file.startsWith(`vector-packs/${ACTIVE_EMBEDDING_SPEC.id}/`) ||
      file.startsWith(`snapshots/${ACTIVE_EMBEDDING_SPEC.id}/`)
    )))
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test("artifact build scripts reject publication-policy denial before writing bytes", async () => {
  const deskRoot = makeTempDir("desk-artifact-scripts-denied-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-denied-plugin-")
  try {
    writeDeniedPolicy(pluginRoot)
    const doc = await seedIndexedDesk({ deskRoot })

    for (const target of ARTIFACT_SCRIPT_TARGETS) {
      const before = artifactTree(pluginRoot)
      const result = runNpmScript(
        target.scriptName,
        artifactArgs({ target, deskRoot, pluginRoot }),
      )
      assertScriptFailedWithCode(result, "artifact_publication_not_approved")
      assertOutputDoesNotLeak(result, doc.body)
      assertArtifactTreeUnchanged(pluginRoot, before)
    }
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test("artifact build scripts reject excluded local DB docs before writing bytes", async () => {
  const deskRoot = makeTempDir("desk-artifact-scripts-excluded-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-excluded-plugin-")
  try {
    writeApprovedPolicy(pluginRoot)
    const doc = await seedIndexedDesk({
      deskRoot,
      docPath: "ignored-track/task-1/task.md",
      body: "---\nstatus: processing\n---\nexcluded release fixture text\n",
    })
    writeFile(deskRoot, ".gitignore", "ignored-track/\n")

    for (const target of ARTIFACT_SCRIPT_TARGETS) {
      const before = artifactTree(pluginRoot)
      const result = runNpmScript(
        target.scriptName,
        artifactArgs({ target, deskRoot, pluginRoot }),
      )
      assertScriptFailedWithCode(result, "artifact_input_excluded")
      assertOutputDoesNotLeak(result, doc.body)
      assertArtifactTreeUnchanged(pluginRoot, before)
    }
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test("artifact build scripts reject tombstoned local DB docs before writing bytes", async () => {
  const deskRoot = makeTempDir("desk-artifact-scripts-tombstone-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-tombstone-plugin-")
  try {
    writeApprovedPolicy(pluginRoot)
    const doc = await seedIndexedDesk({
      deskRoot,
      body: "---\nstatus: processing\n---\nredacted release fixture text\n",
    })
    writeTombstoneLedger(pluginRoot, [
      {
        schema_version: 1,
        document_path: doc.docPath,
        document_hash: doc.hash,
        reason: "redacted",
        redacted_at: "2026-06-15T00:00:00.000Z",
        effective_from: "2026-06-15T00:00:00.000Z",
        artifact_rotation_id: "unit-21a-redaction",
        actor: "unit-test-reviewer",
      },
    ])

    for (const target of ARTIFACT_SCRIPT_TARGETS) {
      const before = artifactTree(pluginRoot)
      const result = runNpmScript(
        target.scriptName,
        artifactArgs({ target, deskRoot, pluginRoot }),
      )
      assertScriptFailedWithCode(result, "artifact_input_redacted")
      assertOutputDoesNotLeak(result, doc.body)
      assertArtifactTreeUnchanged(pluginRoot, before)
    }
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
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

test("MCP startup reads ensure-index budget from plugin performance config", async () => {
  const deskRoot = makeTempDir("desk-artifact-scripts-startup-budget-desk-")
  const pluginRoot = makeTempDir("desk-artifact-scripts-startup-budget-plugin-")
  try {
    mkdirSync(path.join(pluginRoot, "config"), { recursive: true })
    writeBudgetConfig(path.join(pluginRoot, "config", "performance-budgets.json"), {
      startup: {
        ensure_index_ms: 37,
      },
    })
    const runtimeServer = runtimeServerWithEnsureIndex()

    await startMcpServer({
      argv: ["--root", deskRoot],
      cwd: deskRoot,
      env: {},
      homeDir: deskRoot,
      mcpRoot: pluginRoot,
      runtimeImporter: async () => runtimeServer,
    })

    assert.equal(runtimeServer.ensureCalls.length, 1)
    assert.equal(runtimeServer.ensureCalls[0].deskRoot, deskRoot)
    assert.equal(runtimeServer.ensureCalls[0].opts.startup, true)
    assert.equal(runtimeServer.ensureCalls[0].opts.budgetMs, 37)
    assert.equal(runtimeServer.startCalls.length, 1)
    assert.equal(runtimeServer.startCalls[0].statusContext.startup.budget_ms, 37)
  } finally {
    rmSync(deskRoot, { recursive: true, force: true })
    rmSync(pluginRoot, { recursive: true, force: true })
  }
})

test("artifact scripts fail when configured rebuild or validation budgets are exceeded", async () => {
  const budgetConfig = path.join(makeTempDir("desk-artifact-scripts-budget-config-"), "budgets.json")
  try {
    writeBudgetConfig(budgetConfig, {
      artifacts: {
        snapshot_verify_ms: 0,
        validate_ms: 0,
      },
      rebuild: {
        snapshot_build_ms: 0,
        vector_pack_rebuild_ms: 0,
      },
    })
    await withSeededArtifactFixture(async ({ deskRoot, pluginRoot, snapshotTarget, vectorTarget }) => {
      for (const [scriptName, args] of [
        [
          vectorTarget.scriptName,
          artifactArgs({
            target: vectorTarget,
            deskRoot,
            pluginRoot,
            id: "budget-pack",
            budgetConfig,
          }),
        ],
        [
          snapshotTarget.scriptName,
          [
            ...artifactArgs({
              target: snapshotTarget,
              deskRoot,
              pluginRoot,
              id: "budget-snapshot",
              budgetConfig,
            }),
            "--included-pack-id",
            vectorTarget.id,
          ],
        ],
        [
          "artifact:snapshot:verify",
          [
            "--plugin-root",
            pluginRoot,
            "--snapshot-id",
            snapshotTarget.id,
            "--budget-config",
            budgetConfig,
          ],
        ],
        [
          "artifact:validate",
          [
            "--desk-root",
            deskRoot,
            "--plugin-root",
            pluginRoot,
            "--budget-config",
            budgetConfig,
          ],
        ],
      ]) {
        const before = artifactTree(pluginRoot)
        const result = runNpmScript(scriptName, args)
        assertScriptFailedWithCode(result, "performance_budget_exceeded")
        assertArtifactTreeUnchanged(pluginRoot, before)
      }
    })
  } finally {
    rmSync(path.dirname(budgetConfig), { recursive: true, force: true })
  }
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
