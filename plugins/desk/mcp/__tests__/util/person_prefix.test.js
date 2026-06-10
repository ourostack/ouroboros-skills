// person_prefix — Unit 1.2: the shared write-prefix helper.
//
//   personPrefix(deskRoot, person)
//     person truthy + valid alias → join(deskRoot, "desks", alias)
//     person null / "" / whitespace → deskRoot (OFF, byte-identical)
//     alias with ".." or a path separator → throws (path-traversal reject)
//
// This is the single seam every write-path builder routes through, so its
// branches carry the 100%-coverage requirement.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { personPrefix } from "../../src/util/paths.js"

const ROOT = path.join(path.sep, "tmp", "crew-repo")

// ── OFF branch (default-OFF, behavior-preserving) ─────────────────────────────

test("personPrefix returns deskRoot unchanged when person is null", () => {
  assert.equal(personPrefix(ROOT, null), ROOT)
})

test("personPrefix returns deskRoot unchanged when person is undefined", () => {
  assert.equal(personPrefix(ROOT, undefined), ROOT)
})

test("personPrefix treats empty string as OFF", () => {
  assert.equal(personPrefix(ROOT, ""), ROOT)
})

test("personPrefix treats whitespace-only person as OFF", () => {
  assert.equal(personPrefix(ROOT, "   "), ROOT)
  assert.equal(personPrefix(ROOT, "\t\n"), ROOT)
})

test("personPrefix treats a non-string truthy person as OFF (defensive)", () => {
  // person should always be a string|null from the dispatch layer, but the
  // helper must not throw on an unexpected type — it degrades to OFF.
  assert.equal(personPrefix(ROOT, 42), ROOT)
  assert.equal(personPrefix(ROOT, {}), ROOT)
  assert.equal(personPrefix(ROOT, true), ROOT)
})

// ── ON branch (valid alias) ───────────────────────────────────────────────────

test("personPrefix joins desks/<alias> for a valid alias", () => {
  assert.equal(personPrefix(ROOT, "ari"), path.join(ROOT, "desks", "ari"))
})

test("personPrefix trims surrounding whitespace from a valid alias", () => {
  assert.equal(personPrefix(ROOT, "  ari  "), path.join(ROOT, "desks", "ari"))
})

test("personPrefix accepts aliases with hyphens, underscores, dots-in-name, digits", () => {
  assert.equal(personPrefix(ROOT, "ari-m_2"), path.join(ROOT, "desks", "ari-m_2"))
})

// ── reject branch (path-traversal / separators) ──────────────────────────────

test("personPrefix throws on '..' traversal", () => {
  assert.throws(() => personPrefix(ROOT, ".."), /alias/i)
})

test("personPrefix throws on an alias containing '..'", () => {
  assert.throws(() => personPrefix(ROOT, "../evil"), /alias/i)
  assert.throws(() => personPrefix(ROOT, "a..b"), /alias/i)
})

test("personPrefix throws on a forward-slash in the alias", () => {
  assert.throws(() => personPrefix(ROOT, "a/b"), /alias/i)
})

test("personPrefix throws on a back-slash in the alias", () => {
  assert.throws(() => personPrefix(ROOT, "a\\b"), /alias/i)
})

test("personPrefix throws on an absolute-path alias", () => {
  assert.throws(() => personPrefix(ROOT, "/etc/passwd"), /alias/i)
})

test("personPrefix throws on a single '.' segment", () => {
  assert.throws(() => personPrefix(ROOT, "."), /alias/i)
})
