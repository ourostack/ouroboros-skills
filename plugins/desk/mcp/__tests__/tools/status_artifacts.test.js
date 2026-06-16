// Unit 17d: red contract for artifact-aware desk_status output.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"

import { closeDb, openDb, setMeta } from "../../src/db/init.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import { callTool } from "../../src/server.js"

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "desk-status-artifacts-"))
}

function parseToolResult(response) {
  assert.equal(response.isError, undefined, response.content?.[0]?.text)
  return JSON.parse(response.content[0].text)
}

function insertDocWithChunks(db, chunkCount = 2) {
  const docId = db.prepare(
    `INSERT INTO docs (path, kind, hash, mtime, frontmatter)
     VALUES ('trackA/task-1/task.md', 'task', 'abc', 1, '{}')
     RETURNING id`,
  ).get().id
  const chunkIds = []
  for (let index = 0; index < chunkCount; index += 1) {
    chunkIds.push(db.prepare(
      `INSERT INTO chunks (
         doc_id,
         chunk_index,
         chunk_key,
         text_hash,
         embedding_spec_id,
         chunker_id,
         normalization_id,
         text
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    ).get(
      docId,
      index,
      `chunk-${index}`,
      `sha256:${index}`,
      ACTIVE_EMBEDDING_SPEC.id,
      ACTIVE_EMBEDDING_SPEC.chunker_id,
      ACTIVE_EMBEDDING_SPEC.normalization_id,
      `chunk ${index} text`,
    ).id)
  }
  return chunkIds
}

function seedPartialVectorDb(root) {
  const db = openDb(root)
  try {
    const [coveredChunkId] = insertDocWithChunks(db, 2)
    const vec = new Float32Array(ACTIVE_EMBEDDING_SPEC.dimension)
    db.prepare("INSERT INTO chunk_vecs (chunk_id, embedding) VALUES (?, ?)").run(
      BigInt(coveredChunkId),
      vec,
    )
    setMeta(db, "last_indexed_at", "2999-01-01T00:00:00.000Z")
  } finally {
    closeDb(db)
  }
}

function seedLexicalOnlyDb(root) {
  const db = openDb(root)
  try {
    insertDocWithChunks(db, 1)
    setMeta(db, "last_indexed_at", "2999-01-01T00:00:00.000Z")
  } finally {
    closeDb(db)
  }
}

function seedFullyCoveredVectorDb(root) {
  const db = openDb(root)
  try {
    for (const chunkId of insertDocWithChunks(db, 2)) {
      const vec = new Float32Array(ACTIVE_EMBEDDING_SPEC.dimension)
      db.prepare("INSERT INTO chunk_vecs (chunk_id, embedding) VALUES (?, ?)").run(
        BigInt(chunkId),
        vec,
      )
    }
    setMeta(db, "last_indexed_at", "2999-01-01T00:00:00.000Z")
  } finally {
    closeDb(db)
  }
}

test("desk_status reports snapshot/vector-pack startup fallback and degraded query embeddings", async () => {
  const root = makeRoot()
  try {
    seedPartialVectorDb(root)

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        startup: {
          ensure_index: {
            built: true,
            reason: "stale_snapshot_reconciled",
            fallback: "vector_packs",
            snapshot: {
              restored: true,
              reconciled: true,
              reason: "snapshot_restored",
              snapshot_id: "desk-startup-snapshot",
              freshness: {
                artifact_source_scope: "fresh",
                document_tree: "stale",
              },
            },
            semantic: {
              chunks_total: 2,
              vectors_indexed: 1,
              missing_vectors: 1,
              embedding_available: false,
              embedding_diagnostic: {
                reason: "embedding_generation_failed",
                message: "document embedding generation failed during startup repair",
              },
            },
          },
          duration_ms: 42,
          budget_ms: 250,
        },
      },
    }))

    assert.equal(body.snapshots.module_state, "available")
    assert.equal(body.snapshots.restore_state, "restored")
    assert.equal(body.snapshots.snapshot_id, "desk-startup-snapshot")
    assert.equal(body.snapshots.reconciled, true)
    assert.deepEqual(body.snapshots.freshness, {
      artifact_source_scope: "fresh",
      document_tree: "stale",
    })
    assert.equal(body.vector_packs.module_state, "available")
    assert.equal(body.vector_packs.import_state, "used_as_fallback")
    assert.equal(body.vector_packs.fallback_used, true)
    assert.equal(body.document_vectors.state, "partial")
    assert.equal(body.document_vectors.chunks_total, 2)
    assert.equal(body.document_vectors.vectors_indexed, 1)
    assert.equal(body.document_vectors.missing_vectors, 1)
    assert.equal(body.document_vectors.coverage, 0.5)
    assert.equal(body.query_embedding.available, false)
    assert.equal(body.query_embedding.diagnostic.reason, "embedding_generation_failed")
    assert.equal(body.lexical_index.available, true)
    assert.equal(body.lexical_index.state, "available")
    assert.deepEqual(body.startup_fallback, {
      mode: "snapshot_then_vector_packs",
      degraded: true,
      duration_ms: 42,
      budget_ms: 250,
    })
    assert.ok(body.degraded_modes.includes("document_vectors_partial"))
    assert.ok(body.degraded_modes.includes("query_embedding_unavailable"))
    assert.match(body.summary, /snapshot/i)
    assert.match(body.summary, /vector pack/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status reports lexical-only startup fallback when artifacts and embeddings are unavailable", async () => {
  const root = makeRoot()
  try {
    seedLexicalOnlyDb(root)

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        startup: {
          ensure_index: {
            built: true,
            reason: "missing",
            snapshot: {
              restored: false,
              reason: "snapshot_corrupt",
              snapshot_id: "corrupt-startup-snapshot",
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
          },
          duration_ms: 35,
          budget_ms: 250,
        },
      },
    }))

    assert.equal(body.snapshots.module_state, "available")
    assert.equal(body.snapshots.restore_state, "skipped")
    assert.equal(body.snapshots.reason, "snapshot_corrupt")
    assert.equal(body.vector_packs.module_state, "available")
    assert.equal(body.vector_packs.import_state, "absent")
    assert.equal(body.document_vectors.state, "missing")
    assert.equal(body.document_vectors.chunks_total, 1)
    assert.equal(body.document_vectors.vectors_indexed, 0)
    assert.equal(body.document_vectors.missing_vectors, 1)
    assert.equal(body.query_embedding.available, false)
    assert.equal(body.query_embedding.diagnostic.reason, "embedding_generation_failed")
    assert.equal(body.lexical_index.available, true)
    assert.equal(body.startup_fallback.mode, "lexical_only")
    assert.equal(body.startup_fallback.degraded, true)
    assert.ok(body.degraded_modes.includes("document_vectors_missing"))
    assert.ok(body.degraded_modes.includes("lexical_fallback_active"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status preserves explicit vector-pack import state from startup context", async () => {
  const root = makeRoot()
  try {
    seedLexicalOnlyDb(root)

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        startup: {
          ensure_index: {
            built: false,
            reason: "fresh",
            vector_packs: {
              import_state: "validated",
              packs_available: 2,
            },
          },
          duration_ms: 1,
          budget_ms: 250,
        },
      },
    }))

    assert.equal(body.vector_packs.module_state, "available")
    assert.equal(body.vector_packs.import_state, "validated")
    assert.equal(body.vector_packs.packs_available, 2)
    assert.equal(body.startup_fallback.mode, "fresh")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status classifies additional artifact startup modes", async () => {
  const root = makeRoot()
  async function statusFor(ensureIndex) {
    return parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        startup: {
          ensure_index: ensureIndex,
          duration_ms: 2,
          budget_ms: 250,
        },
      },
    }))
  }

  try {
    seedFullyCoveredVectorDb(root)

    let body = await statusFor({
      built: false,
      reason: "snapshot_restored",
      snapshot: {
        restored: false,
        reason: "snapshot_already_restored",
        snapshot_id: "already-restored",
      },
      semantic: {
        chunks_total: 2,
        vectors_indexed: 2,
        missing_vectors: 0,
        embedding_available: true,
      },
    })
    assert.equal(body.snapshots.restore_state, "already_restored")
    assert.equal(body.query_embedding.available, true)
    assert.equal(body.document_vectors.state, "available")
    assert.deepEqual(body.degraded_modes, [])

    body = await statusFor({
      built: true,
      reason: "semantic_missing",
      fallback: "vector_packs",
      semantic: { chunks_total: 2, vectors_indexed: 2, missing_vectors: 0 },
    })
    assert.equal(body.startup_fallback.mode, "vector_packs")
    assert.equal(body.vector_packs.import_state, "used_as_fallback")

    body = await statusFor({
      built: false,
      reason: "snapshot_restored",
      snapshot: { restored: true, snapshot_id: "snapshot-only" },
      semantic: { chunks_total: 2, vectors_indexed: 2, missing_vectors: 0 },
    })
    assert.equal(body.startup_fallback.mode, "snapshot")

    body = await statusFor({
      built: true,
      reason: "stale",
      semantic: { chunks_total: 2, vectors_indexed: 2, missing_vectors: 0 },
    })
    assert.equal(body.startup_fallback.mode, "rebuild")

    body = await statusFor({ built: false, reason: "startup_budget_exceeded" })
    assert.equal(body.startup_fallback.mode, "startup_deferred")
    assert.equal(body.startup_fallback.degraded, true)

    body = await statusFor({ built: false, reason: "fresh" })
    assert.equal(body.startup_fallback.mode, "fresh")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
