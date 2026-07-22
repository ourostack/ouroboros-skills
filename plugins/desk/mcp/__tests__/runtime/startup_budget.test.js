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

test("startup reports snapshot plus vector-pack fallback and startup errors", async () => {
  const root = makeRoot("desk-startup-budget-edges-")
  const vectorPackRuntime = runtimeServerWithEnsureIndex({
    ensureIndex: async () => ({
      built: true,
      reason: "semantic_missing",
      fallback: "vector_packs",
      snapshot: {
        restored: true,
        snapshot_id: "startup-snapshot-with-packs",
      },
      semantic: {
        chunks_total: 2,
        vectors_indexed: 2,
        missing_vectors: 0,
      },
    }),
  })
  const errorRuntime = runtimeServerWithEnsureIndex({
    ensureIndex: async () => {
      throw new Error("startup repair unavailable")
    },
  })
  try {
    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => vectorPackRuntime,
    })
    assert.equal(
      vectorPackRuntime.startCalls[0].statusContext.startup.fallback_mode,
      "snapshot_then_vector_packs",
    )
    assert.equal(vectorPackRuntime.startCalls[0].statusContext.startup.degraded, false)

    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => errorRuntime,
    })
    const errorStartup = errorRuntime.startCalls[0].statusContext.startup
    assert.equal(errorStartup.ensure_index.reason, "startup_error")
    assert.equal(errorStartup.ensure_index.error.message, "startup repair unavailable")
    assert.equal(errorStartup.fallback_mode, "startup_error")
    assert.equal(errorStartup.degraded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("startup classifies every bounded fallback mode", async () => {
  const root = makeRoot("desk-startup-budget-modes-")
  async function startupFor(resultOrThrow) {
    const runtimeServer = runtimeServerWithEnsureIndex({
      ensureIndex: async () => {
        if (resultOrThrow instanceof Error || typeof resultOrThrow === "string") {
          throw resultOrThrow
        }
        return resultOrThrow
      },
    })

    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => runtimeServer,
    })
    return runtimeServer.startCalls[0].statusContext.startup
  }

  try {
    assert.equal((await startupFor({
      built: true,
      reason: "semantic_missing",
      fallback: "vector_packs",
      semantic: { chunks_total: 1, vectors_indexed: 1, missing_vectors: 0 },
    })).fallback_mode, "vector_packs")

    assert.equal((await startupFor({
      built: false,
      reason: "snapshot_restored",
      snapshot: { restored: true, snapshot_id: "snapshot-only" },
      semantic: { chunks_total: 1, vectors_indexed: 1, missing_vectors: 0 },
    })).fallback_mode, "snapshot")

    const rebuild = await startupFor({
      built: true,
      reason: "stale",
      semantic: { chunks_total: 1, vectors_indexed: 1, missing_vectors: 0 },
    })
    assert.equal(rebuild.fallback_mode, "rebuild")
    assert.equal(rebuild.degraded, false)

    const degradedLexical = await startupFor({
      built: true,
      reason: "stale",
      semantic: { chunks_total: 1, vectors_indexed: 0, missing_vectors: 1 },
    })
    assert.equal(degradedLexical.fallback_mode, "lexical_only")
    assert.equal(degradedLexical.degraded, true)

    assert.equal((await startupFor({ built: false, reason: "fresh" })).fallback_mode, "fresh")

    const stringError = await startupFor("string startup failure")
    assert.equal(stringError.ensure_index.reason, "startup_error")
    assert.equal(stringError.ensure_index.error.message, "string startup failure")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("startup stops waiting and aborts when bounded ensureIndex exceeds budget", async () => {
  const root = makeRoot("desk-startup-budget-timeout-")
  let signalSeen = false
  let abortSeen = false
  const runtimeServer = runtimeServerWithEnsureIndex({
    ensureIndex: async (_deskRoot, opts = {}) => {
      signalSeen = opts.signal instanceof AbortSignal
      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          abortSeen = true
        }, { once: true })
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      throw new Error("late rebuild rejection")
    },
  })
  try {
    const startedAt = Date.now()
    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => runtimeServer,
    })
    const elapsedMs = Date.now() - startedAt

    assert.equal(signalSeen, true)
    assert.equal(abortSeen, true)
    assert.ok(elapsedMs < 500, `startup took ${elapsedMs}ms despite 250ms budget`)
    const startup = runtimeServer.startCalls[0].statusContext.startup
    assert.equal(startup.ensure_index.reason, "startup_budget_exceeded")
    assert.equal(startup.fallback_mode, "startup_deferred")
    assert.equal(startup.degraded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("startup skips bounded ensureIndex when the runtime server has no ensureIndex hook", async () => {
  const root = makeRoot("desk-startup-budget-no-hook-")
  const startCalls = []
  try {
    await main({
      argv: ["--root", root],
      env: {},
      cwd: root,
      homeDir: root,
      runtimeImporter: async () => ({
        async startServer(args) {
          startCalls.push(args)
        },
      }),
    })

    assert.equal(startCalls.length, 1)
    assert.deepEqual(startCalls[0].statusContext.startup, {
      fallback_mode: "not_checked",
      degraded: false,
      duration_ms: 0,
      budget_ms: 250,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
