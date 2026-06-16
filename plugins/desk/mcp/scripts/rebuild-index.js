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

import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { rebuildIndex } from "../src/indexer/index.js"
import { resolveDeskRoot } from "../src/util/paths.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultPluginRoot = path.resolve(moduleDir, "..", "..")

export function parseArgs(argv) {
  const args = { root: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      args.root = argv[++i]
    }
  }
  return args
}

export function resolvePluginRoot(env = process.env, fallback = defaultPluginRoot) {
  return env.DESK_PLUGIN_ROOT || fallback
}

export async function runRebuildIndexCommand({
  argv = process.argv.slice(2),
  env = process.env,
  now = Date.now,
  rebuild = rebuildIndex,
  write = console.log,
} = {}) {
  const args = parseArgs(argv)
  const deskRoot = resolveDeskRoot(args.root)
  const pluginRoot = resolvePluginRoot(env)
  const startedAt = now()
  const summary = await rebuild(deskRoot, {
    tombstones: { pluginRoot },
  })
  const elapsedMs = now() - startedAt
  const output = { desk_root: deskRoot, elapsed_ms: elapsedMs, ...summary }
  write(
    JSON.stringify(
      output,
      null,
      2,
    ),
  )
  return output
}

export async function main(options = {}) {
  return runRebuildIndexCommand(options)
}

export function handleFatalError(err, {
  logError = console.error,
  exit = process.exit,
} = {}) {
  logError("[rebuild-index] fatal:", err.message)
  exit(1)
}

export function isMainModule(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false
  const moduleUrl = new URL(importMetaUrl)
  moduleUrl.search = ""
  moduleUrl.hash = ""
  return moduleUrl.href === pathToFileURL(argv1).href
}

export function startCli({
  importMetaUrl = import.meta.url,
  argv1 = process.argv[1],
  mainFn = main,
  onFatal = handleFatalError,
} = {}) {
  if (!isMainModule(importMetaUrl, argv1)) return null
  return mainFn().catch(onFatal)
}

startCli()
