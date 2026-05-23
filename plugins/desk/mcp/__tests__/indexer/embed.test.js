// embed.test.js — Ollama soft-fail + happy path with a mocked fetch.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import {
  embedChunk,
  embedChunkDetailed,
  embedChunks,
  EMBEDDING_DIM,
  resolveEmbeddingEndpoints,
  resolveEmbeddingModel,
} from "../../src/indexer/embed.js"

function mockOkFetch(vec) {
  return async (_url, _opts) => ({
    ok: true,
    json: async () => ({ embedding: vec }),
  })
}

function mockHttpErrorFetch(status) {
  return async () => ({ ok: false, status })
}

function mockNetworkErrorFetch() {
  return async () => {
    const err = new Error("ECONNREFUSED")
    err.code = "ECONNREFUSED"
    throw err
  }
}

test("embedChunk returns a 768-dim array on success", async () => {
  const vec = Array.from({ length: EMBEDDING_DIM }, (_, i) => i / EMBEDDING_DIM)
  const out = await embedChunk("hello world", { fetch: mockOkFetch(vec) })
  assert.ok(Array.isArray(out))
  assert.equal(out.length, EMBEDDING_DIM)
  assert.equal(out[0], 0)
  assert.equal(out[100], 100 / EMBEDDING_DIM)
})

test("embedChunk returns null when Ollama refuses the connection", async () => {
  const out = await embedChunk("x", { fetch: mockNetworkErrorFetch() })
  assert.equal(out, null)
})

test("embedChunk returns null on HTTP error (model not pulled, etc.)", async () => {
  const out = await embedChunk("x", { fetch: mockHttpErrorFetch(404) })
  assert.equal(out, null)
})

test("embedChunkDetailed reports endpoint/model diagnostics on failure", async () => {
  const res = await embedChunkDetailed("x", {
    endpoint: "http://127.0.0.1:11434",
    model: "missing-model",
    fetch: mockHttpErrorFetch(404),
  })
  assert.equal(res.available, false)
  assert.equal(res.vector, null)
  assert.equal(res.diagnostic.endpoint, "http://127.0.0.1:11434/api/embeddings")
  assert.equal(res.diagnostic.model, "missing-model")
  assert.equal(res.diagnostic.reason, "http_404")
})

test("embedChunk tries OLLAMA_HOST before default localhost fallbacks", async () => {
  const oldHost = process.env.OLLAMA_HOST
  const oldEndpoint = process.env.DESK_EMBED_ENDPOINT
  const oldOllamaEndpoint = process.env.DESK_OLLAMA_ENDPOINT
  delete process.env.DESK_EMBED_ENDPOINT
  delete process.env.DESK_OLLAMA_ENDPOINT
  process.env.OLLAMA_HOST = "http://10.0.0.8:11434"
  const calls = []
  const vec = Array.from({ length: EMBEDDING_DIM }, () => 0.25)
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes("10.0.0.8")) throw new Error("not reachable")
    return { ok: true, json: async () => ({ embedding: vec }) }
  }

  try {
    const out = await embedChunk("hello", { fetch: fetchImpl })
    assert.equal(out.length, EMBEDDING_DIM)
    assert.equal(calls[0], "http://10.0.0.8:11434/api/embeddings")
    assert.equal(calls[1], "http://127.0.0.1:11434/api/embeddings")
  } finally {
    if (oldHost == null) delete process.env.OLLAMA_HOST
    else process.env.OLLAMA_HOST = oldHost
    if (oldEndpoint == null) delete process.env.DESK_EMBED_ENDPOINT
    else process.env.DESK_EMBED_ENDPOINT = oldEndpoint
    if (oldOllamaEndpoint == null) delete process.env.DESK_OLLAMA_ENDPOINT
    else process.env.DESK_OLLAMA_ENDPOINT = oldOllamaEndpoint
  }
})

test("embedding endpoint and model can be resolved from environment", () => {
  const oldEndpoint = process.env.DESK_EMBED_ENDPOINT
  const oldModel = process.env.DESK_EMBED_MODEL
  process.env.DESK_EMBED_ENDPOINT = "http://example.test:11434"
  process.env.DESK_EMBED_MODEL = "custom-embed"
  try {
    assert.equal(resolveEmbeddingModel(), "custom-embed")
    assert.equal(
      resolveEmbeddingEndpoints()[0],
      "http://example.test:11434/api/embeddings",
    )
  } finally {
    if (oldEndpoint == null) delete process.env.DESK_EMBED_ENDPOINT
    else process.env.DESK_EMBED_ENDPOINT = oldEndpoint
    if (oldModel == null) delete process.env.DESK_EMBED_MODEL
    else process.env.DESK_EMBED_MODEL = oldModel
  }
})

test("embedChunk returns null when embedding dimensionality is wrong", async () => {
  const out = await embedChunk("x", { fetch: mockOkFetch([0, 1, 2]) })
  assert.equal(out, null)
})

test("embedChunks stops calling fetch after the first failure", async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    const err = new Error("nope")
    err.code = "ECONNREFUSED"
    throw err
  }
  const out = await embedChunks(["a", "b", "c", "d"], {
    endpoint: "http://127.0.0.1:11434",
    fetch: fetchImpl,
  })
  assert.equal(out.length, 4)
  for (const e of out) assert.equal(e, null)
  // The implementation may probe a chunk or two before giving up; we want
  // it to bail short of doing all 4.
  assert.equal(calls, 1, `expected single call before bail-out, got ${calls}`)
})

test("embedChunks happy path returns one vector per chunk", async () => {
  const vec = Array.from({ length: EMBEDDING_DIM }, () => 0.5)
  const out = await embedChunks(["a", "b"], { fetch: mockOkFetch(vec) })
  assert.equal(out.length, 2)
  assert.equal(out[0].length, EMBEDDING_DIM)
  assert.equal(out[1].length, EMBEDDING_DIM)
})
