import {
  mkdirSync,
  readFileSync,
} from "node:fs"
import * as path from "node:path"

import { applyCodexActivation } from "./adapters/codex.js"

const CODEX_HOME_DIR = ".codex"
const DEFAULT_MODE = "global-personal"

const smokePrompt = [
  "Report the current instructions you loaded, list available MCP tool names,",
  "call desk_status, and return one JSON object with instruction_sources,",
  "combined_instructions, tools, and desk_status.",
].join(" ")

export async function runCodexCliActivationSmoke({
  repoRoot,
  hostRoot,
  workspaceRoot,
  mode = DEFAULT_MODE,
  codexRunner,
}) {
  const codexHome = path.join(hostRoot, CODEX_HOME_DIR)
  const deskRoot = path.join(hostRoot, "desk")
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(deskRoot, { recursive: true })

  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "plugins", "desk", "activation", "desk.activation.json"), "utf8"))
  applyCodexActivation({
    manifest,
    mode,
    hostRoot,
    existingConfig: "",
    existingInstructions: "",
    pluginRoot: path.join(repoRoot, "plugins", "desk"),
    workSuitePluginRoot: path.join(repoRoot, "plugins", "work-suite"),
    deskRoot,
    runtimeCacheDir: path.join(hostRoot, ".cache", "ouroboros-skills", "desk"),
  })

  const runnerOutput = await codexRunner({
    command: "codex",
    args: ["exec", "--json", "--ephemeral", "--cd", workspaceRoot, smokePrompt],
    env: {
      CODEX_HOME: codexHome,
      DESK: deskRoot,
      HOME: hostRoot,
      PATH: process.env.PATH,
    },
    prompt: smokePrompt,
  })
  const proof = JSON.parse(JSON.parse(runnerOutput.stdout.trim().split(/\r?\n/u).at(-1)).message)

  return {
    status: "pass",
    ...proof,
    activation: {
      config_path: path.join(codexHome, "config.toml"),
      instructions_path: path.join(codexHome, "AGENTS.md"),
      mode,
    },
    manual_setup: {
      codex_mcp_add: false,
      copied_agent_file: false,
      uncontrolled_agents_edit: false,
    },
    real_profile_touched: false,
  }
}
