import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { indexDbPath } from "../db/init.js"
import { ACTIVE_EMBEDDING_SPEC } from "../indexer/spec.js"

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
)
const DB_SCHEMA = { id: "desk-index", version: 1 }
const EMBEDDING_SPEC = {
  id: ACTIVE_EMBEDDING_SPEC.id,
  provider: "ollama",
  model: ACTIVE_EMBEDDING_SPEC.model,
  model_revision: ACTIVE_EMBEDDING_SPEC.model_revision,
  dimensions: ACTIVE_EMBEDDING_SPEC.dimension,
  encoding: "float32",
  chunker_id: ACTIVE_EMBEDDING_SPEC.chunker_id,
  normalization_id: ACTIVE_EMBEDDING_SPEC.normalization_id,
}

export async function desk_status({ deskRoot, statusContext = {} }) {
  const root = rootStatus(deskRoot, statusContext.root)
  const runtime = runtimeStatus(statusContext.runtime ?? {})
  const localDb = root.valid
    ? inspectLocalDb(root.path)
    : unavailableLocalDb(root.path === null ? null : indexDbPath(root.path), "root_unavailable")

  return {
    status: root.valid ? "ok" : "error",
    root,
    runtime,
    local_db: localDb.local_db,
    db_schema: localDb.local_db.schema,
    active_embedding_spec: EMBEDDING_SPEC,
    snapshots: { restore_state: "not_checked", module_state: "not_installed" },
    vector_packs: { import_state: "not_checked", module_state: "not_installed" },
    document_vectors: localDb.document_vectors,
    query_embedding: {
      available: "not_checked",
      spec_id: EMBEDDING_SPEC.id,
      note: "desk_status does not probe live embedding endpoints during session start",
    },
    lexical_index: localDb.lexical_index,
    summary: summaryFor({ root, localDb }),
  }
}

function inspectLocalDb(deskRoot) {
  const dbPath = indexDbPath(deskRoot)
  if (!existsSync(dbPath)) {
    return unavailableLocalDb(dbPath, "missing")
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    sqliteVec.load(db)
    const chunksTableExists = tableExists(db, "chunks")
    const vectorsTableExists = tableExists(db, "chunk_vecs")
    const lexicalAvailable = tableExists(db, "chunks_fts")
    const chunksTotal = chunksTableExists ? countRows(db, "chunks") : 0
    const vectorsIndexed = countActiveVectors(db, {
      chunksTableExists,
      vectorsTableExists,
    })
    const missingVectors = Math.max(0, chunksTotal - vectorsIndexed)
    const freshness = inspectFreshness(deskRoot, db)
    return {
      local_db: {
        path: dbPath,
        exists: true,
        schema: DB_SCHEMA,
        state: freshness.state === "stale" ? "stale" : "available",
        freshness,
      },
      lexical_index: {
        available: lexicalAvailable,
        state: ["missing", "available"][Number(lexicalAvailable)],
      },
      document_vectors: {
        state: vectorsTableExists ? "available" : "missing",
        chunks_total: chunksTotal,
        vectors_indexed: vectorsIndexed,
        missing_vectors: missingVectors,
        coverage: vectorsIndexed / Math.max(1, chunksTotal),
      },
    }
  } finally {
    db.close()
  }
}

function unavailableLocalDb(dbPath, state) {
  return {
    local_db: {
      path: dbPath,
      exists: false,
      schema: { id: DB_SCHEMA.id, version: null },
      state,
      freshness: { state: "unknown", reason: state },
    },
    lexical_index: {
      available: false,
      state: state === "missing" ? "missing_local_db" : state,
    },
    document_vectors: {
      state: state === "missing" ? "missing_local_db" : state,
      chunks_total: 0,
      vectors_indexed: 0,
      missing_vectors: 0,
      coverage: null,
    },
  }
}

function rootStatus(deskRoot, rootContext = {}) {
  const pathValue = typeof deskRoot === "string" && deskRoot.trim().length > 0
    ? deskRoot
    : null
  const source = typeof rootContext?.source === "string" && rootContext.source.trim().length > 0
    ? rootContext.source
    : "unknown"
  const tried = Array.isArray(rootContext?.tried)
    ? rootContext.tried.filter(isRootAttempt)
    : []
  const exists = pathValue === null ? false : existsSync(pathValue)
  const malformed_context = rootContext !== null
    && typeof rootContext === "object"
    && (rootContext.source !== undefined && source === "unknown"
      || rootContext.tried !== undefined && !Array.isArray(rootContext.tried))

  return {
    path: pathValue,
    source,
    tried,
    exists,
    valid: exists,
    diagnostic: exists ? null : rootDiagnostic(pathValue),
    malformed_context,
  }
}

function runtimeStatus(runtime) {
  const sourceMirrorPath = runtime.source_mirror_path ?? runtime.sourceMirrorPath ?? null
  return {
    plugin: {
      name: packageJson.name,
      version: packageJson.version,
    },
    node: {
      platform: process.platform,
      arch: process.arch,
      abi: process.versions.modules,
    },
    target: runtime.target ?? defaultTarget(),
    runtime_cache_dir: runtime.runtime_cache_dir ?? runtime.runtimeCacheDir ?? null,
    source_mirror_path: sourceMirrorPath,
    loaded_from_source_mirror: typeof sourceMirrorPath === "string" && sourceMirrorPath.length > 0,
  }
}

function inspectFreshness(deskRoot, db) {
  if (!tableExists(db, "meta")) {
    return { state: "unknown", reason: "meta_table_missing" }
  }
  const lastIndexedAt = metaValue(db, "last_indexed_at")
  if (lastIndexedAt === null) {
    return { state: "unknown", reason: "last_indexed_at_missing" }
  }
  const indexedMs = Date.parse(lastIndexedAt)
  if (Number.isNaN(indexedMs)) {
    return { state: "unknown", reason: "last_indexed_at_invalid", last_indexed_at: lastIndexedAt }
  }
  const newest = newestMarkdownFile(deskRoot)
  if (newest === null) {
    return { state: "fresh", last_indexed_at: lastIndexedAt, newest_document: null }
  }
  return {
    state: newest.mtime_ms > indexedMs ? "stale" : "fresh",
    last_indexed_at: lastIndexedAt,
    newest_document: newest,
  }
}

function newestMarkdownFile(deskRoot) {
  let newest = null
  for (const file of markdownFiles(deskRoot)) {
    const stat = statSync(path.join(deskRoot, file))
    const candidate = { path: file, mtime_ms: stat.mtimeMs }
    if (newest === null || candidate.mtime_ms > newest.mtime_ms) {
      newest = candidate
    }
  }
  return newest
}

function markdownFiles(root, current = root) {
  const out = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (shouldSkipDir(entry.name)) {
      continue
    }
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) {
      out.push(...markdownFiles(root, absolute))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.relative(root, absolute))
    }
  }
  return out
}

function defaultTarget() {
  return `${process.platform}-${process.arch}-node-${process.versions.modules}`
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
}

function tableExists(db, table) {
  return db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name = ?").get(table) !== undefined
}

function tableHasColumns(db, table, columns) {
  const names = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
  return columns.every((column) => names.has(column))
}

function countActiveVectors(db, { chunksTableExists, vectorsTableExists }) {
  if (!chunksTableExists || !vectorsTableExists) return 0
  if (!tableHasColumns(db, "chunks", [
    "embedding_spec_id",
    "chunker_id",
    "normalization_id",
  ])) {
    return 0
  }
  return db.prepare(
    `SELECT COUNT(*) AS count
     FROM chunks c
     JOIN chunk_vecs v ON v.chunk_id = c.id
     WHERE c.embedding_spec_id = ?
       AND c.chunker_id = ?
       AND c.normalization_id = ?`,
  ).get(
    ACTIVE_EMBEDDING_SPEC.id,
    ACTIVE_EMBEDDING_SPEC.chunker_id,
    ACTIVE_EMBEDDING_SPEC.normalization_id,
  ).count
}

function metaValue(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key)
  return row?.value ?? null
}

function isRootAttempt(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.source === "string"
    && typeof value.path === "string"
}

function rootDiagnostic(pathValue) {
  return pathValue === null ? "missing_desk_root" : "desk_root_not_found"
}

function shouldSkipDir(name) {
  return name === ".state" || name === ".git" || name === "node_modules"
}

function summaryFor({ root, localDb }) {
  return [
    `Desk root ${root.path} resolved from ${root.source}.`,
    root.valid ? null : `Root diagnostic: ${root.diagnostic}.`,
    localDb.local_db.exists
      ? `Local DB is ${localDb.local_db.state}.`
      : "Local DB is missing; this is normal on first run.",
    "Snapshot restore, vector-pack import, and query embedding probes were not run.",
  ].filter(Boolean).join(" ")
}
