// Unit 14a: red contract for vector-pack compaction validation and
// search/ref preservation. The implementation lands in Unit 14b; compaction
// rewriting must stay disabled until these validation hooks pass.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { desk_search, desk_timeline } from "../../src/tools/search.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import {
  buildFixtureIndex,
  makeEmbedFetch,
  makeFailingFetch,
  mkTempDeskRoot,
  writeFile,
} from "../tools/_search_helpers.js"

async function loadCompactionModule() {
  return import("../../src/indexer/vector-compaction.js")
}

function vector(seed, dimension = ACTIVE_EMBEDDING_SPEC.dimension) {
  return Array.from({ length: dimension }, (_, index) => ((seed + index) % 23) / 23)
}

function row({ key, hash, seed }) {
  return {
    chunk_key: `ck_${key.repeat(40).slice(0, 40)}`,
    text_hash: `sha256:${hash.repeat(64).slice(0, 64)}`,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    dimension: ACTIVE_EMBEDDING_SPEC.dimension,
    encoding: "float32-json",
    vector: vector(seed),
  }
}

function pack(packId, rows) {
  return {
    pack_id: packId,
    embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
    rows,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function buildModeDesk() {
  const root = await mkTempDeskRoot()
  await writeFile(
    root,
    "trackA/task-active/task.md",
    "---\nstatus: processing\nschema_version: 1\nupdated: 2026-05-01\n---\nalpha active content\n",
  )
  await writeFile(
    root,
    "trackA/_archive/task-old/task.md",
    "---\nstatus: done\nschema_version: 1\nupdated: 2025-05-01\n---\nalpha archived content\n",
  )
  await buildFixtureIndex(root)
  return root
}

test("validateVectorPackCompaction accepts semantically equivalent duplicate merge", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })
  const rowB = row({ key: "b", hash: "2", seed: 2 })

  const summary = validateVectorPackCompaction({
    sourcePacks: [
      pack("pack-a", [rowA, rowB]),
      pack("pack-b", [clone(rowA)]),
    ],
    compactedPack: pack("compacted", [clone(rowA), clone(rowB)]),
  })

  assert.deepEqual(summary, {
    equivalent: true,
    source_pack_count: 2,
    source_rows: 3,
    compacted_rows: 2,
    unique_chunk_keys: 2,
    duplicate_rows_removed: 1,
  })
})

test("validateVectorPackCompaction rejects missing rows and mutated vectors", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })
  const rowB = row({ key: "b", hash: "2", seed: 2 })
  const mutatedVector = { ...rowB, vector: vector(99) }
  const mutatedHash = { ...rowB, text_hash: `sha256:${"3".repeat(64)}` }

  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA, rowB])],
      compactedPack: pack("missing-row", [rowA]),
    }),
    /missing compacted row.*ck_b/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA, rowB])],
      compactedPack: pack("mutated-vector", [rowA, mutatedVector]),
    }),
    /vector mismatch.*ck_b/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA, rowB])],
      compactedPack: pack("mutated-hash", [rowA, mutatedHash]),
    }),
    /text_hash mismatch.*ck_b/u,
  )
})

test("validateVectorPackCompaction rejects conflicting source duplicates", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })
  const conflictingA = {
    ...rowA,
    text_hash: `sha256:${"9".repeat(64)}`,
  }

  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [
        pack("pack-a", [rowA]),
        pack("pack-b", [conflictingA]),
      ],
      compactedPack: pack("compacted", [rowA]),
    }),
    /conflicting duplicate chunk_key.*ck_a/u,
  )
})

test("validateCompactionPreservation compares search scopes and refs graph snapshots", async () => {
  const { validateCompactionPreservation } = await loadCompactionModule()
  const before = {
    search: {
      active: ["trackA/task-active/task.md"],
      archived: ["trackA/_archive/task-old/task.md"],
      all: ["trackA/task-active/task.md", "trackA/_archive/task-old/task.md"],
    },
    refs_graph: [
      {
        from: "trackA/task-active/task.md",
        to: "trackA/task-active/planning.md",
        ref_kind: "planning_of",
      },
    ],
  }

  assert.deepEqual(
    validateCompactionPreservation({ before, after: clone(before) }),
    { search_preserved: true, refs_preserved: true },
  )

  const missingArchived = clone(before)
  missingArchived.search.archived = []
  assert.throws(
    () => validateCompactionPreservation({ before, after: missingArchived }),
    /archived search scope changed/u,
  )

  const missingRef = clone(before)
  missingRef.refs_graph = []
  assert.throws(
    () => validateCompactionPreservation({ before, after: missingRef }),
    /refs_graph changed/u,
  )
})

test("desk_search exposes hybrid vs lexical search_mode while preserving archive scopes", async () => {
  const root = await buildModeDesk()

  const hybrid = await desk_search({
    deskRoot: root,
    input: { query: "alpha", scope: "all" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.equal(hybrid.search_mode, "hybrid")
  assert.equal(hybrid.semantic_unavailable, false)
  assert.ok(hybrid.results.some((result) => result.path.includes("task-active")))
  assert.ok(hybrid.results.some((result) => result.path.includes("_archive")))

  const lexical = await desk_search({
    deskRoot: root,
    input: { query: "alpha", scope: "archived" },
    opts: { embed: { fetch: makeFailingFetch() } },
  })
  assert.equal(lexical.search_mode, "lexical")
  assert.equal(lexical.semantic_unavailable, true)
  assert.ok(lexical.results.length >= 1)
  assert.ok(lexical.results.every((result) => result.path.includes("_archive")))
})

test("desk_timeline exposes temporal, hybrid, and lexical search_mode variants", async () => {
  const root = await buildModeDesk()

  const temporal = await desk_timeline({
    deskRoot: root,
    input: { from: "2025-01-01", to: "2026-12-31" },
  })
  assert.equal(temporal.search_mode, "temporal")
  assert.equal(temporal.semantic_unavailable, false)

  const hybrid = await desk_timeline({
    deskRoot: root,
    input: { from: "2025-01-01", to: "2026-12-31", query: "alpha" },
    opts: { embed: { fetch: makeEmbedFetch() } },
  })
  assert.equal(hybrid.search_mode, "hybrid")
  assert.equal(hybrid.semantic_unavailable, false)

  const lexical = await desk_timeline({
    deskRoot: root,
    input: { from: "2025-01-01", to: "2026-12-31", query: "alpha" },
    opts: { embed: { fetch: makeFailingFetch() } },
  })
  assert.equal(lexical.search_mode, "lexical")
  assert.equal(lexical.semantic_unavailable, true)
})
