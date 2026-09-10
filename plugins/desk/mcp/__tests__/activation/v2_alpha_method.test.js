import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { buildCopilotBundle, validateCopilotPackagingContract } from "../../src/activation/copilot-bundle.js"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"

const repoRoot = new URL("../../../../../", import.meta.url)
const readJson = (relativePath) => JSON.parse(readFileSync(new URL(relativePath, repoRoot), "utf8"))
const methodIds = new Set(["work-suite", "superpowers"])
const bundlePath = "plugins/desk/activation/copilot-root.flattened-bundle.json"

function activationFor(method) {
  const activation = readJson("plugins/desk/activation/desk.activation.json")
  const version = method === "superpowers" ? "6.3.0" : "4.0.0-alpha.1"
  activation.dependencies = activation.dependencies.filter((dependency) => !methodIds.has(dependency.id))
  activation.dependencies.push({
    id: method,
    kind: "plugin",
    version_range: version,
    provenance: { source: `plugins/${method}/.codex-plugin/plugin.json`, package: `ourostack/${method}` },
    lock: { version, integrity: `sha256-${method}-fixture` },
  })
  for (const target of activation.provides.activation_targets) {
    target.depends_on = [...target.depends_on.filter((id) => !methodIds.has(id)), method]
  }
  return activation
}

function packagingInput(method) {
  const activation = activationFor(method)
  const deskPlugin = readJson("plugins/desk/plugin.json")
  const dependencies = deskPlugin.activation.copilot.dependencies
  for (const id of methodIds) delete dependencies[id]
  dependencies[method] = {
    path: `../${method}`,
    version: activation.dependencies.at(-1).lock.version,
    resolution: "flattened",
    bundleMetadata: bundlePath,
  }
  const bundle = readJson(bundlePath)
  bundle.dependency_closure = bundle.dependency_closure.filter((entry) => !methodIds.has(entry.id))
  bundle.dependency_closure.push({
    id: method,
    version: activation.dependencies.at(-1).lock.version,
    plugin: `plugins/${method}/plugin.json`,
    skills: `plugins/${method}/skills/`,
  })
  return {
    activation,
    deskPlugin,
    bundle,
    workSuitePlugin: { name: "work-suite", version: "4.0.0-alpha.1" },
    superpowersPlugin: { name: "superpowers", version: "6.3.0" },
    plainLanguagePlugin: readJson("plugins/plain-language/plugin.json"),
    ponytailPlugin: readJson("plugins/ponytail-upstream/plugin.json"),
  }
}

function codexInput(method, mode = "global-personal") {
  return {
    manifest: activationFor(method),
    mode,
    existingConfig: 'model = "operator-choice"\n',
    existingInstructions: "# User guidance\nKeep my preferences unchanged.\n",
    pluginRoot: "plugins/desk",
    deskRoot: "~/desk",
    runtimeCacheDir: "~/.cache/ouroboros-skills/desk",
  }
}

test("alpha Copilot bundle consumes Superpowers rather than Work Suite", () => {
  const activation = activationFor("superpowers")
  // An available legacy provider is not selected by desk:worker. This exposes
  // wrong selection as a value mismatch instead of an unrelated missing-lock error.
  activation.dependencies.push(activationFor("work-suite").dependencies.find((entry) => entry.id === "work-suite"))
  const bundle = buildCopilotBundle({ activation })
  const methods = bundle.dependency_closure.filter((entry) => methodIds.has(entry.id))
  assert.deepEqual(methods, [{
    id: "superpowers",
    version: "6.3.0",
    plugin: "plugins/superpowers/plugin.json",
    skills: "plugins/superpowers/skills/",
  }])
  assert.equal(JSON.stringify(bundle).includes("work-suite"), false)
})

test("legacy Copilot manifest-shape characterization selects Work Suite", () => {
  const bundle = buildCopilotBundle({ activation: activationFor("work-suite") })
  assert.deepEqual(bundle.dependency_closure.filter((entry) => methodIds.has(entry.id)).map((entry) => entry.id), ["work-suite"])
  assert.deepEqual(validateCopilotPackagingContract(packagingInput("work-suite")), [])
})

test("alpha Copilot packaging accepts the selected pinned provider", () => {
  assert.deepEqual(validateCopilotPackagingContract(packagingInput("superpowers")), [])
})

test("alpha Copilot packaging rejects a mismatched Superpowers version", () => {
  const input = packagingInput("superpowers")
  const baselineErrors = validateCopilotPackagingContract(input)
  input.superpowersPlugin.version = "6.2.0"
  const addedErrors = validateCopilotPackagingContract(input).filter((error) => !baselineErrors.includes(error))
  assert.deepEqual(addedErrors, [
    "Copilot root Superpowers version must match activation lock 6.3.0",
  ], "the single version mutation must add its own diagnostic, independent of unsupported-alpha preconditions")
})

test("alpha Copilot packaging rejects a second lifecycle owner in the closure", () => {
  const input = packagingInput("superpowers")
  const baselineErrors = validateCopilotPackagingContract(input)
  input.bundle.dependency_closure.push({ id: "work-suite", version: "4.0.0-alpha.1" })
  const addedErrors = validateCopilotPackagingContract(input).filter((error) => !baselineErrors.includes(error))
  assert.deepEqual(addedErrors, [
    "Copilot alpha bundle must not include Work Suite as a second lifecycle owner",
  ], "the single closure mutation must add its own diagnostic, independent of unsupported-alpha preconditions")
})

test("alpha Codex activation routes the real owned instruction block to Superpowers", () => {
  const input = codexInput("superpowers")
  input.existingInstructions = "# User guidance\nUse Work Suite skills for engineering work.\n"
  const result = materializeCodexActivation(input)
  assert.ok(result.generatedInstructions.startsWith(input.existingInstructions))
  const owned = result.generatedInstructions.split("# BEGIN desk activation:")[1]?.split("# END desk activation")[0]
  assert.ok(owned)
  assert.match(result.generatedConfig, /\[plugins\."superpowers@/u)
  assert.doesNotMatch(result.generatedConfig, /\[plugins\."work-suite@/u)
  assert.match(owned, /Selected engineering lifecycle: Superpowers\./u)
  assert.match(owned, /desk:superpowers-integration/u)
  assert.doesNotMatch(owned, /Use Work Suite skills \(`work-ideator`/u)
  assert.match(result.generatedConfig, /^model = "operator-choice"\n/u)
})

test("legacy Codex instruction-shape characterization retains the Work Suite route", () => {
  const result = materializeCodexActivation(codexInput("work-suite"))
  assert.match(result.generatedInstructions, /Use Work Suite skills/u)
  assert.doesNotMatch(result.generatedConfig, /\[plugins\."superpowers@/u)
})

test("manual-only mode characterization has no worker instruction or MCP bridge", () => {
  const result = materializeCodexActivation(codexInput("superpowers", "manual-only"))
  assert.equal(result.generatedInstructions, "")
  assert.equal(result.generatedActivationConfig, "")
  assert.equal(result.instructionsPath, null)
  assert.doesNotMatch(result.generatedConfig, /\[mcp_servers\.desk\]/u)
  assert.equal(result.generatedArtifacts.some((artifact) => artifact.kind === "owned-codex-instructions"), false)
})
