import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { callTool, TOOL_IMPLS } from "../../src/server.js"
import { TOOL_DESCRIPTIONS, TOOL_NAMES } from "../../src/tool-names.js"
import { doctorRuntime } from "../../src/tools/doctor.js"

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "desk-doctor-"))
}

function parseToolResult(response) {
  assert.equal(response.isError, undefined, response.content?.[0]?.text)
  return JSON.parse(response.content[0].text)
}

test("desk_doctor is registered as the healthy counterpart to diagnostic recovery", () => {
  assert.ok(TOOL_NAMES.includes("desk_doctor"), `registered tools: ${TOOL_NAMES.join(", ")}`)
  assert.equal(typeof TOOL_IMPLS.desk_doctor, "function")
  assert.match(TOOL_DESCRIPTIONS.desk_doctor, /runtime|diagnostic|recover/iu)
})

test("healthy desk_doctor uses the same dependency-free diagnostic vocabulary", async () => {
  const root = makeRoot()
  try {
    const statusContext = {
      runtime: {
        target: {
          id: "darwin-arm64-node-127",
          platform: "darwin",
          arch: "arm64",
          node_abi: "127",
        },
        shipped_targets: [
          {
            id: "darwin-arm64-node-127",
            platform: "darwin",
            arch: "arm64",
            node_abi: "127",
          },
        ],
        paths_checked: ["/plugin/artifacts/runtime-deps/1.3.2/support-matrix.json"],
        runtime_cache_dir: "/cache/desk/runtime",
        support_matrix_path: "/plugin/artifacts/runtime-deps/1.3.2/support-matrix.json",
      },
    }
    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_doctor",
      input: {},
      statusContext,
    }))

    assert.deepEqual(Object.keys(body).sort(), [
      "mode",
      "reason",
      "remediation",
      "runtime",
      "status",
      "summary",
    ])
    assert.equal(body.status, "ok")
    assert.equal(body.mode, "healthy")
    assert.equal(body.reason, "ready")
    assert.match(body.summary, /ready|healthy/iu)
    assert.deepEqual(body.runtime, {
      state: "ready",
      current_target: statusContext.runtime.target,
      shipped_targets: statusContext.runtime.shipped_targets,
      paths_checked: statusContext.runtime.paths_checked,
      runtime_cache_path: statusContext.runtime.runtime_cache_dir,
      support_matrix_path: statusContext.runtime.support_matrix_path,
    })

    assert.deepEqual(body.remediation, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("healthy desk_doctor tolerates empty context and prefers normalized runtime fields", () => {
  assert.deepEqual(doctorRuntime().runtime, {
    state: "ready",
    current_target: undefined,
    shipped_targets: [],
    paths_checked: [],
    runtime_cache_path: undefined,
    support_matrix_path: undefined,
  })
  assert.deepEqual(doctorRuntime({
    statusContext: {
      runtime: {
        current_target: "darwin-arm64-node-127",
        target: "ignored-target",
        runtime_cache_path: "/normalized-cache",
        runtime_cache_dir: "/ignored-cache",
        shipped_targets: [],
        paths_checked: [],
        support_matrix_path: "/matrix",
      },
    },
  }).runtime, {
    state: "ready",
    current_target: "darwin-arm64-node-127",
    shipped_targets: [],
    paths_checked: [],
    runtime_cache_path: "/normalized-cache",
    support_matrix_path: "/matrix",
  })
})
