#!/usr/bin/env node

import { readProfileInput } from "../src/measurement/profile-input.js"
import { buildWorkProfile, renderWorkProfile } from "../src/measurement/work-profile.js"

try {
  const args = process.argv.slice(2)
  const options = new Map([[args[0], args[1]], [args[2], args[3]]])
  if (args.length !== 4 || options.size !== 2 || !options.has("--input") || !["json", "markdown"].includes(options.get("--format"))) {
    throw new Error("Usage: profile-work.js --input <snapshot.json> --format json|markdown")
  }
  const result = renderWorkProfile(buildWorkProfile(readProfileInput(options.get("--input"))), options.get("--format"))
  process.stdout.write(result)
} catch (error) {
  process.stderr.write(`profile-work: ${error.code ?? error.message}\n`)
  process.exitCode = 1
}
