import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { ACTIVE_EMBEDDING_SPEC } from "./spec.js"

const VECTOR_ENCODING = "float32-json"
const ROW_FIELDS = new Set([
  "chunk_key",
  "text_hash",
  "embedding_spec_id",
  "dimension",
  "encoding",
  "vector",
])
const ROW_ABORT_CHECK_INTERVAL = 100

export function deriveVectorPackPaths({
  pluginRoot,
  embeddingSpecId = ACTIVE_EMBEDDING_SPEC.id,
  packId,
} = {}) {
  assertPathSafeId(embeddingSpecId, "embedding_spec_id")
  assertPathSafeId(packId, "pack_id")
  const packDir = path.join(pluginRoot, "artifacts", "vector-packs", embeddingSpecId)
  const packPath = path.join(packDir, `${packId}.jsonl`)
  return {
    packDir,
    packPath,
    manifestPath: path.join(packDir, `${packId}.manifest.json`),
    checksumPath: path.join(packDir, `${packId}.sha256`),
    relativePackPath: normalizePath(path.join(
      "plugins",
      "desk",
      "artifacts",
      "vector-packs",
      embeddingSpecId,
      `${packId}.jsonl`,
    )),
  }
}

export async function validateVectorPackFile({
  packPath,
  manifestPath,
  checksumPath,
  expectedSpec = ACTIVE_EMBEDDING_SPEC,
  signal,
} = {}) {
  throwIfAborted(signal)
  const label = path.basename(packPath ?? "vector-pack")
  if (typeof packPath !== "string" || packPath.trim() === "") {
    throw new Error(`${label} pack path is required`)
  }
  const resolvedManifestPath = manifestPath ?? sidecarPath(packPath, ".manifest.json")
  const resolvedChecksumPath = checksumPath ?? sidecarPath(packPath, ".sha256")
  const packBytes = await readRequiredFile(packPath, `${label} pack`, signal)
  const packText = packBytes.toString("utf8")
  const packSha = sha256(packBytes)
  const manifest = await readRequiredJson(resolvedManifestPath, `${label} manifest`, signal)
  const checksum = await readRequiredChecksum(resolvedChecksumPath, `${label} checksum`, signal)

  if (checksum !== packSha) {
    throw new Error(`${label}: checksum mismatch for vector pack`)
  }
  validateManifest({ manifest, expectedSpec, packSha, label })
  const rows = await parseRows({ packText, expectedSpec, label, signal })
  if (manifest.row_count !== rows.length) {
    throw new Error(`${label}: manifest row_count must match vector pack rows`)
  }

  return {
    pack_id: manifest.pack_id,
    embedding_spec_id: manifest.embedding_spec_id,
    rows,
    manifest,
  }
}

export async function importVectorPacks({
  db,
  pluginRoot,
  expectedSpec = ACTIVE_EMBEDDING_SPEC,
  signal,
} = {}) {
  throwIfAborted(signal)
  const packDir = path.join(pluginRoot, "artifacts", "vector-packs", expectedSpec.id)
  const summary = {
    packs_considered: 0,
    packs_imported: 0,
    rows_imported: 0,
    rows_skipped_duplicate: 0,
    rows_skipped_missing_chunk: 0,
  }

  let entries
  try {
    entries = await fs.readdir(packDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return summary
    throw error
  }
  throwIfAborted(signal)

  const packFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(packDir, entry.name))
    .sort()

  const seenInRun = new Set()
  const findChunks = db.prepare(
    `SELECT id, text_hash
     FROM chunks
     WHERE chunk_key = ?
     ORDER BY id`,
  )
  const hasVector = db.prepare(
    "SELECT chunk_id FROM chunk_vecs WHERE chunk_id = ?",
  )
  const insertVector = db.prepare(
    "INSERT INTO chunk_vecs (chunk_id, embedding) VALUES (?, ?)",
  )

  for (const packPath of packFiles) {
    throwIfAborted(signal)
    summary.packs_considered += 1
    const pack = await validateVectorPackFile({
      packPath,
      manifestPath: sidecarPath(packPath, ".manifest.json"),
      checksumPath: sidecarPath(packPath, ".sha256"),
      expectedSpec,
      signal,
    })
    throwIfAborted(signal)
    summary.packs_imported += 1

    const txn = db.transaction((rows) => {
      for (const row of rows) {
        throwIfAborted(signal)
        const chunks = findChunks.all(row.chunk_key)
        if (chunks.length === 0) {
          summary.rows_skipped_missing_chunk += 1
          continue
        }
        for (const chunk of chunks) {
          if (chunk.text_hash !== row.text_hash) {
            throw new Error(
              `${path.basename(packPath)} row ${row.row_number}: text_hash mismatch for chunk_key ${row.chunk_key}`,
            )
          }
        }

        if (seenInRun.has(row.chunk_key)) {
          summary.rows_skipped_duplicate += 1
          continue
        }

        let inserted = 0
        let skipped = 0
        for (const chunk of chunks) {
          throwIfAborted(signal)
          if (hasVector.get(chunk.id)) {
            skipped += 1
            continue
          }
          insertVector.run(BigInt(chunk.id), new Float32Array(row.vector))
          inserted += 1
        }
        if (inserted === 0) {
          seenInRun.add(row.chunk_key)
          summary.rows_skipped_duplicate += skipped
          continue
        }
        seenInRun.add(row.chunk_key)
        summary.rows_imported += inserted
        summary.rows_skipped_duplicate += skipped
      }
    })
    for (let index = 0; index < pack.rows.length; index += ROW_ABORT_CHECK_INTERVAL) {
      throwIfAborted(signal)
      txn(pack.rows.slice(index, index + ROW_ABORT_CHECK_INTERVAL))
      await yieldToAbortSignal(signal)
    }
  }

  return summary
}

function validateManifest({ manifest, expectedSpec, packSha, label }) {
  if (manifest.schema_version !== 1) {
    throw new Error(`${label}: manifest schema_version must be 1`)
  }
  assertPathSafeId(manifest.pack_id, "pack_id")
  if (manifest.embedding_spec_id !== expectedSpec.id) {
    throw new Error(`${label}: manifest embedding_spec_id must match active spec`)
  }
  if (manifest.dimension !== expectedSpec.dimension) {
    throw new Error(`${label}: manifest dimension must match active spec`)
  }
  if (manifest.encoding !== VECTOR_ENCODING) {
    throw new Error(`${label}: manifest encoding must be ${VECTOR_ENCODING}`)
  }
  if (!Number.isInteger(manifest.row_count) || manifest.row_count < 0) {
    throw new Error(`${label}: manifest row_count must be a non-negative integer`)
  }
  if (manifest.rows_sha256 !== packSha) {
    throw new Error(`${label}: manifest rows_sha256 must match vector pack`)
  }
}

async function parseRows({ packText, expectedSpec, label, signal }) {
  throwIfAborted(signal)
  const rows = []
  const lines = packText.split(/\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    if (index % ROW_ABORT_CHECK_INTERVAL === 0) {
      await yieldToAbortSignal(signal)
    }
    const line = lines[index]
    if (line.trim() === "") continue
    const rowNumber = index + 1
    let row
    try {
      row = JSON.parse(line)
    } catch {
      throw new Error(`${label} row ${rowNumber}: malformed JSON`)
    }
    validateRow({ row, rowNumber, expectedSpec, label })
    rows.push({ ...row, row_number: rowNumber })
  }
  throwIfAborted(signal)
  return rows
}

function validateRow({ row, rowNumber, expectedSpec, label }) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`${label} row ${rowNumber}: row must be an object`)
  }
  if (Object.keys(row).some((key) => !ROW_FIELDS.has(key))) {
    throw new Error(`${label} row ${rowNumber}: unknown field is not allowed`)
  }
  if (typeof row.chunk_key !== "string" || !/^ck_[a-f0-9]{40}$/u.test(row.chunk_key)) {
    throw new Error(`${label} row ${rowNumber}: chunk_key is invalid`)
  }
  if (typeof row.text_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(row.text_hash)) {
    throw new Error(`${label} row ${rowNumber}: text_hash is invalid`)
  }
  if (row.embedding_spec_id !== expectedSpec.id) {
    throw new Error(`${label} row ${rowNumber}: embedding_spec_id must match active spec`)
  }
  if (row.dimension !== expectedSpec.dimension) {
    throw new Error(`${label} row ${rowNumber}: dimension must match active spec`)
  }
  if (row.encoding !== VECTOR_ENCODING) {
    throw new Error(`${label} row ${rowNumber}: encoding must be ${VECTOR_ENCODING}`)
  }
  if (!Array.isArray(row.vector)) {
    throw new Error(`${label} row ${rowNumber}: vector must be an array`)
  }
  if (row.vector.length !== expectedSpec.dimension) {
    throw new Error(`${label} row ${rowNumber}: vector length must match dimension`)
  }
  if (!row.vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error(`${label} row ${rowNumber}: vector must contain only finite numbers`)
  }
}

async function readRequiredFile(filePath, label, signal) {
  throwIfAborted(signal)
  try {
    const bytes = await fs.readFile(filePath)
    throwIfAborted(signal)
    return bytes
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} missing`)
    }
    throw error
  }
}

async function readRequiredJson(filePath, label, signal) {
  const bytes = await readRequiredFile(filePath, label, signal)
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

async function readRequiredChecksum(filePath, label, signal) {
  const bytes = await readRequiredFile(filePath, label, signal)
  const match = bytes.toString("utf8").match(/^\s*([a-f0-9]{64})\b/u)
  if (!match) {
    throw new Error(`${label} must start with a sha256 digest`)
  }
  return match[1]
}

function sidecarPath(packPath, suffix) {
  return packPath.replace(/\.jsonl$/u, suffix)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function yieldToAbortSignal(signal) {
  throwIfAborted(signal)
  await new Promise((resolve) => setImmediate(resolve))
  throwIfAborted(signal)
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const err = new Error("operation aborted")
  err.name = "AbortError"
  throw err
}

function assertPathSafeId(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value !== value.trim() ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    path.isAbsolute(value)
  ) {
    throw new Error(`invalid ${label}: path traversal is not allowed`)
  }
}

function normalizePath(value) {
  return value.split(path.sep).join("/")
}
