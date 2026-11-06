// chunk.test.js — golden splitting cases for the chunker.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { chunkBody } from "../../src/indexer/chunk.js"

test("empty / whitespace body yields zero chunks", () => {
  assert.deepEqual(chunkBody(""), [])
  assert.deepEqual(chunkBody("   \n\n  "), [])
})

test("single paragraph doc → one chunk, no heading", () => {
  const out = chunkBody("just a sentence, no headings here.")
  assert.equal(out.length, 1)
  assert.equal(out[0].index, 0)
  assert.equal(out[0].heading, null)
  assert.ok(out[0].text.includes("just a sentence"))
})

test("H2-bounded doc splits into one chunk per section + preamble", () => {
  const body = [
    "preamble paragraph",
    "",
    "## Section A",
    "alpha content",
    "",
    "## Section B",
    "beta content",
  ].join("\n")
  const out = chunkBody(body)
  assert.equal(out.length, 3)
  assert.equal(out[0].heading, null)
  assert.equal(out[1].heading, "Section A")
  assert.equal(out[2].heading, "Section B")
  // Indexes are dense + 0-based.
  assert.deepEqual(
    out.map((c) => c.index),
    [0, 1, 2],
  )
})

test("oversized section splits on paragraph boundary", () => {
  const big = "lorem ipsum dolor sit amet, ".repeat(40) // ~1120 chars
  const second = "second paragraph that is also reasonably long. ".repeat(15)
  const body = [
    "## Big section",
    big,
    "",
    second,
    "",
    "small trailing paragraph.",
  ].join("\n")
  const out = chunkBody(body)
  // The whole section is one heading but should produce multiple chunks
  // because the body crosses the 800-char threshold.
  assert.ok(out.length >= 2, `expected >=2 chunks, got ${out.length}`)
  // All chunks attached to the same heading.
  for (const c of out) {
    assert.equal(c.heading, "Big section")
  }
})

test("code fence is never split mid-fence", () => {
  // Build a fenced block that itself exceeds the threshold + a heading
  // before it so we know which section the fence lives in.
  const fence = ["```js", "x".repeat(900), "```"].join("\n")
  const body = ["## Has code", fence].join("\n")
  const out = chunkBody(body)
  // Even though the fence is huge, it must come out atomic — i.e., one
  // chunk contains both the opening and closing fence markers.
  const fenceChunks = out.filter(
    (c) => c.text.includes("```js") && c.text.endsWith("```"),
  )
  assert.equal(
    fenceChunks.length,
    1,
    `expected exactly one chunk to contain the full fence; got ${out.length} chunks`,
  )
})

test("H2 lookalike inside code fence does not trigger split", () => {
  const body = [
    "## Real heading",
    "",
    "```",
    "## not a heading, still inside a fence",
    "more code",
    "```",
    "",
    "## Other heading",
    "tail",
  ].join("\n")
  const out = chunkBody(body)
  // We expect exactly 2 sections (the two real H2 headings), not 3.
  const headings = out.map((c) => c.heading)
  assert.deepEqual(headings.sort(), ["Other heading", "Real heading"].sort())
})
