import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")

async function loadDiagnostics() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "diagnostics.js")))
}

const currentTarget = {
  id: "darwin-arm64-node-115",
  platform: "darwin",
  arch: "arm64",
  node_abi: "115",
}
const shippedTargets = [{
  id: "darwin-arm64-node-127",
  platform: "darwin",
  arch: "arm64",
  node_abi: "127",
}]

test("runtime diagnostic vocabulary distinguishes every recoverable first-boot failure", async () => {
  const { createRuntimeDiagnostic } = await loadDiagnostics()
  for (const reason of [
    "unsupported_target",
    "missing_pack",
    "corrupt_pack",
    "runtime_restore_failed",
    "runtime_inspection_failed",
    "node_selection_failed",
    "no_compatible_node",
    "guarded_reexec_failure",
  ]) {
    const diagnostic = createRuntimeDiagnostic({
      reason,
      failureKind: reason === "corrupt_pack" ? "checksum_mismatch" : undefined,
      currentTarget,
      shippedTargets,
      pathsChecked: ["/usr/bin/node", "/plugin/runtime-deps/support-matrix.json"],
      runtimeCachePath: "/cache/desk/runtime",
      supportMatrixPath: "/plugin/runtime-deps/support-matrix.json",
      cause: new Error("SECRET internal failure\n    at private-frame.js:42:1"),
    })
    assert.equal(diagnostic.status, "degraded")
    assert.equal(diagnostic.mode, "diagnostic")
    assert.equal(diagnostic.reason, reason)
    assert.equal(
      diagnostic.failure_kind,
      reason === "corrupt_pack" ? "checksum_mismatch" : undefined,
    )
    assert.equal(diagnostic.runtime.current_target, currentTarget)
    assert.equal(diagnostic.runtime.shipped_targets, shippedTargets)
    assert.deepEqual(diagnostic.runtime.paths_checked, [
      "/usr/bin/node",
      "/plugin/runtime-deps/support-matrix.json",
    ])
    assert.equal(diagnostic.runtime.runtime_cache_path, "/cache/desk/runtime")
    assert.equal(diagnostic.runtime.support_matrix_path, "/plugin/runtime-deps/support-matrix.json")
    assert.ok(diagnostic.remediation.length > 0, reason)
    assert.match(diagnostic.summary, /Desk|runtime|pack|Node/iu)
    assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|private-frame|stack/iu)
  }
})

test("corrupt-pack diagnostics retain actionable failure kinds", async () => {
  const { createRuntimeDiagnostic } = await loadDiagnostics()
  for (const failureKind of [
    "checksum_mismatch",
    "manifest_mismatch",
    "archive_corrupt",
  ]) {
    const diagnostic = createRuntimeDiagnostic({
      reason: "corrupt_pack",
      failureKind,
      currentTarget,
      shippedTargets,
      pathsChecked: [],
      runtimeCachePath: "/cache",
      supportMatrixPath: "/matrix.json",
    })

    assert.equal(diagnostic.failure_kind, failureKind)
    assert.match(
      diagnostic.remediation.map((item) => item.message).join("\n"),
      /refresh|rebuild|pack/iu,
    )
  }
})

test("runtime diagnostics provide safe defaults for unknown failures", async () => {
  const { createRuntimeDiagnostic } = await loadDiagnostics()
  const diagnostic = createRuntimeDiagnostic({ reason: "unexpected_failure" })
  assert.equal(diagnostic.reason, "unexpected_failure")
  assert.match(diagnostic.summary, /could not prepare/u)
  assert.deepEqual(diagnostic.runtime.shipped_targets, [])
  assert.deepEqual(diagnostic.runtime.paths_checked, [])
  assert.equal(diagnostic.runtime.runtime_cache_path, null)
  assert.equal(diagnostic.runtime.support_matrix_path, null)
  assert.equal(diagnostic.remediation[0].action, "refresh_plugin")
})
