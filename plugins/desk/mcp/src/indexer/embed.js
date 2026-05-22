// embed.js — turn chunk text into 768-dim embeddings via Ollama.
//
// Calls Ollama's /api/embeddings endpoint with `nomic-embed-text` (which
// resolves to nomic-embed-text-v1.5 — 768-dim, 8k context). Soft-fails when
// Ollama is unreachable or returns an unusable response: we return null and
// log a single semantic_unavailable warning per indexer run so the index
// still gets populated lexically.

export const EMBEDDING_DIM = 768
const DEFAULT_ENDPOINT = "http://localhost:11434/api/embeddings"
const DEFAULT_MODEL = "nomic-embed-text"

/**
 * Embed a single chunk of text. Returns a Float32-friendly array of length
 * 768 on success, or null when the embedding service is unavailable.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.endpoint] — override the Ollama endpoint URL.
 * @param {string} [opts.model] — override the model name.
 * @param {typeof fetch} [opts.fetch] — injection point for tests.
 * @returns {Promise<number[] | null>}
 */
export async function embedChunk(text, opts = {}) {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT
  const model = opts.model ?? DEFAULT_MODEL
  const fetchImpl = opts.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") {
    return null
  }

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    })
  } catch (err) {
    // Connection refused, DNS, etc — Ollama isn't running.
    return null
  }

  if (!response || !response.ok) {
    return null
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return null
  }

  const vec = payload?.embedding
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
    return null
  }
  // Defensive: coerce to numbers; null/undef entries → 0.
  return vec.map((v) => (typeof v === "number" ? v : 0))
}

/**
 * Batch-embed an array of chunk texts. Returns an array of the same length
 * where each entry is either a 768-dim array or null (chunk-level soft-fail
 * — though in practice if one fails, they all fail because Ollama is down).
 *
 * Stops calling Ollama after the first failure to avoid hammering a dead
 * endpoint; remaining chunks are returned as null.
 */
export async function embedChunks(texts, opts = {}) {
  const out = []
  let aborted = false
  for (const t of texts) {
    if (aborted) {
      out.push(null)
      continue
    }
    const vec = await embedChunk(t, opts)
    if (vec == null) {
      aborted = true
      out.push(null)
    } else {
      out.push(vec)
    }
  }
  return out
}
