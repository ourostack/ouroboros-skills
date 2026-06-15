import { createHash } from "node:crypto"

export const ACTIVE_EMBEDDING_SPEC = Object.freeze({
  id: "nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768",
  model: "nomic-embed-text",
  model_revision: "nomic-embed-text-v1.5",
  dimension: 768,
  chunker_id: "desk-md-h2-paragraph-v1",
  normalization_id: "unicode-whitespace-v1",
  is_active: true,
})

export function getActiveEmbeddingSpec() {
  return { ...ACTIVE_EMBEDDING_SPEC }
}

export function isActiveEmbeddingSpec(specId) {
  return specId === ACTIVE_EMBEDDING_SPEC.id
}

export function normalizeChunkText(text) {
  return String(text ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/gu, " "))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function chunkTextHash(text) {
  return `sha256:${sha256(normalizeChunkText(text))}`
}

export function computeChunkKey({ docPath, chunk, embeddingSpec = ACTIVE_EMBEDDING_SPEC }) {
  const textHash = chunkTextHash(chunk?.text ?? "")
  const identity = [
    embeddingSpec.id,
    embeddingSpec.chunker_id,
    embeddingSpec.normalization_id,
    docPath,
    textHash,
  ].join("\0")
  return `ck_${sha256(identity).slice(0, 40)}`
}

export function chunkIdentity({ docPath, chunk, embeddingSpec = ACTIVE_EMBEDDING_SPEC }) {
  return {
    chunk_key: computeChunkKey({ docPath, chunk, embeddingSpec }),
    text_hash: chunkTextHash(chunk?.text ?? ""),
    embedding_spec_id: embeddingSpec.id,
    chunker_id: embeddingSpec.chunker_id,
    normalization_id: embeddingSpec.normalization_id,
  }
}

export function writeActiveEmbeddingSpec(db, setMeta) {
  db.prepare("UPDATE embedding_specs SET is_active = 0 WHERE is_active != 0").run()
  db.prepare(
    `INSERT INTO embedding_specs
      (id, model, model_revision, dimension, chunker_id, normalization_id, is_active)
     VALUES (@id, @model, @model_revision, @dimension, @chunker_id, @normalization_id, 1)
     ON CONFLICT(id) DO UPDATE SET
       model = excluded.model,
       model_revision = excluded.model_revision,
       dimension = excluded.dimension,
       chunker_id = excluded.chunker_id,
       normalization_id = excluded.normalization_id,
       is_active = 1`,
  ).run(ACTIVE_EMBEDDING_SPEC)
  setMeta(db, "active_embedding_spec_id", ACTIVE_EMBEDDING_SPEC.id)
  setMeta(db, "active_chunker_id", ACTIVE_EMBEDDING_SPEC.chunker_id)
  setMeta(db, "active_normalization_id", ACTIVE_EMBEDDING_SPEC.normalization_id)
}
