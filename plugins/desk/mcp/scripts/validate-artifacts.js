#!/usr/bin/env node

import { runArtifactValidateCli } from "../src/artifacts/artifact-scripts.js"

process.exitCode = await runArtifactValidateCli()
