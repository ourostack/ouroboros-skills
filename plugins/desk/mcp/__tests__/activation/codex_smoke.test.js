import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const evidencePath = path.join(
  repoRoot,
  "desk",
  "tasks",
  "2026-06-14-1335-doing-desk-dependency-activation",
  "codex-smoke-evidence.md",
)
const supportMatrixPath = path.join(repoRoot, "plugins", "desk", "activation", "support-matrix.json")
const codexDesktopUnsupportedPrimitive = "codex-desktop-scriptable-activation-smoke"

async function loadCodexSmokeHarness() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "activation", "codex-smoke.js")))
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function makeTempHost() {
  return mkdtempSync(path.join(tmpdir(), "desk-codex-smoke-"))
}

function assertUnderRoot(root, actualPath, label) {
  const relative = path.relative(root, actualPath)
  assert.equal(
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
    true,
    `${label} must stay under temp host root: ${actualPath}`,
  )
}

function assertNoHealthyPathManualSetup(trace) {
  assert.doesNotMatch(trace, /\bcodex\s+mcp\s+add\b/iu)
  assert.doesNotMatch(trace, /(?:^|[\\/])\.codex[\\/]agents(?:[\\/]|$)/iu)
  assert.doesNotMatch(trace, /\bcopy(?:ing|ied)?\s+(?:the\s+)?(?:worker|agent)\s+file\b/iu)
  assert.doesNotMatch(trace, /\buncontrolled\s+AGENTS(?:\.md)?\s+(?:append|copy|edit)\b/iu)
}

function codexMatrixRow() {
  const matrix = loadJson(supportMatrixPath)
  const row = matrix.hosts.find((host) => host.host_id === "codex")
  assert.ok(row, "support matrix must include codex")
  return row
}

test("Codex CLI activation smoke uses a temp profile and proves worker instructions plus desk_status", async () => {
  const { runCodexCliActivationSmoke } = await loadCodexSmokeHarness()
  const hostRoot = makeTempHost()
  try {
    const workspaceRoot = path.join(hostRoot, "workspace")
    mkdirSync(workspaceRoot, { recursive: true })
    const runnerCalls = []

    const result = await runCodexCliActivationSmoke({
      repoRoot,
      hostRoot,
      workspaceRoot,
      mode: "global-personal",
      codexRunner: async (request) => {
        runnerCalls.push(request)

        assert.equal(request.command, "codex")
        assert.ok(request.args.includes("exec"), "smoke must launch a new noninteractive session")
        assert.ok(request.args.includes("--json"), "smoke must preserve machine-readable evidence")
        assert.ok(request.args.includes("--ephemeral"), "smoke must avoid persistent session side effects")
        assert.ok(request.args.includes("--cd"), "smoke must pin the workspace")
        assert.ok(request.args.includes(workspaceRoot), "smoke must run from the temp workspace")
        assert.equal(request.env.DESK, path.join(hostRoot, "desk"))
        assertUnderRoot(hostRoot, request.env.HOME, "HOME")
        assertUnderRoot(hostRoot, request.env.CODEX_HOME, "CODEX_HOME")
        assert.notEqual(request.env.HOME, process.env.HOME)
        assert.notEqual(request.env.CODEX_HOME, process.env.CODEX_HOME)
        assert.match(request.prompt, /current instructions/iu)
        assert.match(request.prompt, /desk_status/u)
        assertNoHealthyPathManualSetup(JSON.stringify(request))

        return {
          exitCode: 0,
          stdout: `${JSON.stringify({
            type: "final_message",
            message: JSON.stringify({
              instruction_sources: ["CODEX_HOME/AGENTS.md"],
              combined_instructions: [
                "You are the desk worker by default.",
                "Run the `desk:session-start` skill before other work.",
              ].join("\n"),
              tools: ["desk_status"],
              desk_status: {
                status: "ok",
                root: {
                  path: path.join(hostRoot, "desk"),
                  source: "activation-config",
                },
                runtime: {
                  loaded_from_source_mirror: true,
                },
              },
            }),
          })}\n`,
          stderr: "",
        }
      },
    })

    assert.equal(runnerCalls.length, 1)
    assert.equal(result.status, "pass")
    assert.deepEqual(result.instruction_sources, ["CODEX_HOME/AGENTS.md"])
    assert.match(result.combined_instructions, /desk worker by default/u)
    assert.match(result.combined_instructions, /desk:session-start/u)
    assert.deepEqual(result.tools, ["desk_status"])
    assert.equal(result.desk_status.status, "ok")
    assert.equal(result.desk_status.root.path, path.join(hostRoot, "desk"))
    assert.equal(result.desk_status.root.source, "activation-config")
    assert.equal(result.desk_status.runtime.loaded_from_source_mirror, true)
    assert.deepEqual(result.manual_setup, {
      codex_mcp_add: false,
      copied_agent_file: false,
      uncontrolled_agents_edit: false,
    })
    assert.equal(result.real_profile_touched, false)
    assertNoHealthyPathManualSetup(JSON.stringify(result))
  } finally {
    rmSync(hostRoot, { recursive: true, force: true })
  }
})

test("Codex smoke evidence records CLI proof and an exact Desktop App fallback", () => {
  const evidence = readFileSync(evidencePath, "utf8")
  const codex = codexMatrixRow()

  assert.match(evidence, /^Status: PASS$/m)
  assert.match(evidence, /## Codex CLI Activation Smoke[\s\S]*Status: PASS/u)
  assert.match(evidence, /codex exec --json/u)
  assert.match(evidence, /CODEX_HOME/u)
  assert.match(evidence, /You are the desk worker by default\./u)
  assert.match(evidence, /desk:session-start/u)
  assert.match(evidence, /desk_status/u)
  assert.match(evidence, /developers\.openai\.com\/codex\/cli\/reference#codex-exec/u)
  assert.match(evidence, /developers\.openai\.com\/codex\/guides\/agents-md/u)
  assert.match(evidence, /developers\.openai\.com\/codex\/app-server/u)

  const desktopAppRealSmoke = /## Codex Desktop App Activation Surface[\s\S]*Status: PASS/u.test(evidence)
  const desktopAppFallback = (
    /## Codex Desktop App Activation Surface[\s\S]*Status: UNSUPPORTED/u.test(evidence) &&
    codex.unsupported_primitives.includes(codexDesktopUnsupportedPrimitive) &&
    codex.evidence_command_or_doc.includes("codex-smoke-evidence.md") &&
    /Codex Desktop lacks a stable scriptable activation-smoke primitive/iu.test(codex.fallback_behavior)
  )
  assert.equal(
    desktopAppRealSmoke || desktopAppFallback,
    true,
    "Codex App must have a real smoke artifact or an exact unsupported primitive plus fallback",
  )
})

test("Codex support matrix points at the smoke contract and evidence artifact", () => {
  const codex = codexMatrixRow()

  assert.ok(codex.source_paths.includes("plugins/desk/mcp/__tests__/activation/codex_smoke.test.js"))
  assert.ok(
    codex.source_paths.includes(
      "desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/codex-smoke-evidence.md",
    ),
  )
  assert.match(codex.evidence_command_or_doc, /node --test plugins\/desk\/mcp\/__tests__\/activation\/codex_smoke\.test\.js/u)
  assert.match(codex.evidence_command_or_doc, /codex-smoke-evidence\.md/u)
  assert.ok(codex.unsupported_primitives.includes(codexDesktopUnsupportedPrimitive))
})

