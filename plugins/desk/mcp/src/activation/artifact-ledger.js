import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"

const LEDGER_SCHEMA_VERSION = 1
const OWNED_ACTIVATION_BLOCK_PATTERN = /(?:\r?\n)?# BEGIN desk activation: [^\r\n]* owner=desk-activation\r?\n[\s\S]*?# END desk activation\r?\n?/u

export function applyActivationArtifacts(request) {
  const snapshots = [
    snapshotHostFile(request.hostRoot, request.ledgerPath),
  ]
  const ledgerArtifacts = []

  try {
    for (const artifact of request.artifacts) {
      snapshots.push(snapshotHostFile(request.hostRoot, artifact.path))
      writeHostFile(request.hostRoot, artifact.path, artifact.content)
      ledgerArtifacts.push({
        owner: artifact.owner,
        kind: artifact.kind,
        path: artifact.path,
        content_sha256: sha256(artifact.content),
        updated_at: request.now,
      })
    }

    const ledger = {
      schema_version: LEDGER_SCHEMA_VERSION,
      owner: request.activation.owner,
      activation: {
        id: request.activation.id,
        version: request.activation.version,
        host: request.activation.host,
        mode: request.activation.mode,
        generated_by: request.activation.generatedBy,
      },
      never_delete: request.neverDelete,
      artifacts: ledgerArtifacts,
      updated_at: request.now,
    }

    writeHostFile(request.hostRoot, request.ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`)
    return { ledger }
  } catch (error) {
    rollbackSnapshots(snapshots)
    throw new Error("activation apply failed; rolled back generated artifacts", { cause: error })
  }
}

export function readActivationLedger({ hostRoot, ledgerPath }) {
  let content
  try {
    content = readFileSync(hostPath(hostRoot, ledgerPath), "utf8")
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`activation ledger missing: ${ledgerPath}`, { cause: error })
    }
    throw error
  }

  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`activation ledger corrupt: ${ledgerPath}`, { cause: error })
  }
}

export function deactivateActivationArtifacts({ hostRoot, ledgerPath }) {
  if (!existsSync(hostPath(hostRoot, ledgerPath))) {
    return {
      removed: [],
      skipped: [
        {
          path: ledgerPath,
          kind: "activation-ledger",
          reason: "missing-ledger",
        },
      ],
    }
  }

  const ledger = readActivationLedger({ hostRoot, ledgerPath })
  const neverDelete = new Set(ledger.never_delete)
  const changedArtifacts = findChangedArtifacts({ hostRoot, ledger, neverDelete })
  if (changedArtifacts.length > 0) {
    return {
      removed: [],
      skipped: changedArtifacts,
    }
  }

  const removed = []
  const skipped = []

  for (const artifact of ledger.artifacts) {
    if (neverDelete.has(artifact.kind)) {
      skipped.push({
        path: artifact.path,
        kind: artifact.kind,
        reason: "never-delete",
      })
    } else {
      const fileContent = readFileSync(hostPath(hostRoot, artifact.path), "utf8")
      writeHostFile(hostRoot, artifact.path, stripOwnedActivationBlock(fileContent))
      removed.push({
        path: artifact.path,
        kind: artifact.kind,
      })
    }
  }

  rmSync(hostPath(hostRoot, ledgerPath))
  removed.push({
    path: ledgerPath,
    kind: "activation-ledger",
  })
  return { removed, skipped }
}

function findChangedArtifacts({ hostRoot, ledger, neverDelete }) {
  const changedArtifacts = []
  for (const artifact of ledger.artifacts) {
    if (!neverDelete.has(artifact.kind)) {
      const fileContent = readFileSync(hostPath(hostRoot, artifact.path), "utf8")
      if (sha256(fileContent) !== artifact.content_sha256) {
        changedArtifacts.push({
          path: artifact.path,
          kind: artifact.kind,
          reason: "content-changed",
        })
      }
    }
  }
  return changedArtifacts
}

function stripOwnedActivationBlock(content) {
  return content
    .replace(OWNED_ACTIVATION_BLOCK_PATTERN, "\n")
    .replace(/(?:\r?\n)+$/u, "\n")
}

function writeHostFile(hostRoot, relativePath, content) {
  const filePath = hostPath(hostRoot, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf8")
}

function hostPath(hostRoot, relativePath) {
  return path.join(hostRoot, relativePath)
}

function snapshotHostFile(hostRoot, relativePath) {
  const filePath = hostPath(hostRoot, relativePath)
  if (!existsSync(filePath)) {
    return {
      restore: () => rmSync(filePath, { force: true }),
    }
  }

  try {
    const content = readFileSync(filePath, "utf8")
    return {
      restore: () => writeHostFile(hostRoot, relativePath, content),
    }
  } catch {
    return {
      restore: () => {},
    }
  }
}

function rollbackSnapshots(snapshots) {
  for (const snapshot of snapshots.reverse()) {
    snapshot.restore()
  }
}

function sha256(content) {
  return `sha256-${createHash("sha256").update(content).digest("hex")}`
}
