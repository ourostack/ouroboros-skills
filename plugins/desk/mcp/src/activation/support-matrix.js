import {
  readFileSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

export const SUPPORT_MATRIX_SCHEMA_VERSION = 1

const REQUIRED_EVIDENCE_COLUMNS = [
  "host_id",
  "surface",
  "disposition",
  "source_paths",
  "evidence_command_or_doc",
  "unsupported_primitives",
  "fallback_behavior",
]
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(moduleDir, "..", "..", "..", "..", "..")
const defaultManifestPath = "plugins/desk/activation/desk.activation.json"
const defaultEvidencePath = "desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md"
const defaultOutputPath = "plugins/desk/activation/support-matrix.json"

export function parseHostCapabilityEvidence({ content, sourcePath }) {
  const tableRows = content
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("|"))
  const columns = splitMarkdownRow(tableRows[0])
  if (!sameList(columns, REQUIRED_EVIDENCE_COLUMNS)) {
    throw new Error(`host capability evidence has invalid columns: ${sourcePath}`)
  }

  return {
    source_path: sourcePath,
    hosts: tableRows.slice(2).map((line) => {
      const values = splitMarkdownRow(line)
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]))
      return {
        ...row,
        source_paths: splitList(row.source_paths),
        unsupported_primitives: splitList(row.unsupported_primitives),
      }
    }),
  }
}

export function buildSupportMatrix({ manifest, evidence, sources }) {
  const matrix = {
    schema_version: SUPPORT_MATRIX_SCHEMA_VERSION,
    generated_from: {
      activation_manifest: sources.activationManifest,
      host_capability_evidence: sources.hostCapabilityEvidence,
    },
    hosts: evidence.hosts,
  }
  const issues = validateSupportMatrix({ matrix, manifest, evidence })
  if (issues.length > 0) {
    throw new Error(`support matrix validation failed:\n${issues.join("\n")}`)
  }
  return matrix
}

export function validateSupportMatrix({ matrix, manifest, evidence }) {
  const issues = []
  if (matrix.schema_version !== SUPPORT_MATRIX_SCHEMA_VERSION) {
    issues.push("support matrix schema_version is unsupported")
  }
  for (const hostSupport of manifest.host_support) {
    const evidenceRow = evidence.hosts.find((row) => row.host_id === hostSupport.host)
    if (!evidenceRow) {
      issues.push(`missing evidence row for host ${hostSupport.host}`)
    } else if (evidenceRow.fallback_behavior !== hostSupport.fallback_behavior) {
      issues.push(`fallback_behavior mismatch for host ${hostSupport.host}`)
    }
  }
  if (!sameList(matrix.hosts.map((row) => row.host_id), evidence.hosts.map((row) => row.host_id))) {
    issues.push("support matrix host rows must match evidence rows")
  }
  return issues
}

export function generateSupportMatrixArtifact() {
  const manifest = readJson(defaultManifestPath)
  const evidence = parseHostCapabilityEvidence({
    content: readText(defaultEvidencePath),
    sourcePath: defaultEvidencePath,
  })
  const matrix = buildSupportMatrix({
    manifest,
    evidence,
    sources: {
      activationManifest: defaultManifestPath,
      hostCapabilityEvidence: defaultEvidencePath,
    },
  })
  writeFileSync(repoPath(defaultOutputPath), `${JSON.stringify(matrix, null, 2)}\n`, "utf8")
  return {
    outputPath: defaultOutputPath,
    matrix,
  }
}

export function runSupportMatrixGenerator() {
  const { outputPath } = generateSupportMatrixArtifact()
  process.stdout.write(`wrote ${outputPath}\n`)
  return 0
}

function splitMarkdownRow(row) {
  return row.trim().replace(/^\|/u, "").replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim())
}

function splitList(value) {
  if (value === "none") {
    return []
  }
  return value.split(";").map((item) => item.trim()).filter(Boolean)
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath))
}

function readText(relativePath) {
  return readFileSync(repoPath(relativePath), "utf8")
}

function repoPath(relativePath) {
  return path.join(defaultRepoRoot, relativePath)
}
