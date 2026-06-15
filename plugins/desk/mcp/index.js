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
import { resolveDeskRoot } from "./src/util/paths.js"

export function parseArgs(argv) {
  const args = { root: null, person: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      args.root = argv[++i]
    } else if (argv[i] === "--person" && argv[i + 1]) {
      args.person = argv[++i]
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const deskRoot = resolveDeskRoot(args.root)
  const { startServer } = await importRuntimeServer({
    mcpRoot: path.dirname(fileURLToPath(import.meta.url)),
  })
  await startServer({ deskRoot, person: args.person })
}

function isEntrypoint() {
  if (!process.argv[1]) {
    return false
  }
  const modulePath = fileURLToPath(import.meta.url)
  try {
    return realpathSync(modulePath) === realpathSync(process.argv[1])
  } catch {
    return path.resolve(modulePath) === path.resolve(process.argv[1])
  }
}

// Only launch the server when run as the entry point, not when imported
// (tests import `parseArgs` without spawning a stdio server).
if (isEntrypoint()) {
  main().catch((err) => {
    console.error("[desk-mcp] fatal:", err.message)
    process.exit(1)
  })
}
