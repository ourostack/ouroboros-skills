// Unit 18a: red contract for explicit artifact publication policy and approval.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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

async function listFiles(root) {
  const files = []
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
        files.push(path.relative(root, abs).split(path.sep).join("/"))
      }
    }
  }
  await walk(root)
  return files.sort()
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
  const { evaluateArtifactPublication } = await loadPolicyModule()
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
  await fs.mkdir(path.join(artifactsRoot, "vector-packs"), { recursive: true })
  const before = await listFiles(artifactsRoot)

  await ensureIndex(deskRoot, {
    startup: true,
    skipEmbed: true,
    snapshots: { pluginRoot },
    vectorPacks: { pluginRoot },
  })

  assert.deepEqual(await listFiles(artifactsRoot), before)
})
