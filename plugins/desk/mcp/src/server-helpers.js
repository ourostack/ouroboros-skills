// server-helpers.js — pieces of server.js that the search tools call into.
//
// Split out from server.js so `src/tools/search.js` can call ensureIndex()
// without creating an import cycle (server.js imports the search tools, the
// search tools need ensureIndex, ensureIndex used to live in server.js).

import { existsSync, readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { closeDb, indexDbPath, openDb } from "./db/init.js"
import { isIndexFresh, rebuildIndex } from "./indexer/index.js"
import { probeEmbeddingService } from "./indexer/embed.js"
import { ACTIVE_EMBEDDING_SPEC } from "./indexer/spec.js"
import { restoreSnapshotToState } from "./snapshots/restore.js"

const EMBEDDING_GENERATION_FAILURE_DIAGNOSTIC = {
  reason: "embedding_generation_failed",
  message: "one or more document embeddings could not be generated during rebuild",
}
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MCP_ROOT = path.resolve(MODULE_DIR, "..")
const DEFAULT_PLUGIN_ROOT = path.resolve(DEFAULT_MCP_ROOT, "..")
const SNAPSHOT_DB_SCHEMA = { id: "desk-index-sqlite-v1", version: 1 }
const SNAPSHOT_SQLITE_VEC_TABLE = "vec0"
let configuredArtifactPluginRoot = null

/**
 * Bring the on-disk index up to date for `deskRoot`. Idempotent: when the
 * DB exists and no markdown file has an mtime newer than last_indexed_at,
 * does nothing. Called at server-boot and re-called at the top of each
 * search-tool invocation so single-process callers (tests, the daemon) see
 * a consistent view after writes.
 *
 * @param {string} deskRoot
 * @param {object} [opts]
 * @param {object} [opts.embed] — forwarded to rebuildIndex (test injection).
 * @param {boolean} [opts.skipEmbed] — skip embedding when (re)building.
 * @param {object} [opts.vectorPacks] — forwarded to rebuildIndex.
 * @returns {Promise<{ built: boolean, reason: string,
 *                     summary?: import("./indexer/index.js").RebuildSummary,
 *                     semantic?: object }>}
 *   When `built=true`, `summary` carries the rebuildIndex counts. When
 *   `built=false` (fresh), `summary` is omitted — nothing was reindexed.
 */
export async function ensureIndex(deskRoot, opts = {}) {
  const effectiveOpts = resolveEnsureIndexOptions(opts)
  const dbPath = indexDbPath(deskRoot)
  let snapshot = null
  let dbExisted = existsSync(dbPath)
  throwIfAborted(effectiveOpts.signal)
  if (!dbExisted && effectiveOpts.snapshots?.pluginRoot) {
    snapshot = await restoreSnapshotToState({
      deskRoot,
      ...effectiveOpts.snapshots,
    })
    dbExisted = existsSync(dbPath)
  }
  throwIfAborted(effectiveOpts.signal)
  const db = openDb(deskRoot)
  try {
    const semanticBefore = getSemanticCoverage(db)
    let repairMissing = false
    if (dbExisted) {
      const fresh = await isIndexFresh(deskRoot, db)
      if (fresh) {
        if (!snapshotNeedsReconcile(snapshot)) {
          const repair = await maybeRepairMissingEmbeddings(
            deskRoot,
            db,
            effectiveOpts,
            semanticBefore,
          )
          if (repair) return withSnapshot(repair, snapshot)
          if (snapshot) {
            return withSnapshot(
              { built: false, reason: "snapshot_restored", semantic: semanticBefore },
              snapshot,
            )
          }
          return withSnapshot(
            { built: false, reason: "fresh", semantic: semanticBefore },
            snapshot,
          )
        }
      }
      repairMissing = await shouldRepairMissingEmbeddings(effectiveOpts, semanticBefore)
    }
    const summary = await rebuildIndex(deskRoot, {
      ...effectiveOpts,
      db,
      reembedMissing: repairMissing,
    })
    const semanticAfter = getSemanticCoverage(db)
    assignEmbeddingAvailability(semanticAfter, semanticBefore, summary)
    const result = {
      built: true,
      reason: snapshot?.restored ? "stale_snapshot_reconciled" : dbExisted ? "stale" : "missing",
      summary,
      semantic: semanticAfter,
      vector_packs: summary.vector_packs,
    }
    const fallback = fallbackFor(effectiveOpts, snapshot, summary.vector_packs)
    if (fallback === "vector_packs") {
      result.vector_packs = fallbackVectorPackStatus(summary.vector_packs)
    }
    if (snapshot?.restored) {
      result.snapshot = {
        ...snapshot,
        reconciled: true,
      }
      if (fallback) result.fallback = fallback
    } else {
      return withSnapshot(result, snapshot, fallback)
    }
    return result
  } finally {
    closeDb(db)
  }
}

export function resolveEnsureIndexOptions(opts = {}) {
  const pluginRoot = resolveArtifactPluginRoot(opts)
  const effective = { ...opts }
  effective.snapshots = resolveSnapshotOptions({ opts, pluginRoot })
  effective.vectorPacks = resolveVectorPackOptions({ opts, pluginRoot })
  return effective
}

export function configureRuntimeArtifacts({ pluginRoot } = {}) {
  configuredArtifactPluginRoot = textOrNull(pluginRoot)
    ? path.resolve(pluginRoot)
    : null
  return { pluginRoot: configuredArtifactPluginRoot }
}

function snapshotNeedsReconcile(snapshot) {
  if (!snapshot?.restored) return false
  return snapshot.freshness?.artifact_source_scope === "stale" ||
    snapshot.freshness?.document_tree === "stale"
}

function resolveSnapshotOptions({ opts, pluginRoot }) {
  if (opts.snapshots === false || opts.snapshots === null) return undefined
  if (opts.snapshots !== undefined) {
    return {
      ...defaultSnapshotCompatibilityContext(),
      pluginRoot,
      ...opts.snapshots,
    }
  }
  if (!hasSnapshotArtifacts(pluginRoot)) return undefined
  return {
    pluginRoot,
    ...defaultSnapshotCompatibilityContext(),
  }
}

function resolveVectorPackOptions({ opts, pluginRoot }) {
  if (opts.vectorPacks === false || opts.vectorPacks === null) return undefined
  if (opts.vectorPacks !== undefined) {
    return {
      pluginRoot,
      ...opts.vectorPacks,
    }
  }
  if (!hasVectorPackArtifacts(pluginRoot)) return undefined
  return { pluginRoot }
}

function resolveArtifactPluginRoot(opts) {
  return path.resolve(
    textOrNull(opts.snapshots?.pluginRoot) ??
      textOrNull(opts.vectorPacks?.pluginRoot) ??
      textOrNull(process.env.DESK_PLUGIN_ROOT) ??
      configuredArtifactPluginRoot ??
      DEFAULT_PLUGIN_ROOT,
  )
}

function defaultSnapshotCompatibilityContext() {
  return {
    expectedDbSchema: SNAPSHOT_DB_SCHEMA,
    expectedSqliteVec: {
      package: "sqlite-vec",
      version: sqliteVecVersion(),
      table: SNAPSHOT_SQLITE_VEC_TABLE,
    },
    expectedRuntime: {
      platform: process.platform,
      arch: process.arch,
      node_abi: `node-${process.versions.modules}`,
    },
  }
}

function sqliteVecVersion() {
  const packageLock = JSON.parse(
    readFileSync(path.join(DEFAULT_MCP_ROOT, "package-lock.json"), "utf8"),
  )
  return packageLock.packages?.["node_modules/sqlite-vec"]?.version
}

function hasSnapshotArtifacts(pluginRoot) {
  return hasArtifactFiles(
    path.join(pluginRoot, "artifacts", "snapshots", ACTIVE_EMBEDDING_SPEC.id),
    ".sqlite.zst",
  )
}

function hasVectorPackArtifacts(pluginRoot) {
  return hasArtifactFiles(
    path.join(pluginRoot, "artifacts", "vector-packs", ACTIVE_EMBEDDING_SPEC.id),
    ".jsonl",
  )
}

function hasArtifactFiles(dir, suffix) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith(suffix))
  } catch {
    return false
  }
}

function textOrNull(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null
}

export function getSemanticCoverage(db) {
  const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n
  const vectors = db.prepare(
    `SELECT COUNT(*) AS n
     FROM chunks c
     JOIN chunk_vecs v ON v.chunk_id = c.id
     WHERE c.embedding_spec_id = ?
       AND c.chunker_id = ?
       AND c.normalization_id = ?`,
  ).get(
    ACTIVE_EMBEDDING_SPEC.id,
    ACTIVE_EMBEDDING_SPEC.chunker_id,
    ACTIVE_EMBEDDING_SPEC.normalization_id,
  ).n
  return {
    chunks_total: chunks,
    vectors_indexed: vectors,
    missing_vectors: Math.max(0, chunks - vectors),
  }
}

async function shouldRepairMissingEmbeddings(opts, semantic) {
  if (!semantic || semantic.missing_vectors <= 0) return false
  if (opts.vectorPacks?.pluginRoot) return true
  if (opts.skipEmbed) return false
  const probe = await probeEmbeddingService(opts.embed ?? {})
  semantic.embedding_available = probe.available
  semantic.embedding_diagnostic = probe.diagnostic
  return probe.available
}

async function maybeRepairMissingEmbeddings(deskRoot, db, opts, semantic) {
  const shouldRepair = await shouldRepairMissingEmbeddings(opts, semantic)
  if (!shouldRepair) return null
  const summary = await rebuildIndex(deskRoot, {
    ...opts,
    db,
    reembedMissing: true,
  })
  return {
    built: true,
    reason: "semantic_missing",
    summary,
    fallback: fallbackFor(opts, null, summary.vector_packs),
    vector_packs: fallbackFor(opts, null, summary.vector_packs) === "vector_packs"
      ? fallbackVectorPackStatus(summary.vector_packs)
      : summary.vector_packs,
    semantic: assignEmbeddingAvailability(
      getSemanticCoverage(db),
      semantic,
      summary,
    ),
  }
}

function assignEmbeddingAvailability(target, source, summary) {
  if (summary.semantic_warnings > 0) {
    target.embedding_available = false
    target.embedding_diagnostic = EMBEDDING_GENERATION_FAILURE_DIAGNOSTIC
  } else if (source.embedding_available === true) {
    target.embedding_available = true
    if (source.embedding_diagnostic) {
      target.embedding_diagnostic = source.embedding_diagnostic
    }
  } else if (source.embedding_available === false) {
    if (summary.chunks_inserted > 0 && target.missing_vectors === 0) {
      target.embedding_available = true
    } else {
      target.embedding_available = false
      if (source.embedding_diagnostic) {
        target.embedding_diagnostic = source.embedding_diagnostic
      }
    }
  }
  return target
}

function withSnapshot(result, snapshot, fallback = null) {
  if (snapshot) {
    result.snapshot = snapshot
  }
  if (fallback) {
    result.fallback = fallback
  }
  return result
}

function fallbackFor(opts, _snapshot, vectorPacks) {
  if (opts.vectorPacks?.pluginRoot && vectorPacks?.rows_imported > 0) return "vector_packs"
  return null
}

function fallbackVectorPackStatus(vectorPacks) {
  return {
    ...vectorPacks,
    import_state: "used_as_fallback",
    fallback_used: true,
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const err = new Error("operation aborted")
  err.name = "AbortError"
  throw err
}
