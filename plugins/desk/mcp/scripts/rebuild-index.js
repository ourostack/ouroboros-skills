#!/usr/bin/env node
// rebuild-index.js — manual index build for a desk root.
//
// Usage:
//   node scripts/rebuild-index.js --root <path>
//
// Walks the desk, hashes each indexable file, upserts chunks, and (if Ollama
// is reachable at http://localhost:11434) embeds via nomic-embed-text. Soft-
// fails if Ollama isn't around — index gets built with FTS5 only.
//
// Prints a JSON summary on success. Exit non-zero on a real error (disk full,
// schema apply failed, unreachable desk dir).

import { resolveDeskRoot } from "../src/util/paths.js"
import { rebuildIndex } from "../src/indexer/index.js"

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
  const startedAt = Date.now()
  const summary = await rebuildIndex(deskRoot)
  const elapsedMs = Date.now() - startedAt
  console.log(
    JSON.stringify(
      { desk_root: deskRoot, elapsed_ms: elapsedMs, ...summary },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error("[rebuild-index] fatal:", err.message)
  process.exit(1)
})
