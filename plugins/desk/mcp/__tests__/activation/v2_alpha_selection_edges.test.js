import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { buildCopilotBundle, validateCopilotPackagingContract } from "../../src/activation/copilot-bundle.js"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"

const read = (file) => JSON.parse(readFileSync(new URL(`../../../../../${file}`, import.meta.url), "utf8"))
const legacy = { id: "work-suite", kind: "plugin", version_range: "^4.0.0-alpha.1", provenance: { source: "plugins/work-suite/.codex-plugin/plugin.json", package: "ourostack/work-suite" }, lock: { version: "4.0.0-alpha.1", integrity: "sha256-legacy-fixture" } }
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

test("legacy packaging without target dependency declarations retains its historical diagnostics", () => {
  const input = fixture()
  input.activation.dependencies = input.activation.dependencies.filter((entry) => entry.id !== "superpowers")
  input.activation.dependencies.push(structuredClone(legacy))
  input.deskPlugin.activation.copilot.dependencies["work-suite"] = { ...input.deskPlugin.activation.copilot.dependencies.superpowers, path: "../work-suite", version: legacy.lock.version }
  delete input.deskPlugin.activation.copilot.dependencies.superpowers
  input.bundle.dependency_closure = input.bundle.dependency_closure.filter((entry) => entry.id !== "superpowers")
  input.bundle.dependency_closure.push({ id: "work-suite", version: legacy.lock.version, plugin: "plugins/work-suite/plugin.json", skills: "plugins/work-suite/skills/" })
  input.workSuitePlugin = read("plugins/work-suite/plugin.json")
  delete input.activation.provides.activation_targets[0].depends_on
  assert.deepEqual(validateCopilotPackagingContract(input), [])
})
