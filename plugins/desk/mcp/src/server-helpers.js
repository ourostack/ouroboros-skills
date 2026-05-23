// server-helpers.js — pieces of server.js that the search tools call into.
//
// Split out from server.js so `src/tools/search.js` can call ensureIndex()
// without creating an import cycle (server.js imports the search tools, the
// search tools need ensureIndex, ensureIndex used to live in server.js).

import { existsSync } from "node:fs"
import { closeDb, indexDbPath, openDb } from "./db/init.js"
import { isIndexFresh, rebuildIndex } from "./indexer/index.js"
import { probeEmbeddingService } from "./indexer/embed.js"

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
 * @returns {Promise<{ built: boolean, reason: string,
 *                     summary?: import("./indexer/index.js").RebuildSummary,
 *                     semantic?: object }>}
 *   When `built=true`, `summary` carries the rebuildIndex counts. When
 *   `built=false` (fresh), `summary` is omitted — nothing was reindexed.
 */
export async function ensureIndex(deskRoot, opts = {}) {
  const dbPath = indexDbPath(deskRoot)
  const dbExisted = existsSync(dbPath)
  const db = openDb(deskRoot)
  try {
    const semanticBefore = getSemanticCoverage(db)
    let repairMissing = false
    if (dbExisted) {
      const fresh = await isIndexFresh(deskRoot, db)
      if (fresh) {
        const repair = await maybeRepairMissingEmbeddings(
          deskRoot,
          db,
          opts,
          semanticBefore,
        )
        if (repair) return repair
        return { built: false, reason: "fresh", semantic: semanticBefore }
      }
      repairMissing = await shouldRepairMissingEmbeddings(opts, semanticBefore)
    }
    const summary = await rebuildIndex(deskRoot, {
      ...opts,
      db,
      reembedMissing: repairMissing,
    })
    const semanticAfter = getSemanticCoverage(db)
    if (repairMissing) semanticAfter.embedding_available = true
    return {
      built: true,
      reason: dbExisted ? "stale" : "missing",
      summary,
      semantic: semanticAfter,
    }
  } finally {
    closeDb(db)
  }
}

export function getSemanticCoverage(db) {
  const chunks = db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n
  const vectors = db.prepare("SELECT COUNT(*) AS n FROM chunk_vecs").get().n
  return {
    chunks_total: chunks,
    vectors_indexed: vectors,
    missing_vectors: Math.max(0, chunks - vectors),
  }
}

async function shouldRepairMissingEmbeddings(opts, semantic) {
  if (opts.skipEmbed) return false
  if (!semantic || semantic.missing_vectors <= 0) return false
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
    semantic: { ...getSemanticCoverage(db), embedding_available: true },
  }
}
