import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as path from "node:path"

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url))
const pluginRoot = path.join(repoRoot, "plugins", "superpowers")
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"))
const pinnedSkills = [
  "brainstorming", "dispatching-parallel-agents", "executing-plans", "finishing-a-development-branch",
  "receiving-code-review", "requesting-code-review", "subagent-driven-development", "systematic-debugging",
  "test-driven-development", "using-git-worktrees", "using-superpowers", "verification-before-completion",
  "writing-plans", "writing-skills",
]

test("Superpowers provider is pinned, licensed, and byte-bound through the existing source lock", () => {
  const source = readJson("upstream-sources.lock.json").sources.find((entry) => entry.repository === "obra/superpowers")
  assert.ok(source, "the existing lock must include the Superpowers provider")
  assert.equal(source.commit, "b36e0829c6d0140e93cfef2ca599b1b07d4a7797")
  assert.equal(source.license, "MIT")
  assert.ok(source.files.some((file) => file.sourcePath === "LICENSE"))
  for (const file of source.files) {
    assert.equal(
      createHash("sha256").update(readFileSync(path.join(repoRoot, file.generatedPath))).digest("hex"),
      file.sha256,
      file.generatedPath,
    )
  }
  for (const relativePath of ["plugin.json", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const manifest = JSON.parse(readFileSync(path.join(pluginRoot, relativePath), "utf8"))
    assert.equal(manifest.name, "superpowers")
    assert.equal(manifest.version, "6.3.0")
  }
})

test("Superpowers lock contains every pinned skill and bootstrap-critical source, not a vacuous subset", () => {
  const source = readJson("upstream-sources.lock.json").sources.find((entry) => entry.repository === "obra/superpowers")
  assert.ok(source, "the lock must explicitly include obra/superpowers")
  const paths = source.files.map((file) => file.sourcePath)
  for (const required of ["LICENSE", "hooks/hooks.json", "hooks/run-hook.cmd", "hooks/session-start", ...pinnedSkills.map((skill) => `skills/${skill}/SKILL.md`)]) {
    assert.ok(paths.includes(required), `missing mandatory pinned source: ${required}`)
    assert.equal(source.files.find((file) => file.sourcePath === required).generatedPath, `plugins/superpowers/${required}`)
  }
  assert.equal(new Set(paths).size, paths.length, "duplicate lock paths cannot stand in for complete source coverage")
})

test("shipped Superpowers root manifest binds existing skills and the authored Copilot hook adapter", () => {
  assert.ok(existsSync(path.join(pluginRoot, "plugin.json")), "Superpowers root plugin.json must ship")
  const manifest = readJson("plugins/superpowers/plugin.json")
  assert.equal(manifest.skills, "./skills/")
  assert.equal(manifest.hooks, "./hooks/copilot-hooks.json")
  assert.equal(statSync(path.join(pluginRoot, manifest.skills)).isDirectory(), true)
  assert.equal(statSync(path.join(pluginRoot, manifest.hooks)).isFile(), true)
  const adapter = readJson("plugins/superpowers/hooks/copilot-hooks.json")
  assert.deepEqual(adapter, {
    version: 1,
    hooks: {
      sessionStart: [{
        type: "command",
        bash: 'bash "${PLUGIN_ROOT}/hooks/run-hook.cmd" session-start',
        powershell: '& "${PLUGIN_ROOT}\\hooks\\run-hook.cmd" session-start',
        timeoutSec: 10,
      }],
    },
  })
  assert.equal(statSync(path.join(pluginRoot, "hooks/run-hook.cmd")).isFile(), true)
  assert.equal(statSync(path.join(pluginRoot, "hooks/session-start")).isFile(), true)
  const source = readJson("upstream-sources.lock.json").sources.find((entry) => entry.repository === "obra/superpowers")
  assert.ok(source)
  assert.equal(source.files.some((file) => file.generatedPath === "plugins/superpowers/hooks/copilot-hooks.json"), false, "the authored adapter is not pristine upstream payload")
})

function runBootstrap(platform) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot }
  delete env.CURSOR_PLUGIN_ROOT
  delete env.COPILOT_CLI
  if (platform === "copilot") env.COPILOT_CLI = "1"
  const result = spawnSync("bash", [path.join(pluginRoot, "hooks", "run-hook.cmd"), "session-start"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test("maintained Superpowers bootstrap emits Copilot additionalContext without a second context envelope", () => {
  const output = runBootstrap("copilot")
  assert.deepEqual(Object.keys(output), ["additionalContext"])
  const skill = readFileSync(path.join(pluginRoot, "skills", "using-superpowers", "SKILL.md"), "utf8")
  assert.ok(output.additionalContext.includes(skill.trimEnd()))
  assert.match(output.additionalContext, /superpowers:using-superpowers/u)
})

test("maintained Superpowers bootstrap keeps the Claude envelope distinct", () => {
  const output = runBootstrap("claude")
  assert.deepEqual(Object.keys(output), ["hookSpecificOutput"])
  assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart")
  assert.match(output.hookSpecificOutput.additionalContext, /superpowers:using-superpowers/u)
})
