#!/usr/bin/env node

import { runRuntimeDependencyPackVerifyCli } from "../src/runtime/runtime-deps.js"

process.exitCode = runRuntimeDependencyPackVerifyCli()
