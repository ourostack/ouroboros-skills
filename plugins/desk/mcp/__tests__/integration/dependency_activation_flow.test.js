// Unit 24a1: red integration contract for production snapshot cold start.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { closeDb, indexDbPath, openDb } from "../../src/db/init.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import { ensureIndex } from "../../src/server-helpers.js"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const pluginRoot = path.join(repoRoot, "plugins", "desk")
const productionSnapshotId = "repo-public-bootstrap-2026-06-15"
const productionDocPath = "tasks/dependency-activation/task.md"
const productionSnapshotRoot = path.join(
  pluginRoot,
  "artifacts",
  "snapshots",
  ACTIVE_EMBEDDING_SPEC.id,
)
const productionSnapshotManifestPath = path.join(
  productionSnapshotRoot,
  `${productionSnapshotId}.manifest.json`,
)

async function tmpRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function copyProductionDeskDoc(deskRoot) {
  const target = path.join(deskRoot, productionDocPath)
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(path.join(repoRoot, "desk", productionDocPath), target)
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

test("cold start restores the committed production snapshot without rebuild or embeddings", async () => {
  const tempRoot = await tmpRoot("desk-dependency-flow-snapshot-")
  try {
    const deskRoot = path.join(tempRoot, "desk")
    await copyProductionDeskDoc(deskRoot)
    const productionManifest = JSON.parse(
      await readFile(productionSnapshotManifestPath, "utf8"),
    )
    const productionDocBytes = await readFile(path.join(deskRoot, productionDocPath))

    assert.equal(productionManifest.snapshot_id, productionSnapshotId)
    assert.deepEqual(
      productionManifest.represented_documents,
      [{ path: productionDocPath, hash: sha256(productionDocBytes) }],
      "the integration fixture must use the real committed production snapshot inputs",
    )

    const result = await ensureIndex(deskRoot, {
      startup: true,
      embed: {
        fetch: async () => {
          throw new Error("cold-start production snapshot restore must not call live embeddings")
        },
      },
    })

    assert.equal(result.built, false, JSON.stringify(result, null, 2))
    assert.equal(result.reason, "snapshot_restored")
    assert.equal(result.snapshot?.snapshot_id, productionSnapshotId)
    assert.equal(result.snapshot?.freshness?.artifact_source_scope, "fresh")
    assert.equal(result.snapshot?.freshness?.document_tree, "fresh")
    assert.equal(result.fallback, undefined)

    const stateMeta = JSON.parse(
      await readFile(`${indexDbPath(deskRoot)}.snapshot.json`, "utf8"),
    )
    assert.equal(stateMeta.snapshot_id, productionSnapshotId)
    assert.equal(
      stateMeta.source_snapshot_path,
      path.posix.join(
        "artifacts",
        "snapshots",
        ACTIVE_EMBEDDING_SPEC.id,
        `${productionSnapshotId}.sqlite.zst`,
      ),
    )

    const db = openDb(deskRoot)
    try {
      assert.deepEqual(
        db.prepare("SELECT path FROM docs ORDER BY path").all(),
        [{ path: productionDocPath }],
      )
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunks").get().n, 2)
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chunk_vecs").get().n, 2)
    } finally {
      closeDb(db)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
