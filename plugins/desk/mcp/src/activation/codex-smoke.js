import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs"
import * as path from "node:path"

import { applyCodexActivation } from "./adapters/codex.js"

const CODEX_HOME_DIR = ".codex"
const DEFAULT_MODE = "global-personal"
const PROJECT_DESK_ROOT = ".desk"
const MANUAL_ONLY_REASON = "manual-only opt-out"
const STACK_FRAME_PATTERN = /^\s*at (?:async )?\S.*(?:\r?\n|$)/gmu

const smokePrompt = [
  "Report the current instructions you loaded, list available MCP tool names,",
  "call desk_status, and return one JSON object with instruction_sources,",
  "combined_instructions, tools, and desk_status.",
].join(" ")

function readTextFile(filePath) {
  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf8")
  }
  return ""
}

function hostPath(hostRoot, artifactPath) {
  if (artifactPath === null) {
    return null
  }
  const relativePath = artifactPath.startsWith("~/")
    ? artifactPath.slice(2)
    : artifactPath
  return path.join(hostRoot, relativePath)
}

function activationContext({ hostRoot, workspaceRoot, mode }) {
  const codexHome = path.join(hostRoot, CODEX_HOME_DIR)
  if (mode === "project-local") {
    return {
      activationHostRoot: workspaceRoot,
      actualDeskRoot: path.join(workspaceRoot, PROJECT_DESK_ROOT),
      adapterDeskRoot: PROJECT_DESK_ROOT,
      codexHome,
      runtimeCacheDir: path.join(workspaceRoot, ".codex", "desk-runtime-cache"),
    }
  }

  const deskRoot = path.join(hostRoot, "desk")
  return {
    activationHostRoot: hostRoot,
    actualDeskRoot: deskRoot,
    adapterDeskRoot: deskRoot,
    codexHome,
    runtimeCacheDir: path.join(hostRoot, ".cache", "ouroboros-skills", "desk"),
  }
}

function activationSummary(activationHostRoot, activation, { includeSelectedActivation = false } = {}) {
  const summary = {
    config_path: hostPath(activationHostRoot, activation.configPath),
    activation_config_path: hostPath(activationHostRoot, activation.activationConfigPath),
    instructions_path: hostPath(activationHostRoot, activation.instructionsPath),
    mode: activation.mode,
  }
  if (includeSelectedActivation) {
    summary.selected_activation = activation.selectedActivation
  }
  return summary
}

async function invokeCodexRunner(codexRunner, request) {
  try {
    return await codexRunner(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error?.code === "ENOENT") {
      throw new Error("Codex CLI unavailable: codex binary not found")
    }
    throw new Error(`Codex CLI smoke failed to launch: ${message}`)
  }
}

function assertExitCode(runnerOutput) {
  if (runnerOutput.exitCode !== 0) {
    const stderrSummary = String(runnerOutput.stderr ?? "")
      .replace(STACK_FRAME_PATTERN, "")
      .trim()
      .replace(/\r?\n+/gu, "; ")
    const stderrSuffix = stderrSummary ? `: ${stderrSummary}` : ""
    throw new Error(`Codex CLI smoke failed with exit code ${runnerOutput.exitCode}${stderrSuffix}`)
  }
}

function parseProof(stdout) {
  try {
    const event = JSON.parse(String(stdout).trim().split(/\r?\n/u).at(-1))
    return JSON.parse(event.message)
  } catch (error) {
    throw new Error("Codex CLI smoke output did not contain a parseable final JSON message")
  }
}

function assertDeskStatusProof(proof, deskRoot, selectedActivation = null) {
  const deskStatus = proof.desk_status ?? {}
  const root = deskStatus.root ?? {}
  if (`${deskStatus.status}:${root.path}` !== `ok:${deskRoot}`) {
    throw new Error("Codex CLI smoke did not prove desk_status availability")
  }
  if (selectedActivation) {
    const statusActivation = deskStatus.activation ?? {}
    const statusChain = Array.isArray(statusActivation.chain) ? statusActivation.chain : []
    if (
      statusActivation.selected_id !== selectedActivation.id ||
      statusChain.join(" -> ") !== selectedActivation.chain.map((entry) => entry.id).join(" -> ")
    ) {
      throw new Error("Codex CLI smoke did not prove selected activation desk_status metadata")
    }
  }
}

export async function runCodexCliActivationSmoke({
  repoRoot,
  hostRoot,
  workspaceRoot,
  mode = DEFAULT_MODE,
  manifest: manifestOverride = null,
  selectedActivationId = null,
  cleanupProfile = false,
  codexRunner,
}) {
  const {
    activationHostRoot,
    actualDeskRoot,
    adapterDeskRoot,
    codexHome,
    runtimeCacheDir,
  } = activationContext({ hostRoot, workspaceRoot, mode })
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(codexHome, { recursive: true })
  mkdirSync(actualDeskRoot, { recursive: true })

  try {
    const manifest = manifestOverride ?? JSON.parse(readFileSync(path.join(repoRoot, "plugins", "desk", "activation", "desk.activation.json"), "utf8"))
    const { activation } = applyCodexActivation({
      manifest,
      mode,
      selectedActivationId,
      hostRoot: activationHostRoot,
      existingConfig: readTextFile(hostPath(activationHostRoot, mode === "project-local" ? ".codex/config.toml" : "~/.codex/config.toml")),
      existingInstructions: readTextFile(hostPath(activationHostRoot, mode === "project-local" ? "AGENTS.md" : "~/.codex/AGENTS.md")),
      pluginRoot: path.join(repoRoot, "plugins", "desk"),
      workSuitePluginRoot: path.join(repoRoot, "plugins", "work-suite"),
      deskRoot: adapterDeskRoot,
      runtimeCacheDir,
    })
    const activationPaths = activationSummary(activationHostRoot, activation, {
      includeSelectedActivation: selectedActivationId !== null,
    })

    if (mode === "manual-only") {
      return {
        status: "skipped",
        reason: MANUAL_ONLY_REASON,
        activation: activationPaths,
        manual_setup: {
          codex_mcp_add: false,
          copied_agent_file: false,
          uncontrolled_agents_edit: false,
        },
        real_profile_touched: false,
      }
    }

    const runnerOutput = await invokeCodexRunner(codexRunner, {
      command: "codex",
      args: ["exec", "--json", "--ephemeral", "--cd", workspaceRoot, smokePrompt],
      env: {
        CODEX_HOME: codexHome,
        DESK: actualDeskRoot,
        HOME: hostRoot,
        PATH: process.env.PATH,
      },
      prompt: smokePrompt,
    })
    assertExitCode(runnerOutput)
    const proof = parseProof(runnerOutput.stdout)
    assertDeskStatusProof(
      proof,
      actualDeskRoot,
      selectedActivationId === null ? null : activation.selectedActivation,
    )

    return {
      status: "pass",
      ...proof,
      activation: activationPaths,
      manual_setup: {
        codex_mcp_add: false,
        copied_agent_file: false,
        uncontrolled_agents_edit: false,
      },
      real_profile_touched: false,
    }
  } finally {
    if (cleanupProfile) {
      rmSync(codexHome, { recursive: true, force: true })
    }
  }
}
