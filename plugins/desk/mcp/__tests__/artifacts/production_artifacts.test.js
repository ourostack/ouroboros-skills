// Unit 22d: red contract for production vector-pack and snapshot artifacts.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const pluginRoot = path.join(repoRoot, "plugins", "desk")
const productionNotesPath = path.join(
  repoRoot,
  "desk",
  "tasks",
  "2026-06-14-1335-doing-desk-dependency-activation",
  "production-artifacts.md",
)
const require = createRequire(import.meta.url)
const generatedArtifacts = require(path.join(repoRoot, "scripts", "test-desk-generated-artifacts.cjs"))

function repoPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/")
}

test("production shared artifact expectation uses canonical active-spec repo paths", async () => {
  assert.equal(typeof generatedArtifacts.productionSharedArtifactExpectation, "function")
  assert.equal(typeof generatedArtifacts.verifyProductionSharedArtifacts, "function")

  const expectation = await generatedArtifacts.productionSharedArtifactExpectation({
    repoRoot,
    mcpRoot,
    pluginRoot,
  })

  assert.match(expectation.embeddingSpecId, /^nomic-embed-text/u)
  assert.equal(
    repoPath(expectation.vectorPackDir),
    `plugins/desk/artifacts/vector-packs/${expectation.embeddingSpecId}`,
  )
  assert.equal(
    repoPath(expectation.snapshotDir),
    `plugins/desk/artifacts/snapshots/${expectation.embeddingSpecId}`,
  )
  assert.equal(expectation.notesPath, productionNotesPath)
  assert.equal(expectation.vectorPackDir.includes("__tests__"), false)
  assert.equal(expectation.snapshotDir.includes("__tests__"), false)
})

test("production artifact verification notes declare commands, hashes, policy, and redaction checks", () => {
  const body = readFileSync(productionNotesPath, "utf8").toLowerCase()
  for (const required of [
    "node scripts/test-desk-generated-artifacts.cjs",
    "artifact:vector-pack:build",
    "artifact:snapshot:build",
    "artifact:validate",
    "artifact_source_scope_hash",
    "document_tree_hash",
    "publication-policy",
    "approval",
    "tombstone",
    "exclusion",
  ]) {
    assert.ok(body.includes(required), `production-artifacts.md must mention ${required}`)
  }
})

test("production shared artifacts are committed, approved, policy-checked, and fresh", async () => {
  const result = await generatedArtifacts.verifyGeneratedArtifacts({
    repoRoot,
    mcpRoot,
    pluginRoot,
  })

  assert.equal(result.ok, true, result.errors.join("\n"))
  assert.ok(
    result.productionSharedArtifacts.vector_packs.count >= 1,
    "at least one production vector pack must be committed",
  )
  assert.ok(
    result.productionSharedArtifacts.snapshots.count >= 1,
    "at least one production snapshot must be committed",
  )
})

test("production shared artifact verifier rejects missing or fixture-only artifacts", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "desk-production-artifacts-"))
  try {
    const expectation = await generatedArtifacts.productionSharedArtifactExpectation({
      repoRoot,
      mcpRoot,
      pluginRoot: path.join(tempDir, "plugins", "desk"),
      notesPath: path.join(tempDir, "production-artifacts.md"),
    })
    const result = await generatedArtifacts.verifyProductionSharedArtifacts({
      expectation,
      spawn: () => ({ status: 1, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /production vector pack artifact missing/u)
    assert.match(result.errors.join("\n"), /production snapshot artifact missing/u)
    assert.match(result.errors.join("\n"), /publication policy/u)
    assert.match(result.errors.join("\n"), /production-artifacts\.md/u)
    assert.doesNotMatch(result.errors.join("\n"), /__tests__\/fixtures/u)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
