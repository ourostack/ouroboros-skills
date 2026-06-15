import {
  readFileSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

export const COPILOT_BUNDLE_SCHEMA_VERSION = 1

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(moduleDir, "..", "..", "..", "..", "..")
const activationManifestPath = "plugins/desk/activation/desk.activation.json"
const deskPluginPath = "plugins/desk/plugin.json"
const workSuitePluginPath = "plugins/work-suite/plugin.json"
const outputPath = "plugins/desk/activation/copilot-root.flattened-bundle.json"
const generatorCommand =
  "npm --prefix plugins/desk/mcp run activation:copilot-bundle:generate"

export function buildCopilotBundle({ activation }) {
  const workSuiteDependency = activation.dependencies.find((dependency) => (
    dependency.id === "work-suite"
  ))

  return {
    schema_version: COPILOT_BUNDLE_SCHEMA_VERSION,
    host: "copilot-root",
    generated_by: generatorCommand,
    generated_from: {
      activation_manifest: activationManifestPath,
      desk_plugin: deskPluginPath,
      work_suite_plugin: workSuitePluginPath,
    },
    launch: {
      agent: "plugins/desk/agents/worker.agent.md",
      mcp: "plugins/desk/.mcp.json",
    },
    dependency_closure: [
      {
        id: "desk",
        version: activation.version,
        plugin: deskPluginPath,
        skills: "plugins/desk/skills/",
        agents: "plugins/desk/agents/",
        mcpServers: "plugins/desk/.mcp.json",
      },
      {
        id: "work-suite",
        version: workSuiteDependency.lock.version,
        plugin: workSuitePluginPath,
        skills: "plugins/work-suite/skills/",
      },
    ],
    manual_steps: [],
  }
}

export function generateCopilotBundleArtifact() {
  const activation = readJson(activationManifestPath)
  const bundle = buildCopilotBundle({ activation })
  writeFileSync(repoPath(outputPath), `${JSON.stringify(bundle, null, 2)}\n`, "utf8")
  return {
    outputPath,
    bundle,
  }
}

export function runCopilotBundleGenerator() {
  const result = generateCopilotBundleArtifact()
  process.stdout.write(`wrote ${result.outputPath}\n`)
  return 0
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(repoPath(relativePath), "utf8"))
}

function repoPath(relativePath) {
  return path.join(defaultRepoRoot, relativePath)
}
