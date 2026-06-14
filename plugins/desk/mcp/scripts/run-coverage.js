#!/usr/bin/env node

import { runCoverageCommand } from "../src/coverage/runner.js"

process.exitCode = runCoverageCommand()
