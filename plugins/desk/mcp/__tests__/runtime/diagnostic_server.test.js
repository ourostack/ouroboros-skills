import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { PassThrough } from "node:stream"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const diagnosticServerUrl = pathToFileURL(
  path.join(mcpRoot, "src", "runtime", "diagnostic-server.js"),
).href

async function loadDiagnosticServer() {
  return import(diagnosticServerUrl)
}

function fixtureDiagnostic() {
  return {
    status: "degraded",
    mode: "diagnostic",
    reason: "no_compatible_node",
    summary: "Desk could not find a local Node runtime matching a shipped offline dependency pack.",
    runtime: {
      current_target: {
        id: "darwin-arm64-node-115",
        platform: "darwin",
        arch: "arm64",
        node_abi: "115",
      },
      shipped_targets: [
        {
          id: "darwin-arm64-node-127",
          platform: "darwin",
          arch: "arm64",
          node_abi: "127",
        },
      ],
      paths_checked: [
        "/usr/local/bin/node",
        "/Users/unit/.nvm/versions/node/v22.0.0/bin/node",
      ],
      runtime_cache_path: "/Users/unit/.cache/desk/runtime",
      support_matrix_path: "/plugin/artifacts/runtime-deps/1.3.2/support-matrix.json",
    },
    remediation: [
      {
        action: "use_shipped_node",
        message: "Start Desk with a local Node runtime whose module ABI is 127.",
      },
      {
        action: "refresh_plugin",
        message: "Refresh the Desk plugin if the committed runtime support matrix or pack is missing.",
      },
    ],
  }
}

function parseMessages(text) {
  return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line))
}

function parseToolPayload(message) {
  return JSON.parse(message.result.content[0].text)
}

test("diagnostic MCP completes the core handshake and keeps remediation coherent across tool calls", async () => {
  const { startDiagnosticServer } = await loadDiagnosticServer()
  const input = new PassThrough()
  const output = new PassThrough()
  const chunks = []
  output.on("data", (chunk) => chunks.push(chunk))
  const diagnostic = fixtureDiagnostic()
  const running = startDiagnosticServer({
    diagnostic,
    input,
    output,
    serverVersion: "1.3.2",
  })

  input.end([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "unit-diagnostic-client", version: "1.0.0" },
      },
    },
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "ping",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "desk_status",
        arguments: {},
      },
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "desk_doctor",
        arguments: {},
      },
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "desk_task_update",
        arguments: {
          track: "ops",
          slug: "must-not-run",
        },
      },
    },
  ].map((message) => JSON.stringify(message)).join("\n") + "\n")

  await running
  const messages = parseMessages(Buffer.concat(chunks).toString("utf8"))
  assert.deepEqual(messages.map((message) => message.id), [1, 2, 3, 4, 5, 6])
  assert.equal(messages[0].result.protocolVersion, "2025-06-18")
  assert.deepEqual(messages[0].result.capabilities, { tools: {} })
  assert.equal(messages[0].result.serverInfo.name, "desk-mcp-diagnostic")
  assert.deepEqual(messages[1].result, {})
  assert.deepEqual(
    messages[2].result.tools.map((tool) => tool.name),
    ["desk_status", "desk_doctor"],
  )

  const status = parseToolPayload(messages[3])
  const doctor = parseToolPayload(messages[4])
  const rejectedMutation = parseToolPayload(messages[5])
  assert.equal(messages[3].result.isError, undefined)
  assert.equal(messages[4].result.isError, undefined)
  assert.equal(messages[5].result.isError, true)
  assert.deepEqual(Object.keys(status).sort(), [
    "mode",
    "reason",
    "remediation",
    "runtime",
    "status",
    "summary",
  ])
  assert.equal(status.status, "degraded")
  assert.equal(status.mode, "diagnostic")
  assert.equal(status.reason, "no_compatible_node")
  assert.equal(doctor.reason, status.reason)
  assert.equal(rejectedMutation.reason, status.reason)
  assert.deepEqual(doctor.runtime, status.runtime)
  assert.deepEqual(rejectedMutation.runtime, status.runtime)
  assert.deepEqual(doctor.remediation, status.remediation)
  assert.deepEqual(rejectedMutation.remediation, status.remediation)
  assert.match(rejectedMutation.summary, /unavailable while Desk is in diagnostic mode/u)
  assert.doesNotMatch(Buffer.concat(chunks).toString("utf8"), /\n\s+at\s+/u)
})

test("diagnostic MCP imports and serves with native and SDK module resolution poisoned", () => {
  const root = mkdtempSync(path.join(tmpdir(), "desk-diagnostic-loader-"))
  try {
    const loaderPath = path.join(root, "poison-loader.mjs")
    writeFileSync(
      loaderPath,
      [
        `const forbiddenPackages = new Set(["@modelcontextprotocol/sdk", "better-sqlite3", "sqlite-vec"])`,
        `export async function resolve(specifier, context, nextResolve) {`,
        `  if (forbiddenPackages.has(specifier) || specifier.includes("/@modelcontextprotocol/sdk/") || specifier.endsWith("/src/server.js") || specifier.endsWith("/src/tools/status.js")) {`,
        `    throw new Error("poisoned diagnostic import: " + specifier)`,
        `  }`,
        `  return nextResolve(specifier, context)`,
        `}`,
        "",
      ].join("\n"),
      "utf8",
    )
    const script = [
      `import { PassThrough } from "node:stream"`,
      `const { startDiagnosticServer } = await import(${JSON.stringify(diagnosticServerUrl)})`,
      `const input = new PassThrough()`,
      `const output = new PassThrough()`,
      `let response = ""`,
      `output.on("data", (chunk) => { response += chunk.toString("utf8") })`,
      `const running = startDiagnosticServer({`,
      `  diagnostic: ${JSON.stringify(fixtureDiagnostic())},`,
      `  input,`,
      `  output,`,
      `  serverVersion: "1.3.2",`,
      `})`,
      `input.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }) + "\\n")`,
      `await running`,
      `const parsed = JSON.parse(response.trim())`,
      `if (parsed.id !== 1 || JSON.stringify(parsed.result) !== "{}") process.exit(23)`,
      `process.stdout.write("diagnostic-ok\\n")`,
      "",
    ].join("\n")
    const result = spawnSync(process.execPath, [
      "--experimental-loader",
      pathToFileURL(loaderPath).href,
      "--input-type=module",
      "--eval",
      script,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: "",
      },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stdout, "diagnostic-ok\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
