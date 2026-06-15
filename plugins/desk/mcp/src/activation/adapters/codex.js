const CODEX_CAPABILITIES = new Set(["Read", "Write", "Interactive"])
const OWNED_BLOCK_BEGIN_PATTERN = /^# BEGIN desk activation: [^\r\n]* owner=desk-activation\r?$/gm
const OWNED_BLOCK_END_PATTERN = /^# END desk activation\r?$/gm
const DESK_PLUGIN_SECTION = "[plugins.\"desk@ourostack\"]"
const DESK_PLUGIN_MCP_SECTION = "[plugins.\"desk@ourostack\".mcp_servers.desk]"

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

function findOwnedActivationBlock(content) {
  const begins = [...content.matchAll(OWNED_BLOCK_BEGIN_PATTERN)]
  const ends = [...content.matchAll(OWNED_BLOCK_END_PATTERN)]

  if (begins.length > 1 || ends.length > 1) {
    throw new Error("multiple owned desk activation blocks found")
  }
  if (begins.length !== ends.length) {
    throw new Error("malformed owned desk activation block")
  }
  if (begins.length === 0) {
    return null
  }

  const begin = begins[0]
  const end = ends[0]
  if (end.index < begin.index) {
    throw new Error("malformed owned desk activation block")
  }

  let blockEnd = end.index + end[0].length
  if (content[blockEnd] === "\n") {
    blockEnd += 1
  }
  return {
    start: begin.index,
    end: blockEnd,
  }
}

function removeOwnedActivationBlock(content) {
  const ownedBlock = findOwnedActivationBlock(content)
  if (!ownedBlock) {
    return content
  }
  return `${content.slice(0, ownedBlock.start)}${content.slice(ownedBlock.end)}`
}

function trimTrailingLineBreaks(content) {
  return content.replace(/(?:\r?\n)+$/u, "")
}

function mergeOwnedActivationBlock(existingContent, ownedBlock) {
  const userContent = trimTrailingLineBreaks(removeOwnedActivationBlock(existingContent))
  if (!userContent) {
    return ownedBlock
  }
  return `${userContent}\n\n${ownedBlock}`
}

function sectionHasDisabledEnabled(content, sectionName) {
  let inSection = false
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.startsWith("[") && line.endsWith("]")) {
      inSection = line === sectionName
    } else if (inSection && /^enabled\s*=\s*false\b/u.test(line)) {
      return true
    }
  }
  return false
}

function assertNoUserDisabledDeskConfig(config) {
  if (
    sectionHasDisabledEnabled(config, DESK_PLUGIN_SECTION) ||
    sectionHasDisabledEnabled(config, DESK_PLUGIN_MCP_SECTION)
  ) {
    throw new Error(
      "user-authored disabled Desk config must be removed before automatic Desk activation",
    )
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
  const configWithoutOwnedBlock = removeOwnedActivationBlock(input.existingConfig)
  assertNoUserDisabledDeskConfig(configWithoutOwnedBlock)
  const generatedConfig = mergeOwnedActivationBlock(input.existingConfig, renderConfigBlock(input, modeConfig))
  const instructionsBlock = renderInstructionsBlock(input, modeConfig)
  const generatedInstructions = instructionsBlock
    ? mergeOwnedActivationBlock(input.existingInstructions, instructionsBlock)
    : ""
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
