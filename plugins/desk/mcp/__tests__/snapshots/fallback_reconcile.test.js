// Unit 17a: red contract for snapshot startup fallback and stale reconcile.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { zstdCompressSync } from "node:zlib"
import matter from "gray-matter"

import { closeDb, indexDbPath, openDb } from "../../src/db/init.js"
import { chunkBody } from "../../src/indexer/chunk.js"
import { rebuildIndex } from "../../src/indexer/index.js"
import {
  ACTIVE_EMBEDDING_SPEC,
  chunkIdentity,
} from "../../src/indexer/spec.js"
import {
  configureRuntimeArtifacts,
  ensureIndex,
  resolveEnsureIndexOptions,
} from "../../src/server-helpers.js"
import { desk_reindex } from "../../src/tools/reindex.js"

const require = createRequire(import.meta.url)
const packageLock = require("../../package-lock.json")
const SOURCE_SCOPE_HASH = `sha256:${"a".repeat(64)}`
const STALE_SOURCE_SCOPE_HASH = `sha256:${"d".repeat(64)}`
const CURRENT_DOCUMENT_TREE_HASH = `sha256:${"b".repeat(64)}`
const STALE_DOCUMENT_TREE_HASH = `sha256:${"c".repeat(64)}`
const DB_SCHEMA = { id: "desk-index-sqlite-v1", version: 1 }
const SQLITE_VEC = {
  package: "sqlite-vec",
  version: packageLock.packages["node_modules/sqlite-vec"].version,
  table: "vec0",
}
const RUNTIME = {
  platform: process.platform,
  arch: process.arch,
  node_abi: `node-${process.versions.modules}`,
}

async function tmpRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeFile(root, rel, body) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, "utf8")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function vector(seed, dimension = ACTIVE_EMBEDDING_SPEC.dimension) {
  return Array.from({ length: dimension }, (_, index) => ((seed + index) % 23) / 23)
}

function docBody(raw) {
  return matter(raw).content ?? ""
}

function rowForDoc({ docPath, body, chunkIndex = 0, seed = 1 }) {
  const chunk = chunkBody(docBody(body))[chunkIndex]
  assert.ok(chunk, `missing chunk ${chunkIndex} for ${docPath}`)
  const identity = chunkIdentity({ docPath, chunk })
  return {
    chunk_key: identity.chunk_key,
    text_hash: identity.text_hash,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    dimension: ACTIVE_EMBEDDING_SPEC.dimension,
    encoding: "float32-json",
    vector: vector(seed),
  }
}

async function writePack({ pluginRoot, packId, rows }) {
  const packDir = path.join(
    pluginRoot,
    "artifacts",
    "vector-packs",
    ACTIVE_EMBEDDING_SPEC.id,
  )
  await fs.mkdir(packDir, { recursive: true })
  const packPath = path.join(packDir, `${packId}.jsonl`)
  const manifestPath = path.join(packDir, `${packId}.manifest.json`)
  const checksumPath = path.join(packDir, `${packId}.sha256`)
  const jsonl = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`
  const rowsSha = sha256(jsonl)
  await fs.writeFile(packPath, jsonl, "utf8")
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify({
      schema_version: 1,
      pack_id: packId,
      embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
      dimension: ACTIVE_EMBEDDING_SPEC.dimension,
      encoding: "float32-json",
      row_count: rows.length,
      rows_sha256: rowsSha,
      created_at: "2026-06-15T00:00:00.000Z",
      provenance: {
        builder: "artifact:vector-pack:build",
        source: "unit-test",
      },
    }, null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(checksumPath, `${rowsSha}  ${packId}.jsonl\n`, "utf8")
}

function snapshotContext(pluginRoot, overrides = {}) {
  return {
    pluginRoot,
    expectedDbSchema: DB_SCHEMA,
    expectedSqliteVec: SQLITE_VEC,
    expectedRuntime: RUNTIME,
    expectedArtifactSourceScopeHash: SOURCE_SCOPE_HASH,
    expectedDocumentTreeHash: CURRENT_DOCUMENT_TREE_HASH,
    ...overrides,
  }
}

function validManifest({
  snapshotId,
  artifactSha,
  createdAt = "2026-06-15T00:00:00.000Z",
  documentTreeHash = CURRENT_DOCUMENT_TREE_HASH,
  overrides = {},
} = {}) {
  return {
    schema_version: 1,
    snapshot_id: snapshotId,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    dimension: ACTIVE_EMBEDDING_SPEC.dimension,
    chunker_id: ACTIVE_EMBEDDING_SPEC.chunker_id,
    normalization_id: ACTIVE_EMBEDDING_SPEC.normalization_id,
    db_schema: DB_SCHEMA,
    sqlite_vec: SQLITE_VEC,
    runtime: RUNTIME,
    artifact_source_scope_hash: SOURCE_SCOPE_HASH,
    document_tree_hash: documentTreeHash,
    included_pack_ids: ["desk-base-pack"],
    created_at: createdAt,
    artifact: {
      file: `${snapshotId}.sqlite.zst`,
      format: "sqlite-zstd",
      sha256: artifactSha,
      compressed: true,
    },
    provenance: {
      builder: "plugins/desk/mcp/scripts/build-snapshot.js",
      source: "unit-test",
      commit: "0123456789abcdef0123456789abcdef01234567",
    },
    source_paths: [
      "plugins/desk/mcp/src/snapshots/restore.js",
      "plugins/desk/mcp/src/db/schema.sql",
      "plugins/desk/mcp/package-lock.json",
    ],
    ...overrides,
  }
}

async function writeSnapshotArtifact({
  pluginRoot,
  snapshotId,
  sqliteBytes,
  documentTreeHash = CURRENT_DOCUMENT_TREE_HASH,
  manifestOverrides,
} = {}) {
  const snapshotDir = path.join(
    pluginRoot,
    "artifacts",
    "snapshots",
    ACTIVE_EMBEDDING_SPEC.id,
  )
  await fs.mkdir(snapshotDir, { recursive: true })
  const snapshotPath = path.join(snapshotDir, `${snapshotId}.sqlite.zst`)
  const manifestPath = path.join(snapshotDir, `${snapshotId}.manifest.json`)
  const checksumPath = path.join(snapshotDir, `${snapshotId}.sha256`)
  const artifactBytes = zstdCompressSync(sqliteBytes)
  const artifactSha = `sha256:${sha256(artifactBytes)}`
  await fs.writeFile(snapshotPath, artifactBytes)
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(validManifest({
      snapshotId,
      artifactSha,
      documentTreeHash,
      overrides: manifestOverrides,
    }), null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(checksumPath, `${artifactSha}  ${snapshotId}.sqlite.zst\n`, "utf8")
  return { snapshotPath, manifestPath, checksumPath }
}

async function writeSnapshotFromDesk({
  pluginRoot,
  snapshotId,
  sourceDeskRoot,
  documentTreeHash,
  manifestOverrides,
  rebuildOpts = { skipEmbed: true },
} = {}) {
  await rebuildIndex(sourceDeskRoot, rebuildOpts)
  const db = openDb(sourceDeskRoot)
  try {
    db.pragma("wal_checkpoint(TRUNCATE)")
  } finally {
    closeDb(db)
  }
  return writeSnapshotArtifact({
    pluginRoot,
    snapshotId,
    sqliteBytes: await fs.readFile(indexDbPath(sourceDeskRoot)),
    documentTreeHash,
    manifestOverrides,
  })
}

async function writeCorruptSnapshot({ pluginRoot, snapshotId }) {
  const snapshotDir = path.join(
    pluginRoot,
    "artifacts",
    "snapshots",
    ACTIVE_EMBEDDING_SPEC.id,
  )
  await fs.mkdir(snapshotDir, { recursive: true })
  const snapshotPath = path.join(snapshotDir, `${snapshotId}.sqlite.zst`)
  const manifestPath = path.join(snapshotDir, `${snapshotId}.manifest.json`)
  const checksumPath = path.join(snapshotDir, `${snapshotId}.sha256`)
  const artifactBytes = Buffer.from("not zstd sqlite data", "utf8")
  const artifactSha = `sha256:${sha256(artifactBytes)}`
  await fs.writeFile(snapshotPath, artifactBytes)
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(validManifest({ snapshotId, artifactSha }), null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(checksumPath, `${artifactSha}  ${snapshotId}.sqlite.zst\n`, "utf8")
}

function storedVector(db, docPath, chunkIndex) {
  const row = db
    .prepare(
      `SELECT v.embedding
       FROM chunk_vecs v
       JOIN chunks c ON c.id = v.chunk_id
       JOIN docs d ON d.id = c.doc_id
       WHERE d.path = ? AND c.chunk_index = ?`,
    )
    .get(docPath, chunkIndex)
  assert.ok(row, `missing stored vector for ${docPath} chunk ${chunkIndex}`)
  const buffer = Buffer.from(row.embedding)
  const values = []
  for (let offset = 0; offset < buffer.length; offset += 4) {
    values.push(buffer.readFloatLE(offset))
  }
  return values
}

function assertVectorApprox(actual, expected) {
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 0.000001,
      `vector[${index}] expected ${expected[index]}, got ${actual[index]}`,
    )
  }
}

async function withPluginRoot(pluginRoot, fn) {
  const original = process.env.DESK_PLUGIN_ROOT
  process.env.DESK_PLUGIN_ROOT = pluginRoot
  try {
    return await fn()
  } finally {
    if (original === undefined) {
      delete process.env.DESK_PLUGIN_ROOT
    } else {
      process.env.DESK_PLUGIN_ROOT = original
    }
  }
}

test("resolveEnsureIndexOptions preserves explicit artifact opt-outs", () => {
  for (const disabled of [false, null]) {
    const resolved = resolveEnsureIndexOptions({
      snapshots: disabled,
      vectorPacks: disabled,
    })

    assert.equal(resolved.snapshots, undefined)
    assert.equal(resolved.vectorPacks, undefined)
  }
})

test("resolveEnsureIndexOptions uses the configured runtime artifact root", async () => {
  const pluginRoot = await tmpRoot("desk-configured-plugin-root-")
  const original = process.env.DESK_PLUGIN_ROOT
  delete process.env.DESK_PLUGIN_ROOT
  try {
    assert.deepEqual(
      configureRuntimeArtifacts({ pluginRoot }),
      { pluginRoot: path.resolve(pluginRoot) },
    )
    const resolved = resolveEnsureIndexOptions({ vectorPacks: {} })
    assert.equal(resolved.vectorPacks.pluginRoot, path.resolve(pluginRoot))
    assert.deepEqual(configureRuntimeArtifacts(), { pluginRoot: null })
  } finally {
    configureRuntimeArtifacts()
    if (original === undefined) {
      delete process.env.DESK_PLUGIN_ROOT
    } else {
      process.env.DESK_PLUGIN_ROOT = original
    }
  }
})

test("ensureIndex falls back from corrupt snapshots to vector packs without live embedding calls", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-fallback-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-fallback-plugin-")
  const docPath = "trackA/task-1/task.md"
  const body = "---\nstatus: processing\n---\ncorrupt snapshot covered body"
  await writeFile(deskRoot, docPath, body)
  await writeCorruptSnapshot({ pluginRoot, snapshotId: "corrupt-snapshot" })
  await writePack({
    pluginRoot,
    packId: "corrupt-fallback",
    rows: [rowForDoc({ docPath, body, seed: 5 })],
  })

  let calls = 0
  const failIfCalled = async () => {
    calls += 1
    throw new Error("vector-pack fallback should not call embeddings")
  }

  const ensured = await ensureIndex(deskRoot, {
    snapshots: snapshotContext(pluginRoot),
    vectorPacks: { pluginRoot },
    skipEmbed: true,
    embed: { fetch: failIfCalled },
  })

  assert.ok(ensured.snapshot, "ensureIndex should report snapshot fallback state")
  assert.equal(calls, 0)
  assert.equal(ensured.snapshot.restored, false)
  assert.equal(ensured.snapshot.reason, "snapshot_corrupt")
  assert.equal(ensured.fallback, "vector_packs")
  assert.equal(ensured.semantic.missing_vectors, 0)

  const db = openDb(deskRoot)
  try {
    assertVectorApprox(storedVector(db, docPath, 0), vector(5))
  } finally {
    closeDb(db)
  }
})

test("ensureIndex treats incompatible snapshots as cache misses before vector-pack fallback", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-fallback-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-fallback-plugin-")
  const snapshotSourceRoot = await tmpRoot("desk-snapshot-fallback-source-")
  const docPath = "trackA/task-1/task.md"
  const body = "---\nstatus: processing\n---\nincompatible snapshot covered body"
  await writeFile(deskRoot, docPath, body)
  await writeFile(snapshotSourceRoot, docPath, body)
  await writeSnapshotFromDesk({
    pluginRoot,
    snapshotId: "incompatible-snapshot",
    sourceDeskRoot: snapshotSourceRoot,
    manifestOverrides: { runtime: { ...RUNTIME, arch: "x64" } },
  })
  await writePack({
    pluginRoot,
    packId: "incompatible-fallback",
    rows: [rowForDoc({ docPath, body, seed: 7 })],
  })

  const ensured = await ensureIndex(deskRoot, {
    snapshots: snapshotContext(pluginRoot),
    vectorPacks: { pluginRoot },
    skipEmbed: true,
  })

  assert.ok(ensured.snapshot, "ensureIndex should report incompatible snapshot state")
  assert.equal(ensured.snapshot.restored, false)
  assert.equal(ensured.snapshot.reason, "no_compatible_snapshot")
  assert.equal(ensured.fallback, "vector_packs")
  assert.equal(ensured.semantic.missing_vectors, 0)

  const db = openDb(deskRoot)
  try {
    assertVectorApprox(storedVector(db, docPath, 0), vector(7))
  } finally {
    closeDb(db)
  }
})

test("ensureIndex reports corrupt snapshots without a fallback when vector packs are absent", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-no-fallback-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-no-fallback-plugin-")
  const docPath = "trackA/task-1/task.md"
  await writeFile(
    deskRoot,
    docPath,
    "---\nstatus: processing\n---\nlexical only after corrupt snapshot",
  )
  await writeCorruptSnapshot({ pluginRoot, snapshotId: "corrupt-no-fallback" })

  const ensured = await ensureIndex(deskRoot, {
    snapshots: snapshotContext(pluginRoot),
    skipEmbed: true,
  })

  assert.ok(ensured.snapshot, "ensureIndex should report snapshot failure state")
  assert.equal(ensured.snapshot.restored, false)
  assert.equal(ensured.snapshot.reason, "snapshot_corrupt")
  assert.equal(ensured.fallback, undefined)
  assert.equal(ensured.semantic.missing_vectors, 1)
})

test("ensureIndex auto-discovers snapshots from the runtime plugin root", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-default-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-default-plugin-")
  const snapshotSourceRoot = await tmpRoot("desk-snapshot-default-source-")
  const docPath = "trackA/task-1/task.md"
  const body = "---\nstatus: processing\n---\ndefault artifact restored body"
  await writeFile(snapshotSourceRoot, docPath, body)
  await writeSnapshotFromDesk({
    pluginRoot,
    snapshotId: "default-compatible",
    sourceDeskRoot: snapshotSourceRoot,
    rebuildOpts: {
      embed: {
        fetch: async () => ({
          ok: true,
          json: async () => ({ embedding: vector(3) }),
        }),
      },
    },
  })
  await writeFile(deskRoot, docPath, body)
  const old = new Date("2020-01-01T00:00:00.000Z")
  await fs.utimes(path.join(deskRoot, docPath), old, old)

  const ensured = await withPluginRoot(pluginRoot, () => ensureIndex(deskRoot))

  assert.equal(ensured.built, false)
  assert.equal(ensured.reason, "snapshot_restored")
  assert.equal(ensured.snapshot.restored, true)
  assert.equal(ensured.semantic.missing_vectors, 0)
})

test("desk_reindex uses runtime artifacts without artifact opts", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-reindex-default-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-reindex-default-plugin-")
  const docPath = "trackA/task-1/task.md"
  const body = "---\nstatus: processing\n---\ncovered by production artifact defaults"
  await writeFile(deskRoot, docPath, body)
  await writeCorruptSnapshot({ pluginRoot, snapshotId: "default-corrupt" })
  await writePack({
    pluginRoot,
    packId: "default-fallback",
    rows: [rowForDoc({ docPath, body, seed: 13 })],
  })

  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    throw new Error("artifact-covered production path should not call embeddings")
  }
  try {
    const result = await withPluginRoot(pluginRoot, () => desk_reindex({
      deskRoot,
      input: {},
    }))

    assert.equal(calls, 0)
    assert.equal(result.status, "ok")
    assert.equal(result.built, true)
    assert.equal(result.reason, "missing")
    assert.equal(result.missing_vectors, 0)
  } finally {
    globalThis.fetch = originalFetch
  }

  const db = openDb(deskRoot)
  try {
    assertVectorApprox(storedVector(db, docPath, 0), vector(13))
  } finally {
    closeDb(db)
  }
})

test("ensureIndex returns snapshot_restored when a restored snapshot is already fresh", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-fresh-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-fresh-plugin-")
  const snapshotSourceRoot = await tmpRoot("desk-snapshot-fresh-source-")
  const docPath = "trackA/task-1/task.md"
  const body = "---\nstatus: processing\n---\nfresh restored snapshot body"
  await writeFile(snapshotSourceRoot, docPath, body)
  await writeSnapshotFromDesk({
    pluginRoot,
    snapshotId: "fresh-compatible",
    sourceDeskRoot: snapshotSourceRoot,
    rebuildOpts: {
      embed: {
        fetch: async () => ({
          ok: true,
          json: async () => ({ embedding: vector(11) }),
        }),
      },
    },
  })
  await writeFile(deskRoot, docPath, body)
  const old = new Date("2020-01-01T00:00:00.000Z")
  await fs.utimes(path.join(deskRoot, docPath), old, old)

  const ensured = await ensureIndex(deskRoot, {
    snapshots: snapshotContext(pluginRoot),
    skipEmbed: true,
  })

  assert.equal(ensured.built, false)
  assert.equal(ensured.reason, "snapshot_restored")
  assert.equal(ensured.snapshot.restored, true)
  assert.equal(ensured.semantic.missing_vectors, 0)
})

test("ensureIndex restores stale compatible snapshots then reconciles docs, refs, and search text", async () => {
  const deskRoot = await tmpRoot("desk-snapshot-reconcile-desk-")
  const pluginRoot = await tmpRoot("desk-snapshot-reconcile-plugin-")
  const snapshotSourceRoot = await tmpRoot("desk-snapshot-reconcile-source-")
  const taskPath = "trackA/task-1/task.md"
  const planningPath = "trackA/task-1/planning.md"
  const sentinelPath = "trackA/task-1/feedback.md"
  const staleTask = "---\nstatus: processing\n---\nstale snapshot task body"
  const stalePlanning = "---\n---\nstale planning body"
  const unchangedSentinel = "---\n---\nunchanged sentinel vector body"
  const currentTask = "---\nstatus: processing\n---\ncurrent reconciled task body"
  const currentPlanning = "---\n---\ncurrent reconciled planning body"

  await writeFile(snapshotSourceRoot, taskPath, staleTask)
  await writeFile(snapshotSourceRoot, planningPath, stalePlanning)
  await writeFile(snapshotSourceRoot, sentinelPath, unchangedSentinel)
  await writeSnapshotFromDesk({
    pluginRoot,
    snapshotId: "stale-compatible",
    sourceDeskRoot: snapshotSourceRoot,
    documentTreeHash: STALE_DOCUMENT_TREE_HASH,
    manifestOverrides: {
      artifact_source_scope_hash: STALE_SOURCE_SCOPE_HASH,
    },
    rebuildOpts: {
      embed: {
        fetch: async () => ({
          ok: true,
          json: async () => ({ embedding: vector(19) }),
        }),
      },
    },
  })
  await writeFile(deskRoot, taskPath, currentTask)
  await writeFile(deskRoot, planningPath, currentPlanning)
  await writeFile(deskRoot, sentinelPath, unchangedSentinel)

  const ensured = await ensureIndex(deskRoot, {
    snapshots: snapshotContext(pluginRoot),
    skipEmbed: true,
  })

  assert.ok(ensured.snapshot, "ensureIndex should report restored snapshot state")
  assert.equal(ensured.snapshot.restored, true)
  assert.equal(ensured.snapshot.freshness.artifact_source_scope, "stale")
  assert.equal(ensured.snapshot.freshness.document_tree, "stale")
  assert.equal(ensured.snapshot.reconciled, true)
  assert.equal(ensured.reason, "stale_snapshot_reconciled")
  assert.equal(ensured.summary.docs_indexed, 2)

  const db = openDb(deskRoot)
  try {
    const text = db
      .prepare("SELECT group_concat(text, '\n') AS text FROM chunks")
      .get().text
    assert.match(text, /current reconciled task body/u)
    assert.match(text, /current reconciled planning body/u)
    assert.match(text, /unchanged sentinel vector body/u)
    assert.doesNotMatch(text, /stale snapshot/u)
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM chunks_fts WHERE chunks_fts MATCH ?").get("current").count,
      2,
    )
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM chunks_fts WHERE chunks_fts MATCH ?").get("stale").count,
      0,
    )
    assertVectorApprox(storedVector(db, sentinelPath, 0), vector(19))
    const refs = db
      .prepare(
        `SELECT ref_kind
         FROM refs_graph
         ORDER BY ref_kind`,
      )
      .all()
      .map((row) => row.ref_kind)
    assert.deepEqual(refs, ["feedback_of", "planning_of"])
  } finally {
    closeDb(db)
  }
})
