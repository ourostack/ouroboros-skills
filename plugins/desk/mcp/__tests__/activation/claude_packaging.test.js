import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)

function readText(...segments) {
  return readFileSync(path.join(repoRoot, ...segments), "utf8")
}

function loadJson(...segments) {
  return JSON.parse(readText(...segments))
}

function parseSimpleFrontmatter(...segments) {
  const text = readText(...segments)
  const match = text.match(/^---\n([\s\S]*?)\n---/u)
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

test("Claude plugin metadata declares native Desk surfaces and Work Suite dependency", () => {
  const deskPlugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
  const workSuitePlugin = loadJson("plugins", "work-suite", ".claude-plugin", "plugin.json")

  assert.equal(deskPlugin.skills, "./skills/")
  assert.deepEqual(deskPlugin.agents, ["./agents/worker.md"])
  assert.equal(deskPlugin.mcpServers, "./.mcp.json")
  assert.equal(deskPlugin.hooks, "./hooks/hooks.json")
  assert.equal(deskPlugin.outputStyles, "./output-styles/")
  assert.deepEqual(deskPlugin.dependencies, [
    {
      name: "work-suite",
      version: "^1.4.0",
    },
  ])
  assert.equal(deskPlugin.activation?.claude?.dependencies?.["work-suite"]?.resolution, "native")
  assert.equal(deskPlugin.activation?.claude?.dependencies?.["work-suite"]?.version, workSuitePlugin.version)
})

test("Work Suite Claude metadata declares itself as a native dependency provider", () => {
  const workSuitePlugin = loadJson("plugins", "work-suite", ".claude-plugin", "plugin.json")

  assert.equal(workSuitePlugin.skills, "./skills/")
  assert.deepEqual(workSuitePlugin.activation?.claude?.dependencyProvider, {
    id: "work-suite",
    version: workSuitePlugin.version,
    resolution: "native",
  })
})

test("Claude worker agent is exposed without unsupported scoped permission fields", () => {
  const worker = parseSimpleFrontmatter("plugins", "desk", "agents", "worker.md")

  assert.equal(worker.name, "worker")
  assert.equal(worker.model, "inherit")
  assert.equal(worker.background, false)
  assert.equal(worker.initialPrompt, "Run the `desk:session-start` skill before any other work.")
  assert.equal(Object.hasOwn(worker, "hooks"), false)
  assert.equal(Object.hasOwn(worker, "mcpServers"), false)
  assert.equal(Object.hasOwn(worker, "permissionMode"), false)
})

test("Claude activation metadata records Agent View and background-session disposition", () => {
  const deskPlugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")

  assert.deepEqual(deskPlugin.activation?.claude?.targets?.["desk:worker"], {
    default: true,
    source: "agents/worker.md",
    activationSurface: "plugin-agent",
  })
  assert.deepEqual(deskPlugin.activation?.claude?.nativeSurfaces, [
    "skills",
    "agents",
    "hooks",
    "mcpServers",
    "outputStyles",
    "dependencies",
  ])
  assert.deepEqual(deskPlugin.activation?.claude?.agentView, {
    status: "supported-with-version-floor",
    minimumClaudeCodeVersion: "2.1.157",
    foregroundLaunch: "claude --agent desk:worker",
    backgroundLaunch: "claude --agent desk:worker --bg",
    agentViewLaunch: "claude agents --agent desk:worker",
    inheritsPluginContext: true,
  })
})

test("Claude packaging documents its permission and capability boundary", () => {
  const deskPlugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")

  assert.deepEqual(deskPlugin.activation?.claude?.permissionBoundary, {
    requestedCapabilities: ["Read", "Write", "Interactive"],
    generatedArtifacts: [],
    neverDelete: ["desk-root-data"],
    unsupportedAgentScopedFields: ["hooks", "mcpServers", "permissionMode"],
  })
  assert.deepEqual(deskPlugin.activation?.claude?.mcpServers?.desk, {
    launch: "plugin-bundled",
    manualRegistration: false,
    configPath: ".mcp.json",
  })
})

test("Claude hook and MCP configuration stay plugin-relative and non-manual", () => {
  const hooks = loadJson("plugins", "desk", "hooks", "hooks.json")
  const mcp = loadJson("plugins", "desk", ".mcp.json")

  assert.equal(hooks.hooks.SessionStart[0].matcher, "startup|resume|clear")
  assert.equal(
    hooks.hooks.SessionStart[0].hooks[0].command,
    "bash ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh",
  )
  assert.deepEqual(mcp.mcpServers.desk, {
    type: "stdio",
    command: "node",
    args: ["./mcp/index.js"],
    env: {},
  })
})

test("Claude-facing manifests stay version-aligned with activation and marketplace metadata", () => {
  const activation = loadJson("plugins", "desk", "activation", "desk.activation.json")
  const deskClaude = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
  const deskCodex = loadJson("plugins", "desk", ".codex-plugin", "plugin.json")
  const workSuiteClaude = loadJson("plugins", "work-suite", ".claude-plugin", "plugin.json")
  const workSuiteCodex = loadJson("plugins", "work-suite", ".codex-plugin", "plugin.json")

  assert.equal(deskClaude.version, activation.version)
  assert.equal(deskClaude.version, deskCodex.version)
  assert.equal(deskClaude.version, marketplacePlugin("desk").version)
  assert.equal(workSuiteClaude.version, workSuiteCodex.version)
  assert.equal(workSuiteClaude.version, marketplacePlugin("work-suite").version)
  assert.equal(workSuiteClaude.version, activation.dependencies.find((dependency) => (
    dependency.id === "work-suite"
  )).lock.version)
})
