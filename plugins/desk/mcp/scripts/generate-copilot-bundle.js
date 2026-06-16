#!/usr/bin/env node

import { runCopilotBundleGenerator } from "../src/activation/copilot-bundle.js"

process.exitCode = runCopilotBundleGenerator()
