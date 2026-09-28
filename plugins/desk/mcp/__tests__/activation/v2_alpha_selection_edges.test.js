import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { buildCopilotBundle, validateCopilotPackagingContract } from "../../src/activation/copilot-bundle.js"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"

const read = (file) => JSON.parse(readFileSync(new URL(`../../../../../${file}`, import.meta.url), "utf8"))
const legacy = { id: "work-suite", kind: "plugin", version_range: "^4.0.0-alpha.3", provenance: { source: "plugins/work-suite/.codex-plugin/plugin.json", package: "ourostack/work-suite" }, lock: { version: "4.0.0-alpha.3", integrity: "sha256-legacy-fixture" } }
function fixture() {
  const activation = read("plugins/desk/activation/desk.activation.json")
  activation.dependencies = activation.dependencies.filter((entry) => !["work-suite", "superpowers"].includes(entry.id))
  activation.dependencies.push({ id: "superpowers", kind: "plugin", version_range: "6.3.0", provenance: { source: "plugins/superpowers/.codex-plugin/plugin.json", package: "ourostack/superpowers" }, lock: { version: "6.3.0", integrity: "sha256-fixture" } })
  activation.provides.activation_targets.find((entry) => entry.id === "desk:worker").depends_on = ["desk", "superpowers", "plain-language", "ponytail-upstream"]
  const deskPlugin = read("plugins/desk/plugin.json")
  deskPlugin.activation.copilot.dependencies.superpowers = { path: "../superpowers", version: "6.3.0", resolution: "flattened", bundleMetadata: "plugins/desk/activation/copilot-root.flattened-bundle.json" }
  delete deskPlugin.activation.copilot.dependencies["work-suite"]
  const bundle = read("plugins/desk/activation/copilot-root.flattened-bundle.json")
  bundle.dependency_closure = bundle.dependency_closure.filter((entry) => !["work-suite", "superpowers"].includes(entry.id))
  bundle.dependency_closure.push({
    id: "superpowers", version: "6.3.0", plugin: "plugins/superpowers/plugin.json", skills: "plugins/superpowers/skills/",
  })
  return {
    activation, deskPlugin, bundle,
    superpowersPlugin: { version: "6.3.0" },
    plainLanguagePlugin: read("plugins/plain-language/plugin.json"),
    ponytailPlugin: read("plugins/ponytail-upstream/plugin.json"),
  }
}

test("Copilot builder rejects two selected lifecycle owners before producing a bundle", () => {
  const input = fixture()
  input.activation.dependencies.push(structuredClone(legacy))
  input.activation.provides.activation_targets[0].depends_on.push("work-suite")
  assert.throws(() => buildCopilotBundle(input), /exactly one engineering lifecycle/u)
})

test("Copilot validator reports two selected lifecycle owners rather than throwing", () => {
  const input = fixture()
  input.activation.provides.activation_targets[0].depends_on.push("work-suite")
  assert.deepEqual(validateCopilotPackagingContract(input), ["activation must select exactly one engineering lifecycle"])
})

for (const [label, mutate, expected] of [
  ["missing lock", (input) => { input.activation.dependencies = input.activation.dependencies.filter((entry) => entry.id !== "superpowers") }, "Copilot activation must lock Superpowers dependency"],
  ["missing provider", (input) => { delete input.superpowersPlugin }, "Copilot root Superpowers version must match activation lock 6.3.0"],
  ["missing closure", (input) => { input.bundle.dependency_closure = input.bundle.dependency_closure.filter((entry) => entry.id !== "superpowers") }, "Copilot flattened bundle must include superpowers dependency closure"],
  ["missing metadata", (input) => { delete input.deskPlugin.activation.copilot.dependencies.superpowers }, "Copilot Superpowers dependency must point to generated flattened bundle metadata"],
]) {
  test(`Copilot alpha packaging has a distinct ${label} diagnostic`, () => {
    const input = fixture()
    const baseline = validateCopilotPackagingContract(input)
    mutate(input)
    assert.deepEqual(validateCopilotPackagingContract(input).filter((error) => !baseline.includes(error)), [expected])
  })
}

for (const config of [
  '[plugins]\n"work-suite@elsewhere" = { enabled = true }\n',
  '[plugins."work-suite@elsewhere"]\nenabled = "true"\n',
  '[plugins."work-suite@elsewhere"]\ndescription = "enabled = true"\n',
  '[plugins."work-suite@elsewhere"]\nenabled = 1\n',
]) {
  test(`Codex checks typed enabled state rather than text in ${JSON.stringify(config)}`, () => {
    const input = {
      manifest: fixture().activation, mode: "global-personal", existingConfig: config,
      existingInstructions: "", pluginRoot: "plugins/desk", deskRoot: "~/desk", runtimeCacheDir: "/tmp/desk-cache",
    }
    if (config.startsWith("[plugins]\n")) {
      assert.throws(() => materializeCodexActivation(input), /Work Suite/u)
    } else {
      assert.ok(materializeCodexActivation(input).generatedConfig.startsWith(config))
    }
  })
}

test("manual-only activation with no selected lifecycle does not enable an available legacy provider", () => {
  const manifest = fixture().activation
  manifest.dependencies.push(structuredClone(legacy))
  manifest.provides.activation_targets[0].depends_on = ["desk", "plain-language", "ponytail-upstream"]
  const result = materializeCodexActivation({
    manifest, mode: "manual-only", existingConfig: "", existingInstructions: "",
    pluginRoot: "plugins/desk", deskRoot: "~/desk", runtimeCacheDir: "/tmp/desk-cache",
  })
  assert.doesNotMatch(result.generatedConfig, /\[plugins\."(?:work-suite|superpowers)@/u)
  assert.equal(result.generatedInstructions, "")
  assert.equal(result.generatedActivationConfig, "")
})

function omittedSelectionLegacyInput() {
  const input = fixture()
  input.activation.dependencies = input.activation.dependencies.filter((entry) => entry.id !== "superpowers")
  input.activation.dependencies.push(structuredClone(legacy))
  input.deskPlugin.activation.copilot.dependencies["work-suite"] = { ...input.deskPlugin.activation.copilot.dependencies.superpowers, path: "../work-suite", version: legacy.lock.version }
  delete input.deskPlugin.activation.copilot.dependencies.superpowers
  // An activation manifest with no explicit desk:worker.depends_on is the characterized
  // pre-V2 legacy shape and retains the historical four-root closure including Ponytail
  // unconditionally, so the authored root manifest must still carry its bundle metadata
  // pointer here even though the current real plugin.json (a V2 selection) no longer does.
  input.deskPlugin.activation.copilot.dependencies["ponytail-upstream"] = {
    path: "../ponytail-upstream", version: "4.9.0", resolution: "flattened", bundleMetadata: "plugins/desk/activation/copilot-root.flattened-bundle.json",
  }
  input.bundle.dependency_closure = input.bundle.dependency_closure.filter((entry) => entry.id !== "superpowers")
  input.bundle.dependency_closure.push({ id: "work-suite", version: legacy.lock.version, plugin: "plugins/work-suite/plugin.json", skills: "plugins/work-suite/skills/" })
  // The committed bundle is the regenerated three-root V2 artifact, so this legacy fixture
  // supplies the historical Ponytail closure entry in memory rather than relying on a stale
  // committed artifact to carry it.
  input.bundle.dependency_closure.push({ id: "ponytail-upstream", version: "4.9.0", plugin: "plugins/ponytail-upstream/plugin.json", skills: "plugins/ponytail-upstream/skills/" })
  input.bundle.generated_from.ponytail_plugin = "plugins/ponytail-upstream/plugin.json"
  input.workSuitePlugin = read("plugins/work-suite/plugin.json")
  delete input.activation.provides.activation_targets[0].depends_on
  return input
}

test("legacy packaging without target dependency declarations retains its historical diagnostics", () => {
  assert.deepEqual(validateCopilotPackagingContract(omittedSelectionLegacyInput()), [])
})

test("omitted desk:worker.depends_on producer builds the historical four-root closure including Ponytail", () => {
  const { activation } = omittedSelectionLegacyInput()
  const bundle = buildCopilotBundle({ activation })
  assert.deepEqual(
    bundle.dependency_closure.map((entry) => entry.id).sort(),
    ["desk", "plain-language", "ponytail-upstream", "work-suite"],
  )
  assert.equal(Object.hasOwn(bundle.generated_from, "ponytail_plugin"), true)
})

for (const [label, mutate, expected] of [
  [
    "missing Ponytail activation lock",
    (input) => { input.activation.dependencies = input.activation.dependencies.filter((entry) => entry.id !== "ponytail-upstream") },
    "Copilot activation must lock Ponytail dependency",
  ],
  [
    "missing Ponytail root bundle metadata",
    (input) => { delete input.deskPlugin.activation.copilot.dependencies["ponytail-upstream"] },
    "Copilot Ponytail dependency must point to generated flattened bundle metadata",
  ],
  [
    "missing Ponytail bundle closure entry",
    (input) => { input.bundle.dependency_closure = input.bundle.dependency_closure.filter((entry) => entry.id !== "ponytail-upstream") },
    "Copilot flattened bundle must include ponytail-upstream dependency closure",
  ],
]) {
  test(`omitted desk:worker.depends_on validator rejects ${label}`, () => {
    const input = omittedSelectionLegacyInput()
    const baseline = validateCopilotPackagingContract(input)
    assert.deepEqual(baseline, [], "the complete omitted-selection legacy input must be the accepted starting point")
    mutate(input)
    assert.deepEqual(validateCopilotPackagingContract(input), [expected])
  })
}


test("authored V2 closure (selection edges): the real producer builds and validates exactly desk, superpowers, plain-language", () => {
  const activation = read("plugins/desk/activation/desk.activation.json")
  const freshBundle = buildCopilotBundle({ activation })
  const selectedNames = freshBundle.dependency_closure.map((entry) => entry.id)
  const expected = ["desk", "plain-language", "superpowers"]
  assert.deepEqual([...selectedNames].sort(), expected)
  assert.equal(selectedNames.includes("ponytail-upstream"), false)
  assert.equal(selectedNames.includes("work-suite"), false)

  const deskPlugin = read("plugins/desk/plugin.json")
  const superpowersPlugin = read("plugins/superpowers/plugin.json")
  const plainLanguagePlugin = read("plugins/plain-language/plugin.json")
  assert.deepEqual(
    validateCopilotPackagingContract({
      activation, deskPlugin, bundle: freshBundle, superpowersPlugin, plainLanguagePlugin,
    }),
    [],
    "packaging validation must accept the freshly produced three-root closure the real producer builds from the authored manifest",
  )
})

test("ordinary Agency declaration (selection edges): desk/agency.json declares only the two generic V2 dependencies", () => {
  const agency = read("plugins/desk/agency.json")
  assert.equal(agency.name, "desk")
  assert.equal(agency.dependencies.length, 2)
  assert.ok(agency.dependencies.includes("github:ourostack/ouroboros-skills:plugins/superpowers@v2-alpha"))
  assert.ok(agency.dependencies.includes("github:ourostack/ouroboros-skills:plugins/plain-language@v2-alpha"))
})
