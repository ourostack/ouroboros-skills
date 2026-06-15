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
  const rowC = row({ key: "c", hash: "3", seed: 3 })

  const summary = validateVectorPackCompaction({
    sourcePacks: [
      pack("pack-a", [rowA, rowB]),
      pack("pack-b", [clone(rowA), rowC]),
    ],
    compactedPack: pack("compacted", [clone(rowA), clone(rowB), clone(rowC)]),
  })

  assert.deepEqual(summary, {
    equivalent: true,
    source_pack_count: 2,
    source_rows: 4,
    compacted_rows: 3,
    unique_chunk_keys: 3,
    duplicate_rows_removed: 1,
  })
})

test("validateVectorPackCompaction rejects missing rows and mutated vectors", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })
  const rowB = row({ key: "b", hash: "2", seed: 2 })
  const rowC = row({ key: "c", hash: "3", seed: 3 })
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
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA, rowB])],
      compactedPack: pack("extra-row", [rowA, rowB, rowC]),
    }),
    /unexpected compacted row.*ck_c/u,
  )
})

test("validateVectorPackCompaction rejects invalid inputs and row metadata drift", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })

  assert.throws(
    () => validateVectorPackCompaction(),
    /sourcePacks must be a non-empty array/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({ sourcePacks: [] }),
    /sourcePacks must be a non-empty array/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({ sourcePacks: [pack("source", [rowA])] }),
    /compactedPack is required/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [{ pack_id: "bad-source" }],
      compactedPack: pack("compacted", [rowA]),
    }),
    /source pack rows must be an array/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: { pack_id: "bad-compacted" },
    }),
    /compacted pack rows must be an array/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("duplicate-compacted", [rowA, clone(rowA)]),
    }),
    /duplicate compacted row.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("wrong-spec", [
        { ...rowA, embedding_spec_id: "other-spec" },
      ]),
    }),
    /embedding_spec_id mismatch.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("wrong-dimension", [
        { ...rowA, dimension: rowA.dimension + 1 },
      ]),
    }),
    /dimension mismatch.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("wrong-encoding", [
        { ...rowA, encoding: "base64" },
      ]),
    }),
    /encoding mismatch.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("missing-vector", [
        { ...rowA, vector: null },
      ]),
    }),
    /vector mismatch.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [{ ...rowA, vector: null }])],
      compactedPack: pack("valid-vector", [rowA]),
    }),
    /vector mismatch.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [pack("source", [rowA])],
      compactedPack: pack("short-vector", [
        { ...rowA, vector: rowA.vector.slice(1) },
      ]),
    }),
    /vector mismatch.*ck_a/u,
  )
})

test("validateVectorPackCompaction rejects conflicting source duplicates", async () => {
  const { validateVectorPackCompaction } = await loadCompactionModule()
  const rowA = row({ key: "a", hash: "1", seed: 1 })
  const conflictingHashA = {
    ...rowA,
    text_hash: `sha256:${"9".repeat(64)}`,
  }
  const conflictingVectorA = {
    ...rowA,
    vector: vector(99),
  }

  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [
        pack("pack-a", [rowA]),
        pack("pack-b", [conflictingHashA]),
      ],
      compactedPack: pack("compacted", [rowA]),
    }),
    /conflicting duplicate chunk_key.*ck_a/u,
  )
  assert.throws(
    () => validateVectorPackCompaction({
      sourcePacks: [
        pack("pack-a", [rowA]),
        pack("pack-b", [conflictingVectorA]),
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

  const changedActive = clone(before)
  changedActive.search.active = ["trackA/task-other/task.md"]
  assert.throws(
    () => validateCompactionPreservation({ before, after: changedActive }),
    /active search scope changed/u,
  )

  const extraAll = clone(before)
  extraAll.search.all.push("trackZ/injected/task.md")
  assert.throws(
    () => validateCompactionPreservation({ before, after: extraAll }),
    /all search scope changed/u,
  )

  const missingRef = clone(before)
  missingRef.refs_graph = []
  assert.throws(
    () => validateCompactionPreservation({ before, after: missingRef }),
    /refs_graph changed/u,
  )

  const mutatedRef = clone(before)
  mutatedRef.refs_graph = [
    {
      from: "trackA/task-active/task.md",
      to: "trackA/task-active/doing.md",
      ref_kind: "doing_of",
    },
  ]
  assert.throws(
    () => validateCompactionPreservation({ before, after: mutatedRef }),
    /refs_graph changed/u,
  )
})

test("validateCompactionPreservation compares object search result rows by content", async () => {
  const { validateCompactionPreservation } = await loadCompactionModule()
  const before = {
    search: {
      active: [
        {
          path: "trackA/task-active/task.md",
          kind: "task",
          track: "trackA",
          task_slug: "task-active",
          status: "processing",
          updated_at: "2026-05-01",
          snippet: "alpha active content",
          score: 0.91,
          score_breakdown: {
            bm25: 0.8,
            pin: false,
            recency: 0.4,
            semantic: 0.9,
            state: 0.5,
          },
          matched_terms: ["alpha", "active"],
        },
      ],
      archived: [],
      all: [],
    },
    refs_graph: [],
  }

  const reorderedEquivalent = {
    search: {
      active: [
        {
          score_breakdown: {
            state: 0.5,
            semantic: 0.9,
            recency: 0.4,
            pin: false,
            bm25: 0.8,
          },
          matched_terms: ["alpha", "active"],
          score: 0.91,
          snippet: "alpha active content",
          updated_at: "2026-05-01",
          status: "processing",
          task_slug: "task-active",
          track: "trackA",
          kind: "task",
          path: "trackA/task-active/task.md",
        },
      ],
      archived: [],
      all: [],
    },
    refs_graph: [],
  }
  assert.deepEqual(
    validateCompactionPreservation({ before, after: reorderedEquivalent }),
    { search_preserved: true, refs_preserved: true },
  )

  const mutatedObjectRow = clone(before)
  mutatedObjectRow.search.active = [
    {
      ...mutatedObjectRow.search.active[0],
      path: "trackA/task-other/task.md",
      status: "done",
      snippet: "changed active content",
    },
  ]
  assert.throws(
    () => validateCompactionPreservation({ before, after: mutatedObjectRow }),
    /active search scope changed/u,
  )
})

test("validateCompactionPreservation rejects missing snapshots and tolerates absent optional arrays", async () => {
  const { validateCompactionPreservation } = await loadCompactionModule()
  assert.throws(
    () => validateCompactionPreservation(),
    /before snapshot is required/u,
  )
  assert.throws(
    () => validateCompactionPreservation({ before: {} }),
    /after snapshot is required/u,
  )
  assert.deepEqual(
    validateCompactionPreservation({
      before: { search: {}, refs_graph: undefined },
      after: { search: {}, refs_graph: [] },
    }),
    { search_preserved: true, refs_preserved: true },
  )
  assert.deepEqual(
    validateCompactionPreservation({
      before: {
        search: {},
        refs_graph: [{ from: null, to: undefined, ref_kind: null }],
      },
      after: {
        search: {},
        refs_graph: [{}],
      },
    }),
    { search_preserved: true, refs_preserved: true },
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
