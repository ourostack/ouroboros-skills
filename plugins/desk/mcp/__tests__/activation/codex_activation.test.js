import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const fixturesRoot = path.join(mcpRoot, "__tests__", "fixtures", "activation", "codex")

const existingConfig = `# user-authored Codex config
model = "gpt-5.4"
approval_policy = "on-request"
`

const existingInstructions = `# user-authored Codex guidance
Keep repo-local rules intact.
`

async function loadCodexAdapter() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "activation", "adapters", "codex.js")))
}

function loadJson(...segments) {
  return JSON.parse(readFileSync(path.join(repoRoot, ...segments), "utf8"))
}

function loadFixture(mode, fileName) {
  return readFileSync(path.join(fixturesRoot, mode, fileName), "utf8")
}

function activationInput(mode, overrides = {}) {
  return {
    manifest: loadJson("plugins", "desk", "activation", "desk.activation.json"),
    mode,
    existingConfig,
    existingInstructions,
    pluginRoot: "plugins/desk",
    workSuitePluginRoot: "plugins/work-suite",
    deskRoot: mode === "project-local" ? ".desk" : "~/desk",
    runtimeCacheDir: mode === "project-local"
      ? ".codex/desk-runtime-cache"
      : "~/.cache/ouroboros-skills/desk",
    ...overrides,
  }
}

function assertNoManualSetup(content) {
  assert.doesNotMatch(content, /codex\s+mcp\s+add/i)
  assert.doesNotMatch(content, /~\/\.codex\/agents/i)
  assert.doesNotMatch(content, /copy_to_host/i)
  assert.doesNotMatch(content, /\[desk\.activation]/i)
  assert.doesNotMatch(content, /mcp_auto_start/i)
}

test("Codex plugin metadata declares host-native Desk activation surfaces", () => {
  const deskPlugin = loadJson("plugins", "desk", ".codex-plugin", "plugin.json")
  const workSuitePlugin = loadJson("plugins", "work-suite", ".codex-plugin", "plugin.json")

  assert.equal(deskPlugin.skills, "./skills/")
  assert.equal(deskPlugin.mcpServers, "./.mcp.json")
  assert.equal(deskPlugin.hooks, "./hooks/hooks.json")
  assert.equal(deskPlugin.activation?.codex?.defaultMode, "global-personal")
  assert.equal(deskPlugin.activation?.codex?.artifactOwner, "desk-activation")
  assert.deepEqual(deskPlugin.activation?.codex?.optOutModes, ["project-local", "manual-only"])
  assert.equal(deskPlugin.activation?.codex?.targets?.["desk:worker"]?.default, true)
  assert.equal(deskPlugin.activation?.codex?.targets?.["desk:worker"]?.source, "agents/worker.toml")
  assert.equal(deskPlugin.activation?.codex?.targets?.["desk:worker"]?.activationSurface, "global-or-project-agents-md")
  assert.deepEqual(deskPlugin.activation?.codex?.nativeSurfaces, [
    "plugins.<plugin>.enabled",
    "plugins.<plugin>.mcp_servers.<server>",
    "mcp_servers.<server>",
    "AGENTS.md",
  ])
  assert.equal(deskPlugin.activation?.codex?.mcpServers?.desk?.launch, "plugin-bundled")
  assert.equal(deskPlugin.activation?.codex?.mcpServers?.desk?.manualRegistration, false)
  assert.deepEqual(deskPlugin.activation?.codex?.dependencies?.["work-suite"], {
    path: "../work-suite",
    version: workSuitePlugin.version,
    resolution: "flattened",
  })
  assert.deepEqual(deskPlugin.activation?.codex?.manualSetupSteps ?? [], [])
})

test("Codex worker source no longer documents healthy-path copy registration", () => {
  const workerToml = readFileSync(path.join(repoRoot, "plugins", "desk", "agents", "worker.toml"), "utf8")

  assert.doesNotMatch(workerToml, /copy\s+to\s+~\/\.codex\/agents/i)
  assert.doesNotMatch(workerToml, /Invoke via `\/agent worker` once registered/i)
  assert.match(workerToml, /host-native activation/i)
})

test("global personal activation materializes worker and Desk as the default", async () => {
  const { materializeCodexActivation } = await loadCodexAdapter()
  const result = materializeCodexActivation(activationInput("global-personal"))

  assert.equal(result.mode, "global-personal")
  assert.equal(result.scope, "global")
  assert.equal(result.configPath, "~/.codex/config.toml")
  assert.equal(result.instructionsPath, "~/.codex/AGENTS.md")
  assert.deepEqual(result.manualSetupSteps, [])
  assert.deepEqual(result.permissions.requestedCapabilities, ["Read", "Write", "Interactive"])
  assert.deepEqual(result.permissions.neverDelete, ["desk-root-data"])
  assert.deepEqual(result.generatedArtifacts, [
    {
      owner: "desk-activation",
      kind: "owned-host-config",
      path: "~/.codex/config.toml",
    },
    {
      owner: "desk-activation",
      kind: "owned-codex-instructions",
      path: "~/.codex/AGENTS.md",
    },
  ])
  assert.equal(result.generatedConfig, loadFixture("global-personal", "generated-config.toml"))
  assert.equal(result.generatedInstructions, loadFixture("global-personal", "generated-instructions.md"))
  assertNoManualSetup(result.generatedConfig)
  assert.match(result.generatedConfig, /\[plugins\."desk@ourostack"\]/)
  assert.match(result.generatedConfig, /\[plugins\."desk@ourostack"\.mcp_servers\.desk\]/)
  assert.doesNotMatch(result.generatedConfig, /\[mcp_servers\.desk\]/)
  assert.match(result.generatedInstructions, /desk worker by default/)
  assert.match(result.generatedInstructions, /Run the `desk:session-start` skill/)
})

test("project-local opt-out materializes project config without mutating global defaults", async () => {
  const { materializeCodexActivation } = await loadCodexAdapter()
  const result = materializeCodexActivation(activationInput("project-local"))

  assert.equal(result.mode, "project-local")
  assert.equal(result.scope, "project")
  assert.equal(result.configPath, ".codex/config.toml")
  assert.equal(result.instructionsPath, "AGENTS.md")
  assert.deepEqual(result.manualSetupSteps, [])
  assert.equal(result.generatedArtifacts[0].path, ".codex/config.toml")
  assert.equal(result.generatedArtifacts[1].path, "AGENTS.md")
  assert.equal(result.generatedConfig, loadFixture("project-local", "generated-config.toml"))
  assert.equal(result.generatedInstructions, loadFixture("project-local", "generated-instructions.md"))
  assertNoManualSetup(result.generatedConfig)
  assert.match(result.generatedConfig, /\[mcp_servers\.desk\]/)
  assert.match(result.generatedConfig, /args = \["plugins\/desk\/mcp\/index\.js", "--root", "\.desk"\]/)
  assert.match(result.generatedConfig, /cwd = "."/)
})

test("manual-only opt-out keeps Desk available without default worker or MCP autostart", async () => {
  const { materializeCodexActivation } = await loadCodexAdapter()
  const result = materializeCodexActivation(activationInput("manual-only"))

  assert.equal(result.mode, "manual-only")
  assert.equal(result.scope, "global")
  assert.equal(result.configPath, "~/.codex/config.toml")
  assert.equal(result.instructionsPath, null)
  assert.deepEqual(result.manualSetupSteps, [])
  assert.equal(result.generatedArtifacts.length, 1)
  assert.equal(result.generatedConfig, loadFixture("manual-only", "generated-config.toml"))
  assert.equal(result.generatedInstructions, "")
  assertNoManualSetup(result.generatedConfig)
  assert.match(result.generatedConfig, /\[plugins\."desk@ourostack"\]/)
  assert.match(result.generatedConfig, /\[plugins\."desk@ourostack"\.mcp_servers\.desk\]/)
  assert.match(result.generatedConfig, /enabled = false/)
})

test("Codex activation preserves user-authored config and instructions with owned generated blocks", async () => {
  const { materializeCodexActivation } = await loadCodexAdapter()
  const result = materializeCodexActivation(activationInput("global-personal"))

  assert.equal(result.generatedConfig.startsWith(existingConfig), true)
  assert.match(result.generatedConfig, /# BEGIN desk activation: desk@1\.7\.3 mode=global-personal owner=desk-activation/)
  assert.match(result.generatedConfig, /# END desk activation/)
  assert.equal(result.generatedConfig.match(/# BEGIN desk activation/g).length, 1)
  assert.equal(result.generatedConfig.match(/# END desk activation/g).length, 1)
  assert.equal(result.generatedInstructions.startsWith(existingInstructions), true)
  assert.match(result.generatedInstructions, /# BEGIN desk activation: desk@1\.7\.3 mode=global-personal owner=desk-activation/)
  assert.match(result.generatedInstructions, /# END desk activation/)
  assert.equal(result.generatedInstructions.match(/# BEGIN desk activation/g).length, 1)
  assert.equal(result.generatedInstructions.match(/# END desk activation/g).length, 1)
})

test("Codex activation rejects unsupported requested host capabilities", async () => {
  const { materializeCodexActivation } = await loadCodexAdapter()
  const manifest = activationInput("global-personal").manifest
  manifest.permissions.requested_capabilities = ["Read", "Write", "Interactive", "Network"]

  assert.throws(
    () => materializeCodexActivation(activationInput("global-personal", { manifest })),
    /permission.*Network.*not declared|unsupported capability/i,
  )
})
