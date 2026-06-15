const CODEX_CAPABILITIES = new Set(["Read", "Write", "Interactive"])

const MODE_CONFIG = {
  "global-personal": {
    scope: "global",
    configPath: "~/.codex/config.toml",
    defaultAgent: "desk:worker",
    mcpAutoStart: true,
    manualOnly: false,
    projectLocal: false,
    workerDefault: true,
  },
  "project-local": {
    scope: "project",
    configPath: ".codex/config.toml",
    defaultAgent: "desk:worker",
    mcpAutoStart: true,
    manualOnly: false,
    projectLocal: true,
    workerDefault: true,
  },
  "manual-only": {
    scope: "global",
    configPath: "~/.codex/config.toml",
    defaultAgent: "",
    mcpAutoStart: false,
    manualOnly: true,
    projectLocal: false,
    workerDefault: false,
  },
}

function tomlString(value) {
  return `"${value}"`
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(", ")}]`
}

function assertCodexCapabilities(manifest) {
  for (const capability of manifest.permissions.requested_capabilities) {
    if (!CODEX_CAPABILITIES.has(capability)) {
      throw new Error(`unsupported capability: permission ${capability} not declared by Codex adapter`)
    }
  }
}

function renderConfigBlock(input, modeConfig) {
  const { manifest } = input
  const workSuite = manifest.dependencies.find((dependency) => dependency.id === "work-suite")
  const capabilities = manifest.permissions.requested_capabilities
  const artifacts = manifest.permissions.generated_artifacts
  const protectedArtifacts = manifest.permissions.never_delete

  return `# BEGIN desk activation: ${manifest.id}@${manifest.version} mode=${input.mode} owner=desk-activation
[desk.activation]
id = ${tomlString(manifest.id)}
version = ${tomlString(manifest.version)}
mode = ${tomlString(input.mode)}
scope = ${tomlString(modeConfig.scope)}
desk_root = ${tomlString(input.deskRoot)}
runtime_cache_dir = ${tomlString(input.runtimeCacheDir)}
default_agent = ${tomlString(modeConfig.defaultAgent)}
mcp_auto_start = ${modeConfig.mcpAutoStart}
manual_only = ${modeConfig.manualOnly}
project_local = ${modeConfig.projectLocal}

[desk.activation.dependencies.work-suite]
path = ${tomlString(input.workSuitePluginRoot)}
version = ${tomlString(workSuite.lock.version)}
resolution = "flattened"

[desk.activation.mcp_servers.desk]
transport = "stdio"
command = "node"
args = [${tomlString(`${input.pluginRoot}/mcp/index.js`)}]
manual_registration = false

[desk.activation.agents.worker]
id = "desk:worker"
source = ${tomlString(`${input.pluginRoot}/agents/worker.toml`)}
copy_to_host = false
default = ${modeConfig.workerDefault}

[desk.activation.permissions]
requested_capabilities = ${tomlArray(capabilities)}
generated_artifacts = ${tomlArray(artifacts)}
never_delete = ${tomlArray(protectedArtifacts)}

[desk.activation.opt_out]
project_local = true
manual_only = true
# END desk activation
`
}

export function materializeCodexActivation(input) {
  const modeConfig = MODE_CONFIG[input.mode]
  assertCodexCapabilities(input.manifest)
  const generatedConfig = `${input.existingConfig}\n${renderConfigBlock(input, modeConfig)}`

  return {
    mode: input.mode,
    scope: modeConfig.scope,
    configPath: modeConfig.configPath,
    manualSetupSteps: [],
    permissions: {
      requestedCapabilities: input.manifest.permissions.requested_capabilities,
      neverDelete: input.manifest.permissions.never_delete,
    },
    generatedArtifacts: [
      {
        owner: "desk-activation",
        kind: "owned-host-config",
        path: modeConfig.configPath,
      },
    ],
    generatedConfig,
  }
}
