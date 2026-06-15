// Unit 17d: red contract for bounded startup fallback before MCP registration.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { main } from "../../index.js"

function makeRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

function runtimeServerWithEnsureIndex({ ensureIndex }) {
  const events = []
  const startCalls = []
  return {
    _deskRuntime: {
      runtime_cache_dir: "/runtime-cache",
      source_mirror_path: "/runtime-cache/source-mirror/hash",
      target: `${process.platform}-${process.arch}-node-${process.versions.modules}`,
      loaded_from_source_mirror: true,
    },
    events,
    startCalls,
    async ensureIndex(...args) {
      events.push("ensureIndex")
      return ensureIndex(...args)
    },
    async startServer(args) {
      events.push("startServer")
      startCalls.push(args)
    },
  }
}

test("startup runs bounded ensureIndex before registering the server and forwards artifact status", async () => {
  const root = makeRoot("desk-startup-budget-snapshot-")
  const ensureCalls = []
  const runtimeServer = runtimeServerWithEnsureIndex({
    ensureIndex: async (deskRoot, opts = {}) => {
      ensureCalls.push({ deskRoot, opts })
      return {
        built: true,
        reason: "snapshot_restored",
        snapshot: {
          restored: true,
          reason: "snapshot_restored",
          snapshot_id: "startup-compatible",
          freshness: {
            artifact_source_scope: "fresh",
            document_tree: "fresh",
          },
        },
        semantic: {
          chunks_total: 3,
          vectors_indexed: 3,
          missing_vectors: 0,
        },
      }
    },
  })
  try {
    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => runtimeServer,
    })

    assert.equal(ensureCalls.length, 1)
    assert.equal(ensureCalls[0].deskRoot, root)
    assert.equal(ensureCalls[0].opts.startup, true)
    assert.equal(ensureCalls[0].opts.budgetMs, 250)
    assert.equal(runtimeServer.startCalls.length, 1)
    assert.deepEqual(runtimeServer.events, ["ensureIndex", "startServer"])
    const statusContext = runtimeServer.startCalls[0].statusContext
    assert.equal(statusContext.startup.ensure_index.reason, "snapshot_restored")
    assert.equal(statusContext.startup.ensure_index.snapshot.snapshot_id, "startup-compatible")
    assert.equal(statusContext.startup.duration_ms >= 0, true)
    assert.equal(statusContext.startup.budget_ms, 250)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("startup reports lexical fallback when snapshots and vector packs cannot cover offline startup", async () => {
  const root = makeRoot("desk-startup-budget-lexical-")
  const runtimeServer = runtimeServerWithEnsureIndex({
    ensureIndex: async () => ({
      built: true,
      reason: "missing",
      snapshot: {
        restored: false,
        reason: "no_compatible_snapshot",
      },
      semantic: {
        chunks_total: 1,
        vectors_indexed: 0,
        missing_vectors: 1,
        embedding_available: false,
        embedding_diagnostic: {
          reason: "embedding_generation_failed",
        },
      },
    }),
  })
  try {
    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => runtimeServer,
    })

    const statusContext = runtimeServer.startCalls[0].statusContext
    assert.deepEqual(runtimeServer.events, ["ensureIndex", "startServer"])
    assert.ok(statusContext.startup, "startup should forward bounded fallback status context")
    assert.equal(statusContext.startup.ensure_index.reason, "missing")
    assert.equal(statusContext.startup.ensure_index.snapshot.reason, "no_compatible_snapshot")
    assert.equal(statusContext.startup.ensure_index.semantic.embedding_available, false)
    assert.equal(
      statusContext.startup.ensure_index.semantic.embedding_diagnostic.reason,
      "embedding_generation_failed",
    )
    assert.equal(statusContext.startup.fallback_mode, "lexical_only")
    assert.equal(statusContext.startup.degraded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
