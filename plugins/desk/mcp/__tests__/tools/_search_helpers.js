// Shared scaffolding for search-tool tests.
//
// Builds a small synthetic desk with deterministic embeddings (no real
// Ollama). Each chunk's "embedding" is a hand-built 768-dim vector seeded
// from a topic string — tests can verify cosine ordering by choosing topics
// that align (or anti-align) with each doc's text.

import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export async function mkTempDeskRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-search-test-"))
}

/** Write a file under `<root>/<rel>`, creating parent dirs. */
export async function writeFile(root, rel, body) {
  const abs = path.join(root, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, body, "utf8")
}

const DIM = 768

/**
 * Deterministic, repeatable 768-dim vector seeded from a topic. Same topic
 * → identical vector across calls; different topics produce vectors with
 * predictable cosine relationships (high similarity within the same
 * "family", low across families).
 *
 * The family is just a bucket assignment: each topic word maps to one of N
 * orthogonal subspaces, with intra-family variation injected at lower
 * magnitude. Cosine between same-family topics > 0.5; cross-family ~0.
 */
export function topicVector(topic, opts = {}) {
  const dim = opts.dim ?? DIM
  const seed = String(topic ?? "").toLowerCase().trim()
  const vec = new Array(dim).fill(0)
  if (!seed) return vec

  // Family bucket — first character maps into one of 26 orthogonal subspaces.
  // Cheap, deterministic, gives high cosine for same-family topics.
  const firstChar = seed.charCodeAt(0)
  const family = ((firstChar - 97) % 26 + 26) % 26
  const subspaceStart = family * 20 // 20 dims per family, 520 total used

  // Strong signal in the family's subspace.
  for (let i = 0; i < 20; i++) {
    vec[subspaceStart + i] = 1.0
  }

  // Weak per-topic perturbation derived from a simple hash of the topic.
  // Keeps same-family topics distinct without crossing into other families.
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  for (let i = 0; i < 32; i++) {
    const idx = (h + i * 7) % dim
    vec[idx] += 0.15 // additive perturbation
  }

  return vec
}

/**
 * Build a fake fetch that returns `topicVector` for any prompt. Use as
 * `opts.embed.fetch` when constructing search-tool calls or rebuildIndex.
 *
 * The fake parses the JSON body, extracts `prompt`, and returns an
 * Ollama-shaped response with the deterministic vector.
 */
export function makeEmbedFetch() {
  return async function fakeFetch(_url, options) {
    let prompt = ""
    try {
      const body = JSON.parse(options?.body ?? "{}")
      prompt = String(body.prompt ?? "")
    } catch {
      prompt = ""
    }
    const vec = topicVector(prompt)
    return {
      ok: true,
      json: async () => ({ embedding: vec }),
    }
  }
}

/**
 * Build a fake fetch that always fails — simulating Ollama-down. Useful for
 * exercising the FTS-only / semantic_unavailable fallback paths.
 */
export function makeFailingFetch() {
  return async function failingFetch() {
    const err = new Error("ECONNREFUSED")
    err.code = "ECONNREFUSED"
    throw err
  }
}

/**
 * Index a fixture desk with the fake embed fetch. Returns the rebuildIndex
 * summary so tests can assert chunk counts.
 */
export async function buildFixtureIndex(deskRoot, opts = {}) {
  const { rebuildIndex } = await import("../../src/indexer/index.js")
  return rebuildIndex(deskRoot, {
    embed: { fetch: opts.fetch ?? makeEmbedFetch() },
  })
}
