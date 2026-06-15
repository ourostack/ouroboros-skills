import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  existsSync,
  readFileSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const manifestPath = "plugins/desk/activation/desk.activation.json"
const evidencePath = "desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md"
const generatedMatrixPath = "plugins/desk/activation/support-matrix.json"
const requiredColumns = [
  "host_id",
  "surface",
  "disposition",
  "source_paths",
  "evidence_command_or_doc",
  "unsupported_primitives",
  "fallback_behavior",
]
const requiredHosts = [
  "claude",
  "codex",
  "copilot-root",
  "ouroboros-autonomous-agent",
  "generic-stdio",
]

async function loadSupportMatrix() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "activation", "support-matrix.js")))
}

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"))
}

function loadText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

function splitMarkdownRow(row) {
  return row.trim().replace(/^\|/u, "").replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim())
}

function parseEvidenceTable(content) {
  const tableRows = content
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("|"))
  const columns = splitMarkdownRow(tableRows[0])
  const rows = tableRows.slice(2).map((line) => {
    const values = splitMarkdownRow(line)
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]))
  })
  return { columns, rows }
}

function splitList(value) {
  if (value === "none") {
    return []
  }
  return value.split(";").map((item) => item.trim()).filter(Boolean)
}

function normalizedEvidenceRows(content) {
  return parseEvidenceTable(content).rows.map((row) => ({
    ...row,
    source_paths: splitList(row.source_paths),
    unsupported_primitives: splitList(row.unsupported_primitives),
  }))
}

function expectedSupportMatrix() {
  const evidence = normalizedEvidenceRows(loadText(evidencePath))
  return {
    schema_version: 1,
    generated_from: {
      activation_manifest: manifestPath,
      host_capability_evidence: evidencePath,
    },
    hosts: evidence,
  }
}

test("host capability evidence declares required columns and host rows", () => {
  const { columns, rows } = parseEvidenceTable(loadText(evidencePath))

  assert.deepEqual(columns, requiredColumns)
  assert.deepEqual(rows.map((row) => row.host_id).sort(), [...requiredHosts].sort())
  for (const row of rows) {
    for (const column of requiredColumns) {
      assert.notEqual(row[column], "", `${row.host_id} ${column} must not be empty`)
    }
    for (const sourcePath of splitList(row.source_paths)) {
      assert.equal(
        existsSync(path.join(repoRoot, sourcePath)),
        true,
        `${row.host_id} source path must exist: ${sourcePath}`,
      )
    }
  }
})

test("support matrix builder validates manifest host support against evidence", async () => {
  const {
    buildSupportMatrix,
    parseHostCapabilityEvidence,
    validateSupportMatrix,
  } = await loadSupportMatrix()
  const manifest = loadJson(manifestPath)
  const evidence = parseHostCapabilityEvidence({
    content: loadText(evidencePath),
    sourcePath: evidencePath,
  })

  assert.deepEqual(evidence.hosts, normalizedEvidenceRows(loadText(evidencePath)))
  const matrix = buildSupportMatrix({
    manifest,
    evidence,
    sources: {
      activationManifest: manifestPath,
      hostCapabilityEvidence: evidencePath,
    },
  })
  assert.deepEqual(matrix, expectedSupportMatrix())
  assert.deepEqual(validateSupportMatrix({ matrix, manifest, evidence }), [])

  for (const hostSupport of manifest.host_support) {
    const evidenceRow = evidence.hosts.find((row) => row.host_id === hostSupport.host)
    assert.ok(evidenceRow, `missing evidence row for ${hostSupport.host}`)
    assert.equal(evidenceRow.fallback_behavior, hostSupport.fallback_behavior)
  }
})

test("generated support matrix artifact is fresh", async () => {
  const {
    buildSupportMatrix,
    parseHostCapabilityEvidence,
  } = await loadSupportMatrix()
  const manifest = loadJson(manifestPath)
  const evidence = parseHostCapabilityEvidence({
    content: loadText(evidencePath),
    sourcePath: evidencePath,
  })
  const generated = loadJson(generatedMatrixPath)

  assert.deepEqual(generated, buildSupportMatrix({
    manifest,
    evidence,
    sources: {
      activationManifest: manifestPath,
      hostCapabilityEvidence: evidencePath,
    },
  }))
})
