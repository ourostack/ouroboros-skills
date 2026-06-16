#!/usr/bin/env node

import { runVectorPackBuildCli } from "../src/artifacts/artifact-scripts.js"

process.exitCode = await runVectorPackBuildCli()
