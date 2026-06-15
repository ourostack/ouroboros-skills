// Unit 12a: red contract for shared vector-pack validation and import.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { closeDb, openDb } from "../../src/db/init.js"
import {
  ACTIVE_EMBEDDING_SPEC,
  chunkIdentity,
} from "../../src/indexer/spec.js"

const mcpRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const repoRoot = path.resolve(mcpRoot, "..", "..", "..")
const deskPluginRoot = path.join(repoRoot, "plugins", "desk")

async function loadVectorPackModule() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "indexer", "vector-packs.js")))
}

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-vector-pack-"))
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function vector(seed, dimension = ACTIVE_EMBEDDING_SPEC.dimension) {
  return Array.from({ length: dimension }, (_, index) => ((index + seed) % 17) / 17)
}

function rowFor(identity, seed = 1, overrides = {}) {
  return {
    chunk_key: identity.chunk_key,
    text_hash: identity.text_hash,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    dimension: ACTIVE_EMBEDDING_SPEC.dimension,
    encoding: "float32-json",
    vector: vector(seed),
    ...overrides,
  }
}

function storedVector(db, chunkId) {
  const row = db.prepare("SELECT embedding FROM chunk_vecs WHERE chunk_id = ?").get(chunkId)
  assert.ok(row, `missing vector row for chunk_id ${chunkId}`)
  const buffer = Buffer.from(row.embedding)
  const values = []
  for (let offset = 0; offset < buffer.length; offset += 4) {
    values.push(buffer.readFloatLE(offset))
  }
  return values
}

function assertStoredVector(db, chunkId, expected) {
  const actual = storedVector(db, chunkId)
  assert.equal(actual.length, expected.length)
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 0.000001,
      `chunk_id ${chunkId} vector[${index}] expected ${expected[index]}, got ${actual[index]}`,
    )
  }
}

async function writePack({ pluginRoot, packId, rows, manifest = {}, checksum }) {
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
  const packSha = sha256(jsonl)
  const packManifest = {
    schema_version: 1,
    pack_id: packId,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    dimension: ACTIVE_EMBEDDING_SPEC.dimension,
    encoding: "float32-json",
    row_count: rows.length,
    rows_sha256: packSha,
    created_at: "2026-06-15T00:00:00.000Z",
    provenance: {
      builder: "artifact:vector-pack:build",
      source: "unit-test",
    },
    ...manifest,
  }
  await fs.writeFile(packPath, jsonl, "utf8")
  await fs.writeFile(manifestPath, `${JSON.stringify(packManifest, null, 2)}\n`, "utf8")
  await fs.writeFile(checksumPath, checksum ?? `${packSha}  ${packId}.jsonl\n`, "utf8")
  return { packDir, packPath, manifestPath, checksumPath, manifest: packManifest }
}

function insertChunk(db, { docPath, text, chunkIndex = 0 }) {
  const docId = db
    .prepare(
      `INSERT INTO docs (path, kind, hash, mtime, frontmatter)
       VALUES (?, 'task', ?, 0, '{}')
       RETURNING id`,
    )
    .get(docPath, sha256(text)).id
  const chunk = {
    index: chunkIndex,
    text,
    heading: null,
    start_offset: 0,
    end_offset: text.length,
  }
  const identity = chunkIdentity({ docPath, chunk })
  const chunkId = db
    .prepare(
      `INSERT INTO chunks (
         doc_id,
         chunk_index,
         chunk_key,
         text_hash,
         embedding_spec_id,
         chunker_id,
         normalization_id,
         text,
         heading,
         start_offset,
         end_offset
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(
      docId,
      chunk.index,
      identity.chunk_key,
      identity.text_hash,
      identity.embedding_spec_id,
      identity.chunker_id,
      identity.normalization_id,
      chunk.text,
      chunk.heading,
      chunk.start_offset,
      chunk.end_offset,
    ).id
  return { docId, chunkId, identity, chunk }
}

test("vector pack paths are canonical, plugin-root relative, and spec-scoped", async () => {
  const { deriveVectorPackPaths } = await loadVectorPackModule()
  const paths = deriveVectorPackPaths({
    pluginRoot: deskPluginRoot,
    embeddingSpecId: ACTIVE_EMBEDDING_SPEC.id,
    packId: "desk-base",
  })

  assert.equal(
    paths.packDir,
    path.join(deskPluginRoot, "artifacts", "vector-packs", ACTIVE_EMBEDDING_SPEC.id),
  )
  assert.equal(paths.packPath, path.join(paths.packDir, "desk-base.jsonl"))
  assert.equal(paths.manifestPath, path.join(paths.packDir, "desk-base.manifest.json"))
  assert.equal(paths.checksumPath, path.join(paths.packDir, "desk-base.sha256"))
  assert.equal(
    paths.relativePackPath,
    `plugins/desk/artifacts/vector-packs/${ACTIVE_EMBEDDING_SPEC.id}/desk-base.jsonl`,
  )
  assert.throws(
    () => deriveVectorPackPaths({
      pluginRoot: deskPluginRoot,
      embeddingSpecId: ACTIVE_EMBEDDING_SPEC.id,
      packId: "../escape",
    }),
    /invalid pack_id|path traversal/u,
  )
})

test("valid vector packs require adjacent manifest and checksum sidecars", async () => {
  const { validateVectorPackFile } = await loadVectorPackModule()
  const root = await tmpRoot()
  const pluginRoot = path.join(root, "plugins", "desk")
  const identity = chunkIdentity({
    docPath: "trackA/task-1/task.md",
    chunk: { text: "shareable semantic chunk" },
  })
  const paths = await writePack({
    pluginRoot,
    packId: "valid-pack",
    rows: [rowFor(identity)],
  })

  const result = await validateVectorPackFile({
    packPath: paths.packPath,
    manifestPath: paths.manifestPath,
    checksumPath: paths.checksumPath,
    expectedSpec: ACTIVE_EMBEDDING_SPEC,
  })

  assert.equal(result.pack_id, "valid-pack")
  assert.equal(result.embedding_spec_id, ACTIVE_EMBEDDING_SPEC.id)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].chunk_key, identity.chunk_key)
  assert.equal(result.rows[0].vector.length, ACTIVE_EMBEDDING_SPEC.dimension)

  const missingManifest = await writePack({
    pluginRoot,
    packId: "missing-manifest",
    rows: [rowFor(identity)],
  })
  await fs.rm(missingManifest.manifestPath)
  await assert.rejects(
    () => validateVectorPackFile({
      packPath: missingManifest.packPath,
      manifestPath: missingManifest.manifestPath,
      checksumPath: missingManifest.checksumPath,
      expectedSpec: ACTIVE_EMBEDDING_SPEC,
    }),
    /manifest.*missing/u,
  )

  const missingChecksum = await writePack({
    pluginRoot,
    packId: "missing-checksum",
    rows: [rowFor(identity)],
  })
  await fs.rm(missingChecksum.checksumPath)
  await assert.rejects(
    () => validateVectorPackFile({
      packPath: missingChecksum.packPath,
      manifestPath: missingChecksum.manifestPath,
      checksumPath: missingChecksum.checksumPath,
      expectedSpec: ACTIVE_EMBEDDING_SPEC,
    }),
    /checksum.*missing|sha256.*missing/u,
  )

  const badChecksum = await writePack({
    pluginRoot,
    packId: "bad-checksum",
    rows: [rowFor(identity)],
    checksum: `${"0".repeat(64)}  bad-checksum.jsonl\n`,
  })
  await assert.rejects(
    () => validateVectorPackFile({
      packPath: badChecksum.packPath,
      manifestPath: badChecksum.manifestPath,
      checksumPath: badChecksum.checksumPath,
      expectedSpec: ACTIVE_EMBEDDING_SPEC,
    }),
    /checksum.*mismatch|sha256.*mismatch/u,
  )
})

test("vector pack validation rejects wrong specs, dimensions, hashes, and malformed vectors", async () => {
  const { validateVectorPackFile } = await loadVectorPackModule()
  const root = await tmpRoot()
  const pluginRoot = path.join(root, "plugins", "desk")
  const identity = chunkIdentity({
    docPath: "trackA/task-1/task.md",
    chunk: { text: "sensitive text must not leak" },
  })
  const cases = [
    {
      name: "wrong-spec",
      row: rowFor(identity, 1, { embedding_spec_id: "inactive-spec" }),
      pattern: /row 1.*embedding_spec_id/u,
    },
    {
      name: "wrong-dimension",
      row: rowFor(identity, 1, { dimension: 3, vector: vector(1, 3) }),
      pattern: /row 1.*dimension/u,
    },
    {
      name: "bad-hash",
      row: rowFor(identity, 1, { text_hash: "sha256:not-a-real-digest" }),
      pattern: /row 1.*text_hash/u,
    },
    {
      name: "bad-encoding",
      row: rowFor(identity, 1, { encoding: "base64-float32le" }),
      pattern: /row 1.*encoding/u,
    },
    {
      name: "malformed-vector",
      row: rowFor(identity, 1, { vector: "not-an-array" }),
      pattern: /row 1.*vector/u,
    },
  ]

  for (const entry of cases) {
    const paths = await writePack({
      pluginRoot,
      packId: entry.name,
      rows: [entry.row],
    })
    await assert.rejects(
      () => validateVectorPackFile({
        packPath: paths.packPath,
        manifestPath: paths.manifestPath,
        checksumPath: paths.checksumPath,
        expectedSpec: ACTIVE_EMBEDDING_SPEC,
      }),
      (error) => {
        assert.match(error.message, entry.pattern)
        assert.doesNotMatch(error.message, /sensitive text/u)
        return true
      },
    )
  }
})

test("vector pack import is idempotent and deduplicates repeated chunk keys across append-only packs", async () => {
  const { importVectorPacks } = await loadVectorPackModule()
  const root = await tmpRoot()
  const pluginRoot = path.join(root, "plugins", "desk")
  const deskRoot = path.join(root, "desk")
  const db = openDb(deskRoot)
  try {
    const first = insertChunk(db, {
      docPath: "trackA/task-1/task.md",
      text: "first semantic chunk",
      chunkIndex: 0,
    })
    const second = insertChunk(db, {
      docPath: "trackA/task-2/task.md",
      text: "second semantic chunk",
      chunkIndex: 0,
    })
    const third = insertChunk(db, {
      docPath: "trackA/task-3/task.md",
      text: "third semantic chunk",
      chunkIndex: 0,
    })
    await writePack({
      pluginRoot,
      packId: "pack-a",
      rows: [
        rowFor(first.identity, 1),
        rowFor(second.identity, 2),
        rowFor(second.identity, 2),
      ],
    })
    await writePack({
      pluginRoot,
      packId: "pack-b",
      rows: [rowFor(third.identity, 3)],
    })

    const imported = await importVectorPacks({
      db,
      pluginRoot,
      expectedSpec: ACTIVE_EMBEDDING_SPEC,
    })
    assert.equal(imported.packs_considered, 2)
    assert.equal(imported.packs_imported, 2)
    assert.equal(imported.rows_imported, 3)
    assert.equal(imported.rows_skipped_duplicate, 1)
    assert.equal(db.prepare("SELECT count(*) AS count FROM chunk_vecs").get().count, 3)
    assertStoredVector(db, first.chunkId, vector(1))
    assertStoredVector(db, second.chunkId, vector(2))
    assertStoredVector(db, third.chunkId, vector(3))

    const secondImport = await importVectorPacks({
      db,
      pluginRoot,
      expectedSpec: ACTIVE_EMBEDDING_SPEC,
    })
    assert.equal(secondImport.rows_imported, 0)
    assert.equal(db.prepare("SELECT count(*) AS count FROM chunk_vecs").get().count, 3)
  } finally {
    closeDb(db)
  }
})

test("vector pack import verifies chunk text hashes against the local DB before inserting", async () => {
  const { importVectorPacks } = await loadVectorPackModule()
  const root = await tmpRoot()
  const pluginRoot = path.join(root, "plugins", "desk")
  const deskRoot = path.join(root, "desk")
  const db = openDb(deskRoot)
  try {
    const chunk = insertChunk(db, {
      docPath: "trackA/task-1/task.md",
      text: "actual local chunk",
      chunkIndex: 0,
    })
    await writePack({
      pluginRoot,
      packId: "wrong-hash",
      rows: [
        rowFor(chunk.identity, 1, {
          text_hash: chunkIdentity({
            docPath: "trackA/task-1/task.md",
            chunk: { text: "different text" },
          }).text_hash,
        }),
      ],
    })

    await assert.rejects(
      () => importVectorPacks({
        db,
        pluginRoot,
        expectedSpec: ACTIVE_EMBEDDING_SPEC,
      }),
      (error) => {
        assert.match(error.message, /wrong-hash\.jsonl.*row 1.*text_hash/u)
        assert.match(error.message, new RegExp(chunk.identity.chunk_key, "u"))
        assert.doesNotMatch(error.message, /actual local chunk|different text/u)
        return true
      },
    )
    assert.equal(db.prepare("SELECT count(*) AS count FROM chunk_vecs").get().count, 0)
  } finally {
    closeDb(db)
  }
})
