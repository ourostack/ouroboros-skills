import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  constants as fsConstants,
  readFileSync,
  realpathSync,
} from "node:fs"
import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"

const DEFAULT_LOCK_RETRY_MS = 10
const DEFAULT_LOCK_TIMEOUT_MS = 30000
const DEFAULT_RENAME_RETRY_MS = 10
const DEFAULT_RENAME_RETRY_LIMIT = 20
const PRIVATE_ROOT_PREFIX = ".ap-"
const INITIALIZATION_PREFIX = ".init-"
const TRANSACTION_PREFIX = ".tx-"
const GARBAGE_PREFIX = ".gc-"
const JOURNAL_FILE_RE = /^journal\.(\d+)\.json$/u
const JOURNAL_PHASES = new Set([
  "preparing",
  "backing_up",
  "publishing",
  "committed",
  "rolling_back",
])
const WINDOWS_RESERVED_TARGET_RE =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\..*)?$/iu
const RETRYABLE_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"])
const BEST_EFFORT_READER_CLEANUP_CODES = new Set(["EACCES", "EROFS"])
const CURRENT_PROCESS_START = processStartEvidence(process.pid)

export async function publishArtifactSet({
  files,
  validateStaged,
  signal,
  hooks = {},
  fileSystem = fs,
  makeId = randomUUID,
  lockRetryMs = DEFAULT_LOCK_RETRY_MS,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  renameRetryMs = DEFAULT_RENAME_RETRY_MS,
  renameRetryLimit = DEFAULT_RENAME_RETRY_LIMIT,
  ownerProbe = lockOwnerStatus,
} = {}) {
  const publication = assertPublicationInputs({ files, validateStaged })
  const directory = publication.directory
  const coordination = coordinationPaths(directory)
  await ensureReadCoordination(coordination.lockBase, fileSystem)
  const releaseLock = await acquirePublicationLock({
    lockPath: coordination.lockPath,
    signal,
    fileSystem,
    lockRetryMs,
    lockTimeoutMs,
    ownerProbe,
  })
  let result
  let operationError
  let privateRootReady = false
  try {
    await ensurePrivateDirectory(
      directory,
      coordination.privateRoot,
      fileSystem,
    )
    privateRootReady = true
    await fsyncDirectory(coordination.privateRoot, fileSystem)
    await recoverTransactions({
      directory,
      privateRoot: coordination.privateRoot,
      fileSystem,
      renameRetryMs,
      renameRetryLimit,
    })
    const targetSnapshots = await inspectPublicationTargets({
      directory,
      files: publication.files,
      fileSystem,
    })
    result = await commitPublication({
      files: publication.files,
      targetSnapshots,
      validateStaged,
      signal,
      hooks,
      fileSystem,
      makeId,
      directory,
      privateRoot: coordination.privateRoot,
      renameRetryMs,
      renameRetryLimit,
    })
  } catch (error) {
    operationError = error
    if (privateRootReady) {
      try {
        await recoverTransactions({
          directory,
          privateRoot: coordination.privateRoot,
          fileSystem,
          renameRetryMs,
          renameRetryLimit,
        })
      } catch (recoveryError) {
        operationError = new AggregateError(
          [safePublicationError(error), safePublicationError(recoveryError)],
          "artifact publication failed and recovery was incomplete",
        )
      }
    }
  }

  let releaseError
  let privateCleanupError
  if (privateRootReady) {
    try {
      await removePrivateRootIfEmpty(coordination.privateRoot, fileSystem)
    } catch (error) {
      privateCleanupError = safePublicationError(error)
    }
  }
  try {
    await releaseLock()
  } catch (error) {
    releaseError = safePublicationError(error)
  }
  if (operationError || privateCleanupError || releaseError) {
    const errors = [
      operationError && safePublicationError(operationError),
      privateCleanupError,
      releaseError,
    ].filter(Boolean)
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, "artifact publication cleanup failed")
  }
  return result
}

export async function withArtifactRead({
  directory,
  read,
  signal,
  fileSystem = fs,
  lockRetryMs = DEFAULT_LOCK_RETRY_MS,
  lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  renameRetryMs = DEFAULT_RENAME_RETRY_MS,
  renameRetryLimit = DEFAULT_RENAME_RETRY_LIMIT,
  ownerProbe = lockOwnerStatus,
} = {}) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new Error("artifact publication directory is required")
  }
  if (typeof read !== "function") {
    throw new Error("artifact publication read callback is required")
  }
  const coordination = coordinationPaths(directory)
  await ensureReadCoordination(coordination.lockBase, fileSystem)
  const releaseLock = await acquirePublicationLock({
    lockPath: coordination.lockPath,
    signal,
    fileSystem,
    lockRetryMs,
    lockTimeoutMs,
    ownerProbe,
  })
  let readError
  let readSucceeded = false
  let result
  let privateRootReady = false
  try {
    privateRootReady = await inspectPrivateDirectory(
      coordination.privateRoot,
      fileSystem,
    )
    if (privateRootReady) {
      await recoverTransactions({
        directory,
        privateRoot: coordination.privateRoot,
        fileSystem,
        renameRetryMs,
        renameRetryLimit,
      })
    }
    result = await read()
    readSucceeded = true
  } catch (error) {
    readError = error
  }
  let releaseError
  let privateCleanupError
  if (privateRootReady) {
    try {
      await removePrivateRootIfEmpty(
        coordination.privateRoot,
        fileSystem,
        { bestEffortReadOnly: readSucceeded },
      )
    } catch (error) {
      privateCleanupError = safePublicationError(error)
    }
  }
  try {
    await releaseLock()
  } catch (error) {
    releaseError = safePublicationError(error)
  }
  if (readError || privateCleanupError || releaseError) {
    const errors = [
      readError,
      privateCleanupError,
      releaseError,
    ].filter(Boolean)
    if (errors.length === 1) throw errors[0]
    throw new AggregateError(errors, "artifact read coordination failed")
  }
  return result
}

async function commitPublication({
  files,
  targetSnapshots,
  validateStaged,
  signal,
  hooks,
  fileSystem,
  makeId,
  directory,
  privateRoot,
  renameRetryMs,
  renameRetryLimit,
}) {
  const transactionId = makeOpaqueId(makeId())
  const initialization = transactionPaths(
    privateRoot,
    transactionId,
    INITIALIZATION_PREFIX,
  )
  const transaction = transactionPaths(privateRoot, transactionId)
  await makePrivateDirectory(initialization.root, fileSystem)
  await hooks.afterInitialization?.({ step: "root" })
  await makePrivateDirectory(initialization.stageDirectory, fileSystem)
  await hooks.afterInitialization?.({ step: "stage" })
  await makePrivateDirectory(initialization.backupDirectory, fileSystem)
  await hooks.afterInitialization?.({ step: "backup" })
  const journal = {
    schema_version: 1,
    sequence: 0,
    transaction_id: transactionId,
    phase: "preparing",
    files: files.map((file, index) => ({
      name: file.name,
      target: file.target,
      backup: `.b-${index}`,
      had_prior: null,
    })),
  }
  await writeJournal({
    journal,
    transaction: initialization,
    fileSystem,
  })
  await hooks.afterInitialization?.({ step: "journal" })
  await renameWithRetry({
    source: initialization.root,
    target: transaction.root,
    fileSystem,
    renameRetryMs,
    renameRetryLimit,
  })
  await hooks.afterInitialization?.({ step: "published" })
  await fsyncDirectory(privateRoot, fileSystem)
  await hooks.afterInitialization?.({ step: "synced" })
  await hooks.afterPhase?.({ phase: "preparing" })

  for (let index = 0; index < files.length; index += 1) {
    throwIfAborted(signal)
    await writeDurableFile(
      path.join(transaction.stageDirectory, journal.files[index].target),
      files[index].bytes,
      fileSystem,
    )
  }
  await fsyncDirectory(transaction.stageDirectory, fileSystem)
  await validateStaged(Object.fromEntries(
    journal.files.map((file) => [
      file.name,
      path.join(transaction.stageDirectory, file.target),
    ]),
  ))
  await hooks.beforeCommit?.()
  throwIfAborted(signal)
  const revalidatedTargets = await inspectPublicationTargets({
    directory,
    files,
    fileSystem,
  })
  for (let index = 0; index < journal.files.length; index += 1) {
    if (!sameTargetSnapshot(
      targetSnapshots[index],
      revalidatedTargets[index],
    )) {
      throw targetChanged()
    }
    journal.files[index].had_prior = targetSnapshots[index] !== null
  }
  journal.phase = "backing_up"
  await writeJournal({ journal, transaction, fileSystem })
  await hooks.afterPhase?.({ phase: "backing_up" })
  for (let index = 0; index < journal.files.length; index += 1) {
    const file = journal.files[index]
    if (!file.had_prior) continue
    const target = path.join(directory, file.target)
    const backup = path.join(transaction.backupDirectory, file.backup)
    const current = await inspectPublicationTarget(target, fileSystem)
    if (!sameTargetSnapshot(targetSnapshots[index], current)) {
      throw targetChanged()
    }
    await linkWithRetry({
      source: target,
      target: backup,
      fileSystem,
      renameRetryMs,
      renameRetryLimit,
    })
    await assertLinkedFiles({
      source: target,
      backup,
      expected: targetSnapshots[index],
      fileSystem,
    })
    await hooks.afterBackupStep?.({
      index,
      name: file.name,
      step: "linked",
    })
    await fsyncFile(backup, fileSystem)
    await hooks.afterBackupStep?.({
      index,
      name: file.name,
      step: "backup_file_synced",
    })
    await fsyncDirectory(transaction.backupDirectory, fileSystem)
    await hooks.afterBackupStep?.({
      index,
      name: file.name,
      step: "backup_directory_synced",
    })
    await assertLinkedFiles({
      source: target,
      backup,
      expected: targetSnapshots[index],
      fileSystem,
    })
    await removeWithRetry({
      target,
      fileSystem,
      renameRetryMs,
      renameRetryLimit,
    })
    await hooks.afterBackupStep?.({
      index,
      name: file.name,
      step: "target_removed",
    })
    await fsyncDirectory(directory, fileSystem)
    await hooks.afterBackupStep?.({
      index,
      name: file.name,
      step: "source_directory_synced",
    })
  }
  journal.phase = "publishing"
  await writeJournal({ journal, transaction, fileSystem })
  await hooks.afterPhase?.({ phase: "publishing" })
  for (let index = 0; index < journal.files.length; index += 1) {
    const file = journal.files[index]
    await hooks.beforeCommitFile?.({
      index,
      name: file.name,
      targetPath: path.join(directory, file.target),
    })
    throwIfAborted(signal)
    const expectedTarget = file.had_prior ? null : targetSnapshots[index]
    const currentTarget = await inspectPublicationTarget(
      path.join(directory, file.target),
      fileSystem,
    )
    if (!sameTargetSnapshot(expectedTarget, currentTarget)) {
      throw targetChanged()
    }
    await renameWithRetry({
      source: path.join(transaction.stageDirectory, file.target),
      target: path.join(directory, file.target),
      fileSystem,
      renameRetryMs,
      renameRetryLimit,
    })
    await fsyncDirectory(directory, fileSystem)
    await hooks.afterPhase?.({ phase: "publishing", index })
  }
  journal.phase = "committed"
  await writeJournal({ journal, transaction, fileSystem })
  await fsyncDirectory(directory, fileSystem)
  await hooks.afterPhase?.({ phase: "committed" })
  const garbageRoot = await detachTransaction({
    transaction,
    privateRoot,
    fileSystem,
    renameRetryMs,
    renameRetryLimit,
  })
  await hooks.afterPhase?.({ phase: "detached" })
  try {
    await sanitizeAndRemoveDirectory(garbageRoot, fileSystem)
  } catch (error) {
    throw new AggregateError(
      [safePublicationError(error)],
      "artifact publication cleanup failed",
    )
  }
  await fsyncDirectory(privateRoot, fileSystem)
}

async function recoverTransactions({
  directory,
  privateRoot,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
  hooks = {},
}) {
  let entries
  try {
    entries = await fileSystem.readdir(privateRoot, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return
    throw recoveryFailure()
  }
  const transactionEntries = entries
    .filter((entry) =>
      entry.isDirectory() && entry.name.startsWith(TRANSACTION_PREFIX)
    )
    .sort((left, right) => left.name.localeCompare(right.name))
  const initializationEntries = entries
    .filter((entry) =>
      entry.isDirectory() && entry.name.startsWith(INITIALIZATION_PREFIX)
    )
    .sort((left, right) => left.name.localeCompare(right.name))
  const garbageEntries = entries
    .filter((entry) =>
      entry.isDirectory() && entry.name.startsWith(GARBAGE_PREFIX)
    )
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of initializationEntries) {
    try {
      await sanitizeAndRemoveDirectory(
        path.join(privateRoot, entry.name),
        fileSystem,
      )
      await fsyncDirectory(privateRoot, fileSystem)
    } catch {
      throw recoveryFailure()
    }
  }
  for (const entry of garbageEntries) {
    try {
      await sanitizeAndRemoveDirectory(
        path.join(privateRoot, entry.name),
        fileSystem,
      )
      await fsyncDirectory(privateRoot, fileSystem)
    } catch {
      throw recoveryFailure()
    }
  }
  for (const entry of transactionEntries) {
    const transaction = transactionPaths(
      privateRoot,
      entry.name.slice(TRANSACTION_PREFIX.length),
    )
    const journal = await readTransactionJournal(transaction, fileSystem)
    try {
      if (["backing_up", "publishing"].includes(journal.phase)) {
        const recoveryPhase = journal.phase
        journal.phase = "rolling_back"
        journal.sequence += 1
        await writeJournal({ journal, transaction, fileSystem })
        await rollbackFiles({
          directory,
          transaction,
          journal,
          fileSystem,
          renameRetryMs,
          renameRetryLimit,
          hooks,
          recoveryPhase,
        })
      } else if (journal.phase === "committed") {
        const complete = await allTargetsExist({
          directory,
          files: journal.files,
          fileSystem,
        })
        if (!complete) {
          journal.phase = "rolling_back"
          journal.sequence += 1
          await writeJournal({ journal, transaction, fileSystem })
          await rollbackFiles({
            directory,
            transaction,
            journal,
            fileSystem,
            renameRetryMs,
            renameRetryLimit,
            hooks,
            recoveryPhase: "committed",
          })
        }
      } else if (journal.phase === "rolling_back") {
        await rollbackFiles({
          directory,
          transaction,
          journal,
          fileSystem,
          renameRetryMs,
          renameRetryLimit,
          hooks,
          recoveryPhase: "rolling_back",
        })
      }
      await fsyncDirectory(directory, fileSystem)
      const garbageRoot = await detachTransaction({
        transaction,
        privateRoot,
        fileSystem,
        renameRetryMs,
        renameRetryLimit,
      })
      await sanitizeAndRemoveDirectory(garbageRoot, fileSystem)
      await fsyncDirectory(privateRoot, fileSystem)
    } catch {
      throw recoveryFailure()
    }

  }
}

async function detachTransaction({
  transaction,
  privateRoot,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
}) {
  const garbageRoot = path.join(
    privateRoot,
    `${GARBAGE_PREFIX}${transaction.id}`,
  )
  await renameWithRetry({
    source: transaction.root,
    target: garbageRoot,
    fileSystem,
    renameRetryMs,
    renameRetryLimit,
  })
  await fsyncDirectory(privateRoot, fileSystem)
  return garbageRoot
}

async function rollbackFiles({
  directory,
  transaction,
  journal,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
  hooks,
  recoveryPhase,
}) {
  for (let index = 0; index < journal.files.length; index += 1) {
    const file = journal.files[index]
    const target = path.join(directory, file.target)
    const backup = path.join(transaction.backupDirectory, file.backup)
    const staged = path.join(transaction.stageDirectory, file.target)
    let targetStat = await inspectRecoveryFile(target, fileSystem)
    let backupStat = await inspectRecoveryFile(backup, fileSystem)
    const stagedStat = await inspectRecoveryFile(staged, fileSystem)
    if (!file.had_prior) {
      if (targetStat) {
        if (recoveryPhase !== "backing_up" && stagedStat) {
          throw recoveryFailure()
        }
        assertSingleLinkRecoveryFile(targetStat)
        await secureRemoveFile(target, fileSystem)
        await fsyncDirectory(directory, fileSystem)
      }
      continue
    }
    if (!targetStat && !backupStat) throw recoveryFailure()
    if (!backupStat) {
      assertSingleLinkRecoveryFile(targetStat)
      await fsyncFile(target, fileSystem)
      await fsyncDirectory(directory, fileSystem)
      await fsyncDirectory(transaction.backupDirectory, fileSystem)
      continue
    }
    if (targetStat && sameFileIdentity(targetStat, backupStat)) {
      assertLinkedRecoveryFiles(targetStat, backupStat)
    } else {
      if (targetStat) {
        if (recoveryPhase === "backing_up" || stagedStat) {
          throw recoveryFailure()
        }
      }
      assertSingleLinkRecoveryFile(backupStat)
      if (targetStat) {
        assertSingleLinkRecoveryFile(targetStat)
        await secureRemoveFile(target, fileSystem)
        await hooks.afterRestoreStep?.({
          index,
          name: file.name,
          step: "target_removed",
        })
      }
      await linkWithRetry({
        source: backup,
        target,
        fileSystem,
        renameRetryMs,
        renameRetryLimit,
      })
      await hooks.afterRestoreStep?.({
        index,
        name: file.name,
        step: "target_linked",
      })
      targetStat = await inspectRecoveryFile(target, fileSystem)
      backupStat = await inspectRecoveryFile(backup, fileSystem)
      assertLinkedRecoveryFiles(targetStat, backupStat)
    }
    await fsyncFile(target, fileSystem)
    await hooks.afterRestoreStep?.({
      index,
      name: file.name,
      step: "target_file_synced",
    })
    await fsyncDirectory(directory, fileSystem)
    await hooks.afterRestoreStep?.({
      index,
      name: file.name,
      step: "source_directory_synced",
    })
    targetStat = await inspectRecoveryFile(target, fileSystem)
    backupStat = await inspectRecoveryFile(backup, fileSystem)
    assertLinkedRecoveryFiles(targetStat, backupStat)
    await removeWithRetry({
      target: backup,
      fileSystem,
      renameRetryMs,
      renameRetryLimit,
    })
    await hooks.afterRestoreStep?.({
      index,
      name: file.name,
      step: "backup_removed",
    })
    await fsyncDirectory(transaction.backupDirectory, fileSystem)
    await hooks.afterRestoreStep?.({
      index,
      name: file.name,
      step: "backup_directory_synced",
    })
  }
}

async function allTargetsExist({ directory, files, fileSystem }) {
  for (const file of files) {
    const stat = await inspectRecoveryFile(
      path.join(directory, file.target),
      fileSystem,
    )
    if (!stat) return false
    assertSingleLinkRecoveryFile(stat)
  }
  return true
}

function validateJournal(journal, transaction) {
  if (
    journal === null ||
    typeof journal !== "object" ||
    Array.isArray(journal) ||
    !hasExactKeys(journal, [
      "schema_version",
      "sequence",
      "transaction_id",
      "phase",
      "files",
    ]) ||
    journal.schema_version !== 1 ||
    !Number.isInteger(journal.sequence) ||
    journal.sequence < 0 ||
    journal.transaction_id !== transaction.id ||
    !JOURNAL_PHASES.has(journal.phase) ||
    !Array.isArray(journal.files) ||
    journal.files.length === 0
  ) {
    throw recoveryFailure()
  }
  const targets = new Set()
  const backups = new Set()
  for (const file of journal.files) {
    if (
      file === null ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      !hasExactKeys(file, [
        "name",
        "target",
        "backup",
        "had_prior",
      ]) ||
      typeof file.name !== "string" ||
      !safeOpaqueName(file.target) ||
      !safeOpaqueName(file.backup) ||
      ![true, false, null].includes(file.had_prior) ||
      targets.has(file.target) ||
      backups.has(file.backup)
    ) {
      throw recoveryFailure()
    }
    if (journal.phase !== "preparing" && file.had_prior === null) {
      throw recoveryFailure()
    }
    targets.add(file.target)
    backups.add(file.backup)
  }
}

async function writeJournal({ journal, transaction, fileSystem }) {
  const journalPath = path.join(
    transaction.root,
    `journal.${journal.sequence}.json`,
  )
  await writeDurableFile(
    journalPath,
    `${JSON.stringify(journal)}\n`,
    fileSystem,
  )
  await fsyncDirectory(transaction.root, fileSystem)
  journal.sequence += 1
}

async function writeDurableFile(filePath, bytes, fileSystem) {
  const handle = await fileSystem.open(filePath, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync?.()
  } finally {
    await handle.close()
  }
  await fileSystem.chmod?.(filePath, 0o600)
}

async function ensurePrivateDirectory(directory, privateRoot, fileSystem) {
  await fileSystem.mkdir(directory, { recursive: true })
  await makePrivateDirectory(privateRoot, fileSystem)
  await fsyncDirectory(directory, fileSystem)
  await fsyncDirectory(path.dirname(privateRoot), fileSystem)
  await ensureReadCoordination(
    coordinationLockBase(),
    fileSystem,
  )
}

async function ensureReadCoordination(lockBase, fileSystem) {
  await makePrivateDirectory(lockBase, fileSystem)
  await fsyncDirectory(path.dirname(lockBase), fileSystem)
}

async function makePrivateDirectory(directory, fileSystem) {
  await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 })
  if (typeof fileSystem.lstat === "function") {
    const stat = await fileSystem.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw recoveryFailure()
    }
  }
  await fileSystem.chmod?.(directory, 0o700)
}

async function inspectPrivateDirectory(directory, fileSystem) {
  let stat
  try {
    stat = await fileSystem.lstat(directory)
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw recoveryFailure()
  }
  return true
}

async function fsyncDirectory(
  directory,
  fileSystem,
  { platform = process.platform } = {},
) {
  let handle
  try {
    handle = await fileSystem.open(directory, "r")
    await handle.sync?.()
  } catch (error) {
    if (
      platform === "win32" &&
      ["EACCES", "EINVAL", "EPERM"].includes(error.code)
    ) {
      return
    }
    throw error
  } finally {
    await handle?.close()
  }
}

async function fsyncFile(filePath, fileSystem) {
  const handle = await fileSystem.open(filePath, "r")
  try {
    await handle.sync?.()
  } finally {
    await handle.close()
  }
}

async function renameWithRetry({
  source,
  target,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
}) {
  return retryFileOperation({
    operation: () => fileSystem.rename(source, target),
    renameRetryMs,
    renameRetryLimit,
  })
}

async function linkWithRetry({
  source,
  target,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
}) {
  return retryFileOperation({
    operation: () => fileSystem.link(source, target),
    renameRetryMs,
    renameRetryLimit,
  })
}

async function removeWithRetry({
  target,
  fileSystem,
  renameRetryMs,
  renameRetryLimit,
}) {
  return retryFileOperation({
    operation: () => fileSystem.rm(target),
    renameRetryMs,
    renameRetryLimit,
  })
}

async function retryFileOperation({
  operation,
  renameRetryMs,
  renameRetryLimit,
}) {
  let lastError
  for (let attempt = 0; attempt <= renameRetryLimit; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!RETRYABLE_RENAME_CODES.has(error.code)) throw error
      lastError = error
      if (attempt < renameRetryLimit) await delay(renameRetryMs)
    }
  }
  throw lastError
}

async function acquirePublicationLock({
  lockPath,
  signal,
  fileSystem,
  lockRetryMs,
  lockTimeoutMs,
  ownerProbe = lockOwnerStatus,
  processStart = currentProcessStartEvidence,
}) {
  const startedAt = Date.now()
  while (true) {
    throwIfAborted(signal)
    if (!await recoverLockClaims({
      lockPath,
      fileSystem,
      ownerProbe,
      staleAfterMs: Math.max(100, lockRetryMs * 4),
    })) {
      await waitForPublicationLock({
        startedAt,
        lockRetryMs,
        lockTimeoutMs,
        signal,
      })
      continue
    }
    const processStartId = processStart(process.pid)
    if (typeof processStartId !== "string" || processStartId === "") {
      const error = new Error(
        "artifact publication process identity is unavailable",
      )
      error.code = "artifact_publication_identity_unavailable"
      throw error
    }
    const initializedOwner = {
      schema_version: 1,
      pid: process.pid,
      process_start: processStartId,
      owner_token: randomUUID(),
      created_at: new Date().toISOString(),
    }
    const ownerPath =
      `${lockPath}.owner-${initializedOwner.owner_token}`
    try {
      await writeDurableFile(
        ownerPath,
        `${JSON.stringify(initializedOwner)}\n`,
        fileSystem,
      )
    } catch (error) {
      try {
        await fileSystem.rm(ownerPath, { force: true })
      } catch (cleanupError) {
        throw new AggregateError(
          [safePublicationError(error), safePublicationError(cleanupError)],
          "artifact publication owner initialization failed",
        )
      }
      throw safePublicationError(error)
    }
    try {
      await fileSystem.link(ownerPath, lockPath)
    } catch (error) {
      await fileSystem.rm(ownerPath, { force: true })
      if (error.code !== "EEXIST") throw safePublicationError(error)
      if (await staleLockCanBeReclaimed({
        lockPath,
        fileSystem,
        ownerProbe,
        malformedLockStaleMs: Math.max(100, lockRetryMs * 4),
      })) {
        continue
      }
      await waitForPublicationLock({
        startedAt,
        lockRetryMs,
        lockTimeoutMs,
        signal,
      })
      continue
    }
    try {
      await fileSystem.rm(ownerPath, { force: true })
    } catch (error) {
      try {
        await removeOwnedLock({
          lockPath,
          owner: initializedOwner,
          fileSystem,
        })
      } catch (cleanupError) {
        throw new AggregateError(
          [safePublicationError(error), safePublicationError(cleanupError)],
          "artifact publication lock initialization failed",
        )
      }
      throw safePublicationError(error)
    }

    if (await hasLockClaims(lockPath, fileSystem)) {
      await removeOwnedLock({
        lockPath,
        owner: initializedOwner,
        fileSystem,
      })
      await waitForPublicationLock({
        startedAt,
        lockRetryMs,
        lockTimeoutMs,
        signal,
      })
      continue
    }

    return async () => {
      const errors = []
      try {
        await removeOwnedLock({
          lockPath,
          owner: initializedOwner,
          fileSystem,
        })
      } catch (error) {
        errors.push(safePublicationError(error))
      }
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          "artifact publication lock cleanup failed",
        )
      }
    }
  }
}

async function staleLockCanBeReclaimed({
  lockPath,
  fileSystem,
  ownerProbe,
  malformedLockStaleMs,
}) {
  if (typeof fileSystem.rename !== "function") return false
  let observedOwner
  try {
    observedOwner = JSON.parse(await fileSystem.readFile(lockPath, "utf8"))
  } catch {
    const claimPath = await claimLockPath(lockPath, fileSystem)
    if (!claimPath) return true
    if (typeof fileSystem.stat !== "function") {
      return false
    }
    try {
      const stat = await fileSystem.stat(claimPath)
      if (Date.now() - stat.mtimeMs < malformedLockStaleMs) {
        return false
      }
    } catch {
      return false
    }
    return false
  }
  if (!sameLockOwner(observedOwner, observedOwner)) return false
  if (normalizeOwnerStatus(await ownerProbe(observedOwner)) !== "dead") {
    return false
  }
  const claimPath = await claimLockPath(lockPath, fileSystem)
  if (!claimPath) return true
  let claimedOwner
  try {
    claimedOwner = JSON.parse(await fileSystem.readFile(claimPath, "utf8"))
  } catch {
    return false
  }
  if (
    !sameLockOwner(claimedOwner, claimedOwner) ||
    !sameLockOwner(observedOwner, claimedOwner) ||
    normalizeOwnerStatus(await ownerProbe(claimedOwner)) !== "dead"
  ) {
    return false
  }
  await fileSystem.rm(claimPath, { force: true })
  return true
}

async function waitForPublicationLock({
  startedAt,
  lockRetryMs,
  lockTimeoutMs,
  signal,
}) {
  if (Date.now() - startedAt >= lockTimeoutMs) {
    const timeout = new Error("artifact publication lock timed out")
    timeout.code = "artifact_publication_lock_timeout"
    throw timeout
  }
  await delay(lockRetryMs, signal)
}

async function claimLockPath(lockPath, fileSystem) {
  const claimPath = `${lockPath}.claim-${randomUUID()}`
  try {
    await renameWithRetry({
      source: lockPath,
      target: claimPath,
      fileSystem,
      renameRetryMs: DEFAULT_RENAME_RETRY_MS,
      renameRetryLimit: DEFAULT_RENAME_RETRY_LIMIT,
    })
    return claimPath
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}

async function removeOwnedLock({ lockPath, owner, fileSystem }) {
  const existingClaim = await findOwnedClaim({
    lockPath,
    owner,
    fileSystem,
  })
  if (existingClaim) {
    await fileSystem.rm(existingClaim, { force: true })
    return
  }
  let claimPath = await claimLockPath(lockPath, fileSystem)
  if (!claimPath) {
    claimPath = await findOwnedClaim({
      lockPath,
      owner,
      fileSystem,
    })
  }
  if (!claimPath) {
    const error = new Error("artifact publication lock ownership changed")
    error.code = "artifact_publication_lock_ownership_lost"
    throw error
  }
  let claimedOwner
  try {
    claimedOwner = JSON.parse(await fileSystem.readFile(claimPath, "utf8"))
  } catch {
    const error = new Error("artifact publication lock ownership changed")
    error.code = "artifact_publication_lock_ownership_lost"
    throw error
  }
  if (!sameLockOwner(claimedOwner, owner)) {
    const error = new Error("artifact publication lock ownership changed")
    error.code = "artifact_publication_lock_ownership_lost"
    throw error
  }
  await fileSystem.rm(claimPath, { force: true })
}

async function findOwnedClaim({ lockPath, owner, fileSystem }) {
  if (
    typeof fileSystem.readdir !== "function" ||
    typeof fileSystem.readFile !== "function"
  ) {
    return null
  }
  const prefix = `${path.basename(lockPath)}.claim-`
  let entries
  try {
    entries = await fileSystem.readdir(path.dirname(lockPath))
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  for (const entry of entries.map(String).sort()) {
    if (!entry.startsWith(prefix)) continue
    const claimPath = path.join(path.dirname(lockPath), entry)
    try {
      const claimedOwner = JSON.parse(
        await fileSystem.readFile(claimPath, "utf8"),
      )
      if (sameLockOwner(claimedOwner, owner)) return claimPath
    } catch {
      continue
    }
  }
  return null
}

async function hasLockClaims(lockPath, fileSystem) {
  if (typeof fileSystem.readdir !== "function") return false
  const prefix = `${path.basename(lockPath)}.claim-`
  try {
    const entries = await fileSystem.readdir(path.dirname(lockPath))
    return entries.some((entry) => String(entry).startsWith(prefix))
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

async function recoverLockClaims({
  lockPath,
  fileSystem,
  ownerProbe,
  staleAfterMs,
}) {
  if (
    typeof fileSystem.readdir !== "function" ||
    typeof fileSystem.readFile !== "function"
  ) {
    return true
  }
  const prefix = `${path.basename(lockPath)}.claim-`
  let entries
  try {
    entries = await fileSystem.readdir(path.dirname(lockPath))
  } catch (error) {
    if (error.code === "ENOENT") return true
    throw error
  }
  const claims = entries
    .map(String)
    .filter((entry) => entry.startsWith(prefix))
    .sort()
  for (const entry of claims) {
    const claimPath = path.join(path.dirname(lockPath), entry)
    let owner
    try {
      const stat = await fileSystem.stat(claimPath)
      if (Date.now() - stat.mtimeMs < staleAfterMs) return false
      owner = JSON.parse(await fileSystem.readFile(claimPath, "utf8"))
    } catch {
      return false
    }
    if (!sameLockOwner(owner, owner)) return false
    const status = normalizeOwnerStatus(await ownerProbe(owner))
    if (status === "dead") {
      await fileSystem.rm(claimPath, { force: true })
      continue
    }
    return false
  }
  return true
}

function normalizeOwnerStatus(status) {
  if (status === false || status === "dead") return "dead"
  if (status === true || status === "live") return "live"
  return "unknown"
}

function sameLockOwner(left, right) {
  return (
    [left, right].every((owner) =>
      owner !== null &&
      typeof owner === "object" &&
      !Array.isArray(owner) &&
      hasExactKeys(owner, [
        "schema_version",
        "pid",
        "process_start",
        "owner_token",
        "created_at",
      ]) &&
      owner.schema_version === 1 &&
      Number.isInteger(owner.pid) &&
      owner.pid > 0 &&
      typeof owner.process_start === "string" &&
      owner.process_start !== "" &&
      typeof owner.owner_token === "string" &&
      owner.owner_token !== "" &&
      typeof owner.created_at === "string" &&
      !Number.isNaN(Date.parse(owner.created_at))
    ) &&
    left?.schema_version === right?.schema_version &&
    left?.pid === right?.pid &&
    left?.process_start === right?.process_start &&
    left?.owner_token === right?.owner_token &&
    left?.created_at === right?.created_at
  )
}

function lockOwnerStatus(
  owner,
  {
    getProcessStart = processStartEvidence,
    exists = processExists,
  } = {},
) {
  if (!sameLockOwner(owner, owner)) return "unknown"
  const current = getProcessStart(owner.pid)
  if (current !== null) {
    return current === owner.process_start ? "live" : "dead"
  }
  const present = exists(owner.pid)
  return present === false ? "dead" : "unknown"
}

function processExists(pid, { kill = process.kill } = {}) {
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === "ESRCH" ? false : null
  }
}

function processStartEvidence(pid, {
  platform = process.platform,
  readFile = readFileSync,
  spawn = spawnSync,
  kill = process.kill,
} = {}) {
  if (platform === "linux") {
    try {
      const stat = readFile(`/proc/${pid}/stat`, "utf8")
      const close = stat.lastIndexOf(")")
      const fields = stat.slice(close + 2).split(" ")
      return `linux:${fields[19]}`
    } catch {
      return null
    }
  }
  if (platform === "darwin") {
    const result = spawn(
      "ps",
      ["-p", String(pid), "-o", "lstart="],
      { encoding: "utf8" },
    )
    const started = result.status === 0 ? result.stdout.trim() : ""
    return started ? `darwin:${started}` : null
  }
  if (platform === "win32") {
    const result = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
      ],
      { encoding: "utf8", windowsHide: true },
    )
    const started = result.status === 0 ? result.stdout.trim() : ""
    return started ? `win32:${started}` : null
  }
  try {
    kill(pid, 0)
    return `pid:${pid}`
  } catch {
    return null
  }
}

function currentProcessStartEvidence() {
  return CURRENT_PROCESS_START
}

async function sanitizeAndRemoveDirectory(root, fileSystem) {
  let entries
  try {
    entries = await fileSystem.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) {
      await sanitizeAndRemoveDirectory(target, fileSystem)
    } else {
      await secureRemoveFile(target, fileSystem)
    }
  }
  await fileSystem.rm(root, { recursive: true, force: true })
}

async function secureRemoveFile(
  filePath,
  fileSystem,
  {
    noFollowFlag = fsConstants.O_NOFOLLOW,
    platform = process.platform,
  } = {},
) {
  let handle
  let unlinked = false
  try {
    if (typeof fileSystem.lstat !== "function") return
    const initial = await fileSystem.lstat(filePath)
    if (
      !initial.isFile() ||
      initial.isSymbolicLink() ||
      initial.nlink > 1
    ) {
      return
    }
    const flags =
      fsConstants.O_RDWR | (noFollowFlag ?? 0)
    try {
      handle = await fileSystem.open(filePath, flags)
    } catch (error) {
      if (["ELOOP", "EMLINK"].includes(error.code)) return
      throw error
    }
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.nlink > 1 ||
      opened.dev !== initial.dev ||
      opened.ino !== initial.ino
    ) {
      return
    }
    if (platform === "win32") {
      await handle.close()
      handle = undefined
      await fileSystem.rm(filePath, { force: true })
      unlinked = true
      return
    }
    await fileSystem.rm(filePath, { force: true })
    unlinked = true
    const detached = await handle.stat()
    if (
      !detached.isFile() ||
      detached.nlink !== 0 ||
      detached.dev !== initial.dev ||
      detached.ino !== initial.ino
    ) {
      return
    }
    await handle.chmod?.(0o600)
    if (detached.size > 0) {
      const zeros = Buffer.alloc(Math.min(detached.size, 64 * 1024))
      for (let offset = 0; offset < detached.size; offset += zeros.length) {
        await handle.write(
          zeros,
          0,
          Math.min(zeros.length, detached.size - offset),
          offset,
        )
      }
      await handle.sync?.()
    }
  } finally {
    await handle?.close()
    if (!unlinked) await fileSystem.rm(filePath, { force: true })
  }
}

async function fileExists(filePath, fileSystem) {
  try {
    await fileSystem.access(filePath)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

async function inspectPublicationTargets({
  directory,
  files,
  fileSystem,
}) {
  return Promise.all(files.map((file) =>
    inspectPublicationTarget(path.join(directory, file.target), fileSystem)
  ))
}

async function inspectPublicationTarget(filePath, fileSystem) {
  let stat
  try {
    stat = await fileSystem.lstat(filePath)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1
  ) {
    throw unsupportedTarget()
  }
  return targetSnapshot(stat)
}

function targetSnapshot(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  }
}

function sameTargetSnapshot(left, right) {
  if (left === null || right === null) return left === right
  return [
    "dev",
    "ino",
    "mode",
    "nlink",
    "size",
    "mtimeMs",
    "ctimeMs",
  ].every((key) => left[key] === right[key])
}

async function assertLinkedFiles({
  source,
  backup,
  expected,
  fileSystem,
}) {
  let sourceStat
  let backupStat
  try {
    [sourceStat, backupStat] = await Promise.all([
      fileSystem.lstat(source),
      fileSystem.lstat(backup),
    ])
  } catch {
    throw targetChanged()
  }
  if (
    !sourceStat.isFile() ||
    sourceStat.isSymbolicLink() ||
    !backupStat.isFile() ||
    backupStat.isSymbolicLink() ||
    sourceStat.nlink !== 2 ||
    backupStat.nlink !== 2 ||
    !sameFileIdentity(sourceStat, backupStat) ||
    sourceStat.dev !== expected.dev ||
    sourceStat.ino !== expected.ino
  ) {
    throw targetChanged()
  }
}

async function inspectRecoveryFile(filePath, fileSystem) {
  let stat
  try {
    stat = await fileSystem.lstat(filePath)
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw recoveryFailure()
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw recoveryFailure()
  return stat
}

function assertSingleLinkRecoveryFile(stat) {
  if (!stat || stat.nlink !== 1) throw recoveryFailure()
}

function assertLinkedRecoveryFiles(left, right) {
  if (
    !left ||
    !right ||
    left.nlink !== 2 ||
    right.nlink !== 2 ||
    !sameFileIdentity(left, right)
  ) {
    throw recoveryFailure()
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function unsupportedTarget() {
  const error = new Error("artifact publication target is unsupported")
  error.code = "artifact_publication_target_unsupported"
  return error
}

function targetChanged() {
  const error = new Error(
    "artifact publication target changed during publication",
  )
  error.code = "artifact_publication_target_changed"
  return error
}

async function delay(milliseconds, signal) {
  throwIfAborted(signal)
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
  throwIfAborted(signal)
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return
  const error = new Error("artifact publication aborted")
  error.name = "AbortError"
  throw error
}

function assertPublicationInputs({
  files,
  validateStaged,
  platform = process.platform,
}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("artifact publication files are required")
  }
  if (typeof validateStaged !== "function") {
    throw new Error("artifact staged-generation validator is required")
  }
  const pathApi = platform === "win32" ? path.win32 : path.posix
  if (files.some((file) =>
    typeof file.name !== "string" ||
    typeof file.path !== "string" ||
    file.bytes === undefined
  )) {
    throw new Error("artifact publication files must be unique named siblings")
  }
  const normalizedFiles = files.map((file) => {
    const directory = pathApi.dirname(file.path)
    const target = pathApi.basename(file.path)
    if (
      !safeOpaqueName(target) ||
      (platform === "win32" && !safeWindowsTargetName(target)) ||
      pathApi.join(directory, target) !== file.path
    ) {
      throw new Error(
        "artifact publication files must be unique named siblings",
      )
    }
    return { ...file, directory, target }
  })
  const directories = new Set(normalizedFiles.map((file) => file.directory))
  const names = new Set(files.map((file) => file.name))
  const targetNames = new Set(normalizedFiles.map((file) =>
    platform === "win32" ? file.target.toLowerCase() : file.target
  ))
  if (
    directories.size !== 1 ||
    names.size !== files.length ||
    targetNames.size !== files.length
  ) {
    throw new Error("artifact publication files must be unique named siblings")
  }
  return {
    directory: normalizedFiles[0].directory,
    files: normalizedFiles.map(({ directory: _directory, ...file }) => file),
  }
}

function safeWindowsTargetName(value) {
  return (
    !/[. ]$/u.test(value) &&
    !value.includes(":") &&
    !WINDOWS_RESERVED_TARGET_RE.test(value)
  )
}

function coordinationPaths(directory) {
  const canonicalDirectory = canonicalDirectoryIdentity(directory)
  const digest = createHash("sha256")
    .update(canonicalDirectory)
    .digest("hex")
    .slice(0, 32)
  const privateRoot = path.join(
    path.dirname(canonicalDirectory),
    `${PRIVATE_ROOT_PREFIX}${digest.slice(0, 16)}`,
  )
  const lockBase = coordinationLockBase()
  return {
    privateRoot,
    lockBase,
    lockPath: path.join(lockBase, `${digest}.publish.lock`),
  }
}

function canonicalDirectoryIdentity(directory, {
  platform = process.platform,
  realpath = realpathSync.native,
} = {}) {
  const pathApi = platform === "win32" ? path.win32 : path
  let probe = pathApi.resolve(directory)
  const missingSegments = []
  while (true) {
    try {
      probe = realpath(probe)
      break
    } catch (error) {
      if (error.code !== "ENOENT") {
        const failure = new Error(
          "artifact publication directory identity is unavailable",
        )
        failure.code = "artifact_publication_identity_unavailable"
        throw failure
      }
      const parent = pathApi.dirname(probe)
      if (parent === probe) {
        const failure = new Error(
          "artifact publication directory identity is unavailable",
        )
        failure.code = "artifact_publication_identity_unavailable"
        throw failure
      }
      missingSegments.unshift(pathApi.basename(probe))
      probe = parent
    }
  }
  const canonical = pathApi.join(probe, ...missingSegments)
  return platform === "win32" ? canonical.toLowerCase() : canonical
}

function coordinationLockBase({
  env = process.env,
  platform = process.platform,
  home = homedir,
} = {}) {
  const configured = env.DESK_ARTIFACT_COORDINATION_DIR
  if (typeof configured === "string" && configured.trim() !== "") {
    return path.resolve(configured)
  }
  if (
    platform === "win32" &&
    typeof env.LOCALAPPDATA === "string" &&
    env.LOCALAPPDATA.trim() !== ""
  ) {
    return path.join(
      env.LOCALAPPDATA,
      "ouroboros-skills",
      "artifact-publication",
    )
  }
  const cacheRoot =
    typeof env.XDG_CACHE_HOME === "string" &&
      env.XDG_CACHE_HOME.trim() !== ""
      ? env.XDG_CACHE_HOME
      : path.join(home(), ".cache")
  return path.join(cacheRoot, "ouroboros-skills", "artifact-publication")
}

function transactionPaths(
  privateRoot,
  transactionId,
  prefix = TRANSACTION_PREFIX,
) {
  const id = makeOpaqueId(transactionId)
  const root = path.join(privateRoot, `${prefix}${id}`)
  return {
    id,
    root,
    stageDirectory: path.join(root, ".staged"),
    backupDirectory: path.join(root, ".backups"),
    journalPath: path.join(root, "journal.0.json"),
  }
}

function makeOpaqueId(value) {
  const text = String(value)
  if (/^[a-z0-9-]{1,128}$/iu.test(text)) return text
  return createHash("sha256").update(text).digest("hex")
}

function safeOpaqueName(value) {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\")
  )
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
}

async function readTransactionJournal(transaction, fileSystem) {
  let entries
  try {
    entries = await fileSystem.readdir(transaction.root, {
      withFileTypes: true,
    })
  } catch {
    throw recoveryFailure()
  }

  const journals = entries
    .filter((entry) => entry.isFile() && JOURNAL_FILE_RE.test(entry.name))
    .map((entry) => ({
      name: entry.name,
      sequence: Number(JOURNAL_FILE_RE.exec(entry.name)[1]),
    }))
    .sort((left, right) => right.sequence - left.sequence)
  for (const candidate of journals) {
    try {
      const journal = JSON.parse(await fileSystem.readFile(
        path.join(transaction.root, candidate.name),
        "utf8",
      ))
      validateJournal(journal, transaction)
      if (journal.sequence !== candidate.sequence) continue
      return journal
    } catch {
      continue
    }
  }
  throw recoveryFailure()
}

async function removePrivateRootIfEmpty(
  privateRoot,
  fileSystem,
  { bestEffortReadOnly = false } = {},
) {
  let entries
  try {
    entries = await fileSystem.readdir(privateRoot)
  } catch (error) {
    if (error.code === "ENOENT") return
    throw error
  }
  if (entries.length === 0) {
    try {
      await fileSystem.rmdir(privateRoot)
      await fsyncDirectory(path.dirname(privateRoot), fileSystem)
    } catch (error) {
      if (
        bestEffortReadOnly &&
        BEST_EFFORT_READER_CLEANUP_CODES.has(error.code)
      ) {
        return
      }
      throw error
    }
  }
}

function recoveryFailure() {
  const error = new Error("artifact publication recovery failed")
  error.code = "artifact_publication_recovery_failed"
  return error
}

function safePublicationError(error) {
  if (
    error instanceof AggregateError ||
    error?.name === "AbortError" ||
    !error?.path
  ) {
    return error
  }
  const safe = new Error("artifact publication operation failed")
  safe.code = error.code ?? "artifact_publication_failed"
  return safe
}

export const __artifactPublicationInternalsForTests = {
  acquirePublicationLock,
  assertPublicationInputs,
  claimLockPath,
  canonicalDirectoryIdentity,
  coordinationPaths,
  delay,
  fileExists,
  lockOwnerStatus,
  coordinationLockBase,
  fsyncDirectory,
  fsyncFile,
  findOwnedClaim,
  hasLockClaims,
  makePrivateDirectory,
  currentProcessStartEvidence,
  processStartEvidence,
  processExists,
  readTransactionJournal,
  recoverLockClaims,
  recoverTransactions,
  retryFileOperation,
  removePrivateRootIfEmpty,
  removeOwnedLock,
  renameWithRetry,
  safePublicationError,
  sameLockOwner,
  sanitizeAndRemoveDirectory,
  secureRemoveFile,
  staleLockCanBeReclaimed,
  transactionPaths,
  throwIfAborted,
  validateJournal,
  waitForPublicationLock,
  withArtifactRead,
}
