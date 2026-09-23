import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { BrokerError } from './claims.mjs';
import { ensureStateDirectory } from './registry.mjs';

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withBrokerLock(stateDir, fn, options = {}) {
  const {
    name = 'broker',
    timeoutMs = 5_000,
    pollMs = 10,
    staleMs = 30_000,
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

  for (;;) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await writeFile(
        path.join(lockPath, 'owner.json'),
        JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }),
        { mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let lockAge;
      try {
        const owner = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
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
        throw new BrokerError('STALE_BROKER_LOCK', `Broker lock "${name}" is stale`, {
          name,
          ageMs: lockAge,
        });
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
