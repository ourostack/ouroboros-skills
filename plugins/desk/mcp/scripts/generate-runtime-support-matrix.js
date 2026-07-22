#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  generateRuntimeSupportMatrix,
  runtimeSupportMatrixPath,
} from "../src/runtime/runtime-deps.js"
import { runIfEntrypoint } from "../index.js"

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export function generateRuntimeSupportMatrixCli({ mcpRoot = MCP_ROOT } = {}) {
  const packageJson = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8"))
  const packageLock = JSON.parse(readFileSync(path.join(mcpRoot, "package-lock.json"), "utf8"))
  const matrix = generateRuntimeSupportMatrix({ mcpRoot, packageJson, packageLock })
  const matrixPath = runtimeSupportMatrixPath({ mcpRoot, packageJson })
  mkdirSync(path.dirname(matrixPath), { recursive: true })
  writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`, "utf8")
  console.log(matrixPath)
  return matrixPath
}

runIfEntrypoint({
  moduleUrl: import.meta.url,
  launch: generateRuntimeSupportMatrixCli,
})
