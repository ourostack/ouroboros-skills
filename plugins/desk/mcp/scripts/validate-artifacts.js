#!/usr/bin/env node

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { isEntrypoint } from "../index.js"
import { runArtifactValidateCli } from "../src/artifacts/artifact-scripts.js"
import { verifyRuntimeSupportMatrix } from "../src/runtime/runtime-deps.js"

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export async function validateArtifactsCli({
  artifactArgv = process.argv.slice(2),
  mcpRoot = MCP_ROOT,
  artifactValidator = runArtifactValidateCli,
  supportVerifier = verifyRuntimeSupportMatrix,
  io = console,
} = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8"))
  const packageLock = JSON.parse(readFileSync(path.join(mcpRoot, "package-lock.json"), "utf8"))
  const support = supportVerifier({ mcpRoot, packageJson, packageLock })
  if (!support.ok) {
    for (const error of support.errors) io.error(error)
  }
  const artifactExitCode = await artifactValidator({ argv: artifactArgv })
  return support.ok ? artifactExitCode : 1
}

if (isEntrypoint({ argv: process.argv, moduleUrl: import.meta.url })) {
  process.exitCode = await validateArtifactsCli()
}
