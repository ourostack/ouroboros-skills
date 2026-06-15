// Unit 18a: red contract for explicit artifact publication policy and approval.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import { ensureIndex } from "../../src/server-helpers.js"

const mcpRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const repoRoot = path.resolve(mcpRoot, "..", "..", "..")
const deskPluginRoot = path.join(repoRoot, "plugins", "desk")
const policyPath = path.join(deskPluginRoot, "artifacts", "publication-policy.json")
const schemaPath = path.join(deskPluginRoot, "artifacts", "publication-policy.schema.json")
const REQUIRED_POLICY_FIELDS = [
  "schema_version",
  "default_publication",
  "repo_visibility",
  "sensitive_repo",
  "approved_artifact_types",
  "approval_required",
  "approvals",
  "updated_at",
]

async function loadPolicyModule() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "artifacts", "policy.js")))
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function tmpRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function validPolicy(overrides = {}) {
  return {
    schema_version: 1,
    default_publication: "deny",
    repo_visibility: "private",
    sensitive_repo: false,
    approved_artifact_types: [],
    approval_required: true,
    approvals: [],
    updated_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  }
}

function repoApproval(artifactType, overrides = {}) {
  return {
    scope: "repo",
    artifact_type: artifactType,
    approved_by: "unit-test-reviewer",
    approved_at: "2026-06-15T00:00:00.000Z",
    reason: "explicit publication approval for test fixture",
    ...overrides,
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function fileHashes(root) {
  const hashes = {}
  async function walk(current) {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, abs).split(path.sep).join("/")
        hashes[relativePath] = sha256(await fs.readFile(abs))
      }
    }
  }
  await walk(root)
  return Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)))
}

async function seedCommittedArtifactFixture(artifactsRoot) {
  const packDir = path.join(artifactsRoot, "vector-packs", ACTIVE_EMBEDDING_SPEC.id)
  await fs.mkdir(packDir, { recursive: true })
  const packId = "committed-empty-pack"
  const packBody = ""
  const packSha = sha256(packBody)
  await fs.writeFile(path.join(packDir, `${packId}.jsonl`), packBody, "utf8")
  await fs.writeFile(
    path.join(packDir, `${packId}.manifest.json`),
    `${JSON.stringify({
      schema_version: 1,
      pack_id: packId,
      embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
      dimension: ACTIVE_EMBEDDING_SPEC.dimension,
      encoding: "float32-json",
      row_count: 0,
      rows_sha256: packSha,
      created_at: "2026-06-15T00:00:00.000Z",
      provenance: {
        builder: "artifact:vector-pack:build",
        source: "unit-test",
      },
    }, null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(path.join(packDir, `${packId}.sha256`), `${packSha}  ${packId}.jsonl\n`, "utf8")

  const snapshotDir = path.join(artifactsRoot, "snapshots", ACTIVE_EMBEDDING_SPEC.id)
  await fs.mkdir(snapshotDir, { recursive: true })
  const snapshotId = "committed-incompatible-snapshot"
  const snapshotBytes = Buffer.from("committed snapshot bytes", "utf8")
  const snapshotSha = `sha256:${sha256(snapshotBytes)}`
  await fs.writeFile(path.join(snapshotDir, `${snapshotId}.sqlite.zst`), snapshotBytes)
  await fs.writeFile(
    path.join(snapshotDir, `${snapshotId}.manifest.json`),
    `${JSON.stringify({
      schema_version: 1,
      snapshot_id: snapshotId,
      embedding_spec_id: ACTIVE_EMBEDDING_SPEC.id,
      dimension: ACTIVE_EMBEDDING_SPEC.dimension,
      chunker_id: ACTIVE_EMBEDDING_SPEC.chunker_id,
      normalization_id: ACTIVE_EMBEDDING_SPEC.normalization_id,
      db_schema: { id: "intentionally-incompatible", version: 1 },
      sqlite_vec: { package: "sqlite-vec", version: "0.1.6", table: "vec0" },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        node_abi: `node-${process.versions.modules}`,
      },
      artifact_source_scope_hash: `sha256:${"a".repeat(64)}`,
      document_tree_hash: `sha256:${"b".repeat(64)}`,
      included_pack_ids: [packId],
      created_at: "2026-06-15T00:00:00.000Z",
      artifact: {
        file: `${snapshotId}.sqlite.zst`,
        format: "sqlite-zstd",
        sha256: snapshotSha,
        compressed: true,
      },
      provenance: {
        builder: "plugins/desk/mcp/scripts/build-snapshot.js",
        source: "unit-test",
        commit: "0123456789abcdef0123456789abcdef01234567",
      },
      source_paths: [
        "plugins/desk/mcp/src/snapshots/restore.js",
        "plugins/desk/mcp/src/db/schema.sql",
        "plugins/desk/mcp/package-lock.json",
      ],
    }, null, 2)}\n`,
    "utf8",
  )
  await fs.writeFile(
    path.join(snapshotDir, `${snapshotId}.sha256`),
    `${snapshotSha}  ${snapshotId}.sqlite.zst\n`,
    "utf8",
  )
}

test("committed publication policy and schema declare conservative privacy defaults", async () => {
  const { loadPublicationPolicy } = await loadPolicyModule()

  const [policy, schema, loaded] = await Promise.all([
    readJson(policyPath),
    readJson(schemaPath),
    loadPublicationPolicy({ pluginRoot: deskPluginRoot }),
  ])

  for (const field of REQUIRED_POLICY_FIELDS) {
    assert.ok(Object.hasOwn(policy, field), `publication policy missing ${field}`)
  }
  assert.equal(policy.schema_version, 1)
  assert.equal(policy.default_publication, "deny")
  assert.equal(policy.repo_visibility, "public")
  assert.equal(policy.sensitive_repo, true)
  assert.deepEqual(policy.approved_artifact_types, [])
  assert.equal(policy.approval_required, true)
  assert.deepEqual(policy.approvals, [])
  assert.match(policy.updated_at, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(schema.properties.schema_version.const, 1)
  assert.equal(loaded.valid, true)
  assert.deepEqual(loaded.diagnostics, [])
})

test("publication policy schema requires approval and repository-sensitivity fields", async () => {
  const schema = await readJson(schemaPath)

  assert.equal(schema.type, "object")
  assert.deepEqual([...schema.required].sort(), [...REQUIRED_POLICY_FIELDS].sort())
  assert.deepEqual(schema.properties.default_publication.enum.sort(), ["allow", "deny"])
  assert.deepEqual(
    schema.properties.repo_visibility.enum.sort(),
    ["internal", "private", "public", "unknown"],
  )
  assert.equal(schema.properties.sensitive_repo.type, "boolean")
  assert.equal(schema.properties.approval_required.type, "boolean")
  assert.deepEqual(
    schema.properties.approved_artifact_types.items.enum.sort(),
    ["snapshot", "vector-pack"],
  )
  assert.deepEqual(
    schema.properties.approvals.items.required.sort(),
    ["approved_at", "approved_by", "artifact_type", "reason", "scope"],
  )
  assert.deepEqual(schema.properties.approvals.items.properties.scope.enum.sort(), ["org", "repo"])
})

test("publication policy denies public and sensitive repo artifact publication without approval", async () => {
  const { evaluateArtifactPublication } = await loadPolicyModule()

  for (const policy of [
    validPolicy({
      repo_visibility: "public",
      sensitive_repo: false,
      approved_artifact_types: ["vector-pack"],
    }),
    validPolicy({
      repo_visibility: "private",
      sensitive_repo: true,
      approved_artifact_types: ["snapshot"],
    }),
  ]) {
    const decision = evaluateArtifactPublication({
      policy,
      artifact_type: policy.approved_artifact_types[0],
      operation: "write",
    })
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, "approval_required")
    assert.match(decision.message, /explicit approval/u)
  }
})

test("publication policy accepts explicit repo and organization approvals for allowed artifact types", async () => {
  const {
    assertArtifactPublicationAllowed,
    evaluateArtifactPublication,
  } = await loadPolicyModule()
  const policy = validPolicy({
    repo_visibility: "public",
    sensitive_repo: true,
    approved_artifact_types: ["vector-pack", "snapshot"],
    approvals: [
      repoApproval("vector-pack"),
      repoApproval("snapshot", {
        scope: "org",
        approved_by: "security-review",
        reason: "organization artifact publication exception",
      }),
    ],
  })

  assert.deepEqual(
    evaluateArtifactPublication({ policy, artifact_type: "vector-pack", operation: "write" }),
    {
      allowed: true,
      reason: "approved",
      approval_scope: "repo",
      approval_actor: "unit-test-reviewer",
    },
  )
  assert.deepEqual(
    evaluateArtifactPublication({ policy, artifact_type: "snapshot", operation: "write" }),
    {
      allowed: true,
      reason: "approved",
      approval_scope: "org",
      approval_actor: "security-review",
    },
  )
  assert.equal(
    evaluateArtifactPublication({ policy, artifact_type: "runtime-deps", operation: "write" }).reason,
    "artifact_type_not_approved",
  )
  assert.deepEqual(
    await assertArtifactPublicationAllowed({
      policy,
      artifact_type: "vector-pack",
      operation: "write",
      relative_path: "plugins/desk/artifacts/vector-packs/spec/desk-base.jsonl",
    }),
    {
      allowed: true,
      reason: "approved",
      approval_scope: "repo",
      approval_actor: "unit-test-reviewer",
    },
  )
})

test("artifact write guard blocks vector-pack and snapshot writes without approval", async () => {
  const { assertArtifactPublicationAllowed } = await loadPolicyModule()
  const policy = validPolicy({
    repo_visibility: "public",
    sensitive_repo: true,
    approved_artifact_types: ["vector-pack", "snapshot"],
  })

  for (const [artifactType, relativePath] of [
    ["vector-pack", "plugins/desk/artifacts/vector-packs/spec/desk-base.jsonl"],
    ["snapshot", "plugins/desk/artifacts/snapshots/spec/desk-base.sqlite.zst"],
  ]) {
    await assert.rejects(
      () => assertArtifactPublicationAllowed({
        policy,
        artifact_type: artifactType,
        operation: "write",
        relative_path: relativePath,
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_not_approved")
        assert.equal(error.artifact_type, artifactType)
        assert.equal(error.relative_path, relativePath)
        assert.doesNotMatch(error.message, /secret|chunk text|document body/iu)
        return true
      },
    )
  }
})

test("ordinary startup does not write committed artifact files", async () => {
  const tempRoot = await tmpRoot("desk-publication-startup-")
  const deskRoot = path.join(tempRoot, "desk")
  const pluginRoot = path.join(tempRoot, "plugins", "desk")
  const artifactsRoot = path.join(pluginRoot, "artifacts")
  await fs.mkdir(path.join(deskRoot, "track", "task"), { recursive: true })
  await fs.writeFile(path.join(deskRoot, "track", "task", "task.md"), "# Startup\n", "utf8")
  await seedCommittedArtifactFixture(artifactsRoot)
  const before = await fileHashes(artifactsRoot)

  await ensureIndex(deskRoot, {
    startup: true,
    skipEmbed: true,
    snapshots: { pluginRoot },
    vectorPacks: { pluginRoot },
  })

  assert.deepEqual(await fileHashes(artifactsRoot), before)
})
