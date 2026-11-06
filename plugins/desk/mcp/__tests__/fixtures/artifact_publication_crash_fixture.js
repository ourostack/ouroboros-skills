import { promises as fs } from "node:fs"

import {
  __artifactPublicationInternalsForTests,
  publishArtifactSet,
} from "../../src/artifacts/publication.js"

const directory = process.env.PUBLICATION_DIRECTORY
const crashPhase = process.env.PUBLICATION_CRASH_PHASE
const crashInitialization = process.env.PUBLICATION_CRASH_INITIALIZATION
const crashBackupIndex = process.env.PUBLICATION_CRASH_BACKUP_INDEX
const crashBackupStep = process.env.PUBLICATION_CRASH_BACKUP_STEP
const recoveryCrash = process.env.PUBLICATION_RECOVERY_CRASH_JSON
const configuredTargets = process.env.PUBLICATION_TARGETS_JSON
  ? JSON.parse(process.env.PUBLICATION_TARGETS_JSON)
  : ["primary", "manifest", "checksum"].map((name) => ({
      name,
      path: `${directory}/${name}.consumer`,
      bytes: `new-${name}`,
    }))
const targets = configuredTargets.map((target) => ({
  name: target.name,
  path: target.path,
  bytes: Buffer.from(target.bytes, "utf8"),
}))

if (recoveryCrash) {
  const {
    coordinationPaths,
    recoverTransactions,
  } = __artifactPublicationInternalsForTests
  const config = JSON.parse(recoveryCrash)
  const coordination = coordinationPaths(directory)
  if (config.crashStep) {
    await recoverTransactions({
      directory,
      privateRoot: coordination.privateRoot,
      fileSystem: fs,
      hooks: {
        afterRestoreStep({ index, step }) {
          if (index === config.crashIndex && step === config.crashStep) {
            process.exit(86)
          }
        },
      },
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
  } else {
    await recoverTransactions({
      directory,
      privateRoot: coordination.privateRoot,
      fileSystem: fs,
      hooks: {
        afterRestoreStep({ index, step }) {
          if (index === 0 && step === "backup_removed") {
            process.exit(86)
          }
        },
      },
      renameRetryMs: 0,
      renameRetryLimit: 0,
    })
  }
} else {
  await publishArtifactSet({
    files: targets,
    validateStaged: async () => {},
    hooks: {
      afterInitialization({ step }) {
        if (step === crashInitialization) process.exit(86)
      },
      afterPhase({ phase, index }) {
        const phaseName = index === undefined ? phase : `${phase}:${index}`
        if (phaseName === crashPhase) process.exit(86)
      },
      afterBackupStep({ index, step }) {
        if (
          String(index) === crashBackupIndex &&
          step === crashBackupStep
        ) {
          process.exit(86)
        }
      },
    },
  })
}
