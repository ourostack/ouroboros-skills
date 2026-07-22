import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import {
  generateRuntimeSupportMatrixCli,
} from "../../scripts/generate-runtime-support-matrix.js"
import {
  validateArtifactsCli,
} from "../../scripts/validate-artifacts.js"
import {
  runRuntimeSupportMatrixVerifier,
  verifyRuntimeSupportMatrixCli,
} from "../../scripts/verify-runtime-support-matrix.js"

function makeRuntimeFixture() {
  const mcpRoot = mkdtempSync(path.join(tmpdir(), "desk-runtime-cli-"))
  const packageJson = {
    name: "@fixture/desk-mcp",
    version: "1.0.0",
  }
  writeFileSync(path.join(mcpRoot, "package.json"), JSON.stringify(packageJson), "utf8")
  writeFileSync(path.join(mcpRoot, "package-lock.json"), "{}\n", "utf8")
  const targetId = "linux-x64-node-127"
  const lockHash = "a".repeat(64)
  const packDir = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    targetId,
    lockHash,
  )
  mkdirSync(packDir, { recursive: true })
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), "fixture archive", "utf8")
  writeFileSync(path.join(packDir, "runtime-deps.manifest.json"), JSON.stringify({
    platform: {
      os: "linux",
      arch: "x64",
      node_abi: "127",
    },
    package_lock: {
      prod_dependency_lock_hash: lockHash,
    },
  }), "utf8")
  return mcpRoot
}

test("runtime support matrix CLI functions are importable and preserve command outcomes", async () => {
  const mcpRoot = makeRuntimeFixture()
  try {
    const matrixPath = generateRuntimeSupportMatrixCli({ mcpRoot })
    assert.equal(JSON.parse(readFileSync(matrixPath, "utf8")).targets.length, 1)
    assert.equal(verifyRuntimeSupportMatrixCli({ mcpRoot }), 0)
    assert.equal(await validateArtifactsCli({
      artifactArgv: ["--help"],
      mcpRoot,
    }), 0)

    writeFileSync(matrixPath, "{}\n", "utf8")
    assert.equal(verifyRuntimeSupportMatrixCli({ mcpRoot }), 1)
    assert.equal(await validateArtifactsCli({
      artifactArgv: ["--help"],
      mcpRoot,
    }), 1)
  } finally {
    rmSync(mcpRoot, { recursive: true, force: true })
  }
})

test("runtime support matrix CLI defaults operate on the installed MCP root", async () => {
  const matrixPath = generateRuntimeSupportMatrixCli()
  assert.equal(verifyRuntimeSupportMatrixCli(), 0)
  const previousExitCode = process.exitCode
  runRuntimeSupportMatrixVerifier()
  assert.equal(process.exitCode, 0)
  process.exitCode = previousExitCode
  assert.equal(await validateArtifactsCli({ artifactArgv: ["--help"] }), 0)
  assert.equal(JSON.parse(readFileSync(matrixPath, "utf8")).schema_version, 1)
})

test("artifact validation still runs when support-matrix verification fails", async () => {
  const mcpRoot = makeRuntimeFixture()
  const errors = []
  let artifactArgv
  try {
    assert.equal(await validateArtifactsCli({
      artifactArgv: ["--root", "fixture"],
      mcpRoot,
      supportVerifier: () => ({
        ok: false,
        errors: ["support matrix failed"],
      }),
      artifactValidator: async ({ argv }) => {
        artifactArgv = argv
        return 0
      },
      io: {
        error: (message) => errors.push(message),
      },
    }), 1)
    assert.deepEqual(artifactArgv, ["--root", "fixture"])
    assert.deepEqual(errors, ["support matrix failed"])
  } finally {
    rmSync(mcpRoot, { recursive: true, force: true })
  }
})
