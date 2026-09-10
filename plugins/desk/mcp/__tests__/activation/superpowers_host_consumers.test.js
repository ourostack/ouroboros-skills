import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import cacheAudit from "../../../../../scripts/audit-codex-plugin-cache.cjs"
import { validateClaudePackagingContract } from "../../src/activation/claude-packaging.js"
import { validateOuroborosStdioPackagingContract } from "../../src/activation/ouroboros-stdio-packaging.js"
import { buildCopilotBundle } from "../../src/activation/copilot-bundle.js"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"
import { validateActivationManifest } from "../../src/activation/validate.js"

const read = (file) => JSON.parse(readFileSync(new URL(`../../../../../${file}`, import.meta.url), "utf8"))
function activation() {
  return read("plugins/desk/activation/desk.activation.json")
}
function legacyActivation() {
  const value = read("plugins/desk/activation/desk.activation.json")
  value.dependencies = value.dependencies.filter((entry) => entry.id !== "superpowers")
  // Explicit legacy configuration using the declaration retained at 0d4d583; the shipped alpha does not declare Work Suite.
  value.dependencies.push({
    id: "work-suite", kind: "plugin", version_range: "^4.0.0-alpha.1",
    provenance: { source: "plugins/work-suite/.codex-plugin/plugin.json", package: "ourostack/work-suite" },
    lock: { version: "4.0.0-alpha.1", integrity: "sha256-work-suite-activation-manifest-v1" },
  })
  value.provides.activation_targets[0].depends_on = ["desk", "work-suite", "plain-language", "ponytail-upstream"]
  for (const host of Object.values(value.host_activation)) {
    if (host.dependencies?.superpowers) {
      host.dependencies["work-suite"] = { ...host.dependencies.superpowers, path: "../work-suite", version: "4.0.0-alpha.1" }
      delete host.dependencies.superpowers
    }
  }
  for (const host of value.host_support) {
    host.fallback_behavior = host.fallback_behavior.replaceAll("Superpowers", "Work Suite")
  }
  const validation = validateActivationManifest(value)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  return value
}
function claude(value = activation()) {
  const deskPlugin = read("plugins/desk/.claude-plugin/plugin.json")
  return {
    activation: value, claudeActivation: value.host_activation.claude, deskPlugin,
    superpowersPlugin: read("plugins/superpowers/.claude-plugin/plugin.json"),
    workSuitePlugin: read("plugins/work-suite/.claude-plugin/plugin.json"),
  }
}
function ouroboros() {
  return {
    activationManifest: activation(),
    evidenceRows: read("plugins/desk/activation/support-matrix.json").hosts.map((row) => row.host_id === "ouroboros-autonomous-agent" ? {
      ...row,
      source_paths: row.source_paths.map((file) => file.replace("plugins/work-suite/", "plugins/superpowers/")),
      fallback_behavior: "bundle Desk + Superpowers + companions and bind $DESK",
    } : row),
    ouroborosReadmeSection: 'bundle.json\n```json\n{"plugins":["desk","superpowers","plain-language","ponytail-upstream"]}\n```\n$DESK = ~/AgentBundles/<agent>.ouro/desk/',
    genericStdioReadmeSection: 'DESK=~/desk\nnode "./mcp/index.js" --root "$DESK"\nMCP-only; no worker activation.',
    genericStdioActivationSection: "MCP-only; no worker activation.",
  }
}

test("Claude validates the actual alpha declaration without injecting a legacy provider", () => {
  assert.equal(activation().dependencies.some((entry) => entry.id === "work-suite"), false)
  assert.equal(validateActivationManifest(activation()).ok, true)
  assert.deepEqual(validateClaudePackagingContract(claude()), [])
})
test("Claude selected-provider mismatch adds its own diagnostic", () => {
  const input = claude()
  const baseline = validateClaudePackagingContract(input)
  input.superpowersPlugin.version = "6.2.0"
  assert.deepEqual(validateClaudePackagingContract(input).filter((error) => !baseline.includes(error)), ["Superpowers Claude version must match activation lock 6.3.0"])
})
test("Claude alpha native dependency metadata cannot activate a second lifecycle", () => {
  const input = claude()
  const baseline = validateClaudePackagingContract(input)
  input.deskPlugin.dependencies.push({ name: "work-suite", version: "^4.0.0-alpha.1" })
  assert.deepEqual(validateClaudePackagingContract(input).filter((error) => !baseline.includes(error)), ["Claude alpha plugin metadata must not include work-suite dependency"])
})
test("Ouroboros selected alpha closure validates without claiming generic-stdio worker activation", () => {
  assert.deepEqual(validateOuroborosStdioPackagingContract(ouroboros()), [])
})
test("Ouroboros selected alpha closure rejects a legacy-only bundle", () => {
  const input = ouroboros()
  const baseline = validateOuroborosStdioPackagingContract(input)
  input.ouroborosReadmeSection = input.ouroborosReadmeSection.replace('"superpowers"', '"work-suite"')
  assert.deepEqual(validateOuroborosStdioPackagingContract(input).filter((error) => !baseline.includes(error)), ["Ouroboros bundle metadata must include superpowers plugin", "Ouroboros alpha bundle must not include work-suite plugin"])
})
test("Ouroboros alpha bundle cannot include a second lifecycle", () => {
  const input = ouroboros()
  const baseline = validateOuroborosStdioPackagingContract(input)
  input.ouroborosReadmeSection = input.ouroborosReadmeSection.replace('"superpowers"', '"superpowers","work-suite"')
  assert.deepEqual(validateOuroborosStdioPackagingContract(input).filter((error) => !baseline.includes(error)), ["Ouroboros alpha bundle must not include work-suite plugin"])
})
test("current host source contracts use a distinct alpha evidence document", () => {
  assert.equal(read("plugins/desk/activation/support-matrix.json").generated_from.host_capability_evidence, "plugins/desk/activation/host-capability-evidence.md")
})
test("shipped Copilot closure matches the actual selected worker rather than the prior preview", () => {
  const selected = read("plugins/desk/activation/desk.activation.json").provides.activation_targets[0].depends_on
  const closure = read("plugins/desk/activation/copilot-root.flattened-bundle.json").dependency_closure
  assert.deepEqual(closure.map((entry) => entry.id), selected)
})
test("alpha onboarding selects the existing cache audit's Superpowers plugin set explicitly", () => {
  const skill = readFileSync(new URL("../../../skills/codex-onboarding/SKILL.md", import.meta.url), "utf8")
  assert.match(skill, /--plugins desk,superpowers,plain-language,ponytail-upstream/u)
})
test("existing cache audit CLI accepts the alpha set without changing its legacy default", () => {
  const observed = []
  const invoke = (argv) => cacheAudit.run({
    argv, auditFn: (options) => { observed.push(options.plugins); return { status: "current" } },
    stdout: { write() {} }, stderr: { write() {} },
  })
  assert.equal(invoke(["--plugins", "desk,superpowers,plain-language,ponytail-upstream", "--strict"]), 0)
  assert.equal(invoke([]), 0)
  assert.deepEqual(observed, [
    ["desk", "superpowers", "plain-language", "ponytail-upstream"],
    ["desk", "work-suite", "plain-language", "ponytail-upstream"],
  ])
})
test("Claude validates an explicitly declared legacy configuration, not the shipped alpha", () => {
  const input = claude(legacyActivation())
  input.deskPlugin.dependencies[0] = { name: "work-suite", version: "^4.0.0-alpha.1" }
  assert.deepEqual(validateClaudePackagingContract(input), [])
})
test("Ouroboros retains its legacy provider route without enabling Superpowers", () => {
  const input = ouroboros()
  input.activationManifest = legacyActivation()
  input.ouroborosReadmeSection = input.ouroborosReadmeSection.replace('"superpowers"', '"work-suite"')
  const row = input.evidenceRows.find((entry) => entry.host_id === "ouroboros-autonomous-agent")
  row.source_paths = row.source_paths.map((file) => file.replace("plugins/superpowers/", "plugins/work-suite/"))
  row.fallback_behavior = row.fallback_behavior.replace("Superpowers", "Work Suite")
  assert.deepEqual(validateOuroborosStdioPackagingContract(input), [])
})
for (const [surface, mutate, expected] of [
  ["readme", (input) => { input.genericStdioReadmeSection += "\nGeneric stdio loads Superpowers." }, "Generic stdio docs must not claim plugin dependency resolution"],
  ["activation docs", (input) => { input.genericStdioActivationSection += "\nGeneric stdio loads Superpowers." }, "Generic stdio docs must not claim plugin dependency resolution"],
  ["host fallback", (input) => { input.activationManifest.host_support.find((row) => row.host === "generic-stdio").fallback_behavior += ". Generic stdio loads Superpowers." }, "Generic stdio fallback must not claim plugin dependency resolution"],
  ["evidence fallback", (input) => { input.evidenceRows.find((row) => row.host_id === "generic-stdio").fallback_behavior += ". Generic stdio loads Superpowers." }, "Generic stdio evidence fallback must not claim plugin dependency resolution"],
]) {
  test(`generic stdio ${surface} cannot claim Superpowers activation`, () => {
    const input = ouroboros()
    assert.deepEqual(validateOuroborosStdioPackagingContract(input), [])
    mutate(input)
    assert.deepEqual(validateOuroborosStdioPackagingContract(input), [expected])
  })
}

test("Codex provider omits unsupported hooks and retains generated-instructions bootstrap", () => {
  const manifest = activation()
  const provider = read("plugins/superpowers/.codex-plugin/plugin.json")
  assert.equal(manifest.host_support.find((host) => host.host === "codex").capabilities.includes("hooks"), false)
  assert.equal(Object.hasOwn(provider, "hooks"), false)
  const result = materializeCodexActivation({
    manifest, mode: "global-personal", pluginRoot: "plugins/desk", deskRoot: "~/desk",
    existingConfig: "", existingInstructions: "",
  })
  assert.match(result.generatedInstructions, /Selected engineering lifecycle: Superpowers/u)
  assert.match(result.generatedInstructions, /Invoke `desk:superpowers-integration` before engineering work/u)
})

test("Codex onboarding restart instruction names the selected Superpowers composition exactly", () => {
  const skill = readFileSync(new URL("../../../skills/codex-onboarding/SKILL.md", import.meta.url), "utf8")
  assert.ok(skill.includes("The active Codex session will not gain new plugin skills retroactively. Restart Codex or open a fresh session to confirm that `desk`, `superpowers`, `plain-language`, and `ponytail-upstream` appear in the available plugins/skills list."))
})

for (const [method, label] of [["superpowers", "Superpowers"], ["work-suite", "Work Suite"]]) {
  function undeclaredSelectedMethod() {
    const value = activation()
    assert.equal(value.dependencies.some((entry) => entry.id === "work-suite"), false)
    value.dependencies = value.dependencies.filter((entry) => entry.id !== method)
    value.provides.activation_targets[0].depends_on = ["desk", method, "plain-language", "ponytail-upstream"]
    return value
  }
  test(`Claude reports absent selected ${method} declaration in the real alpha without TypeError`, () => {
    assert.deepEqual(validateClaudePackagingContract(claude(undeclaredSelectedMethod())), [
      `missing ${label} dependency in activation manifest`,
    ])
  })
  test(`Copilot builder reports absent selected ${method} declaration in the real alpha without TypeError`, () => {
    assert.throws(() => buildCopilotBundle({ activation: undeclaredSelectedMethod() }), {
      name: "Error", message: `missing ${label} dependency in activation manifest`,
    })
  })
}

test("maintained host verifier uses the canonical selector instead of hardcoded provider paths or keys", () => {
  const source = readFileSync(new URL("../../../../../scripts/test-desk-host-manifests.cjs", import.meta.url), "utf8")
  assert.match(source, /selectEngineeringMethod/u)
  assert.doesNotMatch(source, /plugins\/superpowers\/(?:plugin\.json|\.codex-plugin\/plugin\.json|\.claude-plugin\/plugin\.json)/u)
  assert.doesNotMatch(source, /dependency\.id === "superpowers"|findActivationDependency\(activation, "superpowers"\)|dependencies\?\.superpowers/u)
})
