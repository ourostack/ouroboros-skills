import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { EMBEDDING_DIM, resolveEmbeddingModel } from "../indexer/embed.js"
import { indexDbPath } from "../db/init.js"

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
)
const DB_SCHEMA = { id: "desk-index", version: 1 }
const EMBEDDING_SPEC = {
  id: "ollama:nomic-embed-text:768",
  provider: "ollama",
  model: resolveEmbeddingModel({}),
  dimensions: EMBEDDING_DIM,
  encoding: "float32",
}

export async function desk_status({ deskRoot, statusContext = {} }) {
  const localDb = inspectLocalDb(deskRoot)
  const root = {
    path: deskRoot,
    source: statusContext.root?.source ?? "unknown",
    tried: statusContext.root?.tried ?? [],
  }
  const runtime = runtimeStatus(statusContext.runtime ?? {})

  return {
    status: "ok",
    root,
    runtime,
    local_db: localDb.local_db,
    db_schema: localDb.local_db.schema,
    active_embedding_spec: EMBEDDING_SPEC,
    snapshots: { restore_state: "not_checked" },
    vector_packs: { import_state: "not_checked" },
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
    return {
      local_db: {
        path: dbPath,
        exists: false,
        schema: { id: DB_SCHEMA.id, version: null },
        state: "missing",
      },
      lexical_index: {
        available: false,
        state: "missing_local_db",
      },
      document_vectors: {
        state: "missing_local_db",
        chunks_total: 0,
        vectors_indexed: 0,
        missing_vectors: 0,
        coverage: null,
      },
    }
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    sqliteVec.load(db)
    const chunksTotal = countRows(db, "chunks")
    const vectorsIndexed = countRows(db, "chunk_vecs")
    const missingVectors = Math.max(0, chunksTotal - vectorsIndexed)
    return {
      local_db: {
        path: dbPath,
        exists: true,
        schema: DB_SCHEMA,
        state: "available",
      },
      lexical_index: {
        available: tableExists(db, "chunks_fts"),
        state: ["missing", "available"][Number(tableExists(db, "chunks_fts"))],
      },
      document_vectors: {
        state: "available",
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

function defaultTarget() {
  return `${process.platform}-${process.arch}-node-${process.versions.modules}`
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
}

function tableExists(db, table) {
  return db.prepare("SELECT 1 AS found FROM sqlite_master WHERE name = ?").get(table) !== undefined
}

function summaryFor({ root, localDb }) {
  return [
    `Desk root ${root.path} resolved from ${root.source}.`,
    localDb.local_db.exists
      ? `Local DB is ${localDb.local_db.state}.`
      : "Local DB is missing; this is normal on first run.",
    "Snapshot restore, vector-pack import, and query embedding probes were not run.",
  ].join(" ")
}
