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
import { resolveDeskRootWithSource } from "./src/util/paths.js"

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

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  homeDir,
  mcpRoot = path.dirname(fileURLToPath(import.meta.url)),
  runtimeImporter = importRuntimeServer,
} = {}) {
  const args = parseArgs(argv)
  const { root: deskRoot } = resolveStartupDeskRoot({ args, env, homeDir })
  const { startServer } = await runtimeImporter({
    mcpRoot,
  })
  await startServer({ deskRoot, person: args.person })
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
