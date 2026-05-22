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

import { startServer } from "./src/server.js"
import { resolveDeskRoot } from "./src/util/paths.js"

function parseArgs(argv) {
  const args = { root: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      args.root = argv[++i]
    }
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const deskRoot = resolveDeskRoot(args.root)
  await startServer({ deskRoot })
}

main().catch((err) => {
  console.error("[desk-mcp] fatal:", err.message)
  process.exit(1)
})
