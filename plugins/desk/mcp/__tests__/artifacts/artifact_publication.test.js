import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import {
  constants as fsConstants,
  promises as fsPromises,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import {
  __artifactPublicationInternalsForTests,
  publishArtifactSet,
} from "../../src/artifacts/publication.js"
import {
  buildSnapshotFromLocalDb,
} from "../../src/artifacts/artifact-scripts.js"
import manifestContracts from "../../src/artifacts/manifest-contracts.cjs"
import { closeDb, openDb } from "../../src/db/init.js"
import { rebuildIndex } from "../../src/indexer/index.js"
import { ACTIVE_EMBEDDING_SPEC } from "../../src/indexer/spec.js"
import {
  writeVectorPackArtifact,
} from "../../src/indexer/vector-packs.js"
import {
  writeSnapshotArtifact,
} from "../../src/snapshots/manifest.js"

const { ARTIFACT_SOURCE_PATHS } = manifestContracts
const {
  acquirePublicationLock,
  assertPublicationInputs,
  canonicalDirectoryIdentity,
  claimLockPath,
  coordinationLockBase,
  coordinationPaths,
  delay,
  fileExists,
  findOwnedClaim,
  fsyncDirectory,
  fsyncFile,
  hasLockClaims,
  lockOwnerStatus,
  makePrivateDirectory,
  processExists,
  processStartEvidence,
  readTransactionJournal,
  recoverLockClaims,
  recoverTransactions,
  removePrivateRootIfEmpty,
  removeOwnedLock,
  transactionPaths,
  safePublicationError,
  sameLockOwner,
  sanitizeAndRemoveDirectory,
  secureRemoveFile,
  staleLockCanBeReclaimed,
  validateJournal,
  waitForPublicationLock,
  withArtifactRead,
} = __artifactPublicationInternalsForTests
const mcpRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const repoRoot = path.resolve(mcpRoot, "..", "..", "..")
const sourcePluginRoot = path.join(repoRoot, "plugins", "desk")
const publicationSchemaPath = path.join(
  sourcePluginRoot,
  "artifacts",
  "publication-policy.schema.json",
)
const publicPackManifestPath = path.join(
  sourcePluginRoot,
  "artifacts",
  "vector-packs",
  ACTIVE_EMBEDDING_SPEC.id,
  "repo-public-bootstrap-2026-06-15.manifest.json",
)
const publicPackPath = publicPackManifestPath.replace(
  /\.manifest\.json$/u,
  ".jsonl",
)
const publicSnapshotManifestPath = path.join(
  sourcePluginRoot,
  "artifacts",
  "snapshots",
  ACTIVE_EMBEDDING_SPEC.id,
  "repo-public-bootstrap-2026-06-15.manifest.json",
)
const crashFixturePath = path.join(
  mcpRoot,
  "__tests__",
  "fixtures",
  "artifact_publication_crash_fixture.js",
)

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function approvedPolicy() {
  return {
    schema_version: 1,
    default_publication: "deny",
    repo_visibility: "public",
    sensitive_repo: true,
    approved_artifact_types: ["vector-pack", "snapshot"],
    approval_required: true,
    approvals: ["vector-pack", "snapshot"].map((artifactType) => ({
      scope: "repo",
      artifact_type: artifactType,
      approved_by: "unit-test-reviewer",
      approved_at: "2026-08-24T00:00:00.000Z",
      reason: "Exercise atomic artifact publication.",
    })),
    updated_at: "2026-08-24T00:00:00.000Z",
  }
}

async function scratchRoot(prefix) {
  return mkdtemp(path.join(repoRoot, `.${prefix}-`))
}

async function cleanupScratchRoot(root) {
  await rm(root, { recursive: true, force: true })
  await rm(coordinationPaths(root).privateRoot, {
    recursive: true,
    force: true,
  })
}

async function writeRecoveryState({
  root,
  transactionId,
  phase,
  files,
}) {
  const coordination = coordinationPaths(root)
  const transaction = transactionPaths(
    coordination.privateRoot,
    transactionId,
  )
  await mkdir(transaction.stageDirectory, { recursive: true, mode: 0o700 })
  await mkdir(transaction.backupDirectory, { recursive: true, mode: 0o700 })
  await writeFile(transaction.journalPath, `${JSON.stringify({
    schema_version: 1,
    sequence: 0,
    transaction_id: transaction.id,
    phase,
    files,
  })}\n`, { mode: 0o600 })
  return { coordination, transaction }
}

async function preparePluginRoot(root) {
  const pluginRoot = path.join(root, "plugin")
  await mkdir(path.join(pluginRoot, "artifacts"), { recursive: true })
  await cp(
    publicationSchemaPath,
    path.join(pluginRoot, "artifacts", "publication-policy.schema.json"),
  )
  await writeFile(
    path.join(pluginRoot, "artifacts", "publication-policy.json"),
    `${JSON.stringify(approvedPolicy(), null, 2)}\n`,
    "utf8",
  )
  return pluginRoot
}

function pathsFor(pluginRoot, artifactType, artifactId) {
  const directory = path.join(
    pluginRoot,
    "artifacts",
    artifactType === "vector-pack" ? "vector-packs" : "snapshots",
    ACTIVE_EMBEDDING_SPEC.id,
  )
  return {
    directory,
    primary: path.join(
      directory,
      artifactType === "vector-pack"
        ? `${artifactId}.jsonl`
        : `${artifactId}.sqlite.zst`,
    ),
    manifest: path.join(directory, `${artifactId}.manifest.json`),
    checksum: path.join(directory, `${artifactId}.sha256`),
  }
}

async function generation({ artifactType, artifactId, marker }) {
  const template = JSON.parse(await readFile(
    artifactType === "vector-pack"
      ? publicPackManifestPath
      : publicSnapshotManifestPath,
    "utf8",
  ))
  let primaryBytes
  if (artifactType === "vector-pack") {
    const row = JSON.parse(
      (await readFile(publicPackPath, "utf8")).trim().split("\n")[0],
    )
    row.vector[0] = marker === "old" ? 0.125 : 0.875
    primaryBytes = Buffer.from(`${JSON.stringify(row)}\n`, "utf8")
  } else {
    primaryBytes = Buffer.from(`${artifactType}:${marker}\n`, "utf8")
  }
  const rawSha = sha256(primaryBytes)
  const manifest = artifactType === "vector-pack"
    ? {
        ...template,
        schema_version: 2,
        pack_id: artifactId,
        row_count: 1,
        rows_sha256: rawSha,
        created_at: marker === "old"
          ? "2026-08-24T00:00:00.000Z"
          : "2026-08-24T00:01:00.000Z",
          source_paths: ARTIFACT_SOURCE_PATHS,
        }
    : {
        ...template,
        schema_version: 2,
        snapshot_id: artifactId,
        created_at: marker === "old"
          ? "2026-08-24T00:00:00.000Z"
          : "2026-08-24T00:01:00.000Z",
        artifact: {
          ...template.artifact,
          file: `${artifactId}.sqlite.zst`,
          sha256: `sha256:${rawSha}`,
        },
        source_paths: ARTIFACT_SOURCE_PATHS,
      }
  return {
    primaryBytes,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    checksumBytes: Buffer.from(
      `${artifactType === "vector-pack" ? rawSha : `sha256:${rawSha}`}  ${
        artifactType === "vector-pack"
          ? `${artifactId}.jsonl`
          : `${artifactId}.sqlite.zst`
      }\n`,
      "utf8",
    ),
    sourceDocs: manifest.represented_documents,
  }
}

async function publish({
  artifactType,
  artifactId,
  pluginRoot,
  deskRoot,
  marker,
  publication,
  signal,
}) {
  const bytes = await generation({ artifactType, artifactId, marker })
  const common = {
    pluginRoot,
    embeddingSpecId: ACTIVE_EMBEDDING_SPEC.id,
    policy: approvedPolicy(),
    deskRoot,
    sourceDocs: bytes.sourceDocs,
    publication,
    signal,
  }
  if (artifactType === "vector-pack") {
    return writeVectorPackArtifact({
      ...common,
      packId: artifactId,
      packBytes: bytes.primaryBytes,
      manifestBytes: bytes.manifestBytes,
      checksumBytes: bytes.checksumBytes,
    })
  }
  return writeSnapshotArtifact({
    ...common,
    snapshotId: artifactId,
    snapshotBytes: bytes.primaryBytes,
    manifestBytes: bytes.manifestBytes,
    checksumBytes: bytes.checksumBytes,
  })
}

async function readTriplet(paths) {
  return Promise.all([
    readFile(paths.primary),
    readFile(paths.manifest),
    readFile(paths.checksum),
  ])
}

async function assertOnlyConsumerPaths(paths) {
  assert.deepEqual(
    (await readdir(paths.directory)).sort(),
    [
      path.basename(paths.checksum),
      path.basename(paths.manifest),
      path.basename(paths.primary),
    ].sort(),
  )
}

async function assertPrivateRootEmptyOrMissing(directory) {
  const privateRoot = coordinationPaths(directory).privateRoot
  try {
    assert.deepEqual(await readdir(privateRoot), [])
  } catch (error) {
    assert.equal(error.code, "ENOENT")
  }
}

for (const artifactType of ["vector-pack", "snapshot"]) {
  test(`${artifactType} publication restores the previous generation after every commit-step failure`, async () => {
    const root = await scratchRoot(`artifact-publication-${artifactType}`)
    const deskRoot = path.join(root, "desk")
    const pluginRoot = await preparePluginRoot(root)
    const artifactId = `${artifactType}-rollback`
    const paths = pathsFor(pluginRoot, artifactType, artifactId)
    try {
      await mkdir(deskRoot, { recursive: true })
      await publish({
        artifactType,
        artifactId,
        pluginRoot,
        deskRoot,
        marker: "old",
      })
      const previous = await readTriplet(paths)

      for (let failingIndex = 0; failingIndex < 3; failingIndex += 1) {
        await assert.rejects(
          () => publish({
            artifactType,
            artifactId,
            pluginRoot,
            deskRoot,
            marker: `new-${failingIndex}`,
            publication: {
              hooks: {
                beforeCommitFile({ index }) {
                  if (index === failingIndex) {
                    throw new Error(`synthetic commit failure ${failingIndex}`)
                  }
                },
              },
            },
          }),
          new RegExp(`synthetic commit failure ${failingIndex}`, "u"),
        )
        const restored = await readTriplet(paths)
        for (let index = 0; index < previous.length; index += 1) {
          assert.equal(Buffer.compare(restored[index], previous[index]), 0)
        }
        await assertOnlyConsumerPaths(paths)
      }
    } finally {
      await cleanupScratchRoot(root)
    }
  })

  test(`${artifactType} same-ID publishers serialize complete generations without mixing sidecars`, async () => {
    const root = await scratchRoot(`artifact-concurrency-${artifactType}`)
    const deskRoot = path.join(root, "desk")
    const pluginRoot = await preparePluginRoot(root)
    const artifactId = `${artifactType}-concurrent`
    const paths = pathsFor(pluginRoot, artifactType, artifactId)
    let releaseFirst
    let firstReachedCommit
    const firstCommit = new Promise((resolve) => {
      firstReachedCommit = resolve
    })
    const firstRelease = new Promise((resolve) => {
      releaseFirst = resolve
    })
    try {
      await mkdir(deskRoot, { recursive: true })
      const first = publish({
        artifactType,
        artifactId,
        pluginRoot,
        deskRoot,
        marker: "old",
        publication: {
          hooks: {
            async beforeCommit() {
              firstReachedCommit()
              await firstRelease
            },
          },
        },
      })
      await Promise.race([
        firstCommit,
        first.then(() => assert.fail("first publisher did not pause before commit")),
      ])

      let secondReachedCommit = false
      const second = publish({
        artifactType,
        artifactId,
        pluginRoot,
        deskRoot,
        marker: "new",
        publication: {
          hooks: {
            beforeCommit() {
              secondReachedCommit = true
            },
          },
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      assert.equal(secondReachedCommit, false, "same-ID publisher bypassed the publication lock")

      releaseFirst()
      await Promise.all([first, second])
      assert.equal(secondReachedCommit, true)
      const expected = await generation({ artifactType, artifactId, marker: "new" })
      const actual = await readTriplet(paths)
      for (const [index, bytes] of [
        expected.primaryBytes,
        expected.manifestBytes,
        expected.checksumBytes,
      ].entries()) {
        assert.equal(Buffer.compare(actual[index], bytes), 0)
      }
      await assertOnlyConsumerPaths(paths)
    } finally {
      releaseFirst?.()
      await cleanupScratchRoot(root)
    }
  })
}

test("snapshot build checks cancellation after sanitization and immediately before publication commit", async () => {
  const root = await scratchRoot("artifact-abort")
  const deskRoot = path.join(root, "desk")
  const pluginRoot = await preparePluginRoot(root)
  const snapshotId = "abort-before-commit"
  const paths = pathsFor(pluginRoot, "snapshot", snapshotId)
  const controller = new AbortController()
  try {
    const documentPath = path.join(deskRoot, "track", "task", "task.md")
    await mkdir(path.dirname(documentPath), { recursive: true })
    await writeFile(documentPath, "---\nstatus: processing\n---\nabort fixture\n", "utf8")
    await rebuildIndex(deskRoot, { skipEmbed: true })
    await buildSnapshotFromLocalDb({
      deskRoot,
      pluginRoot,
      mcpRoot,
      snapshotId,
      policy: approvedPolicy(),
      provenanceCommit: "1".repeat(40),
      now: () => Date.parse("2026-08-24T00:00:00.000Z"),
    })
    const previous = await readTriplet(paths)

    await assert.rejects(
      () => buildSnapshotFromLocalDb({
        deskRoot,
        pluginRoot,
        mcpRoot,
        snapshotId,
        policy: approvedPolicy(),
        provenanceCommit: "2".repeat(40),
        now: () => Date.parse("2026-08-24T00:01:00.000Z"),
        signal: controller.signal,
        publication: {
          hooks: {
            beforeCommit() {
              controller.abort()
            },
          },
        },
      }),
      (error) => error.name === "AbortError",
    )

    const restored = await readTriplet(paths)
    for (let index = 0; index < previous.length; index += 1) {
      assert.equal(Buffer.compare(restored[index], previous[index]), 0)
    }
    await assertOnlyConsumerPaths(paths)
    const db = openDb(deskRoot)
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM docs").get().count, 1)
    } finally {
      closeDb(db)
    }
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("artifact writers reject malformed staged manifests before consumer paths change", async () => {
  const root = await scratchRoot("artifact-malformed-manifest")
  const deskRoot = path.join(root, "desk")
  const pluginRoot = await preparePluginRoot(root)
  try {
    await mkdir(deskRoot, { recursive: true })
    const vector = await generation({
      artifactType: "vector-pack",
      artifactId: "malformed-pack",
      marker: "old",
    })
    await assert.rejects(
      () => writeVectorPackArtifact({
        pluginRoot,
        packId: "malformed-pack",
        packBytes: vector.primaryBytes,
        manifestBytes: "{",
        checksumBytes: vector.checksumBytes,
        policy: approvedPolicy(),
        deskRoot,
        sourceDocs: vector.sourceDocs,
      }),
      /manifest must be valid JSON/u,
    )
    const snapshot = await generation({
      artifactType: "snapshot",
      artifactId: "malformed-snapshot",
      marker: "old",
    })
    await assert.rejects(
      () => writeSnapshotArtifact({
        pluginRoot,
        snapshotId: "malformed-snapshot",
        snapshotBytes: snapshot.primaryBytes,
        manifestBytes: "{",
        checksumBytes: snapshot.checksumBytes,
        policy: approvedPolicy(),
        deskRoot,
        sourceDocs: snapshot.sourceDocs,
      }),
      /manifest must be valid JSON/u,
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication internals fail closed for invalid inputs, lock faults, and filesystem errors", async () => {
  for (const args of [
    { files: undefined, validateStaged() {} },
    { files: [], validateStaged() {} },
    {
      files: [{ name: "one", path: "/a/one", bytes: "" }],
    },
    {
      files: [
        { name: "one", path: "/a/one", bytes: "" },
        { name: "two", path: "/b/two", bytes: "" },
      ],
      validateStaged() {},
    },
    {
      files: [
        { name: "one", path: "/a/one", bytes: "" },
        { name: "one", path: "/a/two", bytes: "" },
      ],
      validateStaged() {},
    },
    {
      files: [
        { name: "one", path: "/a/one", bytes: "" },
        { name: "two", path: "/a/one", bytes: "" },
      ],
      validateStaged() {},
    },
    {
      files: [{ name: 1, path: "/a/one", bytes: "" }],
      validateStaged() {},
    },
    {
      files: [{ name: "one", path: 1, bytes: "" }],
      validateStaged() {},
    },
    {
      files: [{ name: "one", path: "/a/one" }],
      validateStaged() {},
    },
    {
      files: [{ name: "one", path: "/a/..", bytes: "" }],
      validateStaged() {},
    },
  ]) {
    assert.throws(() => assertPublicationInputs(args), /artifact publication|staged-generation/u)
  }

  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/lock",
      fileSystem: {
        async open() {
          const error = new Error("open failed")
          error.code = "EACCES"
          throw error
        },
        async rm() {},
      },
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    /open failed/u,
  )
  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/lock",
      fileSystem: {
        async open() {
          return {
            async writeFile() {},
            async sync() {},
            async close() {},
          }
        },
        async link() {
          const error = new Error("busy")
          error.code = "EEXIST"
          throw error
        },
        async rm() {},
      },
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    (error) => error.code === "artifact_publication_lock_timeout",
  )

  for (const cleanupFails of [false, true]) {
    await assert.rejects(
      () => acquirePublicationLock({
        lockPath: "/lock",
        fileSystem: {
          async open() {
            return {
              async writeFile() {
                throw new Error("write lock failed")
              },
              async close() {
                if (cleanupFails) throw new Error("close failed")
              },
            }
          },
          async rm() {
            if (cleanupFails) throw new Error("remove failed")
          },
        },
        lockRetryMs: 0,
        lockTimeoutMs: 0,
      }),
      cleanupFails ? AggregateError : /write lock failed/u,
    )
  }

  let ownerText
  const release = await acquirePublicationLock({
    lockPath: "/lock",
    fileSystem: {
      async open() {
        return {
          async writeFile(value) {
            ownerText = value
          },
          async sync() {},
          async close() {},
        }
      },
      async link() {},
      async readdir() {
        return []
      },
      async rename() {},
      async readFile() {
        return ownerText
      },
      async rm(target) {
        if (target.includes(".claim-")) {
          throw new Error("remove failed")
        }
      },
    },
    lockRetryMs: 0,
    lockTimeoutMs: 0,
  })
  await assert.rejects(release, AggregateError)

  assert.equal(await fileExists("/present", {
    async access() {},
  }), true)
  assert.equal(await fileExists("/missing", {
    async access() {
      const error = new Error("missing")
      error.code = "ENOENT"
      throw error
    },
  }), false)
  await assert.rejects(
    () => fileExists("/denied", {
      async access() {
        const error = new Error("denied")
        error.code = "EACCES"
        throw error
      },
    }),
    /denied/u,
  )

  const preAborted = new AbortController()
  preAborted.abort()
  await assert.rejects(
    () => delay(0, preAborted.signal),
    (error) => error.name === "AbortError",
  )
  const midDelay = new AbortController()
  setTimeout(() => midDelay.abort(), 0)
  await assert.rejects(
    () => delay(10, midDelay.signal),
    (error) => error.name === "AbortError",
  )
})

test("publication rejects noncanonical target aliases before creating a transaction", () => {
  assert.throws(
    () => assertPublicationInputs({
      files: [
        { name: "one", path: "/artifacts/item", bytes: "one" },
        { name: "two", path: "/artifacts/item/", bytes: "two" },
      ],
      validateStaged() {},
      platform: "linux",
    }),
    /artifact publication files must be unique named siblings/u,
  )
})

test("publication target uniqueness follows Windows and POSIX name semantics", () => {
  const caseOnlyFiles = [
    { name: "one", path: "/artifacts/Item", bytes: "one" },
    { name: "two", path: "/artifacts/item", bytes: "two" },
  ]
  assert.throws(
    () => assertPublicationInputs({
      files: caseOnlyFiles,
      validateStaged() {},
      platform: "win32",
    }),
    /artifact publication files must be unique named siblings/u,
  )
  assert.doesNotThrow(() => assertPublicationInputs({
    files: caseOnlyFiles,
    validateStaged() {},
    platform: "linux",
  }))
  const windows = assertPublicationInputs({
    files: [
      { name: "one", path: "C:\\artifacts\\one", bytes: "one" },
      { name: "two", path: "C:\\artifacts\\two", bytes: "two" },
    ],
    validateStaged() {},
    platform: "win32",
  })
  assert.deepEqual(windows.files.map((file) => file.target), ["one", "two"])
})

test("publication rejects Win32 aliases before journaling and preserves POSIX names", () => {
  const invalidWindowsTargets = [
    "artifact.txt.",
    "artifact.txt ",
    "artifact.txt:stream",
    "CON",
    "con.json",
    "PrN.TxT",
    "AUX.bin",
    "nul",
    "COM1.log",
    "com9",
    "COM\u00b9.log",
    "LPT1.txt",
    "LpT9.TxT",
    "lpt\u00b3",
  ]
  for (const target of invalidWindowsTargets) {
    assert.throws(
      () => assertPublicationInputs({
        files: [{
          name: "artifact",
          path: `C:\\artifacts\\${target}`,
          bytes: "artifact",
        }],
        validateStaged() {},
        platform: "win32",
      }),
      /artifact publication files must be unique named siblings/u,
      target,
    )
  }

  const validWindowsTargets = [
    "artifact.txt",
    "COM0.log",
    "COM10.log",
    "console.txt",
    "auxiliary.bin",
  ]
  assert.doesNotThrow(() => assertPublicationInputs({
    files: validWindowsTargets.map((target, index) => ({
      name: `artifact-${index}`,
      path: `C:\\artifacts\\${target}`,
      bytes: target,
    })),
    validateStaged() {},
    platform: "win32",
  }))

  assert.doesNotThrow(() => assertPublicationInputs({
    files: invalidWindowsTargets.map((target, index) => ({
      name: `artifact-${index}`,
      path: `/artifacts/${target}`,
      bytes: target,
    })),
    validateStaged() {},
    platform: "linux",
  }))
})

test("publication reports cleanup and rollback failures without leaking work files", async () => {
  for (const scenario of ["cleanup", "release", "operation-and-cleanup", "rollback"]) {
    const root = await scratchRoot(`artifact-publication-fault-${scenario}`)
    const primaryPath = path.join(root, "artifact.bin")
    const manifestPath = path.join(root, "artifact.manifest.json")
    const checksumPath = path.join(root, "artifact.sha256")
    const targets = [primaryPath, manifestPath, checksumPath]
    try {
      if (scenario === "rollback") {
        await Promise.all(targets.map((target, index) =>
          writeFile(target, `old-${index}`, "utf8")
        ))
      }
      let cleanupFailed = false
      let commitFailed = false
      const fileSystem = {
        ...fsPromises,
        async rm(target, options) {
          if (
            (scenario === "cleanup" ||
              scenario === "operation-and-cleanup") &&
            target.includes(".stage") &&
            !cleanupFailed
          ) {
            cleanupFailed = true
            throw new Error("stage cleanup failed")
          }
          if (
            scenario === "release" &&
            target.includes(".publish.lock")
          ) {
            throw new Error("lock cleanup failed")
          }
          if (
            scenario === "rollback" &&
            commitFailed &&
            target === primaryPath
          ) {
            throw new Error("rollback target cleanup failed")
          }
          return fsPromises.rm(target, options)
        },
      }
      await assert.rejects(
        () => publishArtifactSet({
          files: targets.map((target, index) => ({
            name: String(index),
            path: target,
            bytes: Buffer.from(`new-${index}`, "utf8"),
          })),
          validateStaged: async () => {},
          hooks: {
            beforeCommitFile({ index }) {
              if (
                (scenario === "operation-and-cleanup" && index === 0) ||
                (scenario === "rollback" && index === 1)
              ) {
                commitFailed = true
                throw new Error("commit failed")
              }
            },
          },
          fileSystem,
        }),
        AggregateError,
      )
    } finally {
      await cleanupScratchRoot(root)
    }
  }
})

test("publication recovery resolves process death at every durable phase to one complete generation", async () => {
  assert.equal(typeof withArtifactRead, "function")
  const crashPhases = [
    "preparing",
    "backing_up",
    "publishing",
    "publishing:0",
    "publishing:1",
    "publishing:2",
    "committed",
    "detached",
  ]
  for (const crashPhase of crashPhases) {
    const root = await scratchRoot(`artifact-crash-${crashPhase.replaceAll(":", "-")}`)
    const targets = ["primary", "manifest", "checksum"].map((name) =>
      path.join(root, `${name}.consumer`)
    )
    try {
      await Promise.all(targets.map((target, index) =>
        writeFile(target, `old-${index === 0 ? "primary" : index === 1 ? "manifest" : "checksum"}`)
      ))
      const crashed = spawnSync(process.execPath, [crashFixturePath], {
        cwd: mcpRoot,
        env: {
          ...process.env,
          PUBLICATION_DIRECTORY: root,
          PUBLICATION_CRASH_PHASE: crashPhase,
        },
        encoding: "utf8",
      })
      assert.equal(
        crashed.status,
        86,
        `${crashPhase} did not simulate process death: ${crashed.stderr}`,
      )

      const recovered = await withArtifactRead({
        directory: root,
        read: () => Promise.all(targets.map((target) => readFile(target, "utf8"))),
      })
      assert.ok(
        [
          ["old-primary", "old-manifest", "old-checksum"],
          ["new-primary", "new-manifest", "new-checksum"],
        ].some((generation) => generation.every((value, index) =>
          recovered[index] === value
        )),
        `${crashPhase} recovered a mixed generation: ${JSON.stringify(recovered)}`,
      )
      const repeated = await withArtifactRead({
        directory: root,
        read: () => Promise.all(targets.map((target) => readFile(target, "utf8"))),
      })
      assert.deepEqual(repeated, recovered)
      assert.deepEqual(
        (await readdir(root)).sort(),
        targets.map((target) => path.basename(target)).sort(),
      )
    } finally {
      await cleanupScratchRoot(root)
    }
  }
})

test("each prior file stays linked until its backup is durable, then source removal is synced", async () => {
  const root = await scratchRoot("artifact-backup-sync-order")
  const targets = ["primary", "manifest", "checksum"].map((name) =>
    path.join(root, `${name}.consumer`)
  )
  const events = []
  const hookSteps = []
  let backupDirectory
  const backupFiles = new Set()
  const fileSystem = {
    ...fsPromises,
    async open(target, flags) {
      const handle = await fsPromises.open(target, flags)
      if (
        backupFiles.has(target) ||
        (backupDirectory && [backupDirectory, root].includes(target))
      ) {
        return {
          async sync() {
            if (backupFiles.has(target)) {
              events.push(`sync-file:${path.basename(target)}`)
            } else if (target === backupDirectory) {
              events.push("sync-directory:backup")
            } else {
              events.push("sync-directory:source")
            }
            await handle.sync()
          },
          async close() {
            await handle.close()
          },
        }
      }
      return handle
    },
    async link(source, destination) {
      if (
        path.dirname(source) === root &&
        path.basename(path.dirname(destination)) === ".backups"
      ) {
        backupDirectory = path.dirname(destination)
        backupFiles.add(destination)
        events.push(`link:${path.basename(source)}`)
      }
      return fsPromises.link(source, destination)
    },
    async rm(target, options) {
      if (targets.includes(target)) {
        events.push(`remove:${path.basename(target)}`)
      }
      return fsPromises.rm(target, options)
    },
  }
  try {
    await Promise.all(targets.map((target, index) =>
      writeFile(target, `old-${index}`)
    ))
    await publishArtifactSet({
      files: targets.map((target, index) => ({
        name: String(index),
        path: target,
        bytes: Buffer.from(`new-${index}`),
      })),
      validateStaged: async () => {},
      fileSystem,
      hooks: {
        afterBackupStep({ index, step }) {
          hookSteps.push(`${index}:${step}`)
        },
      },
    })
    assert.deepEqual(events.slice(0, 15), [
      "link:primary.consumer",
      "sync-file:.b-0",
      "sync-directory:backup",
      "remove:primary.consumer",
      "sync-directory:source",
      "link:manifest.consumer",
      "sync-file:.b-1",
      "sync-directory:backup",
      "remove:manifest.consumer",
      "sync-directory:source",
      "link:checksum.consumer",
      "sync-file:.b-2",
      "sync-directory:backup",
      "remove:checksum.consumer",
      "sync-directory:source",
    ])
    assert.deepEqual(hookSteps, [
      "0:linked",
      "0:backup_file_synced",
      "0:backup_directory_synced",
      "0:target_removed",
      "0:source_directory_synced",
      "1:linked",
      "1:backup_file_synced",
      "1:backup_directory_synced",
      "1:target_removed",
      "1:source_directory_synced",
      "2:linked",
      "2:backup_file_synced",
      "2:backup_directory_synced",
      "2:target_removed",
      "2:source_directory_synced",
    ])
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("power loss after every per-file backup boundary preserves the complete prior generation", async () => {
  const backupSteps = [
    "linked",
    "backup_file_synced",
    "backup_directory_synced",
    "target_removed",
    "source_directory_synced",
  ]
  for (let fileIndex = 0; fileIndex < 3; fileIndex += 1) {
    for (const crashStep of backupSteps) {
      const root = await scratchRoot(
        `artifact-backup-crash-${fileIndex}-${crashStep}`,
      )
      const targets = ["primary", "manifest", "checksum"].map((name) =>
        path.join(root, `${name}.consumer`)
      )
      try {
        await Promise.all(targets.map((target, index) =>
          writeFile(target, `old-${index}`)
        ))
        const crashed = spawnSync(process.execPath, [crashFixturePath], {
          cwd: mcpRoot,
          env: {
            ...process.env,
            PUBLICATION_DIRECTORY: root,
            PUBLICATION_CRASH_BACKUP_INDEX: String(fileIndex),
            PUBLICATION_CRASH_BACKUP_STEP: crashStep,
          },
          encoding: "utf8",
        })
        assert.equal(
          crashed.status,
          86,
          `${fileIndex}:${crashStep} did not simulate process death: ${crashed.stderr}`,
        )

        const recovered = await withArtifactRead({
          directory: root,
          read: () => Promise.all(
            targets.map((target) => readFile(target, "utf8")),
          ),
        })
        assert.deepEqual(recovered, ["old-0", "old-1", "old-2"])
        const repeated = await withArtifactRead({
          directory: root,
          read: () => Promise.all(
            targets.map((target) => readFile(target, "utf8")),
          ),
        })
        assert.deepEqual(repeated, recovered)
      } finally {
        await cleanupScratchRoot(root)
      }
    }
  }
})

test("power loss after every per-file restoration boundary retains the durable prior copy", async () => {
  const restoreSteps = [
    "target_removed",
    "target_linked",
    "target_file_synced",
    "source_directory_synced",
    "backup_removed",
    "backup_directory_synced",
  ]
  for (const crashStep of restoreSteps) {
    const root = await scratchRoot(`artifact-restore-crash-${crashStep}`)
    const files = [{
      name: "artifact",
      target: "artifact.consumer",
      backup: ".b-0",
      had_prior: true,
    }]
    try {
      const { coordination, transaction } = await writeRecoveryState({
        root,
        transactionId: `restore-${crashStep}`,
        phase: "publishing",
        files,
      })
      const target = path.join(root, files[0].target)
      const backup = path.join(
        transaction.backupDirectory,
        files[0].backup,
      )
      await writeFile(target, "new generation")
      await writeFile(backup, "old generation")

      const crashed = spawnSync(process.execPath, [crashFixturePath], {
        cwd: mcpRoot,
        env: {
          ...process.env,
          PUBLICATION_DIRECTORY: root,
          PUBLICATION_RECOVERY_CRASH_JSON: JSON.stringify({
            transactionId: transaction.id,
            crashIndex: 0,
            crashStep,
          }),
        },
        encoding: "utf8",
      })
      assert.equal(
        crashed.status,
        86,
        `${crashStep} did not simulate process death: ${crashed.stderr}`,
      )

      await recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      })
      assert.equal(await readFile(target, "utf8"), "old generation")
      assert.deepEqual(await readdir(coordination.privateRoot), [])
    } finally {
      await cleanupScratchRoot(root)
    }
  }
})

test("publication initialization is private and recoverable after failure or process death at every visibility boundary", async () => {
  const initializationSteps = [
    "root",
    "stage",
    "backup",
    "journal",
    "published",
    "synced",
  ]
  for (const step of initializationSteps) {
    const root = await scratchRoot(`artifact-initialization-${step}`)
    const sensitiveBytes = "private initialization bytes"
    const targets = ["primary", "manifest", "checksum"].map((name) => ({
      name,
      path: path.join(root, `${name}.consumer`),
      bytes: Buffer.from(`${sensitiveBytes}-${name}`),
    }))
    try {
      await assert.rejects(
        () => publishArtifactSet({
          files: targets,
          validateStaged: async () => {},
          hooks: {
            afterInitialization({ step: initialized }) {
              if (initialized === step) {
                throw new Error(`synthetic initialization failure ${step}`)
              }
            },
          },
        }),
        (error) => {
          assert.match(error.message, new RegExp(`synthetic initialization failure ${step}`, "u"))
          assert.doesNotMatch(error.message, /private initialization bytes|\.init-|\.tx-/u)
          return true
        },
      )
      await assert.doesNotReject(() => withArtifactRead({
        directory: root,
        read: async () => null,
      }))
      await assert.doesNotReject(() => withArtifactRead({
        directory: root,
        read: async () => null,
      }))
      assert.deepEqual(await readdir(root), [])
      await assertPrivateRootEmptyOrMissing(root)

      const crashed = spawnSync(process.execPath, [crashFixturePath], {
        cwd: mcpRoot,
        env: {
          ...process.env,
          PUBLICATION_DIRECTORY: root,
          PUBLICATION_CRASH_INITIALIZATION: step,
          PUBLICATION_TARGETS_JSON: JSON.stringify(targets.map((target) => ({
            ...target,
            bytes: target.bytes.toString("utf8"),
          }))),
        },
        encoding: "utf8",
      })
      assert.equal(crashed.status, 86, `${step} did not simulate process death: ${crashed.stderr}`)
      await assert.doesNotReject(() => withArtifactRead({
        directory: root,
        read: async () => null,
      }))
      await assert.doesNotReject(() => withArtifactRead({
        directory: root,
        read: async () => null,
      }))
      assert.deepEqual(await readdir(root), [])
      await assertPrivateRootEmptyOrMissing(root)
    } finally {
      await cleanupScratchRoot(root)
    }
  }
})

test("recovery securely removes stale initialization directories without touching foreign state", async () => {
  const root = await scratchRoot("artifact-stale-initialization")
  const coordination = coordinationPaths(root)
  const staleInitialization = path.join(coordination.privateRoot, ".init-stale")
  const secondStaleInitialization = path.join(coordination.privateRoot, ".init-z-stale")
  const foreignDirectory = path.join(coordination.privateRoot, ".initialization-foreign")
  const foreignFile = path.join(coordination.privateRoot, ".init-foreign-file")
  const external = path.join(root, "external-sensitive")
  try {
    await mkdir(staleInitialization, { recursive: true, mode: 0o700 })
    await mkdir(secondStaleInitialization, { recursive: true, mode: 0o700 })
    await mkdir(foreignDirectory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(staleInitialization, "sensitive"), "stale sensitive bytes")
    await writeFile(path.join(secondStaleInitialization, "sensitive"), "second stale sensitive bytes")
    await writeFile(path.join(foreignDirectory, "valid"), "foreign valid state")
    await writeFile(foreignFile, "foreign valid file")
    await writeFile(external, "external valid state")
    await fsPromises.symlink(external, path.join(staleInitialization, "external-link"))

    await recoverTransactions({
      directory: root,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
    await recoverTransactions({
      directory: root,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })

    await assert.rejects(
      () => fsPromises.access(staleInitialization),
      (error) => error.code === "ENOENT",
    )
    await assert.rejects(
      () => fsPromises.access(secondStaleInitialization),
      (error) => error.code === "ENOENT",
    )
    assert.equal(await readFile(path.join(foreignDirectory, "valid"), "utf8"), "foreign valid state")
    assert.equal(await readFile(foreignFile, "utf8"), "foreign valid file")
    assert.equal(await readFile(external, "utf8"), "external valid state")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication recovery handles process death with no prior generation", async () => {
  assert.equal(typeof withArtifactRead, "function")
  const root = await scratchRoot("artifact-crash-no-prior")
  try {
    const crashed = spawnSync(process.execPath, [crashFixturePath], {
      cwd: mcpRoot,
      env: {
        ...process.env,
        PUBLICATION_DIRECTORY: root,
        PUBLICATION_CRASH_PHASE: "publishing:1",
      },
      encoding: "utf8",
    })
    assert.equal(crashed.status, 86, crashed.stderr)
    const recovered = await withArtifactRead({
      directory: root,
      read: async () => readdir(root),
    })
    assert.deepEqual(recovered, [])
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("artifact readers preserve read-only access when the private recovery root is absent", async () => {
  const root = await scratchRoot("artifact-reader-read-only")
  const directory = path.join(root, "package", "artifacts")
  const artifact = path.join(directory, "published.json")
  const coordination = coordinationPaths(directory)
  const privateMutations = []
  const isPrivatePath = (target) =>
    target === coordination.privateRoot ||
    target.startsWith(`${coordination.privateRoot}${path.sep}`)
  const fileSystem = {
    ...fsPromises,
    async mkdir(target, options) {
      if (isPrivatePath(target)) {
        privateMutations.push(["mkdir", target])
        const error = new Error("read-only artifact package")
        error.code = "EROFS"
        throw error
      }
      return fsPromises.mkdir(target, options)
    },
    async chmod(target, mode) {
      if (isPrivatePath(target)) {
        privateMutations.push(["chmod", target])
        const error = new Error("read-only artifact package")
        error.code = "EROFS"
        throw error
      }
      return fsPromises.chmod(target, mode)
    },
    async writeFile(target, ...args) {
      if (isPrivatePath(target)) {
        privateMutations.push(["writeFile", target])
        const error = new Error("read-only artifact package")
        error.code = "EROFS"
        throw error
      }
      return fsPromises.writeFile(target, ...args)
    },
  }
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(artifact, "published artifact", "utf8")

    assert.equal(
      await withArtifactRead({
        directory,
        fileSystem,
        read: () => readFile(artifact, "utf8"),
      }),
      "published artifact",
    )
    assert.deepEqual(privateMutations, [])
    await assert.rejects(
      () => fsPromises.access(coordination.privateRoot),
      (error) => error.code === "ENOENT",
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("artifact readers ignore read-only empty-root cleanup only after a successful read", async () => {
  for (const code of ["EROFS", "EACCES"]) {
    const root = await scratchRoot(`artifact-reader-empty-root-${code.toLowerCase()}`)
    const coordination = coordinationPaths(root)
    const events = []
    const cleanupError = new Error("private cleanup denied")
    cleanupError.code = code
    cleanupError.path = coordination.privateRoot
    const fileSystem = {
      ...fsPromises,
      async rmdir(target) {
        if (target === coordination.privateRoot) {
          events.push("private-cleanup")
          throw cleanupError
        }
        return fsPromises.rmdir(target)
      },
      async rm(target, options) {
        if (target.startsWith(`${coordination.lockPath}.claim-`)) {
          events.push("lock-release")
        }
        return fsPromises.rm(target, options)
      },
    }
    try {
      await mkdir(coordination.privateRoot, {
        recursive: true,
        mode: 0o700,
      })
      assert.equal(
        await withArtifactRead({
          directory: root,
          fileSystem,
          read: async () => "published artifact",
        }),
        "published artifact",
      )
      assert.deepEqual(events, ["private-cleanup", "lock-release"])

      await assert.rejects(
        () => withArtifactRead({
          directory: root,
          fileSystem,
          read: async () => {
            throw new Error("synthetic read failure")
          },
        }),
        (error) => {
          assert.ok(error instanceof AggregateError)
          assert.equal(error.errors.length, 2)
          assert.match(error.errors[0].message, /synthetic read failure/u)
          assert.equal(error.errors[1].code, code)
          return true
        },
      )
    } finally {
      await fsPromises.rm(coordination.lockPath, { force: true })
      await cleanupScratchRoot(root)
    }
  }
})

test("artifact readers keep unexpected empty-root cleanup failures strict after a successful read", async () => {
  const root = await scratchRoot("artifact-reader-empty-root-eio")
  const coordination = coordinationPaths(root)
  const fileSystem = {
    ...fsPromises,
    async rmdir(target) {
      if (target === coordination.privateRoot) {
        const error = new Error("unexpected private cleanup failure")
        error.code = "EIO"
        throw error
      }
      return fsPromises.rmdir(target)
    },
  }
  try {
    await mkdir(coordination.privateRoot, {
      recursive: true,
      mode: 0o700,
    })
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        fileSystem,
        read: async () => "published artifact",
      }),
      (error) => error.code === "EIO",
    )
  } finally {
    await fsPromises.rm(coordination.lockPath, { force: true })
    await cleanupScratchRoot(root)
  }
})

test("artifact readers reject symlinked private recovery roots without traversing them", async () => {
  const root = await scratchRoot("artifact-reader-symlinked-private-root")
  const external = await scratchRoot("artifact-reader-external-private-root")
  const coordination = coordinationPaths(root)
  const sentinels = [
    path.join(external, ".init-external", "sentinel"),
    path.join(external, ".gc-external", "sentinel"),
  ]
  const unsafeOperations = []
  const isPrivatePath = (target) =>
    target === coordination.privateRoot ||
    target.startsWith(`${coordination.privateRoot}${path.sep}`)
  const fileSystem = {
    ...fsPromises,
    async mkdir(target, options) {
      if (isPrivatePath(target)) unsafeOperations.push(["mkdir", target])
      return fsPromises.mkdir(target, options)
    },
    async chmod(target, mode) {
      if (isPrivatePath(target)) unsafeOperations.push(["chmod", target])
      return fsPromises.chmod(target, mode)
    },
    async readdir(target, options) {
      if (isPrivatePath(target)) unsafeOperations.push(["readdir", target])
      return fsPromises.readdir(target, options)
    },
    async rename(source, target) {
      if (isPrivatePath(source) || isPrivatePath(target)) {
        unsafeOperations.push(["rename", source, target])
      }
      return fsPromises.rename(source, target)
    },
    async rm(target, options) {
      if (isPrivatePath(target)) unsafeOperations.push(["rm", target])
      return fsPromises.rm(target, options)
    },
    async rmdir(target) {
      if (isPrivatePath(target)) unsafeOperations.push(["rmdir", target])
      return fsPromises.rmdir(target)
    },
  }
  let readCalled = false
  try {
    await Promise.all(sentinels.map(async (sentinel) => {
      await mkdir(path.dirname(sentinel), { recursive: true })
      await writeFile(sentinel, "external sentinel")
    }))
    await fsPromises.symlink(external, coordination.privateRoot)

    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        fileSystem,
        read: async () => {
          readCalled = true
        },
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_recovery_failed")
        assert.equal(error.message, "artifact publication recovery failed")
        return true
      },
    )
    assert.equal(readCalled, false)
    assert.deepEqual(unsafeOperations, [])
    assert.deepEqual(
      await Promise.all(sentinels.map((sentinel) => readFile(sentinel, "utf8"))),
      ["external sentinel", "external sentinel"],
    )

    await rm(coordination.privateRoot, { force: true })
    await assert.doesNotReject(() => withArtifactRead({
      directory: root,
      read: async () => null,
    }))
  } finally {
    await cleanupScratchRoot(root)
    await cleanupScratchRoot(external)
  }
})

test("publication rejects foreign target shapes without destroying external sentinels", async () => {
  for (const scenario of ["directory", "symlink", "hardlink"]) {
    const root = await scratchRoot(`artifact-target-${scenario}`)
    const external = await scratchRoot(`artifact-target-${scenario}-external`)
    const target = path.join(root, "artifact.consumer")
    const externalSentinel = path.join(external, "sentinel")
    const directorySentinel = path.join(target, "sentinel")
    try {
      await writeFile(externalSentinel, "external sentinel body")
      if (scenario === "directory") {
        await mkdir(target)
        await writeFile(directorySentinel, "directory sentinel body")
      } else if (scenario === "symlink") {
        await fsPromises.symlink(externalSentinel, target)
      } else {
        await fsPromises.link(externalSentinel, target)
      }

      await assert.rejects(
        () => publishArtifactSet({
          files: [{
            name: "artifact",
            path: target,
            bytes: Buffer.from("new artifact"),
          }],
          validateStaged: async () => {},
        }),
        (error) => {
          assert.equal(
            error.code,
            "artifact_publication_target_unsupported",
          )
          assert.equal(
            error.message,
            "artifact publication target is unsupported",
          )
          assert.doesNotMatch(
            error.message,
            /external sentinel body|directory sentinel body|artifact-target/u,
          )
          return true
        },
      )

      assert.equal(
        await readFile(externalSentinel, "utf8"),
        "external sentinel body",
      )
      if (scenario === "directory") {
        assert.equal(
          await readFile(directorySentinel, "utf8"),
          "directory sentinel body",
        )
      } else if (scenario === "symlink") {
        assert.equal((await fsPromises.lstat(target)).isSymbolicLink(), true)
      } else {
        const [externalStat, targetStat] = await Promise.all([
          fsPromises.lstat(externalSentinel),
          fsPromises.lstat(target),
        ])
        assert.equal(targetStat.ino, externalStat.ino)
        assert.equal(targetStat.nlink, 2)
      }
    } finally {
      await cleanupScratchRoot(root)
      await cleanupScratchRoot(external)
    }
  }
})

test("publication rejects device, socket, and FIFO target shapes before mutation", async () => {
  const unsupportedKinds = [
    "block-device",
    "character-device",
    "socket",
    "fifo",
  ]
  for (const kind of unsupportedKinds) {
    const root = await scratchRoot(`artifact-target-${kind}`)
    const target = path.join(root, "artifact.consumer")
    const mutations = []
    const stat = {
      dev: 1,
      ino: 1,
      nlink: 1,
      isFile: () => false,
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isBlockDevice: () => kind === "block-device",
      isCharacterDevice: () => kind === "character-device",
      isSocket: () => kind === "socket",
      isFIFO: () => kind === "fifo",
    }
    const fileSystem = {
      ...fsPromises,
      async lstat(subject) {
        if (subject === target) return stat
        return fsPromises.lstat(subject)
      },
      async access(subject) {
        if (subject === target) return
        return fsPromises.access(subject)
      },
      async rename(source, destination) {
        if (source === target) mutations.push(["rename", destination])
        return fsPromises.rename(source, destination)
      },
      async rm(subject, options) {
        if (subject === target) mutations.push(["rm"])
        return fsPromises.rm(subject, options)
      },
    }
    try {
      await assert.rejects(
        () => publishArtifactSet({
          files: [{
            name: "artifact",
            path: target,
            bytes: Buffer.from("new artifact"),
          }],
          validateStaged: async () => {},
          fileSystem,
        }),
        (error) =>
          error.code === "artifact_publication_target_unsupported",
      )
      assert.deepEqual(mutations, [])
      assert.deepEqual(await readdir(root), [])
    } finally {
      await cleanupScratchRoot(root)
    }
  }
})

test("publication revalidates target identity immediately before backup", async () => {
  const root = await scratchRoot("artifact-target-replacement")
  const target = path.join(root, "artifact.consumer")
  const displaced = path.join(root, "displaced.consumer")
  try {
    await writeFile(target, "old generation")
    await assert.rejects(
      () => publishArtifactSet({
        files: [{
          name: "artifact",
          path: target,
          bytes: Buffer.from("new generation"),
        }],
        validateStaged: async () => {},
        hooks: {
          async beforeCommit() {
            await fsPromises.rename(target, displaced)
            await writeFile(target, "foreign replacement body")
          },
        },
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_target_changed")
        assert.equal(
          error.message,
          "artifact publication target changed during publication",
        )
        assert.doesNotMatch(
          error.message,
          /foreign replacement body|artifact-target-replacement/u,
        )
        return true
      },
    )
    assert.equal(await readFile(target, "utf8"), "foreign replacement body")
    assert.equal(await readFile(displaced, "utf8"), "old generation")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication revalidates each target again after the backing-up journal is durable", async () => {
  const root = await scratchRoot("artifact-target-late-replacement")
  const target = path.join(root, "artifact.consumer")
  const displaced = path.join(root, "displaced.consumer")
  let replaced = false
  try {
    await writeFile(target, "old generation")
    await assert.rejects(
      () => publishArtifactSet({
        files: [{
          name: "artifact",
          path: target,
          bytes: Buffer.from("new generation"),
        }],
        validateStaged: async () => {},
        hooks: {
          async afterPhase({ phase }) {
            if (phase === "backing_up" && !replaced) {
              replaced = true
              await fsPromises.rename(target, displaced)
              await writeFile(target, "foreign replacement body")
            }
          },
        },
      }),
      (error) =>
        error.code === "artifact_publication_target_changed",
    )
    assert.equal(await readFile(target, "utf8"), "foreign replacement body")
    assert.equal(await readFile(displaced, "utf8"), "old generation")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication does not remove a foreign target that appears before staged rename", async () => {
  const root = await scratchRoot("artifact-target-publish-race")
  const target = path.join(root, "artifact.consumer")
  try {
    await assert.rejects(
      () => publishArtifactSet({
        files: [{
          name: "artifact",
          path: target,
          bytes: Buffer.from("new generation"),
        }],
        validateStaged: async () => {},
        hooks: {
          async beforeCommitFile() {
            await writeFile(target, "foreign replacement body")
          },
        },
      }),
      (error) => {
        assert.ok(error instanceof AggregateError)
        assert.doesNotMatch(
          error.message,
          /foreign replacement body|artifact-target-publish-race/u,
        )
        return true
      },
    )
    assert.equal(await readFile(target, "utf8"), "foreign replacement body")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication retains a validated backup when the target is replaced during hard-link creation", async () => {
  const root = await scratchRoot("artifact-target-link-race")
  const target = path.join(root, "artifact.consumer")
  const transaction = transactionPaths(
    coordinationPaths(root).privateRoot,
    "link-race",
  )
  const backup = path.join(transaction.backupDirectory, ".b-0")
  let raced = false
  const fileSystem = {
    ...fsPromises,
    async link(source, destination) {
      await fsPromises.link(source, destination)
      if (source === target && !raced) {
        raced = true
        await fsPromises.rm(source)
        await writeFile(source, "foreign replacement body")
      }
    },
  }
  try {
    await writeFile(target, "old generation")
    await assert.rejects(
      () => publishArtifactSet({
        files: [{
          name: "artifact",
          path: target,
          bytes: Buffer.from("new generation"),
        }],
        validateStaged: async () => {},
        fileSystem,
        makeId: () => "link-race",
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => {
        assert.ok(error instanceof AggregateError)
        assert.doesNotMatch(
          error.message,
          /foreign replacement body|artifact-target-link-race/u,
        )
        return true
      },
    )
    assert.equal(await readFile(target, "utf8"), "foreign replacement body")
    assert.equal(await readFile(backup, "utf8"), "old generation")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication converts backup inspection faults to a private target-change error", async () => {
  const root = await scratchRoot("artifact-target-backup-inspection")
  const target = path.join(root, "artifact.consumer")
  const backup = path.join(
    transactionPaths(
      coordinationPaths(root).privateRoot,
      "backup-inspection",
    ).backupDirectory,
    ".b-0",
  )
  let linked = false
  let failedInspection = false
  const fileSystem = {
    ...fsPromises,
    async link(source, destination) {
      await fsPromises.link(source, destination)
      if (source === target) linked = true
    },
    async lstat(subject) {
      if (subject === backup && linked && !failedInspection) {
        failedInspection = true
        const error = new Error("private backup inspection path")
        error.code = "EACCES"
        error.path = subject
        throw error
      }
      return fsPromises.lstat(subject)
    },
  }
  try {
    await writeFile(target, "old generation")
    await assert.rejects(
      () => publishArtifactSet({
        files: [{
          name: "artifact",
          path: target,
          bytes: Buffer.from("new generation"),
        }],
        validateStaged: async () => {},
        fileSystem,
        makeId: () => "backup-inspection",
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_target_changed")
        assert.doesNotMatch(error.message, /backup-inspection/u)
        return true
      },
    )
    assert.equal(await readFile(target, "utf8"), "old generation")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("recovery rejects unexpected third hard links without removing external state", async () => {
  const root = await scratchRoot("artifact-recovery-third-link")
  const files = [{
    name: "artifact",
    target: "artifact.consumer",
    backup: ".b-0",
    had_prior: true,
  }]
  try {
    const { coordination, transaction } = await writeRecoveryState({
      root,
      transactionId: "third-link",
      phase: "rolling_back",
      files,
    })
    const target = path.join(root, files[0].target)
    const backup = path.join(
      transaction.backupDirectory,
      files[0].backup,
    )
    const external = path.join(root, "external-hard-link")
    await writeFile(target, "old generation")
    await fsPromises.link(target, backup)
    await fsPromises.link(target, external)

    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    assert.deepEqual(
      await Promise.all([
        readFile(target, "utf8"),
        readFile(backup, "utf8"),
        readFile(external, "utf8"),
      ]),
      ["old generation", "old generation", "old generation"],
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("recovery rejects target-only external hard links without removing them", async () => {
  const root = await scratchRoot("artifact-recovery-target-hard-link")
  const files = [{
    name: "artifact",
    target: "artifact.consumer",
    backup: ".b-0",
    had_prior: true,
  }]
  try {
    const { coordination } = await writeRecoveryState({
      root,
      transactionId: "target-hard-link",
      phase: "rolling_back",
      files,
    })
    const target = path.join(root, files[0].target)
    const external = path.join(root, "external-hard-link")
    await writeFile(target, "external generation")
    await fsPromises.link(target, external)

    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    assert.deepEqual(
      await Promise.all([
        readFile(target, "utf8"),
        readFile(external, "utf8"),
      ]),
      ["external generation", "external generation"],
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("recovery rejects unsupported target shapes without traversing them", async () => {
  const root = await scratchRoot("artifact-recovery-target-directory")
  const files = [{
    name: "artifact",
    target: "artifact.consumer",
    backup: ".b-0",
    had_prior: true,
  }]
  try {
    const { coordination } = await writeRecoveryState({
      root,
      transactionId: "target-directory",
      phase: "rolling_back",
      files,
    })
    const target = path.join(root, files[0].target)
    const sentinel = path.join(target, "sentinel")
    await mkdir(target)
    await writeFile(sentinel, "external directory body")

    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    assert.equal(await readFile(sentinel, "utf8"), "external directory body")
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("recovery converts target inspection faults to private recovery errors", async () => {
  const root = await scratchRoot("artifact-recovery-inspection")
  const files = [{
    name: "artifact",
    target: "artifact.consumer",
    backup: ".b-0",
    had_prior: true,
  }]
  try {
    const { coordination } = await writeRecoveryState({
      root,
      transactionId: "inspection-fault",
      phase: "rolling_back",
      files,
    })
    const target = path.join(root, files[0].target)
    const fileSystem = {
      ...fsPromises,
      async lstat(subject) {
        if (subject === target) {
          const error = new Error("private target path")
          error.code = "EACCES"
          error.path = subject
          throw error
        }
        return fsPromises.lstat(subject)
      },
    }
    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_recovery_failed")
        assert.doesNotMatch(error.message, /artifact-recovery-inspection/u)
        return true
      },
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("artifact readers hold publication coordination until every read handle closes", async () => {
  assert.equal(typeof withArtifactRead, "function")
  const root = await scratchRoot("artifact-reader-coordination")
  let releaseReader
  let readerStarted
  let publisherReachedCommit = false
  const readerReady = new Promise((resolve) => {
    readerStarted = resolve
  })
  const readerHold = new Promise((resolve) => {
    releaseReader = resolve
  })
  try {
    const reader = withArtifactRead({
      directory: root,
      read: async () => {
        readerStarted()
        await readerHold
      },
    })
    await readerReady
    const publisher = publishArtifactSet({
      files: ["primary", "manifest", "checksum"].map((name) => ({
        name,
        path: path.join(root, `${name}.consumer`),
        bytes: Buffer.from(name),
      })),
      validateStaged: async () => {},
      hooks: {
        beforeCommit() {
          publisherReachedCommit = true
        },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(publisherReachedCommit, false)
    releaseReader()
    await Promise.all([reader, publisher])
    assert.equal(publisherReachedCommit, true)
  } finally {
    releaseReader?.()
    await cleanupScratchRoot(root)
  }
})

test("publication reclaims dead owners without disturbing live owners", async () => {
  assert.equal(typeof coordinationPaths, "function")
  assert.equal(typeof withArtifactRead, "function")
  const root = await scratchRoot("artifact-owner-recovery")
  const paths = coordinationPaths(root)
  try {
    await mkdir(paths.privateRoot, { recursive: true, mode: 0o700 })
    await mkdir(paths.lockBase, { recursive: true, mode: 0o700 })
    await writeFile(paths.lockPath, `${JSON.stringify({
      schema_version: 1,
      pid: 99999999,
      process_start: "dead-owner",
      owner_token: "dead-owner-token",
      created_at: "2026-08-24T00:00:00.000Z",
    })}\n`, { mode: 0o600 })
    await assert.doesNotReject(() => withArtifactRead({
      directory: root,
      read: async () => null,
      lockRetryMs: 1,
      lockTimeoutMs: 100,
    }))
    let release
    let started
    const ready = new Promise((resolve) => {
      started = resolve
    })
    const hold = new Promise((resolve) => {
      release = resolve
    })
    const live = withArtifactRead({
      directory: root,
      read: async () => {
        started()
        await hold
      },
    })
    await ready
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        read: async () => null,
        lockRetryMs: 1,
        lockTimeoutMs: 10,
      }),
      (error) => error.code === "artifact_publication_lock_timeout",
    )
    release()
    await live
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("malformed durable journals fail closed without leaking private paths or bytes", async () => {
  assert.equal(typeof coordinationPaths, "function")
  assert.equal(typeof transactionPaths, "function")
  assert.equal(typeof withArtifactRead, "function")
  const root = await scratchRoot("artifact-malformed-journal")
  const coordination = coordinationPaths(root)
  const transaction = transactionPaths(coordination.privateRoot, "malformed")
  try {
    await mkdir(transaction.root, { recursive: true, mode: 0o700 })
    await writeFile(transaction.journalPath, "{private-body", { mode: 0o600 })
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        read: async () => null,
      }),
      (error) => {
        assert.equal(error.code, "artifact_publication_recovery_failed")
        assert.doesNotMatch(error.message, /private-body|artifact-malformed-journal/u)
        return true
      },
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("publication retries Windows-style link, unlink, and rename sharing failures", async () => {
  const root = await scratchRoot("artifact-windows-rename")
  const targets = ["primary", "manifest", "checksum"].map((name) =>
    path.join(root, `${name}.consumer`)
  )
  const failedRenames = new Set()
  const failedLinks = new Set()
  const failedRemovals = new Set()
  const phases = []
  const fileSystem = {
    ...fsPromises,
    async rename(source, target) {
      const key = `${path.basename(source)}>${path.basename(target)}`
      if (!failedRenames.has(key)) {
        failedRenames.add(key)
        const error = new Error("synthetic Windows sharing violation")
        error.code = "EBUSY"
        throw error
      }
      return fsPromises.rename(source, target)
    },
    async link(source, target) {
      const key = `${path.basename(source)}>${path.basename(target)}`
      if (targets.includes(source) && !failedLinks.has(key)) {
        failedLinks.add(key)
        const error = new Error("synthetic Windows hard-link sharing violation")
        error.code = "EACCES"
        throw error
      }
      return fsPromises.link(source, target)
    },
    async rm(target, options) {
      if (targets.includes(target) && !failedRemovals.has(target)) {
        failedRemovals.add(target)
        const error = new Error("synthetic Windows unlink sharing violation")
        error.code = "EPERM"
        throw error
      }
      return fsPromises.rm(target, options)
    },
  }
  try {
    await Promise.all(targets.map((target, index) =>
      writeFile(target, `old-${index}`)
    ))
    await publishArtifactSet({
      files: targets.map((target, index) => ({
        name: String(index),
        path: target,
        bytes: Buffer.from(`new-${index}`),
      })),
      validateStaged: async () => {},
      hooks: {
        afterPhase(phase) {
          phases.push(
            phase.index === undefined
              ? phase.phase
              : `${phase.phase}:${phase.index}`,
          )
        },
      },
      fileSystem,
      renameRetryMs: 1,
      renameRetryLimit: 2,
    })
    assert.deepEqual(
      await Promise.all(targets.map((target) => readFile(target, "utf8"))),
      ["new-0", "new-1", "new-2"],
    )
    assert.deepEqual(phases, [
      "preparing",
      "backing_up",
      "publishing",
      "publishing:0",
      "publishing:1",
      "publishing:2",
      "committed",
      "detached",
    ])
    assert.equal(failedLinks.size, 3)
    assert.equal(failedRemovals.size, 3)
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("artifact read coordination validates inputs and aggregates read cleanup failures", async () => {
  for (const args of [
    { read() {} },
    { directory: " ", read() {} },
    { directory: "/artifacts" },
  ]) {
    await assert.rejects(
      () => withArtifactRead(args),
      /directory|id|callback/u,
    )
  }

  const root = await scratchRoot("artifact-read-failures")
  const coordination = coordinationPaths(root)
  try {
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        read() {
          throw new Error("synthetic read failure")
        },
      }),
      /synthetic read failure/u,
    )

    const inspectionError = new Error("synthetic private inspection failure")
    inspectionError.code = "EACCES"
    const inspectionFileSystem = {
      ...fsPromises,
      async lstat(target) {
        if (target === coordination.privateRoot) throw inspectionError
        return fsPromises.lstat(target)
      },
    }
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        fileSystem: inspectionFileSystem,
        read: async () => null,
      }),
      (error) => error === inspectionError,
    )
    await assert.doesNotReject(() => withArtifactRead({
      directory: root,
      read: async () => null,
    }))

    await mkdir(coordination.privateRoot, {
      recursive: true,
      mode: 0o700,
    })
    const fileSystem = {
      ...fsPromises,
      async rmdir(target) {
        if (target === coordination.privateRoot) {
          throw new Error("synthetic private cleanup failure")
        }
        return fsPromises.rmdir(target)
      },
      async rm(target, options) {
        if (target.startsWith(`${coordination.lockPath}.claim-`)) {
          throw new Error("synthetic read lock cleanup failure")
        }
        return fsPromises.rm(target, options)
      },
    }
    await assert.rejects(
      () => withArtifactRead({
        directory: root,
        fileSystem,
        read: async () => {
          throw new Error("synthetic aggregate read failure")
        },
      }),
      (error) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 3)
        return true
      },
    )
  } finally {
    await fsPromises.rm(coordination.lockPath, { force: true })
    await cleanupScratchRoot(root)
  }
})

test("publisher reports private-root cleanup failures without leaking paths", async () => {
  const root = await scratchRoot("artifact-private-cleanup")
  const coordination = coordinationPaths(root)
  const fileSystem = {
    ...fsPromises,
    async rmdir(target) {
      if (target === coordination.privateRoot) {
        const error = new Error(`cannot remove ${target}`)
        error.code = "EACCES"
        error.path = target
        throw error
      }
      return fsPromises.rmdir(target)
    },
  }
  try {
    await assert.rejects(
      () => publishArtifactSet({
        files: ["primary", "manifest", "checksum"].map((name) => ({
          name,
          path: path.join(root, `${name}.consumer`),
          bytes: Buffer.from(name),
        })),
        validateStaged: async () => {},
        fileSystem,
      }),
      (error) => {
        assert.equal(error.code, "EACCES")
        assert.doesNotMatch(error.message, new RegExp(path.basename(root), "u"))
        return true
      },
    )
    const aggregateFileSystem = {
      ...fileSystem,
      async rm(target, options) {
        if (target.startsWith(`${coordination.lockPath}.claim-`)) {
          throw new Error("synthetic publisher lock cleanup failure")
        }
        return fsPromises.rm(target, options)
      },
    }
    await assert.rejects(
      () => publishArtifactSet({
        files: ["primary", "manifest", "checksum"].map((name) => ({
          name,
          path: path.join(root, `${name}.aggregate`),
          bytes: Buffer.from(name),
        })),
        validateStaged: async () => {},
        hooks: {
          beforeCommit() {
            throw new Error("synthetic publisher operation failure")
          },
        },
        fileSystem: aggregateFileSystem,
      }),
      (error) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 3)
        return true
      },
    )
  } finally {
    await fsPromises.rm(coordination.lockPath, { force: true })
    await cleanupScratchRoot(root)
  }
})

test("incomplete committed recovery resumes rollback after process death", async () => {
  const root = await scratchRoot("artifact-committed-rollback-death")
  try {
    const files = [
      {
        name: "first",
        target: "first.consumer",
        backup: ".b-0",
        had_prior: true,
      },
      {
        name: "second",
        target: "second.consumer",
        backup: ".b-1",
        had_prior: true,
      },
    ]
    const { coordination, transaction } = await writeRecoveryState({
      root,
      transactionId: "committed-rollback-death",
      phase: "committed",
      files,
    })
    const firstTarget = path.join(root, files[0].target)
    const secondTarget = path.join(root, files[1].target)
    const firstBackup = path.join(
      transaction.backupDirectory,
      files[0].backup,
    )
    const secondBackup = path.join(
      transaction.backupDirectory,
      files[1].backup,
    )
    await writeFile(secondTarget, "new-second")
    await writeFile(firstBackup, "old-first")
    await writeFile(secondBackup, "old-second")

    const crashed = spawnSync(process.execPath, [crashFixturePath], {
      cwd: mcpRoot,
      env: {
        ...process.env,
        PUBLICATION_DIRECTORY: root,
        PUBLICATION_RECOVERY_CRASH_JSON: JSON.stringify({
          transactionId: transaction.id,
          firstBackup: files[0].backup,
          secondTarget: files[1].target,
        }),
      },
      encoding: "utf8",
    })
    assert.equal(
      crashed.status,
      86,
      `rollback did not simulate process death: ${crashed.stderr}`,
    )
    assert.deepEqual(
      await Promise.all([
        readFile(firstTarget, "utf8"),
        readFile(secondTarget, "utf8"),
      ]),
      ["old-first", "new-second"],
    )
    assert.equal(
      (await readTransactionJournal(transaction, fsPromises)).phase,
      "rolling_back",
    )

    await recoverTransactions({
      directory: root,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
    assert.deepEqual(
      await Promise.all([
        readFile(firstTarget, "utf8"),
        readFile(secondTarget, "utf8"),
      ]),
      ["old-first", "old-second"],
    )
    assert.deepEqual(await readdir(coordination.privateRoot), [])
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("durable recovery covers partial backup and incomplete committed states", async () => {

  const partialRoot = await scratchRoot("artifact-partial-backup")
  const restoreHookSteps = []
  try {
    const files = [
      {
        name: "new-only",
        target: "new-only.consumer",
        backup: ".b-0",
        had_prior: false,
      },
      {
        name: "replaced",
        target: "replaced.consumer",
        backup: ".b-1",
        had_prior: true,
      },
    ]
    const { coordination, transaction } = await writeRecoveryState({
      root: partialRoot,
      transactionId: "partial-backup",
      phase: "publishing",
      files,
    })
    await writeFile(path.join(partialRoot, files[0].target), "new-sensitive")
    await writeFile(path.join(partialRoot, files[1].target), "new-replaced")
    await writeFile(
      path.join(transaction.backupDirectory, files[1].backup),
      "old-replaced",
    )
    await recoverTransactions({
      directory: partialRoot,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
      hooks: {
        afterRestoreStep({ index, step }) {
          restoreHookSteps.push(`${index}:${step}`)
        },
      },
    })
    await assert.rejects(
      () => readFile(path.join(partialRoot, files[0].target)),
      (error) => error.code === "ENOENT",
    )
    assert.equal(
      await readFile(path.join(partialRoot, files[1].target), "utf8"),
      "old-replaced",
    )
    assert.deepEqual(restoreHookSteps, [
      "1:target_removed",
      "1:target_linked",
      "1:target_file_synced",
      "1:source_directory_synced",
      "1:backup_removed",
      "1:backup_directory_synced",
    ])
  } finally {
    await cleanupScratchRoot(partialRoot)
  }

  const missingRoot = await scratchRoot("artifact-missing-backup")
  try {
    const { coordination } = await writeRecoveryState({
      root: missingRoot,
      transactionId: "missing-backup",
      phase: "backing_up",
      files: [{
        name: "missing",
        target: "missing.consumer",
        backup: ".b-0",
        had_prior: true,
      }],
    })
    await assert.rejects(
      () => recoverTransactions({
        directory: missingRoot,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
  } finally {
    await cleanupScratchRoot(missingRoot)
  }

  const interruptedRoot = await scratchRoot("artifact-interrupted-rollback")
  try {
    const files = [{
      name: "replaced",
      target: "replaced.consumer",
      backup: ".b-0",
      had_prior: true,
    }]
    const { coordination, transaction } = await writeRecoveryState({
      root: interruptedRoot,
      transactionId: "interrupted-rollback",
      phase: "publishing",
      files,
    })
    const target = path.join(interruptedRoot, files[0].target)
    const backup = path.join(transaction.backupDirectory, files[0].backup)
    await writeFile(backup, "old-replaced")
    await assert.rejects(
      () => recoverTransactions({
        directory: interruptedRoot,
        privateRoot: coordination.privateRoot,
        fileSystem: {
          ...fsPromises,
          async rename(source, destination) {
            if (source === transaction.root) {
              throw new Error("synthetic death before detach")
            }
            return fsPromises.rename(source, destination)
          },
        },
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    assert.equal(await readFile(target, "utf8"), "old-replaced")
    await assert.rejects(
      () => readFile(backup),
      (error) => error.code === "ENOENT",
    )
    await recoverTransactions({
      directory: interruptedRoot,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
    assert.equal(await readFile(target, "utf8"), "old-replaced")
  } finally {
    await cleanupScratchRoot(interruptedRoot)
  }

  const incompleteRoot = await scratchRoot("artifact-incomplete-committed")
  try {
    const files = [
      {
        name: "present",
        target: "present.consumer",
        backup: ".b-0",
        had_prior: false,
      },
      {
        name: "missing",
        target: "missing.consumer",
        backup: ".b-1",
        had_prior: false,
      },
    ]
    const { coordination } = await writeRecoveryState({
      root: incompleteRoot,
      transactionId: "incomplete-committed",
      phase: "committed",
      files,
    })
    await writeFile(path.join(incompleteRoot, files[0].target), "partial-new")
    await recoverTransactions({
      directory: incompleteRoot,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
    assert.deepEqual(await readdir(incompleteRoot), [])
  } finally {
    await cleanupScratchRoot(incompleteRoot)
  }
})

test("journal validation rejects every malformed durable shape", () => {
  const transaction = transactionPaths("/private", "journal-shapes")
  const validFile = {
    name: "primary",
    target: "artifact.bin",
    backup: ".b-0",
    had_prior: null,
  }
  const valid = {
    schema_version: 1,
    sequence: 0,
    transaction_id: transaction.id,
    phase: "preparing",
    files: [validFile],
  }
  assert.doesNotThrow(() => validateJournal(valid, transaction))
  for (const journal of [
    null,
    "journal",
    [],
    {},
    { ...valid, extra: true },
    { ...valid, schema_version: 2 },
    { ...valid, sequence: -1 },
    { ...valid, sequence: "0" },
    { ...valid, transaction_id: "other" },
    { ...valid, phase: "unknown" },
    { ...valid, files: [] },
    { ...valid, files: [null] },
    { ...valid, files: ["file"] },
    { ...valid, files: [{ ...validFile, extra: true }] },
    { ...valid, files: [{ ...validFile, name: 1 }] },
    { ...valid, files: [{ ...validFile, target: "../target" }] },
    { ...valid, files: [{ ...validFile, target: "" }] },
    { ...valid, files: [{ ...validFile, target: 1 }] },
    { ...valid, files: [{ ...validFile, target: "nested/target" }] },
    { ...valid, files: [{ ...validFile, target: "nested\\target" }] },
    { ...valid, files: [{ ...validFile, target: ".." }] },
    { ...valid, files: [{ ...validFile, backup: "../backup" }] },
    { ...valid, files: [{ ...validFile, had_prior: "yes" }] },
    { ...valid, files: [validFile, { ...validFile }] },
    {
      ...valid,
      files: [validFile, {
        ...validFile,
        target: "other.bin",
      }],
    },
    {
      ...valid,
      phase: "backing_up",
    },
  ]) {
    assert.throws(
      () => validateJournal(journal, transaction),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
  }
})

test("publication platform helpers fail closed across supported owner evidence", async () => {
  assert.equal(
    canonicalDirectoryIdentity("C:\\Repo\\Artifacts", {
      platform: "win32",
      realpath: () => "C:\\Repo\\Artifacts",
    }),
    canonicalDirectoryIdentity("c:\\repo\\ARTIFACTS", {
      platform: "win32",
      realpath: () => "C:\\Repo\\Artifacts",
    }),
  )
  assert.equal(
    canonicalDirectoryIdentity("C:\\Repo\\Missing\\Artifacts", {
      platform: "win32",
      realpath(value) {
        if (value.toLowerCase() === "c:\\repo") return "C:\\ActualRepo"
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
    }),
    "c:\\actualrepo\\missing\\artifacts",
  )
  assert.throws(
    () => canonicalDirectoryIdentity("/denied", {
      realpath() {
        const error = new Error("private path")
        error.code = "EACCES"
        throw error
      },
    }),
    (error) =>
      error.code === "artifact_publication_identity_unavailable" &&
      !error.message.includes("/denied"),
  )
  assert.throws(
    () => canonicalDirectoryIdentity("/", {
      realpath() {
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
    }),
    (error) => error.code === "artifact_publication_identity_unavailable",
  )

  assert.equal(
    processStartEvidence(7, {
      platform: "linux",
      readFile: () => `7 (node) ${[
        ...Array.from({ length: 19 }, () => "0"),
        "12345",
      ].join(" ")}`,
    }),
    "linux:12345",
  )
  assert.equal(processStartEvidence(7, {
    platform: "linux",
    readFile() {
      throw new Error("missing proc")
    },
  }), null)
  assert.equal(processStartEvidence(7, {
    platform: "darwin",
    spawn: () => ({ status: 0, stdout: "Mon Aug 24 00:00:00 2026\n" }),
  }), "darwin:Mon Aug 24 00:00:00 2026")
  assert.equal(processStartEvidence(7, {
    platform: "darwin",
    spawn: () => ({ status: 1, stdout: "" }),
  }), null)
  assert.equal(processStartEvidence(7, {
    platform: "win32",
    spawn: () => ({ status: 0, stdout: "123\n" }),
  }), "win32:123")
  assert.equal(processStartEvidence(7, {
    platform: "win32",
    spawn: () => ({ status: 1, stdout: "" }),
  }), null)
  assert.equal(processStartEvidence(7, {
    platform: "other",
    kill() {},
  }), "pid:7")
  assert.equal(processStartEvidence(7, {
    platform: "other",
    kill() {
      throw new Error("dead")
    },
  }), null)

  const liveOwner = {
    schema_version: 1,
    pid: 7,
    process_start: "start",
    owner_token: "live-owner",
    created_at: "2026-08-24T00:00:00.000Z",
  }
  assert.equal(lockOwnerStatus(liveOwner, {
    getProcessStart: () => "start",
  }), "live")
  assert.equal(lockOwnerStatus(liveOwner, {
    getProcessStart: () => "other",
  }), "dead")
  assert.equal(lockOwnerStatus(liveOwner, {
    getProcessStart: () => null,
    exists: () => false,
  }), "dead")
  assert.equal(lockOwnerStatus(liveOwner, {
    getProcessStart: () => null,
    exists: () => true,
  }), "unknown")
  assert.equal(lockOwnerStatus({
    ...liveOwner,
    process_start: null,
  }, {
    exists: () => false,
  }), "unknown")
  assert.equal(lockOwnerStatus({
    ...liveOwner,
    process_start: null,
  }, {
    exists: () => true,
  }), "unknown")
  assert.equal(processExists(7, { kill() {} }), true)
  assert.equal(processExists(7, {
    kill() {
      const error = new Error("missing")
      error.code = "ESRCH"
      throw error
    },
  }), false)
  assert.equal(processExists(7, {
    kill() {
      const error = new Error("denied")
      error.code = "EPERM"
      throw error
    },
  }), null)
  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/lock",
      fileSystem: {},
      processStart: () => null,
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    (error) => error.code === "artifact_publication_identity_unavailable",
  )
  for (const owner of [
    null,
    [],
    {},
    { ...liveOwner, pid: 0 },
    { ...liveOwner, pid: "7" },
    { ...liveOwner, process_start: "" },
    { ...liveOwner, process_start: 1 },
  ]) {
    assert.equal(lockOwnerStatus(owner), "unknown")
  }

  assert.equal(
    coordinationLockBase({
      env: { DESK_ARTIFACT_COORDINATION_DIR: "./coordination" },
    }),
    path.resolve("./coordination"),
  )
  assert.equal(
    coordinationLockBase({
      env: { DESK_ARTIFACT_COORDINATION_DIR: " " },
      platform: "linux",
      home: () => "/home/unit",
    }),
    path.join(
      "/home/unit",
      ".cache",
      "ouroboros-skills",
      "artifact-publication",
    ),
  )
  assert.equal(
    coordinationLockBase({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\cache" },
    }),
    path.join("C:\\cache", "ouroboros-skills", "artifact-publication"),
  )
  assert.equal(
    coordinationLockBase({
      platform: "linux",
      env: { XDG_CACHE_HOME: "/cache" },
    }),
    path.join("/cache", "ouroboros-skills", "artifact-publication"),
  )
  assert.equal(
    coordinationLockBase({
      platform: "linux",
      env: {},
      home: () => "/home/unit",
    }),
    path.join(
      "/home/unit",
      ".cache",
      "ouroboros-skills",
      "artifact-publication",
    ),
  )
  assert.equal(
    coordinationLockBase({
      platform: "win32",
      env: { LOCALAPPDATA: " ", XDG_CACHE_HOME: "/cache" },
    }),
    path.join("/cache", "ouroboros-skills", "artifact-publication"),
  )

  for (const code of ["EACCES", "EINVAL", "EPERM"]) {
    await assert.doesNotReject(() => fsyncDirectory("/directory", {
      async open() {
        const error = new Error("unsupported directory sync")
        error.code = code
        throw error
      },
    }, { platform: "win32" }))
  }
  await assert.rejects(
    () => fsyncDirectory("/directory", {
      async open() {
        const error = new Error("sync denied")
        error.code = "EACCES"
        throw error
      },
    }, { platform: "linux" }),
    /sync denied/u,
  )
  let fileClosed = false
  await fsyncFile("/artifact", {
    async open() {
      return {
        async close() {
          fileClosed = true
        },
      }
    },
  })
  assert.equal(fileClosed, true)
})

test("publication private-path helpers reject symlinks and reclaim stale locks safely", async () => {
  const calls = []
  await makePrivateDirectory("/private", {
    async mkdir() {
      calls.push("mkdir")
    },
    async chmod() {
      calls.push("chmod")
    },
  })
  assert.deepEqual(calls, ["mkdir", "chmod"])
  for (const stat of [
    { isDirectory: () => false, isSymbolicLink: () => false },
    { isDirectory: () => true, isSymbolicLink: () => true },
  ]) {
    await assert.rejects(
      () => makePrivateDirectory("/private", {
        async mkdir() {},
        async lstat() {
          return stat
        },
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
  }

  const stableOwner = JSON.stringify({
    schema_version: 1,
    pid: 7,
    process_start: "start",
    owner_token: "stable",
    created_at: "2026-08-24T00:00:00.000Z",
  })
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {},
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{"
      },
      async rename() {},
    },
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{"
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async rename() {},
    },
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{"
      },
      async stat() {
        return { mtimeMs: Date.now() }
      },
      async rename() {},
    },
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{"
      },
      async stat() {
        throw new Error("stat failed")
      },
      async rename() {},
    },
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{}"
      },
      async rename() {
        const error = new Error("gone")
        error.code = "ENOENT"
        throw error
      },
      async rm() {},
    },
    ownerProbe: () => false,
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return "{"
      },
      async rename() {
        const error = new Error("gone")
        error.code = "ENOENT"
        throw error
      },
    },
    ownerProbe: () => "dead",
    malformedLockStaleMs: 100,
  }), true)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return stableOwner
      },
      async rename() {
        const error = new Error("gone")
        error.code = "ENOENT"
        throw error
      },
    },
    ownerProbe: () => "dead",
    malformedLockStaleMs: 100,
  }), true)
  let tornClaimReads = 0
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        tornClaimReads += 1
        return tornClaimReads === 1 ? stableOwner : "{"
      },
      async rename() {},
      async link() {},
      async rm() {},
    },
    ownerProbe: () => "dead",
    malformedLockStaleMs: 100,
  }), false)
  let replacedClaimReads = 0
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        replacedClaimReads += 1
        return replacedClaimReads === 1
          ? stableOwner
          : JSON.stringify({
              ...JSON.parse(stableOwner),
              owner_token: "replacement",
            })
      },
      async rename() {},
      async link() {},
      async rm() {},
    },
    ownerProbe: () => "dead",
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return stableOwner
      },
      async rename() {},
      async link() {},
      async rm() {},
    },
    ownerProbe: () => "unknown",
    malformedLockStaleMs: 100,
  }), false)
  assert.equal(await staleLockCanBeReclaimed({
    lockPath: "/lock",
    fileSystem: {
      async readFile() {
        return stableOwner
      },
      async rename() {},
      async rm() {},
    },
    ownerProbe: () => "dead",
    malformedLockStaleMs: 100,
  }), true)
  assert.equal(sameLockOwner(
    {
      schema_version: 1,
      pid: 7,
      process_start: "start",
      owner_token: "token",
      created_at: "2026-08-24T00:00:00.000Z",
    },
    {
      schema_version: 1,
      pid: 7,
      process_start: "start",
      owner_token: "token",
      created_at: "2026-08-24T00:00:00.000Z",
    },
  ), true)
  assert.equal(sameLockOwner({ owner_token: "one" }, {
    owner_token: "two",
  }), false)
})

test("lock release refuses to remove a replacement owner", async () => {
  let writtenOwner
  const removed = []
  const release = await acquirePublicationLock({
    lockPath: "/lock",
    fileSystem: {
      async open() {
        return {
          async writeFile(value) {
            writtenOwner = JSON.parse(value)
          },
          async sync() {},
          async close() {},
        }
      },
      async readFile() {
        return JSON.stringify({
          ...writtenOwner,
          owner_token: "replacement-token",
        })
      },
      async rename() {},
      async link() {},
      async rm(target) {
        removed.push(target)
      },
    },
    lockRetryMs: 0,
    lockTimeoutMs: 0,
  })
  await assert.rejects(
    release,
    (error) =>
      error instanceof AggregateError &&
      error.errors[0]?.code === "artifact_publication_lock_ownership_lost",
  )
  assert.equal(removed.includes("/lock"), false)
  assert.equal(removed.some((target) => target.includes(".claim-")), false)
})

test("lock claim helpers cover quarantine recovery and ownership failures", async () => {
  const owner = {
    schema_version: 1,
    pid: 7,
    process_start: "start",
    owner_token: "owner-token",
    created_at: "2026-08-24T00:00:00.000Z",
  }
  assert.equal(await claimLockPath("/lock", {
    async rename() {
      const error = new Error("missing")
      error.code = "ENOENT"
      throw error
    },
  }), null)
  await assert.rejects(
    () => claimLockPath("/lock", {
      async rename() {
        const error = new Error("denied")
        error.code = "EACCES"
        throw error
      },
    }),
    /denied/u,
  )

  assert.equal(await findOwnedClaim({
    lockPath: "/lock",
    owner,
    fileSystem: {},
  }), null)
  assert.equal(await findOwnedClaim({
    lockPath: "/lock",
    owner,
    fileSystem: {
      async readdir() {
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
      async readFile() {},
    },
  }), null)
  await assert.rejects(
    () => findOwnedClaim({
      lockPath: "/lock",
      owner,
      fileSystem: {
        async readdir() {
          throw new Error("claims denied")
        },
        async readFile() {},
      },
    }),
    /claims denied/u,
  )
  const found = await findOwnedClaim({
    lockPath: "/locks/lock",
    owner,
    fileSystem: {
      async readdir() {
        return [
          "unrelated",
          "lock.claim-malformed",
          "lock.claim-owned",
        ]
      },
      async readFile(target) {
        return target.endsWith("malformed")
          ? "{"
          : JSON.stringify(owner)
      },
    },
  })
  assert.equal(found, "/locks/lock.claim-owned")

  assert.equal(await hasLockClaims("/lock", {}), false)
  assert.equal(await hasLockClaims("/locks/lock", {
    async readdir() {
      return ["unrelated", "lock.claim-one"]
    },
  }), true)
  assert.equal(await hasLockClaims("/locks/lock", {
    async readdir() {
      return ["unrelated"]
    },
  }), false)
  assert.equal(await hasLockClaims("/locks/lock", {
    async readdir() {
      const error = new Error("missing")
      error.code = "ENOENT"
      throw error
    },
  }), false)
  await assert.rejects(
    () => hasLockClaims("/locks/lock", {
      async readdir() {
        throw new Error("claim list denied")
      },
    }),
    /claim list denied/u,
  )

  const removed = []
  await removeOwnedLock({
    lockPath: "/locks/lock",
    owner,
    fileSystem: {
      async readdir() {
        return ["lock.claim-owned"]
      },
      async readFile() {
        return JSON.stringify(owner)
      },
      async rm(target) {
        removed.push(target)
      },
    },
  })
  assert.deepEqual(removed, ["/locks/lock.claim-owned"])
  await assert.rejects(
    () => removeOwnedLock({
      lockPath: "/locks/lock",
      owner,
      fileSystem: {
        async readdir() {
          return []
        },
        async readFile() {},
        async rename() {
          const error = new Error("missing")
          error.code = "ENOENT"
          throw error
        },
      },
    }),
    (error) => error.code === "artifact_publication_lock_ownership_lost",
  )
  await assert.rejects(
    () => removeOwnedLock({
      lockPath: "/locks/lock",
      owner,
      fileSystem: {
        async readdir() {
          return []
        },
        async rename() {},
        async readFile() {
          return "{"
        },
        async link() {},
        async rm() {},
      },
    }),
    (error) => error.code === "artifact_publication_lock_ownership_lost",
  )

  await assert.rejects(
    () => waitForPublicationLock({
      startedAt: 0,
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    (error) => error.code === "artifact_publication_lock_timeout",
  )
})

test("orphaned quarantine claims recover without admitting a competing owner", async () => {
  assert.equal(await recoverLockClaims({
    lockPath: "/lock",
    fileSystem: {},
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), true)
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      },
      async readFile() {},
    },
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), true)
  await assert.rejects(
    () => recoverLockClaims({
      lockPath: "/locks/lock",
      fileSystem: {
        async readdir() {
          throw new Error("claims denied")
        },
        async readFile() {},
      },
      ownerProbe: () => "dead",
      staleAfterMs: 100,
    }),
    /claims denied/u,
  )

  const youngOwner = JSON.stringify({
    schema_version: 1,
    pid: 7,
    process_start: "start",
    owner_token: "young-owner",
    created_at: "2026-08-24T00:00:00.000Z",
  })
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["lock.claim-young"]
      },
      async stat() {
        return { mtimeMs: Date.now() }
      },
      async readFile() {
        return youngOwner
      },
    },
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), false)

  const removed = []
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["unrelated", "lock.claim-malformed"]
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async readFile(target) {
        throw new Error("torn claim")
      },
      async rm(target) {
        removed.push(target)
      },
    },
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), false)
  assert.equal(removed.length, 0)
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["lock.claim-partial"]
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async readFile() {
        return JSON.stringify({ pid: 7 })
      },
      async rm(target) {
        removed.push(target)
      },
    },
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), false)
  assert.equal(removed.length, 0)
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["lock.claim-dead"]
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async readFile() {
        return youngOwner
      },
      async rm(target) {
        removed.push(target)
      },
    },
    ownerProbe: () => "dead",
    staleAfterMs: 100,
  }), true)
  assert.equal(removed.length, 1)

  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["lock.claim-live"]
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async readFile() {
        return youngOwner
      },
      async rm() {},
    },
    ownerProbe: () => "live",
    staleAfterMs: 100,
  }), false)

  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: {
      async readdir() {
        return ["lock.claim-live"]
      },
      async stat() {
        return { mtimeMs: 0 }
      },
      async readFile() {
        return youngOwner
      },
      async link() {
        const error = new Error("replacement exists")
        error.code = "EEXIST"
        throw error
      },
    },
    ownerProbe: () => "unknown",
    staleAfterMs: 100,
  }), false)

  const liveOwner = {
    schema_version: 1,
    pid: 7,
    process_start: "start",
    owner_token: "live-claim-owner",
    created_at: "2026-08-24T00:00:00.000Z",
  }
  const liveClaimPath = "/locks/lock.claim-live-owner"
  const liveClaims = new Map([
    [liveClaimPath, JSON.stringify(liveOwner)],
  ])
  const liveClaimFileSystem = {
    async readdir() {
      return [...liveClaims.keys()].map((target) => path.basename(target))
    },
    async stat() {
      return { mtimeMs: 0 }
    },
    async readFile(target) {
      return liveClaims.get(target)
    },
    async rm(target) {
      liveClaims.delete(target)
    },
  }
  assert.equal(await recoverLockClaims({
    lockPath: "/locks/lock",
    fileSystem: liveClaimFileSystem,
    ownerProbe: () => "live",
    staleAfterMs: 100,
  }), false)
  assert.equal(liveClaims.has(liveClaimPath), true)
  await removeOwnedLock({
    lockPath: "/locks/lock",
    owner: liveOwner,
    fileSystem: liveClaimFileSystem,
  })
  assert.equal(liveClaims.size, 0)
})

test("acquisition waits for young claims and retries claims racing initialization", async () => {
  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/locks/lock",
      fileSystem: {
        async readdir() {
          return ["lock.claim-young"]
        },
        async readFile() {
          return "{}"
        },
        async stat() {
          return { mtimeMs: Date.now() }
        },
      },
      ownerProbe: () => "unknown",
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    (error) => error.code === "artifact_publication_lock_timeout",
  )

  let claimListings = 0
  const waitingFileSystem = {
    async readdir() {
      claimListings += 1
      return claimListings === 1 ? ["lock.claim-young"] : []
    },
    async readFile(target) {
      if (target.includes(".claim-")) {
        return waitingFileSystem.claimOwner ?? "{}"
      }
      return waitingFileSystem.owner
    },
    async stat() {
      return { mtimeMs: Date.now() }
    },
    async open() {
      return {
        async writeFile(value) {
          waitingFileSystem.owner = value
        },
        async sync() {},
        async close() {},
      }
    },
    async rename(_source, target) {
      waitingFileSystem.claimPath = target
      waitingFileSystem.claimOwner = waitingFileSystem.owner
      waitingFileSystem.owner = undefined
    },
    async link() {},
    async rm() {},
  }
  const waitingRelease = await acquirePublicationLock({
    lockPath: "/locks/lock",
    fileSystem: waitingFileSystem,
    ownerProbe: () => "unknown",
    lockRetryMs: 0,
    lockTimeoutMs: 1000,
  })
  await waitingRelease()

  const claims = new Map()
  let mainOwner
  let ownerFile
  let firstWrite = true
  const deadOwner = JSON.stringify({
    schema_version: 1,
    pid: 99999999,
    process_start: "dead",
    owner_token: "dead-claim",
    created_at: "2026-08-24T00:00:00.000Z",
  })
  const fileSystem = {
    async readdir() {
      return [...claims.keys()].map((claimPath) => path.basename(claimPath))
    },
    async stat() {
      return { mtimeMs: 0 }
    },
    async open() {
      return {
        async writeFile(value) {
          ownerFile = value
        },
        async sync() {},
        async close() {},
      }
    },
    async rename(source, target) {
      if (source !== "/locks/lock" || mainOwner === undefined) {
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      }
      claims.set(target, mainOwner)
      mainOwner = undefined
    },
    async readFile(target) {
      if (target === "/locks/lock") return mainOwner
      const value = claims.get(target)
      if (value === undefined) {
        const error = new Error("missing")
        error.code = "ENOENT"
        throw error
      }
      return value
    },
    async rm(target) {
      claims.delete(target)
    },
    async link(_source, target) {
      if (target === "/locks/lock") {
        mainOwner = ownerFile
        if (firstWrite) {
          firstWrite = false
          claims.set("/locks/lock.claim-race", deadOwner)
        }
      }
    },
  }
  const release = await acquirePublicationLock({
    lockPath: "/locks/lock",
    fileSystem,
    ownerProbe: () => "dead",
    lockRetryMs: 0,
    lockTimeoutMs: 1000,
  })
  await release()
  assert.equal(mainOwner, undefined)
  assert.deepEqual([...claims.keys()], [])
})

test("lock initialization cleans a partial owner record before publication", async () => {
  let removedOwner = false
  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/lock",
      fileSystem: {
        async open() {
          return {
            async writeFile() {
              throw new Error("owner write failed")
            },
            async close() {},
          }
        },
        async rm(target) {
          if (target.includes(".owner-")) removedOwner = true
        },
      },
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    /owner write failed/u,
  )
  assert.equal(removedOwner, true)

  let linkedOwner
  await assert.rejects(
    () => acquirePublicationLock({
      lockPath: "/lock",
      fileSystem: {
        async open() {
          return {
            async writeFile(value) {
              linkedOwner = value
            },
            async sync() {},
            async close() {},
          }
        },
        async link() {
          const error = new Error("link denied")
          error.code = "EACCES"
          throw error
        },
        async rm() {},
      },
      lockRetryMs: 0,
      lockTimeoutMs: 0,
    }),
    /link denied/u,
  )

  for (const cleanupFails of [false, true]) {
    let ownerCleanup = true
    await assert.rejects(
      () => acquirePublicationLock({
        lockPath: "/lock",
        fileSystem: {
          async open() {
            return {
              async writeFile(value) {
                linkedOwner = value
              },
              async sync() {},
              async close() {},
            }
          },
          async link() {},
          async readdir() {
            return []
          },
          async rename() {},
          async readFile() {
            return linkedOwner
          },
          async rm(target) {
            if (ownerCleanup && target.includes(".owner-")) {
              ownerCleanup = false
              throw new Error("owner cleanup failed")
            }
            if (cleanupFails && target.includes(".claim-")) {
              throw new Error("claimed cleanup failed")
            }
          },
        },
        lockRetryMs: 0,
        lockTimeoutMs: 0,
      }),
      cleanupFails ? AggregateError : /owner cleanup failed/u,
    )
  }
})

test("publication cleanup and journal readers cover missing and torn private state", async () => {
  await assert.doesNotReject(() => sanitizeAndRemoveDirectory("/missing", {
    async readdir() {
      const error = new Error("missing")
      error.code = "ENOENT"
      throw error
    },
  }))
  await assert.rejects(
    () => sanitizeAndRemoveDirectory("/denied", {
      async readdir() {
        const error = new Error("denied")
        error.code = "EACCES"
        throw error
      },
    }),
    /denied/u,
  )
  await assert.doesNotReject(() => removePrivateRootIfEmpty("/missing", {
    async readdir() {
      const error = new Error("missing")
      error.code = "ENOENT"
      throw error
    },
  }))
  await assert.rejects(
    () => removePrivateRootIfEmpty("/denied", {
      async readdir() {
        throw new Error("cleanup denied")
      },
    }),
    /cleanup denied/u,
  )
  let removed = false
  await removePrivateRootIfEmpty("/empty", {
    async readdir() {
      return []
    },
    async rmdir() {
      removed = true
    },
    async open() {
      return {
        async sync() {},
        async close() {},
      }
    },
  })
  assert.equal(removed, true)
  removed = false
  await removePrivateRootIfEmpty("/nonempty", {
    async readdir() {
      return ["transaction"]
    },
    async rmdir() {
      removed = true
    },
  })
  assert.equal(removed, false)

  const transaction = transactionPaths("/private", "journal-reader")
  await assert.rejects(
    () => readTransactionJournal(transaction, {
      async readdir() {
        throw new Error("missing transaction")
      },
    }),
    (error) => error.code === "artifact_publication_recovery_failed",
  )
  const validJournal = {
    schema_version: 1,
    sequence: 0,
    transaction_id: transaction.id,
    phase: "preparing",
    files: [{
      name: "primary",
      target: "artifact.bin",
      backup: ".b-0",
      had_prior: null,
    }],
  }
  const journal = await readTransactionJournal(transaction, {
    async readdir() {
      return [
        { isFile: () => true, name: "journal.1.json" },
        { isFile: () => true, name: "journal.0.json" },
        { isFile: () => false, name: "ignored" },
      ]
    },
    async readFile(target) {
      return target.endsWith("journal.1.json")
        ? "{"
        : JSON.stringify(validJournal)
    },
  })
  assert.equal(journal.sequence, 0)
  const mismatchedThenValid = await readTransactionJournal(transaction, {
    async readdir() {
      return [
        { isFile: () => true, name: "journal.1.json" },
        { isFile: () => true, name: "journal.0.json" },
      ]
    },
    async readFile(target) {
      return target.endsWith("journal.1.json")
        ? JSON.stringify({ ...validJournal, sequence: 0 })
        : JSON.stringify(validJournal)
    },
  })
  assert.equal(mismatchedThenValid.sequence, 0)

  assert.equal(
    path.basename(transactionPaths("/private", "../unsafe").root),
    `.tx-${createHash("sha256").update("../unsafe").digest("hex")}`,
  )
  const pathError = new Error("private path")
  pathError.code = "EACCES"
  pathError.path = "/private/path"
  const safe = safePublicationError(pathError)
  assert.equal(safe.code, "EACCES")
  assert.doesNotMatch(safe.message, /private/u)
  const ordinary = new Error("ordinary")
  assert.equal(safePublicationError(ordinary), ordinary)
  const noCodePathError = new Error("private path without code")
  noCodePathError.path = "/private/path"
  assert.equal(
    safePublicationError(noCodePathError).code,
    "artifact_publication_failed",
  )
})

test("secure cleanup never follows symlinks or overwrites multi-link files", async () => {
  const root = await scratchRoot("artifact-secure-cleanup-links")
  const cleanupRoot = path.join(root, "cleanup")
  const externalSymlinkTarget = path.join(root, "external-symlink-target")
  const externalHardlinkTarget = path.join(root, "external-hardlink-target")
  try {
    await mkdir(cleanupRoot, { recursive: true })
    await writeFile(externalSymlinkTarget, "external symlink bytes")
    await writeFile(externalHardlinkTarget, "external hardlink bytes")
    await fsPromises.symlink(
      externalSymlinkTarget,
      path.join(cleanupRoot, "linked-backup"),
    )
    await fsPromises.link(
      externalHardlinkTarget,
      path.join(cleanupRoot, "hardlinked-backup"),
    )
    await writeFile(
      path.join(cleanupRoot, "private-backup"),
      "private backup bytes",
    )

    await sanitizeAndRemoveDirectory(cleanupRoot, fsPromises)

    assert.equal(
      await readFile(externalSymlinkTarget, "utf8"),
      "external symlink bytes",
    )
    assert.equal(
      await readFile(externalHardlinkTarget, "utf8"),
      "external hardlink bytes",
    )
    await assert.rejects(
      () => fsPromises.access(cleanupRoot),
      (error) => error.code === "ENOENT",
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})

test("secure cleanup fails closed on no-follow races and inode replacement", async () => {
  let removed = 0
  await assert.doesNotReject(() => secureRemoveFile("/no-lstat", {
    async rm() {
      removed += 1
    },
  }))
  assert.equal(removed, 1)
  let openFlags
  await assert.doesNotReject(() => secureRemoveFile("/no-follow-unsupported", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        dev: 1,
        ino: 1,
      }
    },
    async open(_target, flags) {
      openFlags = flags
      return {
        async stat() {
          return {
            isFile: () => true,
            nlink: 1,
            dev: 1,
            ino: 1,
            size: 0,
          }
        },
        async close() {},
      }
    },
    async rm() {
      removed += 1
    },
  }, { noFollowFlag: null }))
  assert.equal(openFlags, fsConstants.O_RDWR)
  assert.equal(removed, 2)
  await assert.doesNotReject(() => secureRemoveFile("/link-race", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
      }
    },
    async open() {
      const error = new Error("symlink race")
      error.code = "ELOOP"
      throw error
    },
    async rm() {
      removed += 1
    },
  }))
  assert.equal(removed, 3)
  await assert.rejects(
    () => secureRemoveFile("/open-denied", {
      async lstat() {
        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          nlink: 1,
        }
      },
      async open() {
        const error = new Error("open denied")
        error.code = "EACCES"
        throw error
      },
      async rm() {
        removed += 1
      },
    }),
    /open denied/u,
  )
  assert.equal(removed, 4)

  let closed = false
  await assert.doesNotReject(() => secureRemoveFile("/inode-race", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        dev: 1,
        ino: 1,
      }
    },
    async open() {
      return {
        async stat() {
          return {
            isFile: () => true,
            nlink: 1,
            dev: 1,
            ino: 2,
          }
        },
        async close() {
          closed = true
        },
      }
    },
    async rm() {
      removed += 1
    },
  }))
  assert.equal(closed, true)
  assert.equal(removed, 5)

  let pathnameUnlinked = false
  let writes = 0
  let statReads = 0
  await secureRemoveFile("/private-backup", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        dev: 1,
        ino: 1,
      }
    },
    async open() {
      return {
        async stat() {
          statReads += 1
          return {
            isFile: () => true,
            nlink: statReads === 1 ? 1 : 0,
            dev: 1,
            ino: 1,
            size: 4,
          }
        },
        async chmod() {},
        async write() {
          assert.equal(pathnameUnlinked, true)
          writes += 1
        },
        async sync() {},
        async close() {},
      }
    },
    async rm() {
      pathnameUnlinked = true
    },
  }, { platform: "linux" })
  assert.equal(writes, 1)

  writes = 0
  statReads = 0
  await secureRemoveFile("/hardlink-race", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        dev: 1,
        ino: 1,
      }
    },
    async open() {
      return {
        async stat() {
          statReads += 1
          return {
            isFile: () => true,
            nlink: 1,
            dev: 1,
            ino: 1,
            size: 4,
          }
        },
        async write() {
          writes += 1
        },
        async close() {},
      }
    },
    async rm() {},
  }, { platform: "linux" })
  assert.equal(statReads, 2)
  assert.equal(writes, 0)

  let windowsClosed = false
  await secureRemoveFile("/windows-unlink-only", {
    async lstat() {
      return {
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        dev: 1,
        ino: 1,
      }
    },
    async open() {
      return {
        async stat() {
          return {
            isFile: () => true,
            nlink: 1,
            dev: 1,
            ino: 1,
            size: 4,
          }
        },
        async write() {
          assert.fail("Windows cleanup must not overwrite an open inode")
        },
        async close() {
          windowsClosed = true
        },
      }
    },
    async rm() {},
  }, { platform: "win32" })
  assert.equal(windowsClosed, true)
})

test("publication retry helper covers terminal branches", async () => {
  await assert.rejects(
    () => __artifactPublicationInternalsForTests.renameWithRetry({
      source: "/source",
      target: "/target",
      fileSystem: {
        async rename() {
          const error = new Error("not found")
          error.code = "ENOENT"
          throw error
        },
      },
      renameRetryMs: 0,
      renameRetryLimit: 2,
    }),
    /not found/u,
  )
  let attempts = 0
  await assert.rejects(
    () => __artifactPublicationInternalsForTests.renameWithRetry({
      source: "/source",
      target: "/target",
      fileSystem: {
        async rename() {
          attempts += 1
          const error = new Error("busy")
          error.code = "EBUSY"
          throw error
        },
      },
      renameRetryMs: 0,
      renameRetryLimit: 1,
    }),
    /busy/u,
  )
  assert.equal(attempts, 2)
})

test("recovery sorts multiple transactions and rejects missing published backups", async () => {
  const root = await scratchRoot("artifact-multiple-recovery")
  const coordination = coordinationPaths(root)
  try {
    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: {
          async readdir() {
            const error = new Error("recovery denied")
            error.code = "EACCES"
            throw error
          },
        },
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    for (const garbageId of ["z-crashed-cleanup", "a-crashed-cleanup"]) {
      const crashedGarbage = path.join(
        coordination.privateRoot,
        `.gc-${garbageId}`,
        ".backups",
      )
      await mkdir(crashedGarbage, { recursive: true })
      await writeFile(
        path.join(crashedGarbage, "sensitive-backup"),
        "sensitive old vector bytes",
      )
    }
    for (const id of ["z-transaction", "a-transaction"]) {
      const transaction = transactionPaths(coordination.privateRoot, id)
      await mkdir(transaction.stageDirectory, { recursive: true })
      await mkdir(transaction.backupDirectory, { recursive: true })
      await writeFile(transaction.journalPath, `${JSON.stringify({
        schema_version: 1,
        sequence: 0,
        transaction_id: transaction.id,
        phase: "preparing",
        files: [{
          name: "primary",
          target: `${id}.bin`,
          backup: ".b-0",
          had_prior: null,
        }],
      })}\n`)
    }
    await recoverTransactions({
      directory: root,
      privateRoot: coordination.privateRoot,
      fileSystem: fsPromises,
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
    assert.deepEqual(await readdir(coordination.privateRoot), [])

    const transaction = transactionPaths(
      coordination.privateRoot,
      "missing-published-backup",
    )
    await mkdir(transaction.stageDirectory, { recursive: true })
    await mkdir(transaction.backupDirectory, { recursive: true })
    await writeFile(transaction.journalPath, `${JSON.stringify({
      schema_version: 1,
      sequence: 0,
      transaction_id: transaction.id,
      phase: "publishing",
      files: [{
        name: "primary",
        target: "missing.bin",
        backup: ".b-0",
        had_prior: true,
      }],
    })}\n`)
    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: coordination.privateRoot,
        fileSystem: fsPromises,
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
    await assert.rejects(
      () => recoverTransactions({
        directory: root,
        privateRoot: "/private",
        fileSystem: {
          async readdir(target) {
            if (target === "/private") {
              return [{
                isDirectory: () => true,
                name: ".gc-cleanup-failure",
              }]
            }
            const error = new Error("garbage cleanup denied")
            error.code = "EACCES"
            throw error
          },
        },
        renameRetryMs: 0,
        renameRetryLimit: 0,
      }),
      (error) => error.code === "artifact_publication_recovery_failed",
    )
  } finally {
    await cleanupScratchRoot(root)
  }
})
