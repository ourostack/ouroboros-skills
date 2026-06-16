#!/usr/bin/env node

import { runSupportMatrixGenerator } from "../src/activation/support-matrix.js"

process.exitCode = runSupportMatrixGenerator()
