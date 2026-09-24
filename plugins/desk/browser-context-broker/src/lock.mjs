import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
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

export async function withBrokerLock(stateDir, fn, options = {}) {
  const {
    name = 'broker',
    timeoutMs = 5_000,
    pollMs = 10,
    staleMs = 30_000,
    processIdentityReader = readProcessStartIdentity,
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
      await writeFile(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({
          token,
          pid: process.pid,
          startIdentity,
          createdAt: new Date().toISOString(),
        }),
        { mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lockAge;
      let owner;
      try {
        owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
        lockAge = Date.now() - Date.parse(owner.createdAt);
      } catch {
        try {
          lockAge = Date.now() - (await stat(lockPath)).mtimeMs;
        } catch (statError) {
          if (statError.code === 'ENOENT') continue;
          throw statError;
        }
      }
      if (lockAge > staleMs) {
        const ownerState = await inspectOwner(owner, processIdentityReader);
        if (ownerState !== 'absent' && ownerState !== 'replaced') {
          throw new BrokerError('STALE_BROKER_LOCK', `Broker lock "${name}" is stale`, {
            name,
            ageMs: lockAge,
            ownerState,
          });
        }
        const currentOwner = await readFile(path.join(lockPath, 'owner.json'), 'utf8')
          .then((content) => JSON.parse(content))
          .catch(() => undefined);
        if (
          currentOwner?.token !== owner.token ||
          currentOwner?.pid !== owner.pid ||
          currentOwner?.startIdentity !== owner.startIdentity
        ) {
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
