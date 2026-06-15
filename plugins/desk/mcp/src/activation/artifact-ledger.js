import { createHash } from "node:crypto"
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"

const LEDGER_SCHEMA_VERSION = 1
const OWNED_ACTIVATION_BLOCK_PATTERN = /(?:\r?\n)?# BEGIN desk activation: [^\r\n]* owner=desk-activation\r?\n[\s\S]*?# END desk activation\r?\n?/u

export function applyActivationArtifacts(request) {
  const ledgerArtifacts = request.artifacts.map((artifact) => {
    writeHostFile(request.hostRoot, artifact.path, artifact.content)
    return {
      owner: artifact.owner,
      kind: artifact.kind,
      path: artifact.path,
      content_sha256: sha256(artifact.content),
      updated_at: request.now,
    }
  })
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
}

export function readActivationLedger({ hostRoot, ledgerPath }) {
  return JSON.parse(readFileSync(hostPath(hostRoot, ledgerPath), "utf8"))
}

export function deactivateActivationArtifacts({ hostRoot, ledgerPath }) {
  const ledger = readActivationLedger({ hostRoot, ledgerPath })
  const neverDelete = new Set(ledger.never_delete)
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

function sha256(content) {
  return `sha256-${createHash("sha256").update(content).digest("hex")}`
}
