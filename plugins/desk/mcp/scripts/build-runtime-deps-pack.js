#!/usr/bin/env node

import { runRuntimeDependencyPackBuildCli } from "../src/runtime/runtime-deps.js"

process.exitCode = runRuntimeDependencyPackBuildCli()
