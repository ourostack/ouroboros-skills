#!/usr/bin/env node

import { runSnapshotVerifyCli } from "../src/artifacts/artifact-scripts.js"

process.exitCode = await runSnapshotVerifyCli()
