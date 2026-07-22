#!/usr/bin/env node

import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyRuntimeSupportMatrix } from "../src/runtime/runtime-deps.js"

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8"))
const packageLock = JSON.parse(readFileSync(path.join(mcpRoot, "package-lock.json"), "utf8"))
const result = verifyRuntimeSupportMatrix({ mcpRoot, packageJson, packageLock })
if (!result.ok) {
  for (const error of result.errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`runtime support matrix verified (${result.matrix.targets.length} targets)`)
}
