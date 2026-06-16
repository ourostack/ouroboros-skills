// Unit 22d: red contract for production vector-pack and snapshot artifacts.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

function writeFile(root, rel, body) {
  const filePath = path.join(root, rel)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, body)
  return filePath
}

function writeJson(root, rel, value) {
  return writeFile(root, rel, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function docTree(docs) {
  return generatedArtifacts.documentTreeHash(docs)
}

function artifactSourceScopeHash() {
  return generatedArtifacts.artifactSourceScopeHash(mcpRoot)
}

function validApproval(artifactType) {
  return {
    scope: "repo",
    artifact_type: artifactType,
    approved_by: "unit-test-reviewer",
    approved_at: "2026-06-15T00:00:00.000Z",
    reason: `approve ${artifactType} publication fixture`,
  }
}

function validPublicationPolicy(overrides = {}) {
  return {
    schema_version: 1,
    default_publication: "deny",
    repo_visibility: "public",
    sensitive_repo: true,
    approved_artifact_types: ["vector-pack", "snapshot"],
    approval_required: true,
    approvals: [validApproval("vector-pack"), validApproval("snapshot")],
    updated_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  }
}

function writeProductionPolicy(pluginRoot, policy) {
  writeJson(pluginRoot, "artifacts/publication-policy.json", policy)
  writeFile(
    pluginRoot,
    "artifacts/publication-policy.schema.json",
    readFileSync(path.join(repoRoot, "plugins", "desk", "artifacts", "publication-policy.schema.json")),
  )
}

function writeProductionNotes(filePath, { artifactSourceScopeHash, documentTreeHash }) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, [
    "# Production Shared Artifacts",
    "",
    "Verification:",
    "- `node scripts/test-desk-generated-artifacts.cjs`",
    "- `npm --prefix plugins/desk/mcp run artifact:vector-pack:build -- --desk-root <desk-root> --pack-id <pack-id> --from-local-db`",
    "- `npm --prefix plugins/desk/mcp run artifact:snapshot:build -- --desk-root <desk-root> --snapshot-id <snapshot-id> --included-pack-id <pack-id> --from-local-db`",
    "- `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <desk-root>`",
    `- current_artifact_source_scope_hash: ${artifactSourceScopeHash}`,
    `- current_document_tree_hash: ${documentTreeHash}`,
    "- publication-policy approval recorded",
    "- tombstone and exclusion checks ran",
    "",
  ].join("\n"))
}

function writeAmbiguousProductionNotes(filePath, { sourceHash, staleDocumentTreeHash }) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, [
    "# Production Shared Artifacts",
    "",
    "Verification:",
    "- `node scripts/test-desk-generated-artifacts.cjs`",
    "- `npm --prefix plugins/desk/mcp run artifact:vector-pack:build -- --desk-root <desk-root> --pack-id <pack-id> --from-local-db`",
    "- `npm --prefix plugins/desk/mcp run artifact:snapshot:build -- --desk-root <desk-root> --snapshot-id <snapshot-id> --included-pack-id <pack-id> --from-local-db`",
    "- `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <desk-root>`",
    `- vector pack artifact_source_scope_hash: ${sourceHash}`,
    `- vector pack document_tree_hash: ${staleDocumentTreeHash}`,
    `- snapshot artifact_source_scope_hash: ${sourceHash}`,
    `- snapshot document_tree_hash: ${staleDocumentTreeHash}`,
    "- publication-policy approval recorded",
    "- tombstone and exclusion checks ran",
    "",
  ].join("\n"))
}

function writePrimaryWithSidecars({ dir, id, primarySuffix, manifest }) {
  writeFile(dir, `${id}${primarySuffix}`, "artifact bytes\n")
  writeJson(dir, `${id}.manifest.json`, manifest)
  writeFile(dir, `${id}.sha256`, `${sha256("artifact bytes\n")}  ${id}${primarySuffix}\n`)
}

async function tempExpectation({ tempDir, modules } = {}) {
  return generatedArtifacts.productionSharedArtifactExpectation({
    repoRoot,
    mcpRoot,
    pluginRoot: path.join(tempDir, "plugins", "desk"),
    notesPath: path.join(tempDir, "production-artifacts.md"),
    productionArtifactModules: modules,
  })
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
    "current_artifact_source_scope_hash",
    "current_document_tree_hash",
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

test("production policy approval must pass the committed publication-policy schema", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "desk-production-policy-"))
  try {
    const expectation = await tempExpectation({
      tempDir,
      modules: {
        activeEmbeddingSpec: { id: "unit-spec" },
        validateArtifacts: async () => ({
          vector_packs: { count: 0, artifacts: [] },
          snapshots: { count: 0, artifacts: [] },
        }),
      },
    })
    writeProductionNotes(expectation.notesPath, {
      artifactSourceScopeHash: sha256("source"),
      documentTreeHash: docTree([]),
    })
    writeProductionPolicy(expectation.pluginRoot, validPublicationPolicy({
      approvals: [
        { artifact_type: "vector-pack" },
        validApproval("snapshot"),
      ],
    }))

    const result = await generatedArtifacts.verifyProductionSharedArtifacts({
      expectation,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /publication policy approvals\[0\] missing reason/u)
    assert.match(result.errors.join("\n"), /publication policy approvals\[0\]\.scope is unsupported/u)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("production document freshness compares manifests to the published current document tree", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "desk-production-doc-tree-"))
  try {
    const staleDocs = [{ path: "track/stale/task.md", hash: sha256("old") }]
    const currentDocs = [{ path: "track/current/task.md", hash: sha256("new") }]
    const expectation = await tempExpectation({
      tempDir,
      modules: {
        activeEmbeddingSpec: { id: "unit-spec" },
        validateArtifacts: async () => ({
          vector_packs: { count: 1, artifacts: [{ pack_id: "unit-pack", rows: 1 }] },
          snapshots: {
            count: 1,
            artifacts: [{
              snapshot_id: "unit-snapshot",
              freshness: {
                artifact_source_scope: "fresh",
                document_tree: "fresh",
              },
            }],
          },
        }),
      },
    })
    writeProductionNotes(expectation.notesPath, {
      artifactSourceScopeHash: sha256("source"),
      documentTreeHash: docTree(currentDocs),
    })
    writeProductionPolicy(expectation.pluginRoot, validPublicationPolicy())
    const manifest = {
      artifact_source_scope_hash: sha256("source"),
      document_tree_hash: docTree(staleDocs),
      represented_documents: staleDocs,
    }
    writePrimaryWithSidecars({
      dir: path.join(expectation.vectorPackDir),
      id: "unit-pack",
      primarySuffix: ".jsonl",
      manifest,
    })
    writePrimaryWithSidecars({
      dir: path.join(expectation.snapshotDir),
      id: "unit-snapshot",
      primarySuffix: ".sqlite.zst",
      manifest,
    })

    const result = await generatedArtifacts.verifyProductionSharedArtifacts({
      expectation,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /production vector pack unit-pack\.jsonl document_tree_hash must match production-artifacts\.md/u)
    assert.match(result.errors.join("\n"), /production snapshot unit-snapshot\.sqlite\.zst document_tree_hash must match production-artifacts\.md/u)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test("production notes must use canonical current freshness hash fields", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "desk-production-current-hashes-"))
  try {
    const staleDocs = [{ path: "track/stale/task.md", hash: sha256("old") }]
    const sourceHash = artifactSourceScopeHash()
    const expectation = await tempExpectation({
      tempDir,
      modules: {
        activeEmbeddingSpec: { id: "unit-spec" },
        validateArtifacts: async () => ({
          vector_packs: { count: 1, artifacts: [{ pack_id: "unit-pack", rows: 1 }] },
          snapshots: {
            count: 1,
            artifacts: [{
              snapshot_id: "unit-snapshot",
              freshness: {
                artifact_source_scope: "fresh",
                document_tree: "fresh",
              },
            }],
          },
        }),
      },
    })
    writeAmbiguousProductionNotes(expectation.notesPath, {
      sourceHash,
      staleDocumentTreeHash: docTree(staleDocs),
    })
    writeProductionPolicy(expectation.pluginRoot, validPublicationPolicy())
    const manifest = {
      artifact_source_scope_hash: sourceHash,
      document_tree_hash: docTree(staleDocs),
      represented_documents: staleDocs,
    }
    writePrimaryWithSidecars({
      dir: path.join(expectation.vectorPackDir),
      id: "unit-pack",
      primarySuffix: ".jsonl",
      manifest,
    })
    writePrimaryWithSidecars({
      dir: path.join(expectation.snapshotDir),
      id: "unit-snapshot",
      primarySuffix: ".sqlite.zst",
      manifest,
    })

    const result = await generatedArtifacts.verifyProductionSharedArtifacts({
      expectation,
      spawn: () => ({ status: 0, stdout: "", stderr: "" }),
    })

    assert.equal(result.ok, false)
    assert.match(result.errors.join("\n"), /production-artifacts\.md must record current_artifact_source_scope_hash as sha256:<hex>/u)
    assert.match(result.errors.join("\n"), /production-artifacts\.md must record current_document_tree_hash as sha256:<hex>/u)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
