import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { BrokerError } from './claims.mjs';
import { ensureStateDirectory } from './registry.mjs';

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const execFileAsync = promisify(execFile);

async function readProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Process PID is invalid');
  }
  if (process.platform === 'linux') {
    try {
      const processStat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const fields = processStat.slice(processStat.lastIndexOf(')') + 2).split(' ');
      const startTicks = fields[19];
      if (!startTicks) throw new Error('Process start identity is unavailable');
      return `linux:${startTicks}`;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return undefined;
      throw error;
    }
  }
  if (process.platform === 'darwin') {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return undefined;
      if (error.code !== 'EPERM') throw error;
    }
    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', maxBuffer: 4_096 },
    );
    const startIdentity = stdout.trim();
    if (!startIdentity) throw new Error('Process start identity is unavailable');
    return `darwin:${startIdentity}`;
  }
  throw new Error(`Process start identity is unsupported on ${process.platform}`);
}

async function inspectOwner(owner, processIdentityReader) {
  if (
    !owner ||
    typeof owner.token !== 'string' ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    typeof owner.startIdentity !== 'string' ||
    !owner.startIdentity
  ) {
    return 'unknown';
  }
  try {
    const observedStartIdentity = await processIdentityReader(owner.pid);
    if (observedStartIdentity === undefined) return 'absent';
    return observedStartIdentity === owner.startIdentity ? 'alive' : 'replaced';
  } catch {
    return 'unknown';
  }
}

function parseOwner(content) {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function isCompleteOwner(owner) {
  return Boolean(
    owner &&
    typeof owner.token === 'string' &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.startIdentity === 'string' &&
    owner.startIdentity &&
    typeof owner.createdAt === 'string' &&
    Number.isFinite(Date.parse(owner.createdAt)),
  );
}

async function readLockEvidence(lockPath) {
  const lockStat = await stat(lockPath);
  const names = (await readdir(lockPath)).sort();
  const files = [];
  for (const name of names) {
    if (name !== 'owner.json' && !/^\.owner-.*\.tmp$/u.test(name)) continue;
    const content = await readFile(path.join(lockPath, name), 'utf8').catch(
      () => undefined,
    );
    files.push({ name, content });
  }
  const ownerContent = files.find(({ name }) => name === 'owner.json')?.content;
  const tempOwners = files
    .filter(({ name }) => name !== 'owner.json')
    .map(({ content }) => parseOwner(content))
    .filter(isCompleteOwner);
  return {
    lockStat,
    owner: parseOwner(ownerContent),
    tempOwners,
    fingerprint: JSON.stringify({
      dev: lockStat.dev,
      ino: lockStat.ino,
      mtimeMs: lockStat.mtimeMs,
      files,
    }),
  };
}

async function publishOwnerAtomically(lockPath, owner) {
  const temporaryPath = path.join(lockPath, `.owner-${owner.token}.tmp`);
  await writeFile(temporaryPath, JSON.stringify(owner), { mode: 0o600 });
  await rename(temporaryPath, path.join(lockPath, 'owner.json'));
}

export async function withBrokerLock(stateDir, fn, options = {}) {
  const {
    name = 'broker',
    timeoutMs = 5_000,
    pollMs = 10,
    staleMs = 30_000,
    processIdentityReader = readProcessStartIdentity,
    ownerPublisher = publishOwnerAtomically,
  } = options;
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    throw new BrokerError('INVALID_LOCK_NAME', 'Broker lock name contains unsupported path syntax', {
      name,
    });
  }
  await ensureStateDirectory(stateDir);
  const lockPath = path.join(stateDir, `${name}.lock`);
  const token = randomUUID();
  const started = Date.now();
  let startIdentity;
  try {
    startIdentity = await processIdentityReader(process.pid);
  } catch (cause) {
    throw new BrokerError(
      'BROKER_LOCK_IDENTITY_UNAVAILABLE',
      'Broker lock owner process identity could not be determined',
      { name, cause: cause.message },
    );
  }
  if (!startIdentity) {
    throw new BrokerError(
      'BROKER_LOCK_IDENTITY_UNAVAILABLE',
      'Broker lock owner process identity could not be determined',
      { name },
    );
  }

  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await ownerPublisher(lockPath, {
          token,
          pid: process.pid,
          startIdentity,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let evidence;
      try {
        evidence = await readLockEvidence(lockPath);
      } catch (evidenceError) {
        if (evidenceError.code === 'ENOENT') continue;
        throw evidenceError;
      }
      const owner = isCompleteOwner(evidence.owner) ? evidence.owner : undefined;
      const createdAtMs = owner
        ? Date.parse(owner.createdAt)
        : evidence.lockStat.birthtimeMs || evidence.lockStat.ctimeMs;
      const lockAge = Date.now() - createdAtMs;
      if (lockAge > staleMs) {
        let ownerState = owner
          ? await inspectOwner(owner, processIdentityReader)
          : 'absent';
        if (!owner) {
          for (const tempOwner of evidence.tempOwners) {
            const tempOwnerState = await inspectOwner(
              tempOwner,
              processIdentityReader,
            );
            if (tempOwnerState === 'alive' || tempOwnerState === 'unknown') {
              ownerState = tempOwnerState;
              break;
            }
          }
        }
        if (ownerState !== 'absent' && ownerState !== 'replaced') {
          throw new BrokerError('STALE_BROKER_LOCK', `Broker lock "${name}" is stale`, {
            name,
            ageMs: lockAge,
            ownerState,
          });
        }
        const currentEvidence = await readLockEvidence(lockPath).catch(
          (currentError) => {
            if (currentError.code === 'ENOENT') return undefined;
            throw currentError;
          },
        );
        if (!currentEvidence) continue;
        if (currentEvidence.fingerprint !== evidence.fingerprint) {
          throw new BrokerError(
            'STALE_BROKER_LOCK',
            `Broker lock "${name}" changed during stale-owner verification`,
            { name, ageMs: lockAge, ownerState: 'unknown' },
          );
        }
        const reclaimedPath = path.join(
          stateDir,
          `.${name}.reclaimed-${token}-${randomUUID()}`,
        );
        try {
          await rename(lockPath, reclaimedPath);
        } catch (renameError) {
          if (renameError.code === 'ENOENT') continue;
          throw renameError;
        }
        await rm(reclaimedPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new BrokerError('BROKER_LOCK_TIMEOUT', `Timed out waiting for broker lock "${name}"`, {
          name,
          timeoutMs,
        });
      }
      await delay(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
      if (owner.token === token) await rm(lockPath, { recursive: true });
    } catch {
      // An externally removed lock is already released.
    }
  }
}
