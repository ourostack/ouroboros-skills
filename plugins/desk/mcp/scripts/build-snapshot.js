#!/usr/bin/env node

import { runSnapshotBuildCli } from "../src/artifacts/artifact-scripts.js"

process.exitCode = await runSnapshotBuildCli()
