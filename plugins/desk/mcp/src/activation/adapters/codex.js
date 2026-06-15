const CODEX_CAPABILITIES = new Set(["Read", "Write", "Interactive"])

const MODE_CONFIG = {
  "global-personal": {
    scope: "global",
    configPath: "~/.codex/config.toml",
    instructionsPath: "~/.codex/AGENTS.md",
    workerContext: "by default",
    pluginMcpEnabled: true,
    directMcp: false,
  },
  "project-local": {
    scope: "project",
    configPath: ".codex/config.toml",
    instructionsPath: "AGENTS.md",
    workerContext: "by default in this project",
    pluginMcpEnabled: false,
    directMcp: true,
  },
  "manual-only": {
    scope: "global",
    configPath: "~/.codex/config.toml",
    instructionsPath: null,
    workerContext: "",
    pluginMcpEnabled: false,
    directMcp: false,
  },
}

function tomlString(value) {
  return `"${value}"`
}

function tomlArray(values) {
  return `[${values.map(tomlString).join(", ")}]`
}

function tomlBool(value) {
  return value ? "true" : "false"
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
  const pluginMcpPolicy = `[plugins."${manifest.id}@ourostack".mcp_servers.desk]
enabled = ${tomlBool(modeConfig.pluginMcpEnabled)}`
  const approvalPolicy = modeConfig.pluginMcpEnabled
    ? `
default_tools_approval_mode = "prompt"`
    : ""
  const directMcp = modeConfig.directMcp
    ? `

[mcp_servers.desk]
command = "node"
args = ${tomlArray([`${input.pluginRoot}/mcp/index.js`, "--root", input.deskRoot])}
cwd = "."
enabled = true
default_tools_approval_mode = "prompt"`
    : ""

  return `# BEGIN desk activation: ${manifest.id}@${manifest.version} mode=${input.mode} owner=desk-activation
[plugins."work-suite@ourostack"]
enabled = true

[plugins."${manifest.id}@ourostack"]
enabled = true

${pluginMcpPolicy}${approvalPolicy}${directMcp}
# END desk activation
`
}

function renderInstructionsBlock(input, modeConfig) {
  if (!modeConfig.instructionsPath) {
    return ""
  }

  return `# BEGIN desk activation: ${input.manifest.id}@${input.manifest.version} mode=${input.mode} owner=desk-activation
You are the desk worker ${modeConfig.workerContext}.

Run the \`desk:session-start\` skill before other work. Treat \`$DESK\` as \`${input.deskRoot}\`. Keep durable tracks, tasks, friction, and lessons there. Use Work Suite skills (\`work-ideator\`, \`work-planner\`, \`work-doer\`, \`work-merger\`) for substantial engineering work, with harsh sub-agent reviewer gates when the task calls for them.
# END desk activation
`
}

export function materializeCodexActivation(input) {
  const modeConfig = MODE_CONFIG[input.mode]
  assertCodexCapabilities(input.manifest)
  const generatedConfig = `${input.existingConfig}\n${renderConfigBlock(input, modeConfig)}`
  const instructionsBlock = renderInstructionsBlock(input, modeConfig)
  const generatedInstructions = instructionsBlock ? `${input.existingInstructions}\n${instructionsBlock}` : ""
  const instructionArtifacts = modeConfig.instructionsPath
    ? [
        {
          owner: "desk-activation",
          kind: "owned-codex-instructions",
          path: modeConfig.instructionsPath,
        },
      ]
    : []

  return {
    mode: input.mode,
    scope: modeConfig.scope,
    configPath: modeConfig.configPath,
    instructionsPath: modeConfig.instructionsPath,
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
      ...instructionArtifacts,
    ],
    generatedConfig,
    generatedInstructions,
  }
}
