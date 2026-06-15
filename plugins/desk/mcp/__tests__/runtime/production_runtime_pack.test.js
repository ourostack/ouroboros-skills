import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

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

function workflowJob(workflow, jobName) {
  const lines = workflow.split(/\r?\n/u)
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`)
  assert.notEqual(jobStart, -1, `workflow must define job ${jobName}`)
  const jobEnd = lines.findIndex((line, index) => (
    index > jobStart
    && /^  [A-Za-z0-9_-]+:\s*$/u.test(line)
  ))
  return lines.slice(jobStart, jobEnd === -1 ? lines.length : jobEnd).join("\n")
}

function workflowStepBlocks(jobSection) {
  const blocks = []
  let currentBlock
  for (const line of jobSection.split(/\r?\n/u)) {
    if (/^      - /u.test(line)) {
      if (currentBlock !== undefined) {
        blocks.push(currentBlock.join("\n"))
      }
      currentBlock = [line]
      continue
    }
    if (currentBlock !== undefined) {
      currentBlock.push(line)
    }
  }
  if (currentBlock !== undefined) {
    blocks.push(currentBlock.join("\n"))
  }
  return blocks
}

function workflowStepRunText(stepBlock) {
  const lines = stepBlock.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^\s*run:\s+(.+?)\s*$/u)
    if (inline !== null && inline[1] !== "|" && inline[1] !== ">") {
      return inline[1]
    }
    if (/^\s*run:\s*[|>]\s*$/u.test(lines[index])) {
      return lines
        .slice(index + 1)
        .filter((line) => /^\s{10,}\S/u.test(line))
        .map((line) => line.replace(/^\s{10}/u, ""))
        .join("\n")
    }
  }
  return ""
}

function workflowStepWorkingDirectory(stepBlock) {
  const match = stepBlock.match(/^\s*working-directory:\s+(.+?)\s*$/mu)
  return match?.[1]?.replace(/^["']|["']$/gu, "")
}

function workflowStepAllowsFailure(stepBlock) {
  const match = stepBlock.match(/^\s*continue-on-error:\s+(.+?)\s*$/mu)
  return match !== null && !/^["']?false["']?$/iu.test(match[1])
}

function workflowScriptArgsAreReal(args) {
  return !/(?:^|\s)--help(?:\s|$)/u.test(args)
    && !/(?:^|\s)(?:\|\||&&|\||;)(?:\s|$)/u.test(args)
}

function workflowLineRunsGeneratedArtifactVerifier(line) {
  const envPrefix = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*`
  const match = line.match(new RegExp(`^${envPrefix}node\\s+scripts/test-desk-generated-artifacts\\.cjs(?:\\s+(?<args>.*)|$)`, "u"))
  return match !== null && workflowScriptArgsAreReal(match.groups?.args ?? "")
}

function workflowLineRunsMcpScript(line, scriptName, { requirePrefix = false } = {}) {
  const envPrefix = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*`
  const escapedScriptName = scriptName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const prefixPattern = String.raw`npm\s+--prefix\s+plugins/desk/mcp\s+run\s+${escapedScriptName}(?:\s+(?<prefixArgs>.*)|$)`
  const workingDirPattern = String.raw`npm\s+run\s+${escapedScriptName}(?:\s+(?<workingDirArgs>.*)|$)`
  const match = line.match(new RegExp(`^${envPrefix}(?:${prefixPattern}${requirePrefix ? "" : `|${workingDirPattern}`})`, "u"))
  const args = match?.groups?.prefixArgs ?? match?.groups?.workingDirArgs ?? ""
  return match !== null && workflowScriptArgsAreReal(args)
}

function workflowStepRunsGeneratedArtifactVerifier(stepBlock) {
  if (workflowStepAllowsFailure(stepBlock)) {
    return false
  }
  const workingDirectory = workflowStepWorkingDirectory(stepBlock)
  if (workingDirectory !== undefined && workingDirectory !== ".") {
    return false
  }
  return workflowStepRunText(stepBlock)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => workflowLineRunsGeneratedArtifactVerifier(line))
}

function workflowStepRunsMcpScript(stepBlock, scriptName) {
  if (workflowStepAllowsFailure(stepBlock)) {
    return false
  }
  const runLines = workflowStepRunText(stepBlock)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
  const runsCommand = runLines.some((line) => workflowLineRunsMcpScript(line, scriptName))
  if (!runsCommand) {
    return false
  }
  return (
    workflowStepWorkingDirectory(stepBlock) === "plugins/desk/mcp"
    || runLines.some((line) => workflowLineRunsMcpScript(line, scriptName, { requirePrefix: true }))
  )
}

function workflowStepOrder(jobSection) {
  const blocks = workflowStepBlocks(jobSection)
  return {
    generatedArtifactCheck: blocks.findIndex((stepBlock) => workflowStepRunsGeneratedArtifactVerifier(stepBlock)),
    runtimePackBuild: blocks.findIndex((stepBlock) => workflowStepRunsMcpScript(stepBlock, "runtime:deps-pack:build")),
  }
}

test("production runtime dependency pack is committed at the current canonical path", async () => {
  const packageJson = loadJson(packageJsonPath)
  const expectations = await generatedArtifacts.productionRuntimePackExpectations({
    repoRoot,
    mcpRoot,
  })

  assert.deepEqual(expectations.map((expectation) => expectation.target), ["darwin-arm64-node-127"])
  for (const expectation of expectations) {
    const expectedPackDir = path.join(
      mcpRoot,
      "artifacts",
      "runtime-deps",
      packageJson.version,
      expectation.target,
      expectation.prodDependencyLockHash,
    )
    const requiredFiles = [
      expectation.paths.archivePath,
      expectation.paths.manifestPath,
      expectation.paths.checksumPath,
    ]

    assert.equal(expectation.paths.packDir, expectedPackDir)
    assert.equal(repoPath(expectation.paths.packDir).startsWith("plugins/desk/mcp/artifacts/runtime-deps/"), true)
    assert.equal(repoPath(expectation.paths.packDir).includes("__tests__/fixtures"), false)
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

    const verification = generatedArtifacts.verifyPublishedRuntimeDependencyPack({ expectation })
    assert.deepEqual(verification.errors, [])
    assert.equal(verification.ok, true)
  }
})

test("production runtime dependency pack manifest records freshness and dependency-only provenance", async () => {
  const [expectation] = await generatedArtifacts.productionRuntimePackExpectations({
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
  assert.equal(manifest.platform.os, expectation.platform)
  assert.equal(manifest.platform.arch, expectation.arch)
  assert.equal(manifest.platform.node_abi, expectation.nodeAbi)
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

test("generated artifact verification uses explicit published targets instead of the verifier host", async () => {
  const expectations = await generatedArtifacts.productionRuntimePackExpectations({
    repoRoot,
    mcpRoot,
  })
  const linuxHostExpectation = await generatedArtifacts.productionRuntimePackExpectation({
    repoRoot,
    mcpRoot,
    platform: "linux",
    arch: "x64",
    nodeAbi: "127",
  })
  const explicitTargetExpectations = await generatedArtifacts.productionRuntimePackExpectations({
    repoRoot,
    mcpRoot,
    targets: [{ platform: "linux", arch: "x64", nodeAbi: "127" }],
  })
  const stdout = []
  const stderr = []

  assert.deepEqual(
    generatedArtifacts.publishedRuntimePackTargets(),
    [{ platform: "darwin", arch: "arm64", nodeAbi: "127" }],
  )
  assert.equal(expectations[0].target, "darwin-arm64-node-127")
  assert.equal(linuxHostExpectation.target, "linux-x64-node-127")
  assert.deepEqual(explicitTargetExpectations.map((expectation) => expectation.target), ["linux-x64-node-127"])
  assert.notEqual(linuxHostExpectation.paths.packDir, expectations[0].paths.packDir)

  const result = await generatedArtifacts.verifyGeneratedArtifacts({
    repoRoot,
    mcpRoot,
    io: {
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.expectations.map((expectation) => expectation.target), ["darwin-arm64-node-127"])
  assert.match(stdout.join(""), /darwin-arm64-node-127/u)
  assert.equal(stderr.join(""), "")
})

test("CI checks committed generated artifacts before rebuilding runtime dependency packs", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  const order = workflowStepOrder(workflowJob(workflow, "desk-mcp-tests"))

  assert.notEqual(order.generatedArtifactCheck, -1, "desk MCP workflow must run the generated artifact verifier")
  assert.notEqual(order.runtimePackBuild, -1, "desk MCP workflow must still build runtime dependency packs")
  assert.ok(
    order.generatedArtifactCheck < order.runtimePackBuild,
    "committed generated artifacts must be checked before CI creates fresh local runtime dependency packs",
  )

  const fakeWorkflow = [
    "  desk-mcp-tests:",
    "    steps:",
    "      - name: Fake verifier",
    "        run: echo node scripts/test-desk-generated-artifacts.cjs",
    "      - name: Failure-masked verifier",
    "        continue-on-error: true",
    "        run: node scripts/test-desk-generated-artifacts.cjs",
    "      - name: Comment-only verifier",
    "        run: |",
    "          # node scripts/test-desk-generated-artifacts.cjs",
    "          npm run runtime:deps-pack:build",
    "      - name: Real verifier",
    "        run: node scripts/test-desk-generated-artifacts.cjs",
    "      - name: Build runtime dependency pack",
    "        working-directory: plugins/desk/mcp",
    "        run: npm run runtime:deps-pack:build",
  ].join("\n")
  assert.deepEqual(workflowStepOrder(fakeWorkflow), {
    generatedArtifactCheck: 3,
    runtimePackBuild: 4,
  })
})
