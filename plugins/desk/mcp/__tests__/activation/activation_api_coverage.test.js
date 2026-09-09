import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"
import { orderActivationDependencies, resolveActivationChain, validateActivationManifest } from "../../src/activation/validate.js"

const activation = () => JSON.parse(readFileSync(new URL("../../../activation/desk.activation.json", import.meta.url), "utf8"))

test("activation chain defaults to the actual Desk worker without changing its manifest", () => {
  const manifest = activation()
  const before = structuredClone(manifest)
  assert.deepEqual(resolveActivationChain(manifest), resolveActivationChain(manifest, "desk:worker"))
  assert.deepEqual(manifest, before)
})

for (const [field, mutate] of [
  ["mcp_servers[0]", (manifest) => { manifest.mcp_servers = [null] }],
  ["artifacts.embeddings", (manifest) => { manifest.artifacts.embeddings = null }],
  ["artifacts.snapshots", (manifest) => { manifest.artifacts.snapshots = null }],
  ["host_support[0]", (manifest) => { manifest.host_support = [null] }],
]) {
  test(`activation validation rejects null ${field} with its object diagnostic and no partial value`, () => {
    const manifest = activation()
    mutate(manifest)
    const before = structuredClone(manifest)
    const result = validateActivationManifest(manifest)
    assert.equal(result.ok, false)
    assert.equal(result.value, undefined)
    assert.deepEqual(result.errors.filter((error) => error.code === "missing_required_object").map((error) => error.path), [field])
    assert.deepEqual(manifest, before)
  })
}

test("Codex does not coerce an unparsed inline enabled value or rewrite operator config", () => {
  const config = '[plugins]\n"work-suite@elsewhere" = { enabled = 1 }\n'
  const input = {
    manifest: activation(), mode: "global-personal", existingConfig: config,
    existingInstructions: "# Operator notes\nKeep this.\n", pluginRoot: "plugins/desk",
    deskRoot: "~/desk", runtimeCacheDir: "~/.cache/ouroboros-skills/desk",
  }
  const before = structuredClone(input)
  const result = materializeCodexActivation(input)
  assert.ok(result.generatedConfig.startsWith(config))
  assert.ok(result.generatedInstructions.startsWith(input.existingInstructions))
  assert.match(result.generatedConfig, /\[plugins\."superpowers@/u)
  assert.deepEqual(input, before)
  assert.throws(
    () => materializeCodexActivation({ ...input, existingConfig: config.replace("enabled = 1", "enabled = true") }),
    /active Work Suite conflicts with the selected Superpowers lifecycle/u,
  )
})

test("dependency ordering emits inherited overlays once while keeping base targets out of the overlay traversal", () => {
  const manifest = activation()
  const worker = manifest.provides.activation_targets.find((target) => target.id === "desk:worker")
  const overlay = (id, inherits) => ({
    id, kind: "agent-overlay", depends_on: [...worker.depends_on], launch_as: id, inherits,
    entrypoints: { ...worker.entrypoints }, instructions: { identity: id, addendum: "fixture addendum" },
  })
  manifest.provides.overlay_agents = [
    overlay("alpha:worker", ["zeta:worker", "desk:worker"]),
    overlay("zeta:worker", ["desk:worker"]),
  ]
  const validation = validateActivationManifest(manifest)
  assert.equal(validation.ok, true, JSON.stringify(validation.errors))
  const before = structuredClone(manifest)
  const ordered = orderActivationDependencies(manifest)
  assert.deepEqual(ordered.filter((entry) => entry.kind === "agent-overlay").map((entry) => entry.id), ["zeta:worker", "alpha:worker"])
  assert.equal(ordered.filter((entry) => entry.id === "desk:worker").length, 1)
  assert.deepEqual(orderActivationDependencies(manifest), ordered)
  assert.deepEqual(manifest, before)
})
