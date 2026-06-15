// Unit 11a: red contract for stable chunk keys and embedding specs.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { chunkBody } from "../../src/indexer/chunk.js"

const mcpRoot = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
)

async function loadSpecModule() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "indexer", "spec.js")))
}

test("active embedding spec is versioned, path-safe, and tied to chunker identity", async () => {
  const { ACTIVE_EMBEDDING_SPEC, getActiveEmbeddingSpec } = await loadSpecModule()
  const active = getActiveEmbeddingSpec()

  assert.deepEqual(active, ACTIVE_EMBEDDING_SPEC)
  assert.equal(active.model, "nomic-embed-text")
  assert.equal(active.model_revision, "nomic-embed-text-v1.5")
  assert.equal(active.dimension, 768)
  assert.equal(active.chunker_id, "desk-md-h2-paragraph-v1")
  assert.equal(active.normalization_id, "unicode-whitespace-v1")
  assert.match(active.id, /nomic-embed-text-v1_5/u)
  assert.doesNotMatch(active.id, /[\\/: \t\r\n]/u)
})

test("normalized text identity is stable across line endings and insignificant whitespace", async () => {
  const { normalizeChunkText, chunkTextHash } = await loadSpecModule()
  const left = "## Heading\r\nAlpha\u00a0beta  \r\n\r\n"
  const right = "## Heading\nAlpha beta\n"

  assert.equal(normalizeChunkText(left), "## Heading\nAlpha beta")
  assert.equal(normalizeChunkText(left), normalizeChunkText(right))
  assert.equal(chunkTextHash(left), chunkTextHash(right))
  assert.notEqual(chunkTextHash(right), chunkTextHash(`${right}changed\n`))
})

test("chunk keys are stable when unchanged text moves within a document", async () => {
  const { ACTIVE_EMBEDDING_SPEC, computeChunkKey } = await loadSpecModule()
  const docPath = "trackA/task-1/doing.md"
  const before = chunkBody(["## Stable", "same body"].join("\n"))[0]
  const after = chunkBody([
    "## New preface",
    "new text shifts the stable chunk",
    "",
    "## Stable",
    "same body",
  ].join("\n")).find((chunk) => chunk.heading === "Stable")

  const beforeKey = computeChunkKey({ docPath, chunk: before, embeddingSpec: ACTIVE_EMBEDDING_SPEC })
  const afterKey = computeChunkKey({ docPath, chunk: after, embeddingSpec: ACTIVE_EMBEDDING_SPEC })
  const changedKey = computeChunkKey({
    docPath,
    chunk: { ...after, text: `${after.text}\nchanged` },
    embeddingSpec: ACTIVE_EMBEDDING_SPEC,
  })

  assert.equal(afterKey, beforeKey)
  assert.notEqual(changedKey, beforeKey)
})

test("inactive embedding specs are rejected by spec identity helpers", async () => {
  const { ACTIVE_EMBEDDING_SPEC, isActiveEmbeddingSpec } = await loadSpecModule()

  assert.equal(isActiveEmbeddingSpec(ACTIVE_EMBEDDING_SPEC.id), true)
  assert.equal(isActiveEmbeddingSpec(`${ACTIVE_EMBEDDING_SPEC.id}-old`), false)
  assert.equal(isActiveEmbeddingSpec(null), false)
})
