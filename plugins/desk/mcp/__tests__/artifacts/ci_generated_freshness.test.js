// Unit 23a: red contract for CI-level generated artifact freshness.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { devNull, tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import matter from "gray-matter"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const generatedArtifactsScript = "scripts/test-desk-generated-artifacts.cjs"
const hostManifestScript = "scripts/test-desk-host-manifests.cjs"
const require = createRequire(import.meta.url)

test("generated artifact verifier defaults select the owning repository and refuse missing expectations", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  assert.equal(await generatedArtifacts.loadRuntimeDeps(), await generatedArtifacts.loadRuntimeDeps(mcpRoot))
  assert.deepEqual(
    await generatedArtifacts.loadProductionArtifactModules(),
    await generatedArtifacts.loadProductionArtifactModules(mcpRoot),
  )
  assert.deepEqual(
    await generatedArtifacts.productionRuntimePackExpectations(),
    await generatedArtifacts.productionRuntimePackExpectations({ repoRoot, mcpRoot }),
  )
  assert.equal(generatedArtifacts.gitTracksFile({ repoRoot, repoPath: generatedArtifactsScript }), true)
  assert.equal(generatedArtifacts.gitTracksFile({ repoRoot, repoPath: "__missing_generated_artifact_fixture__" }), false)
  assert.throws(() => generatedArtifacts.verifyPublishedRuntimeDependencyPack(), TypeError)
  await assert.rejects(() => generatedArtifacts.verifyProductionSharedArtifacts(), TypeError)
  const expectation = await generatedArtifacts.productionSharedArtifactExpectation({ repoRoot, mcpRoot })
  const shared = await generatedArtifacts.verifyProductionSharedArtifacts({ expectation })
  assert.equal(shared.ok, true, shared.errors.join("\n"))
  assert.equal(await generatedArtifacts.runCli(), 0)
})

test("the artifact archive reader ignores directory headers and preserves their regular files", () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const root = mkdtempSync(path.join(tmpdir(), "desk-directory-header-"))
  try {
    mkdirSync(path.join(root, "artifact"))
    writeFileSync(path.join(root, "artifact", "payload.txt"), "fixture payload\n")
    const archive = path.join(root, "fixture.tgz")
    const result = spawnSync("tar", ["-czf", archive, "-C", root, "artifact"], {
      encoding: "utf8",
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    assert.equal(result.status, 0, result.stderr)
    const contents = generatedArtifacts.extractTarGzContents(archive)
    assert.equal(contents.has("artifact/"), false)
    assert.equal(contents.get("artifact/payload.txt").toString("utf8"), "fixture payload\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const requiredPackageScripts = {
  "activation:support-matrix:generate": "node scripts/generate-support-matrix.js",
  "activation:copilot-bundle:generate": "node scripts/generate-copilot-bundle.js",
  "runtime:deps-pack:build": "node scripts/build-runtime-deps-pack.js",
  "runtime:deps-pack:verify": "node scripts/verify-runtime-deps-pack.js",
  "artifact:vector-pack:build": "node scripts/build-vector-pack.js",
  "artifact:snapshot:build": "node scripts/build-snapshot.js",
  "artifact:snapshot:verify": "node scripts/verify-snapshot.js",
  "artifact:validate": "node scripts/validate-artifacts.js",
}

const requiredHostFreshnessPathFilters = [
  ".gitattributes",
  "plugins/desk/activation/**",
  "plugins/desk/.claude-plugin/plugin.json",
  "plugins/desk/.codex-plugin/plugin.json",
  "plugins/desk/.mcp.copilot.json",
  "plugins/desk/.mcp.json",
  "plugins/desk/agents/**",
  "plugins/desk/hooks/**",
  "plugins/desk/output-styles/**",
  "plugins/desk/plugin.json",
  "plugins/desk/principles.md",
  "plugins/desk/skills/**",
  "plugins/superpowers/**",
  "plugins/work-suite/.claude-plugin/plugin.json",
  "plugins/work-suite/.codex-plugin/plugin.json",
  "plugins/work-suite/plugin.json",
  "plugins/work-suite/skills/**",
]

const requiredHostManifestChecks = [
  "support-matrix",
  "copilot-bundle",
  "copilot-plugin-metadata",
  "codex-plugin",
  "claude-plugin",
  "worker-sources",
  "humanize-skill",
  "codex-fixtures",
]

const hostManifestFixtureFiles = [
  "manifest.json",
  ".github/workflows/desk-mcp-tests.yml",
  ".github/workflows/validate-skills.yml",
  "plugins/desk/activation/host-capability-evidence.md",
  "plugins/desk/.claude-plugin/plugin.json",
  "plugins/desk/.codex-plugin/plugin.json",
  "plugins/desk/.mcp.copilot.json",
  "plugins/desk/.mcp.json",
  "plugins/desk/activation/copilot-root.flattened-bundle.json",
  "plugins/desk/activation/desk.activation.json",
  "plugins/desk/activation/support-matrix.json",
  "plugins/desk/agents/worker.agent.md",
  "plugins/desk/agents/worker.md",
  "plugins/desk/agents/worker.toml",
  "plugins/desk/hooks/hooks.json",
  "plugins/desk/skills/humanize/LICENSE",
  "plugins/desk/skills/humanize/SKILL.md",
  "plugins/desk/mcp/src/activation/adapters/codex.js",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-activation-config.json",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-instructions.md",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-activation-config.json",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml",
  "plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-instructions.md",
  "plugins/desk/output-styles/worker.md",
  "plugins/desk/plugin.json",
  "plugins/desk/principles.md",
  "plugins/work-suite/.claude-plugin/plugin.json",
  "plugins/work-suite/.codex-plugin/plugin.json",
  "plugins/work-suite/plugin.json",
  "plugins/superpowers/.claude-plugin/plugin.json",
  "plugins/superpowers/.codex-plugin/plugin.json",
  "plugins/superpowers/plugin.json",
  "plugins/plain-language/.claude-plugin/plugin.json",
  "plugins/plain-language/.codex-plugin/plugin.json",
  "plugins/plain-language/plugin.json",
  "plugins/ponytail-upstream/.claude-plugin/plugin.json",
  "plugins/ponytail-upstream/.codex-plugin/plugin.json",
  "plugins/ponytail-upstream/plugin.json",
  "scripts/validate-skills.cjs",
]

function loadJson(...segments) {
  return JSON.parse(readFileSync(path.join(repoRoot, ...segments), "utf8"))
}

function loadText(...segments) {
  return readFileSync(path.join(repoRoot, ...segments), "utf8")
}

function writeText(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf8")
}

function writeJson(root, relativePath, value) {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function copyRepoFile(relativePath, targetRoot) {
  const targetPath = path.join(targetRoot, relativePath)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  copyFileSync(path.join(repoRoot, relativePath), targetPath)
}

async function withHostFreshnessFixture(fn) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-host-freshness-"))
  const fixtureRoot = path.join(tempRoot, "repo")
  try {
    for (const relativePath of hostManifestFixtureFiles) {
      copyRepoFile(relativePath, fixtureRoot)
    }
    return await fn(fixtureRoot)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function withValidateSkillsFixture({ hostStatus = 0, generatedStatus = 0 }, fn) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-validate-skills-"))
  const fixtureRoot = path.join(tempRoot, "repo")
  try {
    writeJson(fixtureRoot, "manifest.json", { skills: [] })
    writeJson(fixtureRoot, ".claude-plugin/marketplace.json", { plugins: [] })
    copyRepoFile(".github/workflows/desk-mcp-tests.yml", fixtureRoot)
    copyRepoFile(".github/workflows/validate-skills.yml", fixtureRoot)
    copyRepoFile("scripts/validate-skills.cjs", fixtureRoot)
    copyRepoFile("scripts/check-apple-distribution-kit-skill.cjs", fixtureRoot)
    writeJson(fixtureRoot, "plugins/desk/mcp/package.json", {
      scripts: requiredPackageScripts,
    })
    for (const command of Object.values(requiredPackageScripts)) {
      const relativeScript = command.replace(/^node\s+/u, "plugins/desk/mcp/")
      writeText(fixtureRoot, relativeScript, "#!/usr/bin/env node\nprocess.exit(0)\n")
    }

    for (const name of [
      "autopilot",
      "deep-research",
      "inch-worm",
      "stay-in-turn",
      "visual-qa-dogfood",
      "watchdog-mode",
      "work-doer",
      "work-ideator",
      "work-merger",
      "work-planner",
    ]) {
      const body = `---\nname: ${name}\ndescription: fixture skill\n---\n# ${name}\n`
      writeText(fixtureRoot, `skills/${name}/SKILL.md`, body)
      writeText(fixtureRoot, `plugins/work-suite/skills/${name}/SKILL.md`, body)
    }
    const plainLanguage = "---\nname: plain-language\ndescription: fixture skill\n---\n# plain-language\n"
    writeText(fixtureRoot, "skills/plain-language/SKILL.md", plainLanguage)
    writeText(
      fixtureRoot,
      "plugins/plain-language/skills/plain-language/SKILL.md",
      plainLanguage,
    )
    writeText(
      fixtureRoot,
      "skills/sign-apple-apps/SKILL.md",
      `---
name: sign-apple-apps
description: fixture skill
---
# sign-apple-apps

apple-distribution-kit
distribution/apple-distribution.json
scripts/apple-distribution-kit.sh
bot.ouro.md
bot.ouro.workbench
app.spoonjoy
APP_STORE_CONNECT_API_KEY_ID
APP_STORE_CONNECT_PROVIDER_PUBLIC_ID
TestFlight Submission Lane
testflight plan
testflight publish
asc get
ExportOptions.testflight.plist
method = app-store-connect
Stop for the operator for:
not source files
non-secret CI/preflight gate
Use app-neutral names for reusable materials
For non-Ouro apps, rename these env vars
`,
    )

    for (const script of [
      "scripts/test-autopilot-state-audit.cjs",
      "scripts/test-work-suite-runtime-audit.cjs",
      "scripts/audit-work-suite-runtime.cjs",
    ]) {
      writeText(fixtureRoot, script, "#!/usr/bin/env node\nprocess.exit(0)\n")
    }
    writeText(
      fixtureRoot,
      hostManifestScript,
      `#!/usr/bin/env node\nconsole.error("host manifest fixture failure")\nprocess.exit(${hostStatus})\n`,
    )
    writeText(
      fixtureRoot,
      generatedArtifactsScript,
      `#!/usr/bin/env node\nconsole.error("generated artifact fixture failure")\nprocess.exit(${generatedStatus})\n`,
    )

    return await fn(fixtureRoot)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function stripYamlComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char
    }
    if (char === "#" && !quote) return line.slice(0, index)
  }
  return line
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function workflowPathFilters(workflow, eventName) {
  const filters = []
  const stack = []
  for (const line of workflow.split(/\r?\n/u)) {
    const clean = stripYamlComment(line)
    if (!clean.trim()) continue
    const indent = clean.match(/^ */u)[0].length
    const trimmed = clean.trim()

    if (trimmed.startsWith("- ")) {
      const keys = stack.map((entry) => entry.key)
      if (keys.at(-1) === "paths" && keys.at(-2) === eventName && keys.at(-3) === "on") {
        filters.push(unquoteYamlScalar(trimmed.slice(2)))
      }
      continue
    }

    const keyMatch = trimmed.match(/^(['"]?)([A-Za-z0-9_-]+)\1:\s*(?:.*)?$/u)
    if (!keyMatch) continue
    while (stack.length && stack.at(-1).indent >= indent) stack.pop()
    stack.push({ indent, key: keyMatch[2] })
  }
  return filters
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
  let current
  for (const line of jobSection.split(/\r?\n/u)) {
    if (/^      - /u.test(line)) {
      if (current !== undefined) blocks.push(current.join("\n"))
      current = [line]
      continue
    }
    if (current !== undefined) current.push(line)
  }
  if (current !== undefined) blocks.push(current.join("\n"))
  return blocks
}

function workflowStepAllowsFailure(stepBlock) {
  const match = stepBlock.match(/^\s*continue-on-error:\s+(.+?)\s*$/mu)
  return match !== null && !/^["']?false["']?$/iu.test(match[1])
}

function workflowStepWorkingDirectory(stepBlock) {
  const match = stepBlock.match(/^\s*working-directory:\s+(.+?)\s*$/mu)
  return match?.[1]?.replace(/^["']|["']$/gu, "")
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

function workflowStepRunsRootScript(stepBlock, scriptPath) {
  if (workflowStepAllowsFailure(stepBlock)) return false
  const workingDirectory = workflowStepWorkingDirectory(stepBlock)
  if (workingDirectory !== undefined && workingDirectory !== ".") return false
  const escapedScript = scriptPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const optionalDotScript = escapedScript.replace(/^scripts\//u, "(?:\\.\\/)?scripts/")
  const commandPattern = new RegExp(`^node\\s+${optionalDotScript}(?:\\s|$)`, "u")
  return workflowStepRunText(stepBlock)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => commandPattern.test(line))
}

function workflowRunsRootScript(workflow, jobName, scriptPath) {
  return workflowStepBlocks(workflowJob(workflow, jobName))
    .some((stepBlock) => workflowStepRunsRootScript(stepBlock, scriptPath))
}

function assertIncludesAll(actual, expected, label) {
  for (const value of expected) {
    assert.ok(actual.includes(value), `${label} must include ${value}`)
  }
}

function pathFilterCovers(actualFilter, requiredPath) {
  if (actualFilter === requiredPath) return true
  if (actualFilter.endsWith("/**")) {
    const prefix = actualFilter.slice(0, -3)
    return requiredPath === prefix || requiredPath.startsWith(`${prefix}/`)
  }
  if (actualFilter.endsWith("/*")) {
    const prefix = actualFilter.slice(0, -2)
    const remainder = requiredPath.slice(prefix.length + 1)
    return requiredPath.startsWith(`${prefix}/`) && !remainder.includes("/")
  }
  return false
}

function assertPathFiltersCoverAll(actual, expected, label) {
  for (const value of expected) {
    assert.ok(
      actual.some((filter) => pathFilterCovers(filter, value)),
      `${label} must include or cover ${value}`,
    )
  }
}

function scriptExists(scriptPath) {
  return existsSync(path.join(repoRoot, scriptPath))
}

function packageScriptTargetPath(command) {
  const match = command.match(/^node\s+scripts\/(.+\.js)$/u)
  assert.ok(match, `package script command must run a local JS script: ${command}`)
  return path.join(mcpRoot, "scripts", match[1])
}

function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^\s*\/\/.*$/gmu, "")
}

function validatorRunsScript(scriptPath) {
  const source = stripJsComments(loadText("scripts", "validate-skills.cjs"))
  const escaped = scriptPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return new RegExp(`spawnSync\\(\\s*process\\.execPath\\s*,\\s*\\[\\s*["']${escaped}["']`, "u")
    .test(source)
}

function loadHostManifestVerifier() {
  assert.equal(
    scriptExists(hostManifestScript),
    true,
    `${hostManifestScript} must be the single CI-facing host manifest drift verifier`,
  )
  return require(path.join(repoRoot, hostManifestScript))
}

test("Desk MCP package exposes every freshness artifact script CI needs", () => {
  const packageJson = loadJson("plugins", "desk", "mcp", "package.json")

  for (const [scriptName, command] of Object.entries(requiredPackageScripts)) {
    assert.equal(packageJson.scripts?.[scriptName], command)
    assert.equal(
      existsSync(packageScriptTargetPath(command)),
      true,
      `${scriptName} target script must exist`,
    )
  }
})

test("root generated-artifact verifier exports the production freshness contract", () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))

  for (const exportName of [
    "verifyGeneratedArtifacts",
    "verifyPublishedRuntimeDependencyPack",
    "verifyProductionSharedArtifacts",
    "productionRuntimePackExpectations",
    "productionSharedArtifactExpectation",
    "artifactSourceScopeHash",
    "documentTreeHash",
  ]) {
    assert.equal(typeof generatedArtifacts[exportName], "function", `${exportName} must be exported`)
  }
})

test("root generated-artifact verifier fails closed when required runtime packs are absent", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const stdout = []
  const stderr = []

  const result = await generatedArtifacts.verifyGeneratedArtifacts({
    repoRoot,
    mcpRoot,
    targets: [{ platform: "unit", arch: "fixture", nodeAbi: "999" }],
    io: {
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /generated artifact missing/u)
  assert.match(stderr.join(""), /unit-fixture-node-999/u)
  assert.equal(stdout.join(""), "")
})

test("root generated-artifact verifier propagates missing production vector and snapshot artifacts", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-generated-artifacts-"))
  try {
    const stdout = []
    const stderr = []
    const result = await generatedArtifacts.verifyGeneratedArtifacts({
      repoRoot,
      mcpRoot,
      pluginRoot: path.join(tempRoot, "plugins", "desk"),
      targets: [],
      io: {
        stdout: { write: (text) => stdout.push(text) },
        stderr: { write: (text) => stderr.push(text) },
      },
      spawn: () => ({ status: 1, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /production vector pack artifact missing/u)
    assert.match(result.errors.join("\n"), /production snapshot artifact missing/u)
    assert.match(stderr.join(""), /vector-packs/u)
    assert.equal(stdout.join(""), "")
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("root generated-artifact verifier rejects present but stale runtime dependency packs", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-runtime-pack-stale-"))
  try {
    const tempRepoRoot = path.join(tempRoot, "repo")
    const tempMcpRoot = path.join(tempRepoRoot, "plugins", "desk", "mcp")
    writeJson(tempMcpRoot, "package.json", {
      name: "@ourostack/desk-mcp",
      version: "1.7.3",
    })
    writeJson(tempMcpRoot, "package-lock.json", {
      lockfileVersion: 3,
      packages: {},
    })
    const packDir = path.join(
      tempRepoRoot,
      "plugins",
      "desk",
      "artifacts",
      "runtime-deps",
      "unit-fixture-node-999",
    )
    const fakeRuntimeDeps = {
      productionDependencyLockHash: () => `sha256:${"1".repeat(64)}`,
      deriveRuntimeDependencyPackPaths: () => ({
        packDir,
        archivePath: path.join(packDir, "runtime-deps.tgz"),
        manifestPath: path.join(packDir, "runtime-deps.manifest.json"),
        checksumPath: path.join(packDir, "runtime-deps.sha256"),
      }),
      validateRuntimeDependencyPackManifest: () => [
        "runtime dependency pack manifest package_lock.prod_dependency_lock_hash must match production dependency closure",
      ],
    }
    const expectation = await generatedArtifacts.productionRuntimePackExpectation({
      repoRoot: tempRepoRoot,
      mcpRoot: tempMcpRoot,
      platform: "unit",
      arch: "fixture",
      nodeAbi: "999",
      runtimeDeps: fakeRuntimeDeps,
    })
    writeJson(packDir, "runtime-deps.manifest.json", {
      archive: { sha256: "f".repeat(64) },
      package_lock: { sha256: "e".repeat(64) },
      production_dependencies: [],
    })
    writeText(packDir, "runtime-deps.tgz", "stale archive bytes")
    writeText(packDir, "runtime-deps.sha256", `${"0".repeat(64)}  runtime-deps.tgz\n`)

    const result = generatedArtifacts.verifyPublishedRuntimeDependencyPack({
      expectation,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.doesNotMatch(result.errors.join("\n"), /generated artifact missing/u)
    assert.match(result.errors.join("\n"), /prod_dependency_lock_hash must match production dependency closure/u)
    assert.match(result.errors.join("\n"), /runtime dependency pack checksum mismatch/u)
    assert.match(result.errors.join("\n"), /manifest archive\.sha256 must match runtime-deps\.tgz/u)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("root generated-artifact verifier CLI fails closed on setup exceptions", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-generated-cli-exception-"))
  try {
    const stdout = []
    const stderr = []
    const exitCode = await generatedArtifacts.runCli({
      repoRoot: tempRoot,
      mcpRoot: path.join(tempRoot, "plugins", "desk", "mcp"),
      io: {
        stdout: { write: (text) => stdout.push(text) },
        stderr: { write: (text) => stderr.push(text) },
      },
    })

    assert.equal(exitCode, 1)
    assert.equal(stdout.join(""), "")
    assert.match(stderr.join(""), /Cannot find module|ENOENT|no such file or directory/u)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("root generated-artifact verifier covers defensive helper and CLI branches", async () => {
  const generatedArtifacts = require(path.join(repoRoot, generatedArtifactsScript))
  const internals = generatedArtifacts.__generatedArtifactVerifierInternalsForTests
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-generated-internals-"))
  try {
    const fixtureJson = path.join(tempRoot, "fixture.json")
    writeFileSync(fixtureJson, "{}", "utf8")

    assert.equal(generatedArtifacts.startCli({ isMain: false }), null)
    assert.equal(generatedArtifacts.startCli(), null)
    const exitCodes = []
    assert.equal(
      await generatedArtifacts.startCli({
        isMain: true,
        run: async () => 7,
        setExitCode: (code) => exitCodes.push(code),
      }),
      1,
    )
    assert.deepEqual(exitCodes, [7])
    const defaultRunExitCodes = []
    assert.equal(
      await generatedArtifacts.startCli({
        isMain: true,
        verifyGeneratedArtifactsFn: async () => ({ ok: true }),
        setExitCode: (code) => defaultRunExitCodes.push(code),
        io: { stdout: { write: () => {} }, stderr: { write: () => {} } },
      }),
      1,
    )
    assert.deepEqual(defaultRunExitCodes, [0])
    const previousExitCode = process.exitCode
    try {
      await generatedArtifacts.startCli({ isMain: true, run: async () => 0 })
      assert.equal(process.exitCode, 0)
    } finally {
      process.exitCode = previousExitCode
    }

    assert.equal(
      await generatedArtifacts.runCli({
        verifyGeneratedArtifactsFn: async () => ({ ok: true }),
        io: { stdout: { write: () => {} }, stderr: { write: () => {} } },
      }),
      0,
    )
    assert.equal(
      await generatedArtifacts.runCli({
        verifyGeneratedArtifactsFn: async () => ({ ok: false }),
        io: { stdout: { write: () => {} }, stderr: { write: () => {} } },
      }),
      1,
    )
    const plainErrorStderr = []
    assert.equal(
      await generatedArtifacts.runCli({
        verifyGeneratedArtifactsFn: async () => {
          throw "plain verifier failure"
        },
        io: { stderr: { write: (text) => plainErrorStderr.push(text) } },
      }),
      1,
    )
    assert.equal(plainErrorStderr.join(""), "plain verifier failure\n")
    assert.equal(
      await generatedArtifacts.runCli({
        verifyGeneratedArtifactsFn: async () => {
          throw new Error("default io verifier failure")
        },
      }),
      1,
    )

    const defaultExpectation = await generatedArtifacts.productionRuntimePackExpectation()
    assert.equal(defaultExpectation.target, "darwin-arm64-node-127")
    const defaultShared = await generatedArtifacts.productionSharedArtifactExpectation()
    assert.ok(defaultShared.relativeVectorPackDir.startsWith("plugins/desk/artifacts/vector-packs/"))
    const processIoVerify = await generatedArtifacts.verifyGeneratedArtifacts()
    assert.equal(processIoVerify.ok, true, processIoVerify.errors.join("\n"))
    const defaultVerifyStdout = []
    const defaultVerify = await generatedArtifacts.verifyGeneratedArtifacts({
      io: {
        stdout: { write: (text) => defaultVerifyStdout.push(text) },
        stderr: { write: () => {} },
      },
    })
    assert.equal(defaultVerify.ok, true, defaultVerify.errors.join("\n"))
    assert.match(defaultVerifyStdout.join(""), /Desk generated artifacts verified/u)

    assert.equal(internals.gitTracksFile({
      repoRoot,
      repoPath: "missing",
      spawn: () => ({}),
    }), false)
    assert.equal(generatedArtifacts.artifactSourceScopeHash(tempRoot).startsWith("sha256:"), true)
    assert.equal(
      generatedArtifacts.documentTreeHash([
        { path: "b.md", hash: "sha256:b" },
        { path: "a.md", hash: "a" },
      ]).startsWith("sha256:"),
      true,
    )
    assert.equal(internals.canonicalSha("abc"), "sha256:abc")
    assert.equal(internals.formatErrorMessage(new Error("error object")), "error object")
    assert.equal(internals.formatErrorMessage("plain string"), "plain string")

    const previousParse = JSON.parse
    try {
      JSON.parse = () => {
        throw "plain parse failure"
      }
      const readJsonErrors = []
      assert.equal(internals.readJsonIfPresent(fixtureJson, readJsonErrors, "fixture json"), undefined)
      assert.match(readJsonErrors.join("\n"), /plain parse failure/u)
      const archiveErrors = []
      assert.equal(internals.parseArchiveJson(Buffer.from("{}", "utf8"), "archive json", archiveErrors), undefined)
      assert.match(archiveErrors.join("\n"), /plain parse failure/u)
    } finally {
      JSON.parse = previousParse
    }

    const missingArchiveJsonErrors = []
    assert.equal(internals.parseArchiveJson(undefined, "missing.json", missingArchiveJsonErrors), undefined)
    assert.match(missingArchiveJsonErrors.join("\n"), /must include root missing\.json/u)
    assert.equal(internals.packageRootFromArchiveEntry("not-node-modules/file.js"), undefined)
    assert.equal(internals.packageRootFromArchiveEntry("node_modules/"), undefined)
    assert.equal(internals.packageRootFromArchiveEntry("node_modules/@scope"), undefined)
    assert.match(
      internals.validatePublishedArchiveShape({
        entries: ["package.json", "package-lock.json", "runtime-deps.manifest.json", "node_modules/@scope"],
        productionDependencies: [],
      }).join("\n"),
      /non-production dependency/u,
    )

    const freshnessErrors = []
    internals.propagateValidationFreshness({
      artifacts: undefined,
      errors: freshnessErrors,
      idField: "pack_id",
      label: "production vector pack",
    })
    internals.propagateValidationFreshness({
      artifacts: [{ freshness: { artifact_source_scope: "stale", document_tree: "stale" } }],
      errors: freshnessErrors,
      idField: "pack_id",
      label: "production vector pack",
    })
    assert.match(freshnessErrors.join("\n"), /production vector pack <unknown> artifact_source_scope_hash is stale/u)

    assert.throws(
      () => internals.primaryArtifactFiles({ dir: fixtureJson, suffix: ".jsonl" }),
      /ENOTDIR|not a directory/u,
    )
    const checksumErrors = []
    internals.verifyProductionArtifactChecksum({
      errors: checksumErrors,
      label: "missing artifact",
      primaryPath: path.join(tempRoot, "missing.jsonl"),
      checksumPath: path.join(tempRoot, "missing.sha256"),
      existsSync: () => false,
      repoRoot,
      primaryRepoPath: "missing.jsonl",
      checksumRepoPath: "missing.sha256",
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    })
    assert.deepEqual(checksumErrors, [])
    assert.equal(internals.readTrackedFileBytes({
      repoRoot,
      repoPath: "missing",
      spawn: () => ({ stdout: Buffer.from("tracked bytes"), stderr: "" }),
    }), undefined)
    assert.equal(internals.readTrackedFileBytes({
      repoRoot,
      repoPath: "missing",
      spawn: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: "" }),
    }), undefined)
    assert.deepEqual(
      internals.readTrackedFileBytes({
        repoRoot,
        repoPath: "string",
        spawn: () => ({ status: 0, stdout: "string bytes", stderr: "" }),
      }),
      Buffer.from("string bytes", "utf8"),
    )
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("root host-manifest verifier exists and validates current host-facing generated files", async () => {
  const hostManifests = loadHostManifestVerifier()
  assert.equal(typeof hostManifests.verifyDeskHostManifests, "function")
  assert.equal(typeof hostManifests.runCli, "function")

  const stderr = []
  const stdout = []
  const result = await hostManifests.verifyDeskHostManifests({
    repoRoot,
    mcpRoot,
    io: {
      stderr: { write: (text) => stderr.push(text) },
      stdout: { write: (text) => stdout.push(text) },
    },
  })

  assert.equal(result.ok, true, result.errors?.join("\n") ?? stderr.join(""))
  assertIncludesAll(result.checked ?? [], requiredHostManifestChecks, "host manifest checks")
})

test("root host-manifest verifier catches stale generated host-facing files", async () => {
  const hostManifests = loadHostManifestVerifier()

  await withHostFreshnessFixture(async (freshRoot) => {
    const result = await hostManifests.verifyDeskHostManifests({
      repoRoot: freshRoot,
      mcpRoot,
      io: {
        stderr: { write: () => {} },
        stdout: { write: () => {} },
      },
    })
    assert.equal(result.ok, true, result.errors?.join("\n") ?? "")
    assertIncludesAll(result.checked ?? [], requiredHostManifestChecks, "fresh fixture host manifest checks")
  })

  const staleCases = [
    {
      label: "support-matrix",
      errorPattern: /support[- ]matrix/u,
      mutate: (fixtureRoot) => {
        const matrix = loadJson("plugins", "desk", "activation", "support-matrix.json")
        matrix.hosts = matrix.hosts.filter((row) => row.host_id !== "codex")
        writeJson(fixtureRoot, "plugins/desk/activation/support-matrix.json", matrix)
      },
    },
    {
      label: "copilot-bundle",
      errorPattern: /copilot[- ]bundle/u,
      mutate: (fixtureRoot) => {
        const bundle = loadJson("plugins", "desk", "activation", "copilot-root.flattened-bundle.json")
        bundle.dependency_closure = bundle.dependency_closure.filter((entry) => entry.id !== "superpowers")
        writeJson(fixtureRoot, "plugins/desk/activation/copilot-root.flattened-bundle.json", bundle)
      },
    },
    {
      label: "copilot-plugin-metadata",
      errorPattern: /copilot[- ]plugin[- ]metadata|Copilot desk:worker target|Copilot Superpowers dependency/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "desk", "plugin.json")
        plugin.activation.copilot.targets["desk:worker"].source = "agents/worker.md"
        plugin.activation.copilot.dependencies.superpowers.bundleMetadata =
          "plugins/desk/activation/stale-bundle.json"
        writeJson(fixtureRoot, "plugins/desk/plugin.json", plugin)
      },
    },
    {
      label: "claude-plugin",
      errorPattern: /claude[- ]plugin/u,
      mutate: (fixtureRoot) => {
        const claude = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
        claude.agents = []
        writeJson(fixtureRoot, "plugins/desk/.claude-plugin/plugin.json", claude)
      },
    },
    {
      label: "codex-plugin",
      errorPattern: /codex[- ]plugin/u,
      mutate: (fixtureRoot) => {
        const codex = loadJson("plugins", "desk", ".codex-plugin", "plugin.json")
        codex.activation.codex.targets["desk:worker"].source = "agents/worker.md"
        writeJson(fixtureRoot, "plugins/desk/.codex-plugin/plugin.json", codex)
      },
    },
    {
      label: "worker-sources",
      errorPattern: /worker[- ]sources/u,
      mutate: (fixtureRoot) => {
        writeText(
          fixtureRoot,
          "plugins/desk/agents/worker.toml",
          loadText("plugins", "desk", "agents", "worker.toml")
            .replace('name = "worker"', 'name = "worker-stale"'),
        )
      },
    },
    {
      label: "humanize-skill",
      errorPattern: /humanize[- ]skill/u,
      mutate: (fixtureRoot) => {
        const manifest = loadJson("manifest.json")
        manifest.skills.push({ name: "humanize" })
        writeJson(fixtureRoot, "manifest.json", manifest)
      },
    },
    {
      label: "codex-fixtures",
      errorPattern: /codex[- ]fixtures/u,
      mutate: (fixtureRoot) => {
        writeText(
          fixtureRoot,
          "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml",
          loadText(
            "plugins",
            "desk",
            "mcp",
            "__tests__",
            "fixtures",
            "activation",
            "codex",
            "global-personal",
            "generated-config.toml",
          ).replace("[plugins.\"desk@ourostack\"]", "[plugins.\"desk-stale@ourostack\"]"),
        )
      },
    },
  ]

  for (const staleCase of staleCases) {
    await withHostFreshnessFixture(async (caseRoot) => {
      staleCase.mutate(caseRoot)
      const result = await hostManifests.verifyDeskHostManifests({
        repoRoot: caseRoot,
        mcpRoot,
        io: {
          stderr: { write: () => {} },
          stdout: { write: () => {} },
        },
      })
      assert.equal(result.ok, false, `${staleCase.label} drift must fail verification`)
      assert.match(result.errors.join("\n"), staleCase.errorPattern)
    })
  }
})

test("root host verifier selects an explicit legacy configuration across all three native metadata checks", async () => {
  const { buildCopilotBundle } = await import("../../src/activation/copilot-bundle.js")
  const { materializeCodexActivation } = await import("../../src/activation/adapters/codex.js")
  const { validateActivationManifest } = await import("../../src/activation/validate.js")
  const verifier = loadHostManifestVerifier()
  await withHostFreshnessFixture(async (root) => {
    // A temporary, explicitly declared legacy packaging configuration, not the shipped alpha or a native session.
    const legacyText = (text) => text.replaceAll("superpowers", "work-suite").replaceAll("Superpowers", "Work Suite").replaceAll("6.3.0", "4.0.0-alpha.1")
    const manifestPath = "plugins/desk/activation/desk.activation.json"
    const manifest = JSON.parse(legacyText(loadText(...manifestPath.split("/"))))
    const declaration = {
      id: "work-suite", kind: "plugin", version_range: "^4.0.0-alpha.1",
      provenance: { source: "plugins/work-suite/.codex-plugin/plugin.json", package: "ourostack/work-suite" },
      lock: { version: "4.0.0-alpha.1", integrity: "sha256-work-suite-activation-manifest-v1" },
    }
    manifest.dependencies = manifest.dependencies.map((entry) => entry.id === "work-suite" ? declaration : entry)
    assert.equal(declaration.provenance.source, "plugins/work-suite/.codex-plugin/plugin.json")
    assert.equal(declaration.provenance.package, "ourostack/work-suite")
    assert.equal(declaration.lock.version, loadJson("plugins", "work-suite", ".codex-plugin", "plugin.json").version)
    assert.equal(validateActivationManifest(manifest).ok, true)
    writeJson(root, manifestPath, manifest)
    for (const file of ["plugins/desk/plugin.json", "plugins/desk/.codex-plugin/plugin.json", "plugins/desk/.claude-plugin/plugin.json"]) {
      const plugin = JSON.parse(legacyText(loadText(...file.split("/"))))
      if (file.includes(".claude-plugin")) plugin.dependencies[0].version = declaration.version_range
      writeJson(root, file, plugin)
    }
    writeJson(root, "plugins/desk/activation/copilot-root.flattened-bundle.json", buildCopilotBundle({ activation: manifest }))
    const matrix = JSON.parse(legacyText(loadText("plugins", "desk", "activation", "support-matrix.json")))
    for (const host of matrix.hosts) {
      host.source_paths = host.source_paths.filter((file) => file !== "plugins/work-suite/hooks/copilot-hooks.json")
    }
    writeJson(root, "plugins/desk/activation/support-matrix.json", matrix)
    writeText(root, "plugins/desk/activation/host-capability-evidence.md", legacyText(
      loadText("plugins", "desk", "activation", "host-capability-evidence.md").replace("; plugins/superpowers/hooks/copilot-hooks.json", ""),
    ))
    for (const mode of ["global-personal", "project-local", "manual-only"]) {
      const result = materializeCodexActivation({
        manifest, mode, pluginRoot: "plugins/desk",
        deskRoot: mode === "project-local" ? ".desk" : "~/desk",
        runtimeCacheDir: mode === "project-local" ? ".codex/desk-runtime-cache" : "~/.cache/ouroboros-skills/desk",
        existingConfig: '# user-authored Codex config\nmodel = "gpt-5.4"\napproval_policy = "on-request"\n',
        existingInstructions: "# user-authored Codex guidance\nKeep repo-local rules intact.\n",
      })
      const directory = `plugins/desk/mcp/__tests__/fixtures/activation/codex/${mode}`
      writeText(root, `${directory}/generated-config.toml`, result.generatedConfig)
      if (mode !== "manual-only") writeText(root, `${directory}/generated-instructions.md`, result.generatedInstructions)
    }
    // A hardcoded read of any Superpowers provider is now a real missing-file failure.
    rmSync(path.join(root, "plugins", "superpowers"), { recursive: true })
    const verify = () => verifier.verifyDeskHostManifests({
      repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
    })
    const current = await verify()
    assert.equal(current.ok, true, current.errors.join("\n"))
    assert.deepEqual(current.checked, requiredHostManifestChecks)
    for (const [file, diagnostic] of [
      ["plugins/work-suite/plugin.json", /Copilot root Work Suite version must match activation lock 4\.0\.0-alpha\.1/u],
      ["plugins/work-suite/.codex-plugin/plugin.json", /codex-plugin Work Suite provider lock drift/u],
      ["plugins/work-suite/.claude-plugin/plugin.json", /claude-plugin Work Suite provider lock drift/u],
    ]) {
      const before = readFileSync(path.join(root, file), "utf8")
      const stale = JSON.parse(before)
      stale.version = "0.0.0"
      writeJson(root, file, stale)
      const result = await verify()
      assert.equal(result.ok, false)
      assert.match(result.errors.join("\n"), diagnostic)
      writeText(root, file, before)
    }
  })
})

test("root host-manifest verifier catches cross-host plugin version drift", async () => {
  const hostManifests = loadHostManifestVerifier()
  const staleVersionCases = [
    {
      label: "codex-desk-version",
      errorPattern: /codex-plugin Desk version drift/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "desk", ".codex-plugin", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/desk/.codex-plugin/plugin.json", plugin)
      },
    },
    {
      label: "claude-desk-version",
      errorPattern: /claude-plugin Desk version drift/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/desk/.claude-plugin/plugin.json", plugin)
      },
    },
    {
      label: "copilot-desk-version",
      errorPattern: /Copilot root Desk version must match activation version/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "desk", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/desk/plugin.json", plugin)
      },
    },
    {
      label: "codex-superpowers-lock",
      errorPattern: /codex-plugin Superpowers (dependency version|provider lock) drift/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "superpowers", ".codex-plugin", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/superpowers/.codex-plugin/plugin.json", plugin)
      },
    },
    {
      label: "claude-superpowers-lock",
      errorPattern: /claude-plugin Superpowers provider lock drift/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "superpowers", ".claude-plugin", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/superpowers/.claude-plugin/plugin.json", plugin)
      },
    },
    {
      label: "claude-superpowers-activation",
      errorPattern: /claude-plugin Superpowers activation dependency version drift/u,
      mutate: (fixtureRoot) => {
        const activation = loadJson("plugins", "desk", "activation", "desk.activation.json")
        activation.host_activation.claude.dependencies.superpowers.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/desk/activation/desk.activation.json", activation)
      },
    },
    {
      label: "copilot-superpowers-lock",
      errorPattern: /Copilot root Superpowers version must match activation lock/u,
      mutate: (fixtureRoot) => {
        const plugin = loadJson("plugins", "superpowers", "plugin.json")
        plugin.version = "0.0.0"
        writeJson(fixtureRoot, "plugins/superpowers/plugin.json", plugin)
      },
    },
  ]

  for (const staleCase of staleVersionCases) {
    await withHostFreshnessFixture(async (caseRoot) => {
      staleCase.mutate(caseRoot)
      const result = await hostManifests.verifyDeskHostManifests({
        repoRoot: caseRoot,
        mcpRoot,
        io: {
          stderr: { write: () => {} },
          stdout: { write: () => {} },
        },
      })

      assert.equal(result.ok, false, `${staleCase.label} drift must fail verification`)
      assert.match(result.errors.join("\n"), staleCase.errorPattern)
    })
  }
})

test("root host-manifest verifier catches worker body drift across host formats", async () => {
  const hostManifests = loadHostManifestVerifier()
  const workerCases = [
    {
      label: "claude-worker-body",
      workerPath: "plugins/desk/agents/worker.md",
      errorPattern: /worker-sources claude body drift/u,
    },
    {
      label: "codex-worker-body",
      workerPath: "plugins/desk/agents/worker.toml",
      errorPattern: /worker-sources codex body drift/u,
    },
    {
      label: "copilot-worker-body",
      workerPath: "plugins/desk/agents/worker.agent.md",
      errorPattern: /worker-sources copilot body drift/u,
    },
  ]

  for (const staleCase of workerCases) {
    await withHostFreshnessFixture(async (caseRoot) => {
      writeText(
        caseRoot,
        staleCase.workerPath,
        loadText(...staleCase.workerPath.split("/")).replaceAll("$DESK", "$STALE_DESK"),
      )
      const result = await hostManifests.verifyDeskHostManifests({
        repoRoot: caseRoot,
        mcpRoot,
        io: {
          stderr: { write: () => {} },
          stdout: { write: () => {} },
        },
      })

      assert.equal(result.ok, false, `${staleCase.label} drift must fail verification`)
      assert.match(result.errors.join("\n"), staleCase.errorPattern)
    })
  }
})

test("validate-skills exits nonzero when desk freshness child verifiers fail", async () => {
  await withValidateSkillsFixture({ hostStatus: 1, generatedStatus: 0 }, (fixtureRoot) => {
    const result = spawnSync(process.execPath, ["scripts/validate-skills.cjs"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    })

    assert.notEqual(result.status, 0, "host manifest verifier failure must fail validate-skills.cjs")
    assert.match(`${result.stdout}\n${result.stderr}`, /host manifest|test-desk-host-manifests/u)
  })

  await withValidateSkillsFixture({ hostStatus: 0, generatedStatus: 1 }, (fixtureRoot) => {
    const result = spawnSync(process.execPath, ["scripts/validate-skills.cjs"], {
      cwd: fixtureRoot,
      encoding: "utf8",
    })

    assert.notEqual(result.status, 0, "generated artifact verifier failure must fail validate-skills.cjs")
    assert.match(`${result.stdout}\n${result.stderr}`, /generated artifact|test-desk-generated-artifacts/u)
  })
})

test("root validation delegates host manifest freshness and artifact availability checks", () => {
  assert.equal(
    validatorRunsScript(hostManifestScript),
    true,
    "validate-skills.cjs must execute the host manifest verifier and fail the repo when it fails",
  )
  assert.equal(
    validatorRunsScript(generatedArtifactsScript),
    true,
    "validate-skills.cjs must execute the committed generated-artifact verifier and fail the repo when it fails",
  )

  const source = loadText("scripts", "validate-skills.cjs")
  for (const scriptName of Object.keys(requiredPackageScripts)) {
    assert.match(
      source,
      new RegExp(scriptName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `validate-skills.cjs must verify package script ${scriptName}`,
    )
  }
})

test("fingerprinted source bytes survive a Windows-style Git checkout", () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "desk-canonical-checkout-"))
  const fixtureRoot = path.join(tempRoot, "repo")
  const checkoutRoot = path.join(tempRoot, "checkout")
  const files = [
    ...loadJson("evals", "engineering-v2-kernel.json").sources,
    "plugins/desk/mcp/package.json",
    "plugins/desk/mcp/package-lock.json",
  ]
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull },
    })
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`)
  }
  try {
    for (const file of files) copyRepoFile(file, fixtureRoot)
    if (existsSync(path.join(repoRoot, ".gitattributes"))) copyRepoFile(".gitattributes", fixtureRoot)
    const binary = Buffer.from([0, 13, 10, 65, 13, 10, 0])
    writeFileSync(path.join(fixtureRoot, "opaque.bin"), binary)
    mkdirSync(checkoutRoot)
    git("init", "--quiet")
    git("-c", "core.autocrlf=false", "add", "--all")
    git("-c", "core.autocrlf=true", "-c", "core.eol=crlf", "checkout-index", "--all", `--prefix=${checkoutRoot}${path.sep}`)
    for (const file of files) {
      const expected = readFileSync(path.join(repoRoot, file))
      const actual = readFileSync(path.join(checkoutRoot, file))
      assert.equal(actual.equals(expected), true, `${file} changed during checkout`)
    }
    assert.deepEqual(readFileSync(path.join(checkoutRoot, "opaque.bin")), binary)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test("CI workflow YAML parses before its commands are inspected", () => {
  for (const filename of ["desk-mcp-tests.yml", "validate-skills.yml"]) {
    const source = loadText(".github", "workflows", filename)
    const { data } = matter(`---\n${source}\n---\n`)
    assert.equal(typeof data.jobs, "object", `${filename} must declare jobs`)
    assert.ok(Object.keys(data.jobs).length > 0, `${filename} must contain a job`)
  }
})

test("desk MCP CI runs committed artifact and host manifest verifiers", () => {
  const workflow = loadText(".github", "workflows", "desk-mcp-tests.yml")

  assert.equal(
    workflowRunsRootScript(workflow, "desk-mcp-tests", generatedArtifactsScript),
    true,
    "desk MCP CI must run the committed generated artifact verifier",
  )
  assert.equal(
    workflowRunsRootScript(workflow, "desk-mcp-tests", hostManifestScript),
    true,
    "desk MCP CI must run the host manifest drift verifier",
  )
})

test("desk MCP CI path filters include every host-facing freshness input", () => {
  const workflow = loadText(".github", "workflows", "desk-mcp-tests.yml")

  for (const eventName of ["pull_request", "push"]) {
    const filters = workflowPathFilters(workflow, eventName)
    assertPathFiltersCoverAll(
      filters,
      requiredHostFreshnessPathFilters,
      `desk MCP CI ${eventName}.paths`,
    )
    assert.ok(
      filters.includes("scripts/*.cjs") || filters.includes(hostManifestScript),
      `desk MCP CI ${eventName}.paths must include root host verifier script changes`,
    )
  }
})

test("validate-skills workflow reaches host manifest freshness through workflow or validator", () => {
  const workflow = loadText(".github", "workflows", "validate-skills.yml")
  const workflowDirectlyRunsHostVerifier = workflowRunsRootScript(
    workflow,
    "validate",
    hostManifestScript,
  )

  assert.ok(
    workflowDirectlyRunsHostVerifier || validatorRunsScript(hostManifestScript),
    "validate-skills.yml must fail on host manifest drift directly or through validate-skills.cjs",
  )
})

test("validate-skills workflow installs Desk MCP dependencies before root freshness validation", () => {
  const workflow = loadText(".github", "workflows", "validate-skills.yml")
  const steps = workflowStepBlocks(workflowJob(workflow, "validate"))
  const validateIndex = steps.findIndex((stepBlock) => (
    workflowStepRunsRootScript(stepBlock, "scripts/validate-skills.cjs")
  ))
  const installIndex = steps.findIndex((stepBlock) => (
    workflowStepWorkingDirectory(stepBlock) === "plugins/desk/mcp" &&
      workflowStepRunText(stepBlock)
        .split(/\r?\n/u)
        .some((line) => line.trim() === "npm ci")
  ))

  assert.notEqual(validateIndex, -1, "validate-skills.yml must run node scripts/validate-skills.cjs")
  assert.notEqual(installIndex, -1, "validate-skills.yml must install Desk MCP dependencies")
  assert.ok(
    installIndex < validateIndex,
    "validate-skills.yml must run npm ci before validate-skills.cjs imports MCP freshness verifiers",
  )
  assert.match(
    workflow,
    /cache-dependency-path:\s+plugins\/desk\/mcp\/package-lock\.json/u,
    "validate-skills.yml should cache the Desk MCP package-lock install",
  )
})

test("root host verifier reports selected Claude dependency drift for missing, wrong-name and wrong-range native metadata", async () => {
  const verifier = loadHostManifestVerifier()
  for (const dependencies of [
    undefined, [], [null],
    [{ name: "work-suite", version: "6.3.0" }],
    [{ name: "superpowers", version: "0.0.0" }],
  ]) {
    await withHostFreshnessFixture(async (root) => {
      const plugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
      plugin.dependencies = dependencies
      writeJson(root, "plugins/desk/.claude-plugin/plugin.json", plugin)
      const result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
      assert.equal(result.ok, false)
      assert.ok(result.errors.includes("claude-plugin Superpowers dependency drift"), result.errors.join("\n"))
    })
  }
})

test("root host verifier surfaces missing selected declarations from actual alpha inputs without TypeError", async () => {
  const verifier = loadHostManifestVerifier()
  for (const [method, label] of [["superpowers", "Superpowers"], ["work-suite", "Work Suite"]]) {
    await withHostFreshnessFixture(async (root) => {
      const manifest = loadJson("plugins", "desk", "activation", "desk.activation.json")
      assert.equal(manifest.dependencies.some((entry) => entry.id === "work-suite"), false)
      manifest.dependencies = manifest.dependencies.filter((entry) => entry.id !== method)
      manifest.provides.activation_targets[0].depends_on = ["desk", method, "plain-language", "ponytail-upstream"]
      writeJson(root, "plugins/desk/activation/desk.activation.json", manifest)
      const result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
      assert.equal(result.ok, false)
      assert.deepEqual(result.errors, [`missing ${label} dependency in activation manifest`])
      assert.deepEqual(result.checked, ["support-matrix", "copilot-bundle"])
    })
  }
})

test("root host verifier handles empty, sparse and contradictory evidence rows with precise diagnostics", async () => {
  const verifier = loadHostManifestVerifier()
  const evidence = "plugins/desk/activation/host-capability-evidence.md"
  const host = loadJson("plugins", "desk", "activation", "desk.activation.json").host_support[0].host
  for (const [kind, expected] of [
    ["empty", "support-matrix evidence columns drifted"],
    ["sparse", `support-matrix missing evidence row for ${host}`],
    ["contradictory", `support-matrix evidence disposition drift for ${host}`],
  ]) {
    await withHostFreshnessFixture(async (root) => {
      const rows = loadText(evidence).split(/\r?\n/u).filter((line) => line.startsWith("|"))
      const header = rows.slice(0, 2).join("\n")
      const body = kind === "empty" ? "" : kind === "sparse"
        ? `${header}\n| unknown-host |\n`
        : `${header}\n| ${host} | fixture | wrong-disposition | none | fixture | none | wrong fallback |\n`
      writeText(root, evidence, body)
      const result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
      assert.equal(result.ok, false)
      assert.ok(result.errors.some((error) => error.includes(expected)), result.errors.join("\n"))
      if (kind === "contradictory") assert.ok(result.errors.includes(`support-matrix fallback drift for ${host}`))
    })
  }
})

test("root host verifier reports every Codex native surface and missing activation diagnostic", async () => {
  const verifier = loadHostManifestVerifier()
  for (const missing of [false, true]) {
    await withHostFreshnessFixture(async (root) => {
      const plugin = loadJson("plugins", "desk", ".codex-plugin", "plugin.json")
      plugin.version = "0.0.0"
      plugin.skills = "./wrong/"
      plugin.mcpServers = "./wrong.json"
      if (missing) {
        delete plugin.activation
      } else {
        const codex = plugin.activation.codex
        codex.defaultMode = "wrong"
        codex.optOutModes = []
        codex.targets["desk:worker"] = { source: "wrong.toml", default: false }
        codex.mcpServers.desk.manualRegistration = true
        codex.manualSetupSteps = ["manual fixture"]
        for (const dependency of Object.values(codex.dependencies)) dependency.version = "0.0.0"
      }
      writeJson(root, "plugins/desk/.codex-plugin/plugin.json", plugin)
      const result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
      assert.equal(result.ok, false)
      for (const message of [
        "Desk version drift", "Desk surfaces drift", "default activation mode drift", "opt-out modes drift",
        "desk:worker source drift", "desk:worker default drift", "Desk MCP manual-registration drift",
        "Superpowers dependency version drift", "Plain Language dependency version drift", "Ponytail dependency version drift",
      ]) assert.ok(result.errors.includes(`codex-plugin ${message}`), result.errors.join("\n"))
      assert.equal(result.errors.includes("codex-plugin manual setup steps drift"), !missing)
    })
  }
})

test("root host verifier reports native provider lock drift for both host families", async () => {
  const verifier = loadHostManifestVerifier()
  for (const host of ["codex", "claude"]) {
    await withHostFreshnessFixture(async (root) => {
      for (const provider of ["superpowers", "plain-language", "ponytail-upstream"]) {
        const plugin = loadJson("plugins", provider, `.${host}-plugin`, "plugin.json")
        plugin.version = "0.0.0"
        writeJson(root, `plugins/${provider}/.${host}-plugin/plugin.json`, plugin)
      }
      const result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
      assert.equal(result.ok, false)
      for (const label of ["Superpowers", "Plain Language", "Ponytail"]) {
        assert.ok(result.errors.includes(`${host}-plugin ${label} provider lock drift`), result.errors.join("\n"))
      }
      if (host === "claude") assert.ok(result.errors.includes("claude-plugin Superpowers activation dependency version drift"))
    })
  }
})

test("root host verifier reports Claude surface and activation-worker drift", async () => {
  const verifier = loadHostManifestVerifier()
  await withHostFreshnessFixture(async (root) => {
    const plugin = loadJson("plugins", "desk", ".claude-plugin", "plugin.json")
    plugin.version = "0.0.0"
    plugin.agents = []
    plugin.skills = "./wrong/"
    plugin.mcpServers = "./wrong.json"
    plugin.outputStyles = "./wrong/"
    plugin.dependencies = [{ name: "wrong" }, { name: "wrong" }, { name: "wrong" }]
    writeJson(root, "plugins/desk/.claude-plugin/plugin.json", plugin)
    const activation = loadJson("plugins", "desk", "activation", "desk.activation.json")
    activation.host_activation.claude.targets["desk:worker"].source = "wrong.md"
    writeJson(root, "plugins/desk/activation/desk.activation.json", activation)
    const result = await verifier.verifyDeskHostManifests({
      repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
    })
    assert.equal(result.ok, false)
    for (const message of [
      "Desk version drift", "worker exposure drift", "Desk surfaces drift", "output style surface drift",
      "Superpowers dependency drift", "Plain Language dependency drift", "Ponytail dependency drift",
      "activation worker source drift",
    ]) assert.ok(result.errors.includes(`claude-plugin ${message}`), result.errors.join("\n"))
  })
})

test("root host verifier rejects absent worker metadata and each authored invariant surface", async () => {
  const verifier = loadHostManifestVerifier()
  await withHostFreshnessFixture(async (root) => {
    for (const file of [
      "plugins/desk/agents/worker.md", "plugins/desk/agents/worker.toml", "plugins/desk/agents/worker.agent.md",
      "plugins/desk/output-styles/worker.md", "plugins/desk/principles.md", "plugins/desk/mcp/src/activation/adapters/codex.js",
    ]) writeText(root, file, "fixture without worker metadata\n")
    const result = await verifier.verifyDeskHostManifests({
      repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
    })
    assert.equal(result.ok, false)
    for (const host of ["claude", "codex", "copilot"]) {
      assert.ok(result.errors.includes(`worker-sources ${host} worker name drift`))
      assert.ok(result.errors.includes(`worker-sources ${host} body drift`))
    }
    for (const host of ["claude", "codex-subagent", "copilot", "claude-output-style"]) {
      assert.ok(result.errors.includes(`worker-sources ${host} no-hard-wrap invariant drift`))
    }
    for (const message of [
      "claude session-start prompt drift", "principles no-hard-wrap invariant drift",
      "codex activation no-hard-wrap invariant drift", "codex activation Plain Language invariant drift",
      "codex activation Ponytail invariant drift",
    ]) assert.ok(result.errors.includes(`worker-sources ${message}`), result.errors.join("\n"))
  })
})

test("root host verifier detects missing bundled humanize files and a revived standalone export", async () => {
  const verifier = loadHostManifestVerifier()
  await withHostFreshnessFixture(async (root) => {
    for (const file of ["SKILL.md", "LICENSE"]) rmSync(path.join(root, "plugins/desk/skills/humanize", file))
    writeText(root, "skills/humanize/SKILL.md", "fixture standalone copy\n")
    const manifest = loadJson("manifest.json")
    manifest.skills.push({ name: "humanize" })
    writeJson(root, "manifest.json", manifest)
    const result = await verifier.verifyDeskHostManifests({
      repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
    })
    assert.equal(result.ok, false)
    for (const message of [
      "Desk bundle missing SKILL.md", "Desk bundle missing LICENSE",
      "remains in the standalone skill catalog", "remains exported from the standalone manifest",
    ]) assert.ok(result.errors.includes(`humanize-skill ${message}`), result.errors.join("\n"))
  })
})

test("root host verifier retains primitive I/O diagnostics without masking them as TypeErrors", async (t) => {
  const verifier = loadHostManifestVerifier()
  const fs = require("node:fs")
  await withHostFreshnessFixture(async (root) => {
    const activation = path.join(root, "plugins/desk/activation/desk.activation.json")
    const read = fs.readFileSync
    const mocked = t.mock.method(fs, "readFileSync", (file, ...args) => {
      if (file === activation) throw "fixture activation read failure"
      return read(file, ...args)
    })
    let result
    try {
      result = await verifier.verifyDeskHostManifests({
        repoRoot: root, mcpRoot, io: { stdout: { write() {} }, stderr: { write() {} } },
      })
    } finally {
      mocked.mock.restore()
    }
    assert.deepEqual(result.errors, ["fixture activation read failure"])
    assert.deepEqual(result.checked, [])
  })
})

test("root host verifier default API and CLI preserve success, refusal and stream-error outcomes", async (t) => {
  const verifier = loadHostManifestVerifier()
  const output = []
  const write = process.stdout.write.bind(process.stdout)
  const capture = t.mock.method(process.stdout, "write", (text, ...args) => {
    if (typeof text === "string" && text.startsWith("Desk host manifests verified for ")) {
      output.push(text)
      return true
    }
    return write(text, ...args)
  })
  try {
    assert.equal((await verifier.verifyDeskHostManifests()).ok, true)
    assert.equal(await verifier.runCli(), 0)
  } finally {
    capture.mock.restore()
  }
  assert.equal(output.length, 2)
  await withHostFreshnessFixture(async (root) => {
    writeText(root, "plugins/desk/activation/host-capability-evidence.md", "")
    const errors = []
    const code = await verifier.runCli({
      repoRoot: root, mcpRoot,
      io: { stdout: { write() { assert.fail("invalid metadata must not print success") } }, stderr: { write: (text) => errors.push(text) } },
    })
    assert.equal(code, 1)
    assert.ok(errors.join("").includes("support-matrix evidence columns drifted"))
  })
  for (const failure of [new Error("fixture output refused"), "fixture non-Error output refusal"]) {
    const errors = []
    const code = await verifier.runCli({
      repoRoot, mcpRoot,
      io: { stdout: { write() { throw failure } }, stderr: { write: (text) => errors.push(text) } },
    })
    assert.equal(code, 1)
    assert.equal(errors.join(""), `${failure instanceof Error ? failure.message : failure}\n`)
  }
  const errors = []
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  const out = t.mock.method(process.stdout, "write", (text, ...args) => {
    if (typeof text === "string" && text.startsWith("Desk host manifests verified for ")) throw new Error("fixture ambient output refused")
    return originalOut(text, ...args)
  })
  const err = t.mock.method(process.stderr, "write", (text, ...args) => {
    if (text === "fixture ambient output refused\n") { errors.push(text); return true }
    return originalErr(text, ...args)
  })
  let code
  try {
    code = await verifier.runCli()
  } finally {
    out.mock.restore()
    err.mock.restore()
  }
  assert.equal(code, 1)
  assert.deepEqual(errors, ["fixture ambient output refused\n"])
  const cli = spawnSync(process.execPath, [path.join(repoRoot, hostManifestScript)], {
    cwd: repoRoot, encoding: "utf8",
  })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, /^Desk host manifests verified for /u)
})
