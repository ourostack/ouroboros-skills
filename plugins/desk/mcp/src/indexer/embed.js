// embed.js — turn chunk text into 768-dim embeddings via Ollama.
//
// Calls Ollama's /api/embeddings endpoint with `nomic-embed-text` (which
// resolves to nomic-embed-text-v1.5 — 768-dim, 8k context). Soft-fails when
// Ollama is unreachable or returns an unusable response: we return null and
// log a single semantic_unavailable warning per indexer run so the index
// still gets populated lexically.

export const EMBEDDING_DIM = 768
const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434"
const FALLBACK_OLLAMA_BASE = "http://localhost:11434"
const DEFAULT_MODEL = "nomic-embed-text"
const DEFAULT_TIMEOUT_MS = 2500

function envValue(name) {
  const value = globalThis.process?.env?.[name]
  return typeof value === "string" && value.trim().length ? value.trim() : null
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function normalizeBaseUrl(raw) {
  if (!raw || typeof raw !== "string") return null
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  try {
    const url = new URL(value)
    if (
      url.hostname === "0.0.0.0" ||
      url.hostname === "::" ||
      url.hostname === "[::]"
    ) {
      url.hostname = "127.0.0.1"
    }
    url.pathname = url.pathname.replace(/\/+$/, "")
    if (url.pathname.endsWith("/api/embeddings")) {
      url.pathname = url.pathname.slice(0, -"/api/embeddings".length)
    } else if (url.pathname.endsWith("/api/embed")) {
      url.pathname = url.pathname.slice(0, -"/api/embed".length)
    }
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

function endpointFromBase(raw) {
  const base = normalizeBaseUrl(raw)
  return base ? `${base}/api/embeddings` : null
}

function normalizeEndpoint(raw) {
  if (!raw || typeof raw !== "string") return null
  const value = raw.trim()
  if (!value) return null
  if (value.endsWith("/api/embeddings")) return value
  return endpointFromBase(value)
}

function parseTimeoutMs(opts) {
  const raw = opts.timeoutMs ?? envValue("DESK_EMBED_TIMEOUT_MS")
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

export function resolveEmbeddingModel(opts = {}) {
  return (
    opts.model ??
    envValue("DESK_EMBED_MODEL") ??
    envValue("OLLAMA_EMBED_MODEL") ??
    DEFAULT_MODEL
  )
}

export function resolveEmbeddingEndpoints(opts = {}) {
  if (opts.endpoint) return [normalizeEndpoint(opts.endpoint) ?? opts.endpoint]
  return unique([
    normalizeEndpoint(envValue("DESK_EMBED_ENDPOINT")),
    normalizeEndpoint(envValue("DESK_OLLAMA_ENDPOINT")),
    endpointFromBase(envValue("OLLAMA_HOST")),
    endpointFromBase(DEFAULT_OLLAMA_BASE),
    endpointFromBase(FALLBACK_OLLAMA_BASE),
  ])
}

function compactDiagnostic(diagnostic) {
  if (!diagnostic) return null
  return {
    endpoint: diagnostic.endpoint,
    model: diagnostic.model,
    reason: diagnostic.reason,
    message: diagnostic.message,
  }
}

async function parseErrorMessage(response) {
  try {
    const payload = await response.json()
    if (typeof payload?.error === "string" && payload.error.length) {
      return payload.error
    }
  } catch {
    // Ignore JSON parse failures; status text is good enough.
  }
  return response.statusText || `HTTP ${response.status}`
}

async function postEmbedding({ endpoint, model, text, fetchImpl, timeoutMs }) {
  let timeout = null
  const controller =
    typeof AbortController === "function" ? new AbortController() : null
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  }
  if (controller) {
    request.signal = controller.signal
    timeout = setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    return await fetchImpl(endpoint, request)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * Embed a single chunk of text. Returns a Float32-friendly array of length
 * 768 on success, or null when the embedding service is unavailable.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.endpoint] — override the Ollama endpoint URL.
 * @param {string} [opts.model] — override the model name.
 * @param {number} [opts.timeoutMs] — per-endpoint timeout in milliseconds.
 * @param {typeof fetch} [opts.fetch] — injection point for tests.
 * @returns {Promise<number[] | null>}
 */
export async function embedChunk(text, opts = {}) {
  const { vector } = await embedChunkDetailed(text, opts)
  return vector
}

/**
 * Embed text and include the endpoint/model/reason used for diagnostics.
 *
 * @returns {Promise<{ vector: number[] | null, available: boolean,
 *                     diagnostic: object | null }>}
 */
export async function embedChunkDetailed(text, opts = {}) {
  const endpoints = resolveEmbeddingEndpoints(opts)
  const model = resolveEmbeddingModel(opts)
  const fetchImpl = opts.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== "function") {
    return {
      vector: null,
      available: false,
      diagnostic: {
        endpoint: endpoints[0] ?? null,
        model,
        reason: "fetch_unavailable",
        message: "global fetch is unavailable in this Node runtime",
      },
    }
  }

  if (!endpoints.length) {
    return {
      vector: null,
      available: false,
      diagnostic: {
        endpoint: null,
        model,
        reason: "endpoint_unavailable",
        message: "no embedding endpoint could be resolved",
      },
    }
  }

  const timeoutMs = parseTimeoutMs(opts)
  let lastDiagnostic = null
  for (const endpoint of endpoints) {
    let response
    try {
      response = await postEmbedding({
        endpoint,
        model,
        text,
        fetchImpl,
        timeoutMs,
      })
    } catch (err) {
      lastDiagnostic = {
        endpoint,
        model,
        reason: err?.name === "AbortError" ? "timeout" : "network_error",
        message: err?.message ?? String(err),
      }
      continue
    }

    if (!response || !response.ok) {
      lastDiagnostic = {
        endpoint,
        model,
        reason: `http_${response?.status ?? "error"}`,
        message: response ? await parseErrorMessage(response) : "no response",
      }
      continue
    }

    let payload
    try {
      payload = await response.json()
    } catch (err) {
      lastDiagnostic = {
        endpoint,
        model,
        reason: "invalid_json",
        message: err?.message ?? "embedding response was not JSON",
      }
      continue
    }

    const vec = payload?.embedding
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      lastDiagnostic = {
        endpoint,
        model,
        reason: "invalid_embedding",
        message: `expected ${EMBEDDING_DIM} dimensions, got ${
          Array.isArray(vec) ? vec.length : "none"
        }`,
      }
      continue
    }
    return {
      vector: vec.map((v) => (typeof v === "number" ? v : 0)),
      available: true,
      diagnostic: compactDiagnostic({ endpoint, model, reason: "ok" }),
    }
  }

  return { vector: null, available: false, diagnostic: lastDiagnostic }
}

export async function probeEmbeddingService(opts = {}) {
  const result = await embedChunkDetailed("desk semantic health probe", opts)
  return {
    available: result.available,
    diagnostic: result.diagnostic,
  }
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
