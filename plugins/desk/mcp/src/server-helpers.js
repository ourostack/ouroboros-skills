// server-helpers.js — pieces of server.js that the search tools call into.
//
// Split out from server.js so `src/tools/search.js` can call ensureIndex()
// without creating an import cycle (server.js imports the search tools, the
// search tools need ensureIndex, ensureIndex used to live in server.js).

import { existsSync } from "node:fs"
import { closeDb, indexDbPath, openDb } from "./db/init.js"
import { isIndexFresh, rebuildIndex } from "./indexer/index.js"

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
 */
export async function ensureIndex(deskRoot, opts = {}) {
  const dbPath = indexDbPath(deskRoot)
  const dbExisted = existsSync(dbPath)
  const db = openDb(deskRoot)
  try {
    if (dbExisted) {
      const fresh = await isIndexFresh(deskRoot, db)
      if (fresh) return { built: false, reason: "fresh" }
    }
    await rebuildIndex(deskRoot, { ...opts, db })
    return { built: true, reason: dbExisted ? "stale" : "missing" }
  } finally {
    closeDb(db)
  }
}
