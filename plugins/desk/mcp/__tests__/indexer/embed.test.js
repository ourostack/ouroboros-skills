// embed.test.js — Ollama soft-fail + happy path with a mocked fetch.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { embedChunk, embedChunks, EMBEDDING_DIM } from "../../src/indexer/embed.js"

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
  const out = await embedChunks(["a", "b", "c", "d"], { fetch: fetchImpl })
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
