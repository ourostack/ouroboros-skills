import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { validateOuroborosStdioPackagingContract } from "../../src/activation/ouroboros-stdio-packaging.js"

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

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function currentOuroborosStdioPackagingInput() {
  const activationReadme = readText("plugins", "desk", "activation", "README.md")
  return {
    activationManifest: loadJson(...activationManifestPath.split("/")),
    evidenceRows: normalizedEvidenceRows(),
    ouroborosReadmeSection: sectionBetween(
      readText("plugins", "desk", "README.md"),
      "### Under Ouroboros",
    ),
    ouroborosActivationSection: sectionByAnchor(
      activationReadme,
      "ouroboros-autonomous-agent",
    ),
    genericStdioReadmeSection: sectionBetween(
      readText("plugins", "desk", "mcp", "README.md"),
      "## Generic stdio MCP launch",
      "##",
    ),
    genericStdioActivationSection: sectionByAnchor(activationReadme, "generic-stdio"),
  }
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
  assert.doesNotMatch(section, /DESK=[^\n]+--root "\$DESK"/u)
  assert.match(section, /MCP-only/u)
  assert.match(section, /no worker activation/u)
  assert.doesNotMatch(section, /desk:worker is activated by generic stdio/u)
})

test("Ouroboros/generic stdio packaging validation accepts current artifacts", () => {
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(currentOuroborosStdioPackagingInput()),
    [],
  )
})

test("Ouroboros packaging validation rejects missing bundle metadata and DESK binding", () => {
  const missingBundleJson = clone(currentOuroborosStdioPackagingInput())
  missingBundleJson.ouroborosReadmeSection =
    missingBundleJson.ouroborosReadmeSection.replace("bundle.json", "agent metadata")
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingBundleJson),
    ["Ouroboros docs must define bundle.json plugin metadata"],
  )

  const missingDeskPlugin = clone(currentOuroborosStdioPackagingInput())
  missingDeskPlugin.ouroborosReadmeSection =
    missingDeskPlugin.ouroborosReadmeSection.replace("\"desk\"", "\"notes\"")
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingDeskPlugin),
    ["Ouroboros bundle metadata must include desk plugin"],
  )

  const missingWorkSuitePlugin = clone(currentOuroborosStdioPackagingInput())
  missingWorkSuitePlugin.ouroborosReadmeSection =
    missingWorkSuitePlugin.ouroborosReadmeSection.replace("\"work-suite\"", "\"workflow\"")
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingWorkSuitePlugin),
    ["Ouroboros bundle metadata must include work-suite plugin"],
  )

  const missingDeskBinding = clone(currentOuroborosStdioPackagingInput())
  missingDeskBinding.ouroborosReadmeSection =
    missingDeskBinding.ouroborosReadmeSection.replace(
      "$DESK = ~/AgentBundles/<agent>.ouro/desk/",
      "DESK is provided by the host",
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingDeskBinding),
    ["Ouroboros preamble must bind $DESK to ~/AgentBundles/<agent>.ouro/desk/"],
  )

  const missingBundleSource = clone(currentOuroborosStdioPackagingInput())
  findByField(
    missingBundleSource.evidenceRows,
    "host_id",
    "ouroboros-autonomous-agent",
    "test input",
  ).source_paths = ["plugins/desk/README.md", "plugins/desk/activation/README.md"]
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingBundleSource),
    ["Ouroboros evidence must reference bundle metadata sources"],
  )

  const malformedBundleWithProse = clone(currentOuroborosStdioPackagingInput())
  malformedBundleWithProse.ouroborosReadmeSection =
    malformedBundleWithProse.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"plugins\": [",
        "    \"notes\",",
        "    \"work-suite\"",
        "  ]",
        "}",
        "```",
        "",
        "The word \"desk\" appears in prose but not in bundle metadata.",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(malformedBundleWithProse),
    ["Ouroboros bundle metadata must include desk plugin"],
  )

  const malformedWorkSuiteBundleWithProse = clone(currentOuroborosStdioPackagingInput())
  malformedWorkSuiteBundleWithProse.ouroborosReadmeSection =
    malformedWorkSuiteBundleWithProse.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"plugins\": [",
        "    \"desk\",",
        "    \"workflow\"",
        "  ]",
        "}",
        "```",
        "",
        "The word \"work-suite\" appears in prose but not in bundle metadata.",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(malformedWorkSuiteBundleWithProse),
    ["Ouroboros bundle metadata must include work-suite plugin"],
  )

  const malformedJsonBundle = clone(currentOuroborosStdioPackagingInput())
  malformedJsonBundle.ouroborosReadmeSection =
    malformedJsonBundle.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"plugins\": [\"desk\",",
        "}",
        "```",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(malformedJsonBundle),
    ["Ouroboros bundle metadata must be valid JSON"],
  )

  const malformedJsonBeforeValidJson = clone(currentOuroborosStdioPackagingInput())
  malformedJsonBeforeValidJson.ouroborosReadmeSection =
    malformedJsonBeforeValidJson.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"plugins\": [\"desk\",",
        "}",
        "```",
        "",
        "Later unrelated JSON must not rescue malformed bundle metadata:",
        "",
        "```json",
        "{ \"plugins\": [\"desk\", \"work-suite\"] }",
        "```",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(malformedJsonBeforeValidJson),
    ["Ouroboros bundle metadata must be valid JSON"],
  )

  const bundleWithoutPluginsArray = clone(currentOuroborosStdioPackagingInput())
  bundleWithoutPluginsArray.ouroborosReadmeSection =
    bundleWithoutPluginsArray.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"metadata\": [\"desk\", \"work-suite\"]",
        "}",
        "```",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(bundleWithoutPluginsArray),
    [
      "Ouroboros bundle metadata must include desk plugin",
      "Ouroboros bundle metadata must include work-suite plugin",
    ],
  )

  const bundleWithNonStringPlugin = clone(currentOuroborosStdioPackagingInput())
  bundleWithNonStringPlugin.ouroborosReadmeSection =
    bundleWithNonStringPlugin.ouroborosReadmeSection.replace(
      /```json[\s\S]*?```/u,
      [
        "```json",
        "{",
        "  \"plugins\": [",
        "    \"desk\",",
        "    42",
        "  ]",
        "}",
        "```",
      ].join("\n"),
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(bundleWithNonStringPlugin),
    ["Ouroboros bundle metadata must include work-suite plugin"],
  )
})

test("Ouroboros packaging validation rejects host-support drift and manual installs", () => {
  const hostSupportDrift = clone(currentOuroborosStdioPackagingInput())
  const ouroborosHost = findByField(
    hostSupportDrift.activationManifest.host_support,
    "host",
    "ouroboros-autonomous-agent",
    "test input",
  )
  ouroborosHost.dependency_resolution = "manual-host"
  ouroborosHost.capabilities = "skills"
  ouroborosHost.unsupported_primitives = "host-native-plugin-install"
  hostSupportDrift.ouroborosReadmeSection += "\nnpm install plugins/desk/mcp\n"

  assert.deepEqual(
    validateOuroborosStdioPackagingContract(hostSupportDrift),
    [
      "Ouroboros host support must use flattened dependency resolution",
      "Ouroboros host support must expose agents, skills, and mcp",
      "Ouroboros host support must mark host-native-plugin-install unsupported",
      "Ouroboros healthy path must not require npm install",
    ],
  )
})

test("generic stdio packaging validation rejects unsafe or under-specified launches", () => {
  const unsafeInlineBinding = clone(currentOuroborosStdioPackagingInput())
  unsafeInlineBinding.genericStdioReadmeSection =
    unsafeInlineBinding.genericStdioReadmeSection.replace(
      "DESK=~/desk\nnode /path/to/plugins/desk/mcp/index.js --root \"$DESK\"",
      "DESK=~/desk node /path/to/plugins/desk/mcp/index.js --root \"$DESK\"",
    )
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(unsafeInlineBinding),
    [
      "Generic stdio launch docs must bind $DESK before invoking node",
      "Generic stdio launch must not use inline DESK assignment with --root \"$DESK\"",
    ],
  )

  const missingExplicitRoot = clone(currentOuroborosStdioPackagingInput())
  missingExplicitRoot.genericStdioReadmeSection =
    missingExplicitRoot.genericStdioReadmeSection.replaceAll("--root", "--desk-root")
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingExplicitRoot),
    [
      "Generic stdio launch docs must pass an explicit --root",
      "Generic stdio launch docs must bind $DESK before invoking node",
    ],
  )

  const workerClaim = clone(currentOuroborosStdioPackagingInput())
  workerClaim.genericStdioReadmeSection += "\ndesk:worker is activated by generic stdio.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(workerClaim),
    ["Generic stdio docs must not claim worker activation"],
  )

  const equivalentWorkerClaim = clone(currentOuroborosStdioPackagingInput())
  equivalentWorkerClaim.genericStdioReadmeSection +=
    "\nGeneric stdio starts desk:worker automatically and loads the agent defaults.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(equivalentWorkerClaim),
    ["Generic stdio docs must not claim worker activation"],
  )

  const equivalentDependencyClaim = clone(currentOuroborosStdioPackagingInput())
  equivalentDependencyClaim.genericStdioReadmeSection +=
    "\nGeneric stdio resolves plugin dependencies and loads Work Suite automatically.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(equivalentDependencyClaim),
    ["Generic stdio docs must not claim plugin dependency resolution"],
  )

  const mixedWorkerClaim = clone(currentOuroborosStdioPackagingInput())
  mixedWorkerClaim.genericStdioReadmeSection +=
    "\nGeneric stdio does not activate worker automatically, but generic stdio loads the default agent.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(mixedWorkerClaim),
    ["Generic stdio docs must not claim worker activation"],
  )

  const mixedDependencyClaim = clone(currentOuroborosStdioPackagingInput())
  mixedDependencyClaim.genericStdioReadmeSection +=
    "\nGeneric stdio does not activate worker, but generic stdio loads Work Suite automatically.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(mixedDependencyClaim),
    ["Generic stdio docs must not claim plugin dependency resolution"],
  )

  const negativeBoundaryClaims = clone(currentOuroborosStdioPackagingInput())
  negativeBoundaryClaims.genericStdioReadmeSection +=
    "\nGeneric stdio does not activate worker and does not resolve plugin dependencies.\n"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(negativeBoundaryClaims),
    [],
  )
})

test("generic stdio packaging validation rejects host dependency support claims", () => {
  const genericDependencyClaim = clone(currentOuroborosStdioPackagingInput())
  const genericHost = findByField(
    genericDependencyClaim.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  genericHost.status = "supported"
  genericHost.dependency_resolution = "flattened"
  genericHost.capabilities = ["mcp", "agents"]
  genericHost.unsupported_primitives = ["agent-defaults"]
  genericHost.fallback_behavior = "start worker after resolving plugin dependencies"

  assert.deepEqual(
    validateOuroborosStdioPackagingContract(genericDependencyClaim),
    [
      "Generic stdio host support must be degraded",
      "Generic stdio host support must use manual-host dependency resolution",
      "Generic stdio host support must expose MCP only",
      "Generic stdio host support must mark plugin-dependency-resolution unsupported",
      "Generic stdio fallback must state no worker activation",
    ],
  )
})

test("generic stdio packaging validation rejects missing agent-defaults fallback marker", () => {
  const missingAgentDefaultsMarker = clone(currentOuroborosStdioPackagingInput())
  const genericHost = findByField(
    missingAgentDefaultsMarker.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  genericHost.unsupported_primitives = ["plugin-dependency-resolution"]

  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingAgentDefaultsMarker),
    ["Generic stdio host support must mark agent-defaults unsupported"],
  )

  const missingFallback = clone(currentOuroborosStdioPackagingInput())
  const fallbackHost = findByField(
    missingFallback.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  delete fallbackHost.fallback_behavior
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(missingFallback),
    ["Generic stdio fallback must state no worker activation"],
  )
})

test("generic stdio packaging validation rejects malformed host support lists", () => {
  const nonArrayCapabilities = clone(currentOuroborosStdioPackagingInput())
  const capabilitiesHost = findByField(
    nonArrayCapabilities.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  capabilitiesHost.capabilities = "mcp"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(nonArrayCapabilities),
    ["Generic stdio host support must expose MCP only"],
  )

  const wrongSingleCapability = clone(currentOuroborosStdioPackagingInput())
  const wrongCapabilityHost = findByField(
    wrongSingleCapability.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  wrongCapabilityHost.capabilities = ["agents"]
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(wrongSingleCapability),
    ["Generic stdio host support must expose MCP only"],
  )

  const nonArrayUnsupported = clone(currentOuroborosStdioPackagingInput())
  const unsupportedHost = findByField(
    nonArrayUnsupported.activationManifest.host_support,
    "host",
    "generic-stdio",
    "test input",
  )
  unsupportedHost.unsupported_primitives = "agent-defaults"
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(nonArrayUnsupported),
    [
      "Generic stdio host support must mark agent-defaults unsupported",
      "Generic stdio host support must mark plugin-dependency-resolution unsupported",
    ],
  )
})

test("Ouroboros/generic stdio packaging validation reports missing rows without crashing", () => {
  assert.deepEqual(
    validateOuroborosStdioPackagingContract(),
    [
      "Ouroboros host support row is required",
      "Ouroboros evidence row is required",
      "Ouroboros docs must define bundle.json plugin metadata",
      "Ouroboros bundle metadata must include desk plugin",
      "Ouroboros bundle metadata must include work-suite plugin",
      "Ouroboros preamble must bind $DESK to ~/AgentBundles/<agent>.ouro/desk/",
      "Generic stdio host support row is required",
      "Generic stdio evidence row is required",
      "Generic stdio launch docs must pass an explicit --root",
      "Generic stdio launch docs must bind $DESK before invoking node",
      "Generic stdio docs must state MCP-only behavior",
      "Generic stdio docs must state no worker activation",
    ],
  )

  assert.deepEqual(
    validateOuroborosStdioPackagingContract({
      activationManifest: {},
      evidenceRows: [],
      ouroborosReadmeSection: "",
      genericStdioReadmeSection: "",
    }),
    [
      "Ouroboros host support row is required",
      "Ouroboros evidence row is required",
      "Ouroboros docs must define bundle.json plugin metadata",
      "Ouroboros bundle metadata must include desk plugin",
      "Ouroboros bundle metadata must include work-suite plugin",
      "Ouroboros preamble must bind $DESK to ~/AgentBundles/<agent>.ouro/desk/",
      "Generic stdio host support row is required",
      "Generic stdio evidence row is required",
      "Generic stdio launch docs must pass an explicit --root",
      "Generic stdio launch docs must bind $DESK before invoking node",
      "Generic stdio docs must state MCP-only behavior",
      "Generic stdio docs must state no worker activation",
    ],
  )

  assert.deepEqual(
    validateOuroborosStdioPackagingContract({
      activationManifest: { host_support: [null] },
      evidenceRows: [null],
      ouroborosReadmeSection: currentOuroborosStdioPackagingInput().ouroborosReadmeSection,
      genericStdioReadmeSection: currentOuroborosStdioPackagingInput().genericStdioReadmeSection,
    }),
    [
      "Ouroboros host support row is required",
      "Ouroboros evidence row is required",
      "Generic stdio host support row is required",
      "Generic stdio evidence row is required",
    ],
  )
})
