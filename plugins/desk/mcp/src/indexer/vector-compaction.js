const SEARCH_SCOPES = ["active", "archived", "all"]

export function validateVectorPackCompaction({ sourcePacks, compactedPack } = {}) {
  if (!Array.isArray(sourcePacks) || sourcePacks.length === 0) {
    throw new Error("sourcePacks must be a non-empty array")
  }
  if (!compactedPack || typeof compactedPack !== "object") {
    throw new Error("compactedPack is required")
  }

  const expected = new Map()
  let sourceRows = 0
  for (const pack of sourcePacks) {
    for (const row of packRows(pack, "source pack")) {
      sourceRows += 1
      const existing = expected.get(row.chunk_key)
      if (existing) {
        assertRowsEqual(existing, row, "conflicting duplicate chunk_key")
        continue
      }
      expected.set(row.chunk_key, row)
    }
  }

  const actual = new Map()
  for (const row of packRows(compactedPack, "compacted pack")) {
    if (actual.has(row.chunk_key)) {
      throw new Error(`duplicate compacted row for chunk_key ${row.chunk_key}`)
    }
    actual.set(row.chunk_key, row)
  }

  for (const [chunkKey, expectedRow] of expected) {
    const actualRow = actual.get(chunkKey)
    if (!actualRow) {
      throw new Error(`missing compacted row for chunk_key ${chunkKey}`)
    }
    assertRowsEqual(expectedRow, actualRow, "compacted row mismatch")
  }

  for (const chunkKey of actual.keys()) {
    if (!expected.has(chunkKey)) {
      throw new Error(`unexpected compacted row for chunk_key ${chunkKey}`)
    }
  }

  return {
    equivalent: true,
    source_pack_count: sourcePacks.length,
    source_rows: sourceRows,
    compacted_rows: actual.size,
    unique_chunk_keys: expected.size,
    duplicate_rows_removed: sourceRows - expected.size,
  }
}

export function validateCompactionPreservation({ before, after } = {}) {
  if (!before || typeof before !== "object") {
    throw new Error("before snapshot is required")
  }
  if (!after || typeof after !== "object") {
    throw new Error("after snapshot is required")
  }

  for (const scope of SEARCH_SCOPES) {
    assertCanonicalRowsEqual(
      before.search?.[scope],
      after.search?.[scope],
      `${scope} search scope changed`,
    )
  }
  assertCanonicalRowsEqual(before.chunks, after.chunks, "chunk identity changed")
  assertRefRowsEqual(before.refs_graph, after.refs_graph)
  return { search_preserved: true, refs_preserved: true }
}

export function captureCompactionPreservationSnapshot(db) {
  const docs = db.prepare(
    `SELECT path, kind, track, task_slug, status, updated_at, is_archived
     FROM docs
     ORDER BY path`,
  ).all()
  const search = {
    active: [],
    archived: [],
    all: docs,
  }
  for (const row of docs) {
    if (row.is_archived) {
      search.archived.push(row)
    } else {
      search.active.push(row)
    }
  }

  return {
    search,
    refs_graph: db.prepare(
      `SELECT src.path AS "from", dst.path AS "to", rg.ref_kind
       FROM refs_graph rg
       JOIN docs src ON src.id = rg.src_doc_id
       JOIN docs dst ON dst.id = rg.dst_doc_id
       ORDER BY src.path, dst.path, rg.ref_kind`,
    ).all(),
    chunks: db.prepare(
      `SELECT d.path AS doc_path,
              c.chunk_index,
              c.chunk_key,
              c.text_hash,
              c.embedding_spec_id,
              c.chunker_id,
              c.normalization_id
       FROM chunks c
       JOIN docs d ON d.id = c.doc_id
       ORDER BY d.path, c.chunk_index, c.id`,
    ).all(),
  }
}

function packRows(pack, label) {
  if (!pack || typeof pack !== "object" || !Array.isArray(pack.rows)) {
    throw new Error(`${label} rows must be an array`)
  }
  return pack.rows
}

function assertRowsEqual(left, right, message) {
  if (left.text_hash !== right.text_hash) {
    throw new Error(`${message}: text_hash mismatch for chunk_key ${left.chunk_key}`)
  }
  if (left.embedding_spec_id !== right.embedding_spec_id) {
    throw new Error(`${message}: embedding_spec_id mismatch for chunk_key ${left.chunk_key}`)
  }
  if (left.dimension !== right.dimension) {
    throw new Error(`${message}: dimension mismatch for chunk_key ${left.chunk_key}`)
  }
  if (left.encoding !== right.encoding) {
    throw new Error(`${message}: encoding mismatch for chunk_key ${left.chunk_key}`)
  }
  if (!vectorsEqual(left.vector, right.vector)) {
    throw new Error(`${message}: vector mismatch for chunk_key ${left.chunk_key}`)
  }
}

function vectorsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function assertCanonicalRowsEqual(left, right, message) {
  const leftList = normalizeCanonicalRows(left)
  const rightList = normalizeCanonicalRows(right)
  if (leftList.length !== rightList.length) {
    throw new Error(message)
  }
  for (let index = 0; index < leftList.length; index += 1) {
    if (leftList[index] !== rightList[index]) {
      throw new Error(message)
    }
  }
}

function normalizeCanonicalRows(value) {
  return Array.isArray(value) ? value.map(canonicalSearchRow) : []
}

function canonicalSearchRow(value) {
  if (typeof value === "string") {
    return `string:${JSON.stringify(value)}`
  }
  return `json:${stableStringify(value)}`
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

function stableValue(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(stableValue)

  const sorted = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stableValue(value[key])
  }
  return sorted
}

function assertRefRowsEqual(left, right) {
  const leftRefs = normalizeRefs(left)
  const rightRefs = normalizeRefs(right)
  if (leftRefs.length !== rightRefs.length) {
    throw new Error("refs_graph changed")
  }
  for (let index = 0; index < leftRefs.length; index += 1) {
    if (leftRefs[index] !== rightRefs[index]) {
      throw new Error("refs_graph changed")
    }
  }
}

function normalizeRefs(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((row) => JSON.stringify({
      from: row?.from ?? null,
      to: row?.to ?? null,
      ref_kind: row?.ref_kind ?? null,
    }))
    .sort()
}
