import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const packageLockPath = path.join(mcpRoot, "package-lock.json")
const generatedArtifactsScriptPath = path.join(repoRoot, "scripts", "test-desk-generated-artifacts.cjs")
const workflowPath = path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml")
const require = createRequire(import.meta.url)
const generatedArtifacts = require(generatedArtifactsScriptPath)

async function loadRuntimeDeps() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")))
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function repoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/")
}

function gitTracksFile(filePath) {
  const result = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", "--", repoPath(filePath)],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
  return (result.status ?? 1) === 0
}

test("production runtime dependency pack is committed at the current canonical path", async () => {
  const {
    deriveRuntimeDependencyPackPaths,
    productionDependencyLockHash,
    verifyRuntimeDependencyPack,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  const target = `${process.platform}-${process.arch}-node-${process.versions.modules}`
  const paths = deriveRuntimeDependencyPackPaths({
    mcpRoot,
    packageJson,
    packageLock,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
  })
  const expectedPackDir = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    target,
    prodDependencyLockHash,
  )
  const requiredFiles = [
    paths.archivePath,
    paths.manifestPath,
    paths.checksumPath,
  ]

  assert.equal(paths.packDir, expectedPackDir)
  assert.equal(repoPath(paths.packDir).startsWith("plugins/desk/mcp/artifacts/runtime-deps/"), true)
  assert.equal(repoPath(paths.packDir).includes("__tests__/fixtures"), false)
  assert.deepEqual(
    requiredFiles.filter((filePath) => !existsSync(filePath)).map(repoPath),
    [],
    "production runtime dependency pack files must be present under the canonical current lock path",
  )
  assert.deepEqual(
    requiredFiles.filter((filePath) => !gitTracksFile(filePath)).map(repoPath),
    [],
    "production runtime dependency pack files must be tracked by git, not generated only in a local workspace",
  )

  const verification = verifyRuntimeDependencyPack({
    packDir: paths.packDir,
    mcpRoot,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
  })
  assert.deepEqual(verification.errors, [])
  assert.equal(verification.ok, true)
})

test("production runtime dependency pack manifest records freshness and dependency-only provenance", async () => {
  const expectation = await generatedArtifacts.productionRuntimePackExpectation({
    repoRoot,
    mcpRoot,
  })
  assert.equal(
    existsSync(expectation.paths.manifestPath),
    true,
    `production runtime dependency pack manifest must exist at ${repoPath(expectation.paths.manifestPath)}`,
  )
  const manifest = loadJson(expectation.paths.manifestPath)
  const packageJson = loadJson(packageJsonPath)

  assert.equal(manifest.schema_version, 1)
  assert.equal(manifest.plugin.name, packageJson.name)
  assert.equal(manifest.plugin.version, packageJson.version)
  assert.equal(manifest.platform.os, process.platform)
  assert.equal(manifest.platform.arch, process.arch)
  assert.equal(manifest.platform.node_abi, process.versions.modules)
  assert.equal(manifest.package_lock.path, "plugins/desk/mcp/package-lock.json")
  assert.equal(manifest.package_lock.sha256, sha256(readFileSync(packageLockPath)))
  assert.equal(manifest.package_lock.prod_dependency_lock_hash, expectation.prodDependencyLockHash)
  assert.match(manifest.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  assert.equal(manifest.provenance.builder, "runtime:deps-pack:build")
  assert.match(manifest.provenance.source, /\S/u)
  assert.doesNotMatch(manifest.provenance.source, /fixture|test-only/u)
  assert.equal(manifest.archive.file, "runtime-deps.tgz")
  assert.equal(manifest.archive.sha256, sha256(readFileSync(expectation.paths.archivePath)))
  assert.equal(manifest.archive.contains_server_source, false)
  assert.deepEqual(
    [...manifest.archive.root_entries].sort(),
    [
      "node_modules/",
      "package.json",
      "package-lock.json",
      "runtime-deps.manifest.json",
    ].sort(),
  )
})

test("generated artifact freshness script verifies the production runtime dependency pack", () => {
  const result = spawnSync(
    process.execPath,
    [generatedArtifactsScriptPath],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test("CI checks committed generated artifacts before rebuilding runtime dependency packs", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  const generatedArtifactCheck = workflow.indexOf("node scripts/test-desk-generated-artifacts.cjs")
  const runtimePackBuild = workflow.indexOf("runtime:deps-pack:build")

  assert.notEqual(generatedArtifactCheck, -1, "desk MCP workflow must run the generated artifact verifier")
  assert.notEqual(runtimePackBuild, -1, "desk MCP workflow must still build runtime dependency packs")
  assert.ok(
    generatedArtifactCheck < runtimePackBuild,
    "committed generated artifacts must be checked before CI creates fresh local runtime dependency packs",
  )
})
