// Unit 24a1: red integration contract for production snapshot cold start.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import {
  appendFile,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { closeDb, indexDbPath, openDb } from "../../src/db/init.js"
import { EMBEDDING_DIM } from "../../src/indexer/embed.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import { ensureIndex } from "../../src/server-helpers.js"

const require = createRequire(import.meta.url)
const packageLock = require("../../package-lock.json")
const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const pluginRoot = path.join(repoRoot, "plugins", "desk")
const productionDocPath = "tasks/dependency-activation/task.md"
const productionSnapshotRoot = path.join(
  pluginRoot,
  "artifacts",
  "snapshots",
  ACTIVE_EMBEDDING_SPEC.id,
)
const expectedRuntime = {
  platform: process.platform,
  arch: process.arch,
  node_abi: `node-${process.versions.modules}`,
}
const expectedSqliteVec = {
  package: "sqlite-vec",
  version: packageLock.packages["node_modules/sqlite-vec"].version,
  table: "vec0",
}
const expectedDbSchema = { id: "desk-index-sqlite-v1", version: 1 }

async function tmpRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function copyProductionDeskDoc(deskRoot) {
  const target = path.join(deskRoot, productionDocPath)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(repoRoot, "desk", productionDocPath), target)
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

async function findCompatibleProductionSnapshot() {
  let dirents
  try {
    dirents = await readdir(productionSnapshotRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
  const manifests = []
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith(".manifest.json")) continue
    const manifestPath = path.join(productionSnapshotRoot, dirent.name)
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    if (
      manifest.embedding_spec_id === ACTIVE_EMBEDDING_SPEC.id &&
      stableStringify(manifest.db_schema) === stableStringify(expectedDbSchema) &&
      stableStringify(manifest.sqlite_vec) === stableStringify(expectedSqliteVec) &&
      stableStringify(manifest.runtime) === stableStringify(expectedRuntime)
    ) {
      manifests.push({ manifest, manifestPath })
    }
  }
  manifests.sort((left, right) => (
    Date.parse(right.manifest.created_at) - Date.parse(left.manifest.created_at) ||
    left.manifest.snapshot_id.localeCompare(right.manifest.snapshot_id)
  ))
  return manifests[0] ?? null
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

test("cold start restores the committed production snapshot without rebuild or embeddings", async () => {
  const tempRoot = await tmpRoot("desk-dependency-flow-snapshot-")
  try {
    const deskRoot = path.join(tempRoot, "desk")
    await copyProductionDeskDoc(deskRoot)
    const productionSnapshot = await findCompatibleProductionSnapshot()
    assert.notEqual(
      productionSnapshot,
      null,
      `expected at least one committed production snapshot compatible with ${stableStringify({
        db_schema: expectedDbSchema,
        runtime: expectedRuntime,
        sqlite_vec: expectedSqliteVec,
      })}`,
    )
    const { manifest: productionManifest } = productionSnapshot
    const productionDocBytes = await readFile(path.join(deskRoot, productionDocPath))

    assert.deepEqual(
      productionManifest.represented_documents,
      [{ path: productionDocPath, hash: sha256(productionDocBytes) }],
      "the integration fixture must use the real committed production snapshot inputs",
    )

    const result = await ensureIndex(deskRoot, {
      startup: true,
      embed: {
        fetch: async () => {
          throw new Error("cold-start production snapshot restore must not call live embeddings")
        },
      },
    })

    assert.equal(result.built, false, JSON.stringify(result, null, 2))
    assert.equal(result.reason, "snapshot_restored")
    assert.equal(result.snapshot?.snapshot_id, productionManifest.snapshot_id)
    assert.equal(result.snapshot?.freshness?.artifact_source_scope, "fresh")
    assert.equal(result.snapshot?.freshness?.document_tree, "fresh")
    assert.equal(result.fallback, undefined)

    const stateMeta = JSON.parse(
      await readFile(`${indexDbPath(deskRoot)}.snapshot.json`, "utf8"),
    )
    assert.equal(stateMeta.snapshot_id, productionManifest.snapshot_id)
    assert.equal(
      stateMeta.source_snapshot_path,
      path.posix.join(
        "artifacts",
        "snapshots",
        ACTIVE_EMBEDDING_SPEC.id,
        `${productionManifest.snapshot_id}.sqlite.zst`,
      ),
    )

    const db = openDb(deskRoot)
    try {
      assert.deepEqual(
        db.prepare("SELECT path FROM docs ORDER BY path").all(),
        [{ path: productionDocPath }],
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n, 2)
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunk_vecs").get().n, 2)
    } finally {
      closeDb(db)
    }

    const repeated = await ensureIndex(deskRoot, {
      startup: true,
      embed: {
        fetch: async () => {
          throw new Error("repeated production snapshot startup must not call live embeddings")
        },
      },
    })

    assert.equal(repeated.built, false, JSON.stringify(repeated, null, 2))
    assert.equal(repeated.reason, "fresh")
    assert.equal(repeated.fallback, undefined)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("cold rebuild imports committed production vector packs without embeddings", async () => {
  const tempRoot = await tmpRoot("desk-dependency-flow-vector-pack-")
  try {
    const deskRoot = path.join(tempRoot, "desk")
    await copyProductionDeskDoc(deskRoot)
    let embeddingCalls = 0

    const result = await ensureIndex(deskRoot, {
      startup: true,
      snapshots: false,
      embed: {
        fetch: async () => {
          embeddingCalls += 1
          throw new Error("production vector-pack rebuild must not call live embeddings")
        },
      },
    })

    assert.equal(embeddingCalls, 0)
    assert.equal(result.built, true, JSON.stringify(result, null, 2))
    assert.equal(result.reason, "missing")
    assert.equal(result.fallback, "vector_packs")
    assert.equal(result.vector_packs?.import_state, "used_as_fallback")
    assert.equal(result.vector_packs?.packs_imported, 1)
    assert.equal(result.vector_packs?.rows_imported, 2)
    assert.equal(result.semantic?.missing_vectors, 0)

    const db = openDb(deskRoot)
    try {
      assert.deepEqual(
        db.prepare("SELECT path FROM docs ORDER BY path").all(),
        [{ path: productionDocPath }],
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n, 2)
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunk_vecs").get().n, 2)
    } finally {
      closeDb(db)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("cold rebuild live-generates only production vectors missing from committed packs", async () => {
  const tempRoot = await tmpRoot("desk-dependency-flow-missing-vector-")
  try {
    const deskRoot = path.join(tempRoot, "desk")
    await copyProductionDeskDoc(deskRoot)
    const missingChunk = [
      "## Unit 24a3 Missing Vector",
      "",
      "This integration paragraph is intentionally absent from the committed production vector pack so live embedding generation must cover exactly this new chunk.",
    ].join("\n")
    await appendFile(path.join(deskRoot, productionDocPath), `\n\n${missingChunk}\n`)

    const embeddingRequests = []
    const result = await ensureIndex(deskRoot, {
      startup: true,
      snapshots: false,
      embed: {
        endpoint: "http://127.0.0.1:9/api/embeddings",
        model: "unit-24a3-production-missing-vector",
        fetch: async (url, request) => {
          embeddingRequests.push({
            url,
            body: JSON.parse(request.body),
          })
          return {
            ok: true,
            json: async () => ({
              embedding: Array.from({ length: EMBEDDING_DIM }, (_, index) =>
                index / EMBEDDING_DIM,
              ),
            }),
          }
        },
      },
    })

    assert.equal(result.built, true, JSON.stringify(result, null, 2))
    assert.equal(result.reason, "missing")
    assert.equal(result.fallback, "vector_packs")
    assert.equal(result.vector_packs?.import_state, "used_as_fallback")
    assert.equal(result.vector_packs?.packs_imported, 1)
    assert.equal(result.vector_packs?.rows_imported, 2)
    assert.equal(result.semantic?.chunks_total, 3)
    assert.equal(result.semantic?.vectors_indexed, 3)
    assert.equal(result.semantic?.missing_vectors, 0)

    assert.deepEqual(embeddingRequests, [
      {
        url: "http://127.0.0.1:9/api/embeddings",
        body: {
          model: "unit-24a3-production-missing-vector",
          prompt: missingChunk,
        },
      },
    ])

    const db = openDb(deskRoot)
    try {
      assert.deepEqual(
        db.prepare("SELECT path FROM docs ORDER BY path").all(),
        [{ path: productionDocPath }],
      )
      assert.deepEqual(
        db.prepare("SELECT chunk_index, heading FROM chunks ORDER BY chunk_index").all(),
        [
          { chunk_index: 0, heading: null },
          { chunk_index: 1, heading: null },
          { chunk_index: 2, heading: "Unit 24a3 Missing Vector" },
        ],
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunk_vecs").get().n, 3)
    } finally {
      closeDb(db)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
