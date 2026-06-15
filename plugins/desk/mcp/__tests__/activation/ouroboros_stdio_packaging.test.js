import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const activationManifestPath = "plugins/desk/activation/desk.activation.json"
const evidencePath = "desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md"
const supportMatrixPath = "plugins/desk/activation/support-matrix.json"
const unitTestCommand =
  "node --test plugins/desk/mcp/__tests__/activation/ouroboros_stdio_packaging.test.js"

function readText(...segments) {
  return readFileSync(path.join(repoRoot, ...segments), "utf8")
}

function loadJson(...segments) {
  return JSON.parse(readText(...segments))
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
  return tableRows.slice(2).map((line) => {
    const values = splitMarkdownRow(line)
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]))
  })
}

function splitList(value) {
  if (value === "none") {
    return []
  }
  return value.split(";").map((item) => item.trim()).filter(Boolean)
}

function normalizedEvidenceRows() {
  return parseEvidenceTable(readText(...evidencePath.split("/"))).map((row) => ({
    ...row,
    source_paths: splitList(row.source_paths),
    unsupported_primitives: splitList(row.unsupported_primitives),
  }))
}

function findByField(rows, field, value, source) {
  const row = rows.find((candidate) => candidate[field] === value)
  assert.ok(row, `${source} must include ${field}=${value}`)
  return row
}

function assertIncludesAll(actual, expected, label) {
  for (const item of expected) {
    assert.ok(actual.includes(item), `${label} must include ${item}`)
  }
}

function sectionBetween(markdown, heading, nextHeadingLevel = "###") {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = markdown.match(new RegExp(
    `^${escapedHeading}\\n(?<body>[\\s\\S]*?)(?=^${nextHeadingLevel} |(?![\\s\\S]))`,
    "mu",
  ))
  assert.ok(match, `missing section ${heading}`)
  return match.groups.body
}

function sectionByAnchor(markdown, anchor) {
  const headingPattern = /^(?<level>#{2,6})\s+(?<title>.+)$/gmu
  const headings = Array.from(markdown.matchAll(headingPattern), (match) => ({
    anchor: markdownAnchor(match.groups.title),
    index: match.index,
    level: match.groups.level.length,
    bodyStart: match.index + match[0].length,
  }))
  const headingIndex = headings.findIndex((heading) => heading.anchor === anchor)
  assert.notEqual(headingIndex, -1, `missing markdown anchor #${anchor}`)

  const heading = headings[headingIndex]
  const nextHeading = headings.slice(headingIndex + 1)
    .find((candidate) => candidate.level <= heading.level)
  return markdown.slice(heading.bodyStart, nextHeading?.index ?? markdown.length)
}

function markdownAnchor(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/`/gu, "")
    .replace(/&/gu, "and")
    .replace(/[^a-z0-9\s-]/gu, "")
    .replace(/\s+/gu, "-")
}

test("Ouroboros/autonomous-agent packaging has a flattened bundle disposition", () => {
  const evidenceRow = findByField(
    normalizedEvidenceRows(),
    "host_id",
    "ouroboros-autonomous-agent",
    evidencePath,
  )
  const supportMatrixRow = findByField(
    loadJson(...supportMatrixPath.split("/")).hosts,
    "host_id",
    "ouroboros-autonomous-agent",
    supportMatrixPath,
  )
  const manifestRow = findByField(
    loadJson(...activationManifestPath.split("/")).host_support,
    "host",
    "ouroboros-autonomous-agent",
    activationManifestPath,
  )

  assert.equal(evidenceRow.disposition, "supported-flattened")
  assert.deepEqual(supportMatrixRow, evidenceRow)
  assert.equal(manifestRow.status, "supported")
  assert.equal(manifestRow.dependency_resolution, "flattened")
  assert.deepEqual(manifestRow.unsupported_primitives, ["host-native-plugin-install"])
  assertIncludesAll(manifestRow.capabilities, ["agents", "skills", "mcp"], "Ouroboros capabilities")
  assertIncludesAll(evidenceRow.source_paths, [
    "plugins/desk/README.md",
    "plugins/desk/activation/README.md",
    "plugins/desk/.mcp.json",
    "plugins/desk/plugin.json",
    "plugins/work-suite/plugin.json",
  ], "Ouroboros evidence source_paths")
  assertIncludesAll(evidenceRow.evidence_command_or_doc, [
    unitTestCommand,
    "plugins/desk/README.md#under-ouroboros",
    "plugins/desk/activation/README.md#ouroboros-autonomous-agent",
  ], "Ouroboros evidence_command_or_doc")
  assert.match(evidenceRow.fallback_behavior, /\$DESK/u)
  assert.match(evidenceRow.fallback_behavior, /bundle Desk \+ Work Suite/u)
})

test("Ouroboros activation docs define the evidence anchor and disposition", () => {
  const activationReadme = readText("plugins", "desk", "activation", "README.md")
  const section = sectionByAnchor(activationReadme, "ouroboros-autonomous-agent")

  assert.match(section, /supported-flattened/u)
  assert.match(section, /host-native-plugin-install/u)
  assert.match(section, /bundle Desk \+ Work Suite/u)
  assert.match(section, /\$DESK/u)
})

test("Ouroboros docs specify bundle.json plugin closure and $DESK preamble binding", () => {
  const readme = readText("plugins", "desk", "README.md")
  const section = sectionBetween(readme, "### Under Ouroboros")

  assert.match(section, /bundle\.json/u)
  assert.match(section, /"plugins"\s*:\s*\[/u)
  assert.match(section, /"desk"/u)
  assert.match(section, /"work-suite"/u)
  assert.match(section, /preamble/u)
  assert.match(section, /\$DESK\s*=\s*~\/AgentBundles\/<agent>\.ouro\/desk\//u)
  assert.doesNotMatch(section, /npm install/u)
})

test("generic stdio support matrix records an MCP-only degraded disposition", () => {
  const evidenceRow = findByField(
    normalizedEvidenceRows(),
    "host_id",
    "generic-stdio",
    evidencePath,
  )
  const supportMatrixRow = findByField(
    loadJson(...supportMatrixPath.split("/")).hosts,
    "host_id",
    "generic-stdio",
    supportMatrixPath,
  )
  const manifestRow = findByField(
    loadJson(...activationManifestPath.split("/")).host_support,
    "host",
    "generic-stdio",
    activationManifestPath,
  )

  assert.equal(evidenceRow.disposition, "degraded-mcp-only")
  assert.deepEqual(supportMatrixRow, evidenceRow)
  assert.equal(manifestRow.status, "degraded")
  assert.equal(manifestRow.dependency_resolution, "manual-host")
  assert.deepEqual(manifestRow.capabilities, ["mcp"])
  assert.deepEqual(manifestRow.unsupported_primitives, [
    "agent-defaults",
    "plugin-dependency-resolution",
  ])
  assertIncludesAll(evidenceRow.source_paths, [
    "plugins/desk/.mcp.json",
    "plugins/desk/mcp/README.md",
    "plugins/desk/activation/README.md",
  ], "generic stdio evidence source_paths")
  assertIncludesAll(evidenceRow.evidence_command_or_doc, [
    unitTestCommand,
    "plugins/desk/mcp/README.md#generic-stdio-mcp-launch",
    "plugins/desk/activation/README.md#generic-stdio",
  ], "generic stdio evidence_command_or_doc")
  assert.match(evidenceRow.fallback_behavior, /explicit --root or DESK/u)
  assert.match(evidenceRow.fallback_behavior, /no worker activation/u)
})

test("generic stdio activation docs define the evidence anchor and disposition", () => {
  const activationReadme = readText("plugins", "desk", "activation", "README.md")
  const section = sectionByAnchor(activationReadme, "generic-stdio")

  assert.match(section, /degraded-mcp-only/u)
  assert.match(section, /agent-defaults/u)
  assert.match(section, /plugin-dependency-resolution/u)
  assert.match(section, /explicit --root or DESK/u)
  assert.match(section, /no worker activation/u)
})

test("generic stdio docs show explicit root binding and no default worker claim", () => {
  const mcpReadme = readText("plugins", "desk", "mcp", "README.md")
  const section = sectionBetween(mcpReadme, "## Generic stdio MCP launch", "##")

  assert.match(section, /node .*mcp\/index\.js .*--root/u)
  assert.match(section, /DESK=/u)
  assert.match(section, /\$DESK/u)
  assert.match(section, /MCP-only/u)
  assert.match(section, /no worker activation/u)
  assert.doesNotMatch(section, /desk:worker is activated by generic stdio/u)
})
