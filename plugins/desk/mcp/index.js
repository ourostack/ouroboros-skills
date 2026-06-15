#!/usr/bin/env node
// desk MCP server entry point.
//
// Spawned by consumers as a stdio MCP server with `--root <path>` pointing
// at the desk workspace to operate on. Consumers wire this up via the
// sibling `.mcp.json` declaration.
//
//   node ./mcp/index.js --root ~/AgentBundles/slugger.ouro/desk
//
// The same binary serves every consumer (Claude Code worker, Copilot CLI,
// ouroboros daemon per agent). Each consumer passes a different --root.

import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"
import { importRuntimeServer } from "./src/runtime/bootstrap.js"
import { expandHome, loadActivationConfig, resolveDeskRootWithSource } from "./src/util/paths.js"

const STARTUP_INDEX_BUDGET_MS = 250

export function parseArgs(argv) {
  const args = { root: null, person: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      args.root = argv[++i]
    } else if (argv[i] === "--host-session-root" && argv[i + 1]) {
      args.hostSessionRoot = argv[++i]
    } else if (argv[i] === "--person" && argv[i + 1]) {
      args.person = argv[++i]
    } else if (argv[i] === "--activation-config" && argv[i + 1]) {
      args.activationConfig = argv[++i]
    }
  }
  return args
}

export function resolveStartupDeskRoot({ args, env = process.env, homeDir } = {}) {
  return resolveDeskRootWithSource({
    activationConfigPath: args?.activationConfig,
    env,
    explicitRoot: args?.root,
    homeDir,
    hostSessionRoot: args?.hostSessionRoot,
  })
}

export function resolveStartupRuntimeCacheDir({
  args,
  cwd = process.cwd(),
  homeDir,
} = {}) {
  if (!hasText(args?.activationConfig)) {
    return null
  }
  const activationConfig = loadActivationConfig({
    configPath: args.activationConfig,
    cwd,
    homeDir,
  })
  if (!hasText(activationConfig.runtimeCacheDir)) {
    return null
  }
  const expanded = expandHome(activationConfig.runtimeCacheDir, homeDir)
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded))
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  homeDir,
  mcpRoot = path.dirname(fileURLToPath(import.meta.url)),
  runtimeImporter = importRuntimeServer,
} = {}) {
  const args = parseArgs(argv)
  const rootResolution = resolveStartupDeskRoot({ args, env, homeDir })
  const { root: deskRoot } = rootResolution
  const runtimeCacheDir = resolveStartupRuntimeCacheDir({ args, cwd, homeDir })
  const runtimeServer = await runtimeImporter({
    env,
    mcpRoot,
    runtimeCacheDir,
  })
  const runtimeStatus = runtimeServer._deskRuntime ?? {
    runtime_cache_dir: runtimeCacheDir,
    source_mirror_path: null,
    target: null,
    loaded_from_source_mirror: false,
  }
  const startupStatus = await runStartupEnsureIndex({
    budgetMs: STARTUP_INDEX_BUDGET_MS,
    deskRoot,
    runtimeServer,
  })
  await runtimeServer.startServer({
    deskRoot,
    person: args.person,
    statusContext: {
      root: rootResolution,
      runtime: runtimeStatus,
      startup: startupStatus,
    },
  })
}

async function runStartupEnsureIndex({ budgetMs, deskRoot, runtimeServer }) {
  if (!hasText(deskRoot) || typeof runtimeServer.ensureIndex !== "function") {
    return {
      fallback_mode: "not_checked",
      degraded: false,
      duration_ms: 0,
      budget_ms: budgetMs,
    }
  }
  const startedAt = Date.now()
  let ensureIndexResult
  try {
    ensureIndexResult = await runtimeServer.ensureIndex(deskRoot, {
      startup: true,
      budgetMs,
      skipEmbed: true,
    })
  } catch (err) {
    ensureIndexResult = {
      built: false,
      reason: "startup_error",
      error: {
        message: err?.message ?? String(err),
      },
    }
  }
  const fallbackMode = inferStartupFallbackMode(ensureIndexResult)
  return {
    ensure_index: ensureIndexResult,
    duration_ms: Date.now() - startedAt,
    budget_ms: budgetMs,
    fallback_mode: fallbackMode,
    degraded: startupIsDegraded(ensureIndexResult, fallbackMode),
  }
}

function inferStartupFallbackMode(ensureIndexResult) {
  if (ensureIndexResult?.fallback === "vector_packs" && ensureIndexResult?.snapshot?.restored) {
    return "snapshot_then_vector_packs"
  }
  if (ensureIndexResult?.fallback === "vector_packs") return "vector_packs"
  if (
    ensureIndexResult?.semantic?.missing_vectors > 0
  ) {
    return "lexical_only"
  }
  if (ensureIndexResult?.snapshot?.restored) return "snapshot"
  if (ensureIndexResult?.reason === "startup_error") return "startup_error"
  return ensureIndexResult?.built ? "rebuild" : "fresh"
}

function startupIsDegraded(ensureIndexResult, fallbackMode) {
  return fallbackMode === "lexical_only" ||
    fallbackMode === "startup_error" ||
    ensureIndexResult?.semantic?.embedding_available === false ||
    ensureIndexResult?.semantic?.missing_vectors > 0
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

export function isEntrypoint({
  argv = process.argv,
  moduleUrl = import.meta.url,
  realpath = realpathSync,
} = {}) {
  if (!argv[1]) {
    return false
  }
  const modulePath = fileURLToPath(moduleUrl)
  try {
    return realpath(modulePath) === realpath(argv[1])
  } catch {
    return path.resolve(modulePath) === path.resolve(argv[1])
  }
}

export function runIfEntrypoint({
  argv = process.argv,
  moduleUrl = import.meta.url,
  launch = main,
  stderr = process.stderr,
  exit = process.exit,
} = {}) {
  if (!isEntrypoint({ argv, moduleUrl })) return null
  return launch().catch((err) => {
    stderr.write(`[desk-mcp] fatal: ${err.message}\n`)
    exit(1)
  })
}

// Only launch the server when run as the entry point, not when imported
// (tests import `parseArgs` without spawning a stdio server).
runIfEntrypoint()
