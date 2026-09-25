import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildCopilotBundle,
  generateCopilotBundleArtifact,
  resolveBundleRepoRoot,
  runCopilotBundleGenerator,
  validateCopilotPackagingContract,
} from "../../src/activation/copilot-bundle.js"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const activationManifestPath = "plugins/desk/activation/desk.activation.json"
const copilotBundlePath = "plugins/desk/activation/copilot-root.flattened-bundle.json"
const evidencePath = "plugins/desk/activation/host-capability-evidence.md"
const supportMatrixPath = "plugins/desk/activation/support-matrix.json"
const copilotWorkerSource = "agents/worker.agent.md"
const copilotBundleCommand =
  "npm --prefix plugins/desk/mcp run activation:copilot-bundle:generate"
const expectedCopilotSourcePaths = [
  "plugins/desk/plugin.json",
  "plugins/desk/agents/worker.agent.md",
  "plugins/desk/hooks/copilot-hooks.json",
  "plugins/desk/hooks/copilot-session-start.cjs",
  "plugins/desk/.mcp.copilot.json",
  "plugins/superpowers/plugin.json",
  "plugins/superpowers/hooks/copilot-hooks.json",
  "plugins/plain-language/plugin.json",
  copilotBundlePath,
]

function readText(...segments) {
  return readFileSync(path.join(repoRoot, ...segments), "utf8")
}

function loadJson(...segments) {
  return JSON.parse(readText(...segments))
}

function assertFileExists(...segments) {
  const file = path.join(repoRoot, ...segments)
  assert.equal(existsSync(file), true, `${segments.join("/")} must exist`)
}

function parseSimpleFrontmatter(...segments) {
  const text = readText(...segments)
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  assert.ok(match, `${segments.join("/")} must have YAML frontmatter`)
  return Object.fromEntries(match[1]
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split(":")
      const raw = rest.join(":").trim()
      return [key.trim(), parseScalar(raw)]
    }))
}

function parseScalar(raw) {
  if (raw === "true") return true
  if (raw === "false") return false
  if (raw.startsWith("\"") && raw.endsWith("\"")) return raw.slice(1, -1)
  return raw
}

function marketplacePlugin(name) {
  return loadJson(".claude-plugin", "marketplace.json")
    .plugins
    .find((plugin) => plugin.name === name)
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

function normalizedEvidenceRows(content) {
  return parseEvidenceTable(content).map((row) => ({
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

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertLightweightCopilotStartupHookSource(source) {
  assert.match(
    source,
    /const foundationPath = path\.join\(pluginRoot,\s*"skills",\s*"using-desk",\s*"SKILL\.md"\);/u,
    "the Copilot startup hook must read the canonical using-desk skill at runtime",
  )
  assert.match(
    source,
    /const foundation = fs\.readFileSync\(foundationPath,\s*"utf8"\)\.trimEnd\(\);/u,
    "the Copilot startup hook must keep its single file read pointed at the canonical using-desk skill",
  )
  assert.equal(
    (source.match(/\breadFileSync\(/gu) ?? []).length,
    1,
    "the Copilot startup hook must keep exactly one local file read",
  )
  assert.doesNotMatch(
    source,
    /\b(?:spawnSync|execSync|execFileSync|fork|fetch)\b/u,
    "the Copilot startup hook must not execute commands or fetch network resources",
  )
  assert.doesNotMatch(
    source,
    /"node:(?:child_process|http|https|net|dns|tls)"/u,
    "the Copilot startup hook must stay local-only and avoid network or process modules",
  )
  assert.doesNotMatch(
    source,
    /\b(?:readdirSync|opendirSync|globSync|task\.md)\b/u,
    "the Copilot startup hook must not scan workspace or task files",
  )
  assert.doesNotMatch(
    source,
    /path\.join\([^)]*"skills"[^)]*"(?:session-start|session-start-migrations|rfc[^"]*|first-run-bootstrap)"/iu,
    "the Copilot startup hook must not read onboarding, migration, session-start, or RFC files",
  )
}

function currentCopilotPackagingInput() {
  const activation = loadJson(activationManifestPath)
  return {
    activation,
    bundle: loadJson(...copilotBundlePath.split("/")),
    deskPlugin: loadJson("plugins", "desk", "plugin.json"),
    superpowersPlugin: loadJson("plugins", "superpowers", "plugin.json"),
    plainLanguagePlugin: loadJson("plugins", "plain-language", "plugin.json"),
    ponytailPlugin: loadJson("plugins", "ponytail-upstream", "plugin.json"),
  }
}

// The authored three-root closure no longer selects Ponytail (T03), so the current packaging
// input carries no Ponytail requirement. These tests still need to prove the legacy route
// where a manifest explicitly selects Ponytail is preserved: this helper builds that selection
// in memory only, mirroring how the real bundle metadata looked before T03's removal.
function withPonytailSelected(input) {
  const target = input.activation.provides.activation_targets.find((entry) => entry.id === "desk:worker")
  target.depends_on = [...target.depends_on, "ponytail-upstream"]
  input.deskPlugin.activation.copilot.dependencies["ponytail-upstream"] = {
    path: "../ponytail-upstream",
    version: "4.9.0",
    resolution: "flattened",
    bundleMetadata: copilotBundlePath,
  }
  input.bundle.dependency_closure.push({
    id: "ponytail-upstream",
    version: "4.9.0",
    plugin: "plugins/ponytail-upstream/plugin.json",
    skills: "plugins/ponytail-upstream/skills/",
  })
  input.bundle.generated_from.ponytail_plugin = "plugins/ponytail-upstream/plugin.json"
  return input
}

function expectedCopilotBundle() {
  const activation = loadJson(activationManifestPath)
  const lockedWorkSuiteVersion = activation.dependencies.find((dependency) => (
    dependency.id === "superpowers"
  )).lock.version
  const lockedPlainLanguageVersion = activation.dependencies.find((dependency) => (
    dependency.id === "plain-language"
  )).lock.version
  return {
    schema_version: 1,
    host: "copilot-root",
    generated_by: copilotBundleCommand,
    generated_from: {
      activation_manifest: activationManifestPath,
      desk_plugin: "plugins/desk/plugin.json",
      superpowers_plugin: "plugins/superpowers/plugin.json",
      plain_language_plugin: "plugins/plain-language/plugin.json",
    },
    launch: {
      agent: `plugins/desk/${copilotWorkerSource}`,
      mcp: "plugins/desk/.mcp.copilot.json",
    },
    dependency_closure: [
      {
        id: "desk",
        version: activation.version,
        plugin: "plugins/desk/plugin.json",
        skills: "plugins/desk/skills/",
        agents: "plugins/desk/agents/",
        mcpServers: "plugins/desk/.mcp.copilot.json",
      },
      {
        id: "superpowers",
        version: lockedWorkSuiteVersion,
        plugin: "plugins/superpowers/plugin.json",
        skills: "plugins/superpowers/skills/",
      },
      {
        id: "plain-language",
        version: lockedPlainLanguageVersion,
        plugin: "plugins/plain-language/plugin.json",
        skills: "plugins/plain-language/skills/",
      },
    ],
    manual_steps: [],
  }
}

test("Copilot root plugin metadata exposes Desk worker and MCP without manual registration", () => {
  const activation = loadJson(activationManifestPath)
  const deskPlugin = loadJson("plugins", "desk", "plugin.json")
  const worker = parseSimpleFrontmatter("plugins", "desk", "agents", "worker.agent.md")
  const activationTarget = findByField(
    activation.provides.activation_targets,
    "id",
    "desk:worker",
    activationManifestPath,
  )

  assert.equal(deskPlugin.name, "desk")
  assert.equal(deskPlugin.version, activation.version)
  assert.equal(deskPlugin.version, marketplacePlugin("desk").version)
  assert.equal(deskPlugin.agents, "./agents/")
  assert.equal(deskPlugin.skills, "./skills/")
  assert.equal(deskPlugin.mcpServers, "./.mcp.copilot.json")
  assert.equal(deskPlugin.hooks, "./hooks/copilot-hooks.json")
  assert.deepEqual(deskPlugin.activation?.copilot?.targets?.["desk:worker"], {
    default: true,
    source: copilotWorkerSource,
    activationSurface: "root-plugin-agent",
  })
  assert.equal(activationTarget.entrypoints.copilot, copilotWorkerSource)
  assert.deepEqual(deskPlugin.activation?.copilot?.manualSetupSteps, [])

  assert.equal(worker.name, "worker")
  assert.equal(worker.target, "github-copilot")
  assert.equal(worker["user-invocable"], true)
})

test("Work Suite root plugin metadata omits inert dependency metadata", () => {
  assertFileExists("plugins", "work-suite", "plugin.json")

  const workSuitePlugin = loadJson("plugins", "work-suite", "plugin.json")

  assert.equal(workSuitePlugin.name, "work-suite")
  assert.equal(workSuitePlugin.version, "4.0.0-alpha.2")
  assert.equal(workSuitePlugin.version, marketplacePlugin("work-suite").version)
  assert.equal(workSuitePlugin.skills, "./skills/")
  assert.equal(Object.hasOwn(workSuitePlugin, "dependencies"), false)
  assert.equal(Object.hasOwn(workSuitePlugin, "activation"), false)
})

test("Copilot root packaging declares a generated flattened dependency closure", () => {
  assertFileExists(...copilotBundlePath.split("/"))

  const activation = loadJson(activationManifestPath)
  const deskPlugin = loadJson("plugins", "desk", "plugin.json")
  const bundle = loadJson(...copilotBundlePath.split("/"))
  const lockedWorkSuiteVersion = activation.dependencies.find((dependency) => (
    dependency.id === "superpowers"
  )).lock.version

  assert.deepEqual(deskPlugin.activation?.copilot?.dependencies?.["superpowers"], {
    path: "../superpowers",
    version: lockedWorkSuiteVersion,
    resolution: "flattened",
    bundleMetadata: copilotBundlePath,
  })
  assert.deepEqual(deskPlugin.activation?.copilot?.dependencies?.["plain-language"], {
    path: "../plain-language",
    version: "0.2.1",
    resolution: "flattened",
    bundleMetadata: copilotBundlePath,
  })
  assert.equal(
    Object.hasOwn(deskPlugin.activation?.copilot?.dependencies ?? {}, "ponytail-upstream"),
    false,
    "the authored Copilot root manifest no longer selects Ponytail; only the committed flattened bundle artifact (T19) still carries it",
  )
  assert.deepEqual(bundle, expectedCopilotBundle())
})

test("generated Copilot flattened bundle producer derives the authored three-root closure without writing the committed artifact", () => {
  assertFileExists(...copilotBundlePath.split("/"))
  assertFileExists("plugins", "desk", "mcp", "scripts", "generate-copilot-bundle.js")

  const packageJson = loadJson("plugins", "desk", "mcp", "package.json")
  assert.equal(
    packageJson.scripts["activation:copilot-bundle:generate"],
    "node scripts/generate-copilot-bundle.js",
  )
  assert.match(
    readText("plugins", "desk", "mcp", "scripts", "generate-copilot-bundle.js"),
    /runCopilotBundleGenerator/u,
    "the package-scripted entrypoint must still call the producer that regenerates the committed bundle (T19's exclusive write)",
  )

  const activation = loadJson(activationManifestPath)
  const freshBundle = buildCopilotBundle({ activation })
  assert.deepEqual(
    freshBundle.dependency_closure.map((entry) => entry.id),
    ["desk", "superpowers", "plain-language"],
  )
  assert.equal(Object.hasOwn(freshBundle.generated_from, "ponytail_plugin"), false)

  const bundleOnDisk = loadJson(...copilotBundlePath.split("/"))
  assert.deepEqual(
    freshBundle,
    bundleOnDisk,
    "the checked-in flattened bundle is the regenerated three-root artifact, so the producer's output and the committed file must agree",
  )
})

test("Copilot root evidence and support matrix record flattened packaging as generated", () => {
  const supportMatrix = loadJson(supportMatrixPath)
  const evidenceRow = findByField(
    normalizedEvidenceRows(readText(evidencePath)),
    "host_id",
    "copilot-root",
    evidencePath,
  )
  const supportMatrixRow = findByField(
    supportMatrix.hosts,
    "host_id",
    "copilot-root",
    supportMatrixPath,
  )

  assert.equal(evidenceRow.surface, "Root Copilot source package and selected provider adapter")
  assert.equal(evidenceRow.disposition, "supported-flattened")
  assert.deepEqual(evidenceRow.source_paths, expectedCopilotSourcePaths)
  assert.match(evidenceRow.evidence_command_or_doc, /activation:copilot-bundle:generate/u)
  assert.match(evidenceRow.evidence_command_or_doc, /copilot_packaging\.test\.js/u)
  assert.deepEqual(evidenceRow.unsupported_primitives, ["transitive-dependency-resolution"])
  assert.equal(
    evidenceRow.fallback_behavior,
    "load the generated flattened Desk, Superpowers and Plain Language bundle metadata",
  )
  assert.deepEqual(supportMatrixRow, evidenceRow)
})

test("Copilot root package docs avoid healthy-path manual dependency setup", () => {
  const readme = readText("plugins", "desk", "README.md")
  const agentDocs = readText("plugins", "desk", "docs", "agent-files.md")
  const workSuiteReadme = readText("plugins", "work-suite", "README.md")

  assert.doesNotMatch(readme, /copilot plugin install ourostack\/ouroboros-skills:plugins\/work-suite/u)
  assert.doesNotMatch(agentDocs, /Copilot CLI doesn't auto-resolve transitive plugin deps/u)
  assert.doesNotMatch(workSuiteReadme, /copilot plugin install ourostack\/ouroboros-skills:plugins\/work-suite/u)
})

test("Copilot sessionStart hook stays lightweight and local-only", () => {
  const hookSource = readText("plugins", "desk", "hooks", "copilot-session-start.cjs")
  assertLightweightCopilotStartupHookSource(hookSource)
})

test("Copilot packaging validation rejects missing root surfaces and stale versions", () => {
  assert.deepEqual(validateCopilotPackagingContract(currentCopilotPackagingInput()), [])

  const missingAgents = clone(currentCopilotPackagingInput())
  delete missingAgents.deskPlugin.agents
  assert.deepEqual(
    validateCopilotPackagingContract(missingAgents),
    ["Copilot root plugin metadata must expose ./agents/"],
  )

  const missingSkills = clone(currentCopilotPackagingInput())
  missingSkills.deskPlugin.skills = undefined
  assert.deepEqual(
    validateCopilotPackagingContract(missingSkills),
    ["Copilot root plugin metadata must expose ./skills/"],
  )

  const missingMcp = clone(currentCopilotPackagingInput())
  missingMcp.deskPlugin.mcpServers = "./missing-mcp.json"
  assert.deepEqual(
    validateCopilotPackagingContract(missingMcp),
    ["Copilot root plugin metadata must expose ./.mcp.copilot.json"],
  )

  const missingHooks = clone(currentCopilotPackagingInput())
  delete missingHooks.deskPlugin.hooks
  assert.deepEqual(
    validateCopilotPackagingContract(missingHooks),
    ["Copilot root plugin metadata must expose ./hooks/copilot-hooks.json"],
  )

  const staleDeskVersion = clone(currentCopilotPackagingInput())
  staleDeskVersion.deskPlugin.version = "1.7.2"
  assert.deepEqual(
    validateCopilotPackagingContract(staleDeskVersion),
    ["Copilot root Desk version must match activation version 3.2.0-alpha.10.1"],
  )

  const staleWorkSuiteVersion = clone(currentCopilotPackagingInput())
  staleWorkSuiteVersion.superpowersPlugin.version = "1.4.8"
  assert.deepEqual(
    validateCopilotPackagingContract(staleWorkSuiteVersion),
    ["Copilot root Superpowers version must match activation lock 6.3.0"],
  )

  const stalePlainLanguageVersion = clone(currentCopilotPackagingInput())
  stalePlainLanguageVersion.plainLanguagePlugin.version = "0.0.9"
  assert.deepEqual(
    validateCopilotPackagingContract(stalePlainLanguageVersion),
    ["Copilot root Plain Language version must match activation lock 0.2.1"],
  )

  const stalePonytailVersion = withPonytailSelected(clone(currentCopilotPackagingInput()))
  stalePonytailVersion.ponytailPlugin.version = "4.8.0"
  assert.deepEqual(
    validateCopilotPackagingContract(stalePonytailVersion),
    ["Copilot root Ponytail version must match activation lock 4.9.0"],
  )

  const legacyPonytailSelected = withPonytailSelected(clone(currentCopilotPackagingInput()))
  assert.deepEqual(
    validateCopilotPackagingContract(legacyPonytailSelected),
    [],
    "an explicit legacy manifest that still selects Ponytail must validate cleanly end to end",
  )
})

test("Copilot packaging validation rejects incomplete flattened dependency closure", () => {
  const missingActivationDependencies = clone(currentCopilotPackagingInput())
  delete missingActivationDependencies.activation.dependencies
  assert.deepEqual(
    validateCopilotPackagingContract(missingActivationDependencies),
    [
      "Copilot activation must lock Superpowers dependency",
      "Copilot activation must lock Plain Language dependency",
    ],
  )

  const missingActivationDependenciesPonytailSelected =
    withPonytailSelected(clone(currentCopilotPackagingInput()))
  delete missingActivationDependenciesPonytailSelected.activation.dependencies
  assert.deepEqual(
    validateCopilotPackagingContract(missingActivationDependenciesPonytailSelected),
    [
      "Copilot activation must lock Superpowers dependency",
      "Copilot activation must lock Plain Language dependency",
      "Copilot activation must lock Ponytail dependency",
    ],
    "an explicit legacy manifest that still selects Ponytail must still require its lock",
  )

  const missingActivationLock = clone(currentCopilotPackagingInput())
  missingActivationLock.activation.dependencies =
    missingActivationLock.activation.dependencies.filter((entry) => entry.id !== "superpowers")
  assert.deepEqual(
    validateCopilotPackagingContract(missingActivationLock),
    ["Copilot activation must lock Superpowers dependency"],
  )

  const missingPonytailActivationLock = withPonytailSelected(clone(currentCopilotPackagingInput()))
  missingPonytailActivationLock.activation.dependencies =
    missingPonytailActivationLock.activation.dependencies.filter((entry) => entry.id !== "ponytail-upstream")
  assert.deepEqual(
    validateCopilotPackagingContract(missingPonytailActivationLock),
    ["Copilot activation must lock Ponytail dependency"],
  )

  const missingWorkSuitePlugin = clone(currentCopilotPackagingInput())
  delete missingWorkSuitePlugin.superpowersPlugin
  assert.deepEqual(
    validateCopilotPackagingContract(missingWorkSuitePlugin),
    ["Copilot root Superpowers version must match activation lock 6.3.0"],
  )

  const missingBundle = clone(currentCopilotPackagingInput())
  delete missingBundle.bundle
  assert.deepEqual(
    validateCopilotPackagingContract(missingBundle),
    [
      "Copilot flattened bundle must include superpowers dependency closure",
      "Copilot flattened bundle must include plain-language dependency closure",
    ],
  )

  const missingBundlePonytailSelected = withPonytailSelected(clone(currentCopilotPackagingInput()))
  delete missingBundlePonytailSelected.bundle
  assert.deepEqual(
    validateCopilotPackagingContract(missingBundlePonytailSelected),
    [
      "Copilot flattened bundle must include superpowers dependency closure",
      "Copilot flattened bundle must include plain-language dependency closure",
      "Copilot flattened bundle must include ponytail-upstream dependency closure",
    ],
    "an explicit legacy manifest that still selects Ponytail must still require its bundle closure entry",
  )

  const missingBundleDependency = clone(currentCopilotPackagingInput())
  missingBundleDependency.bundle.dependency_closure =
    missingBundleDependency.bundle.dependency_closure.filter((entry) => entry.id !== "superpowers")
  assert.deepEqual(
    validateCopilotPackagingContract(missingBundleDependency),
    ["Copilot flattened bundle must include superpowers dependency closure"],
  )

  const missingPonytailBundleDependency = withPonytailSelected(clone(currentCopilotPackagingInput()))
  missingPonytailBundleDependency.bundle.dependency_closure =
    missingPonytailBundleDependency.bundle.dependency_closure.filter((entry) => entry.id !== "ponytail-upstream")
  assert.deepEqual(
    validateCopilotPackagingContract(missingPonytailBundleDependency),
    ["Copilot flattened bundle must include ponytail-upstream dependency closure"],
  )

  const missingBundleClosure = clone(currentCopilotPackagingInput())
  delete missingBundleClosure.bundle.dependency_closure
  assert.deepEqual(
    validateCopilotPackagingContract(missingBundleClosure),
    [
      "Copilot flattened bundle must include superpowers dependency closure",
      "Copilot flattened bundle must include plain-language dependency closure",
    ],
  )

  const malformedBundleClosure = clone(currentCopilotPackagingInput())
  malformedBundleClosure.bundle.dependency_closure = [null]
  assert.deepEqual(
    validateCopilotPackagingContract(malformedBundleClosure),
    [
      "Copilot flattened bundle must include superpowers dependency closure",
      "Copilot flattened bundle must include plain-language dependency closure",
    ],
  )

  const missingBundleMetadata = clone(currentCopilotPackagingInput())
  delete missingBundleMetadata.deskPlugin.activation.copilot.dependencies["superpowers"]
  assert.deepEqual(
    validateCopilotPackagingContract(missingBundleMetadata),
    ["Copilot Superpowers dependency must point to generated flattened bundle metadata"],
  )

  const staleBundlePath = clone(currentCopilotPackagingInput())
  staleBundlePath.deskPlugin.activation.copilot.dependencies["superpowers"].bundleMetadata =
    "plugins/desk/activation/old-bundle.json"
  assert.deepEqual(
    validateCopilotPackagingContract(staleBundlePath),
    ["Copilot Superpowers dependency must point to generated flattened bundle metadata"],
  )

  const missingPlainLanguageBundleMetadata = clone(currentCopilotPackagingInput())
  delete missingPlainLanguageBundleMetadata.deskPlugin.activation.copilot.dependencies["plain-language"]
  assert.deepEqual(
    validateCopilotPackagingContract(missingPlainLanguageBundleMetadata),
    ["Copilot Plain Language dependency must point to generated flattened bundle metadata"],
  )

  const missingPonytailBundleMetadata = withPonytailSelected(clone(currentCopilotPackagingInput()))
  delete missingPonytailBundleMetadata.deskPlugin.activation.copilot.dependencies["ponytail-upstream"]
  assert.deepEqual(
    validateCopilotPackagingContract(missingPonytailBundleMetadata),
    ["Copilot Ponytail dependency must point to generated flattened bundle metadata"],
  )

  const missingWorker = clone(currentCopilotPackagingInput())
  delete missingWorker.deskPlugin.activation.copilot.targets["desk:worker"]
  assert.deepEqual(
    validateCopilotPackagingContract(missingWorker),
    ["Copilot desk:worker target must use agents/worker.agent.md"],
  )

  const wrongWorker = clone(currentCopilotPackagingInput())
  wrongWorker.deskPlugin.activation.copilot.targets["desk:worker"].source = "agents/worker.md"
  assert.deepEqual(
    validateCopilotPackagingContract(wrongWorker),
    ["Copilot desk:worker target must use agents/worker.agent.md"],
  )
})

test("authored V2 closure (copilot packaging): the real producer builds and validates exactly desk, superpowers, plain-language", () => {
  const activation = loadJson(activationManifestPath)
  const freshBundle = buildCopilotBundle({ activation })
  const selectedNames = freshBundle.dependency_closure.map((entry) => entry.id)
  const expected = ["desk", "plain-language", "superpowers"]
  assert.deepEqual([...selectedNames].sort(), expected)
  assert.equal(selectedNames.includes("ponytail-upstream"), false)
  assert.equal(selectedNames.includes("work-suite"), false)

  const freshPackagingInput = { ...currentCopilotPackagingInput(), bundle: freshBundle }
  assert.deepEqual(
    validateCopilotPackagingContract(freshPackagingInput),
    [],
    "packaging validation must accept the freshly produced three-root closure the real producer builds from the authored manifest, not merely the declared selection array",
  )
})

test("ordinary Agency declaration (copilot packaging): desk/agency.json declares the two generic V2 dependencies", () => {
  const agency = loadJson("plugins", "desk", "agency.json")
  assert.equal(agency.name, "desk")
  assert.deepEqual(agency.dependencies, [
    "github:ourostack/ouroboros-skills:plugins/superpowers@v2-alpha",
    "github:ourostack/ouroboros-skills:plugins/plain-language@v2-alpha",
  ])
  assert.equal(agency.dependencies.some((dependency) => dependency.includes("ponytail")), false)
  assert.equal(agency.dependencies.some((dependency) => dependency.includes("work-suite")), false)
})

// The committed bundle is release output, so these tests exercise the writer against a scratch repository
// root and never let it touch the real artifact — the accident that made this path untested in the first place.
test("the bundle writer and its CLI entry point produce the artifact in a scratch repository", () => {
  const scratchRoot = mkdtempSync(path.join(tmpdir(), "copilot-bundle-writer-"))
  const committedBundlePath = path.join(repoRoot, ...copilotBundlePath.split("/"))
  const committedBefore = readFileSync(committedBundlePath)
  try {
    for (const relativePath of [activationManifestPath, "plugins/desk/plugin.json", "plugins/superpowers/plugin.json", "plugins/plain-language/plugin.json"]) {
      const target = path.join(scratchRoot, ...relativePath.split("/"))
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(path.join(repoRoot, ...relativePath.split("/")), target)
    }
    mkdirSync(path.join(scratchRoot, "plugins", "desk", "activation"), { recursive: true })

    const generated = generateCopilotBundleArtifact({ repoRoot: scratchRoot })
    assert.equal(generated.outputPath, copilotBundlePath)
    assert.equal(generated.artifactPath, path.join(scratchRoot, ...copilotBundlePath.split("/")))
    const writtenText = readFileSync(generated.artifactPath, "utf8")
    assert.equal(writtenText, `${JSON.stringify(generated.bundle, null, 2)}\n`)
    assert.deepEqual(JSON.parse(writtenText), expectedCopilotBundle())

    rmSync(generated.artifactPath)
    const written = []
    const exitCode = runCopilotBundleGenerator({
      repoRoot: scratchRoot,
      io: { write(chunk) { written.push(chunk) } },
    })
    assert.equal(exitCode, 0)
    assert.deepEqual(written, [`wrote ${copilotBundlePath}\n`])
    assert.deepEqual(JSON.parse(readFileSync(generated.artifactPath, "utf8")), expectedCopilotBundle())
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
  assert.deepEqual(
    readFileSync(committedBundlePath),
    committedBefore,
    "exercising the writer must never modify the committed release artifact",
  )
})

test("the bundle writer resolves its destination from an explicit root, the environment, or this repository", () => {
  assert.equal(resolveBundleRepoRoot({ DESK_COPILOT_BUNDLE_REPO_ROOT: "/scratch/tree" }), "/scratch/tree")
  assert.equal(resolveBundleRepoRoot({}), repoRoot)
  assert.equal(resolveBundleRepoRoot(), process.env.DESK_COPILOT_BUNDLE_REPO_ROOT ?? repoRoot)

  const scratchRoot = mkdtempSync(path.join(tmpdir(), "copilot-bundle-env-"))
  const committedBundlePath = path.join(repoRoot, ...copilotBundlePath.split("/"))
  const committedBefore = readFileSync(committedBundlePath)
  const previous = process.env.DESK_COPILOT_BUNDLE_REPO_ROOT
  try {
    for (const relativePath of [activationManifestPath, "plugins/desk/plugin.json", "plugins/superpowers/plugin.json", "plugins/plain-language/plugin.json"]) {
      const target = path.join(scratchRoot, ...relativePath.split("/"))
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(path.join(repoRoot, ...relativePath.split("/")), target)
    }

    // The package-scripted generator calls this with no arguments at all; the redirect is what lets that exact
    // production path run here without writing the committed artifact.
    process.env.DESK_COPILOT_BUNDLE_REPO_ROOT = scratchRoot
    const written = []
    const stdoutWrite = process.stdout.write
    process.stdout.write = (chunk) => { written.push(String(chunk)); return true }
    let exitCode
    try {
      exitCode = runCopilotBundleGenerator()
    } finally {
      process.stdout.write = stdoutWrite
    }
    assert.equal(exitCode, 0)
    assert.deepEqual(written, [`wrote ${copilotBundlePath}\n`])

    // …and the operator's actual command runs end to end: the package script, through the package manager,
    // with the repository-root redirect pointing at the scratch tree.
    rmSync(path.join(scratchRoot, ...copilotBundlePath.split("/")))
    const scripted = spawnSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["--silent", "run", "activation:copilot-bundle:generate"],
      {
        cwd: path.join(repoRoot, "plugins", "desk", "mcp"),
        encoding: "utf8",
        env: { ...process.env, DESK_COPILOT_BUNDLE_REPO_ROOT: scratchRoot },
      },
    )
    assert.equal(scripted.status, 0, scripted.stderr)
    assert.equal(scripted.stdout.trim(), `wrote ${copilotBundlePath}`)
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(scratchRoot, ...copilotBundlePath.split("/")), "utf8")),
      expectedCopilotBundle(),
    )
    const generated = generateCopilotBundleArtifact()
    assert.equal(generated.artifactPath, path.join(scratchRoot, ...copilotBundlePath.split("/")))
    assert.deepEqual(JSON.parse(readFileSync(generated.artifactPath, "utf8")), expectedCopilotBundle())
  } finally {
    if (previous === undefined) delete process.env.DESK_COPILOT_BUNDLE_REPO_ROOT
    else process.env.DESK_COPILOT_BUNDLE_REPO_ROOT = previous
    rmSync(scratchRoot, { recursive: true, force: true })
  }
  assert.deepEqual(
    readFileSync(committedBundlePath),
    committedBefore,
    "the redirected generator must never modify the committed release artifact",
  )
})
