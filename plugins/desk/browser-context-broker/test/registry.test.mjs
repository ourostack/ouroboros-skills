import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { withBrokerLock } from '../src/lock.mjs';
import {
  readRegistry,
  reconcileContext,
  writeRegistry,
} from '../src/registry.mjs';

const scratchRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '.state',
);

async function stateDir() {
  const directory = path.join(scratchRoot, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

test.after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

const declaration = {
  id: 'requested',
  claims: { surface: 'work' },
  launch: {
    executable: '/opt/browser',
    profileRoot: '/profiles/requested',
  },
};

const identity = {
  pid: 123,
  startIdentity: 'start-1',
  owner: 'operator',
  executable: '/opt/browser',
  profileRoot: '/profiles/requested',
};

function provider(attestation) {
  return async (operation, payload) => {
    assert.equal(operation, 'attest');
    assert.equal(payload.declaration.id, 'requested');
    return attestation;
  };
}

test('writeRegistry uses an atomic replacement and leaves no partial files', async () => {
  const directory = await stateDir();
  const registry = {
    version: 1,
    contexts: {
      requested: { contextId: 'requested', processIdentity: identity },
      unrelated: { contextId: 'unrelated', endpoint: 'http://127.0.0.1:41001' },
    },
    leases: {},
  };

  await writeRegistry(directory, registry);

  assert.deepEqual(await readRegistry(directory), registry);
  assert.deepEqual((await readdir(directory)).sort(), ['registry.json']);
  assert.equal((await stat(path.join(directory, 'registry.json'))).mode & 0o077, 0);
});

test('withBrokerLock serializes writers and removes its exact lock', async () => {
  const directory = await stateDir();
  const order = [];
  let releaseFirst;
  let firstEntered;
  const firstHeld = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    firstEntered = resolve;
  });

  const first = withBrokerLock(directory, async () => {
    order.push('first-start');
    firstEntered();
    await firstHeld;
    order.push('first-end');
  });
  await firstStarted;
  const second = withBrokerLock(directory, async () => {
    order.push('second');
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['first-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second']);
  assert.deepEqual(await readdir(directory), []);
});

test('withBrokerLock reclaims a stale lock after proving its PID is a different generation', async () => {
  const directory = await stateDir();
  const lockPath = path.join(directory, 'broker.lock');
  await mkdir(lockPath, { mode: 0o700 });
  await writeFile(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({
      token: 'stale-owner',
      pid: process.pid,
      startIdentity: 'prior-generation',
      createdAt: new Date(0).toISOString(),
    }),
    { mode: 0o600 },
  );
  let entered = false;

  await withBrokerLock(
    directory,
    async () => {
      entered = true;
    },
    {
      staleMs: 0,
      processIdentityReader: async (pid) => {
        assert.equal(pid, process.pid);
        return 'current-generation';
      },
    },
  );

  assert.equal(entered, true);
  assert.deepEqual(await readdir(directory), []);
});

for (const [ownerState, createProcessIdentityReader] of [
  ['alive', () => async () => 'exact-generation'],
  ['unknown', () => {
    let calls = 0;
    return async () => {
      calls += 1;
      if (calls === 1) return 'exact-generation';
      throw new Error('process inspection unavailable');
    };
  }],
]) {
  test(`withBrokerLock fails closed when a stale owner generation is ${ownerState}`, async () => {
    const directory = await stateDir();
    const lockPath = path.join(directory, 'broker.lock');
    await mkdir(lockPath, { mode: 0o700 });
    await writeFile(
      path.join(lockPath, 'owner.json'),
      JSON.stringify({
        token: 'stale-owner',
        pid: process.pid,
        startIdentity: 'exact-generation',
        createdAt: new Date(0).toISOString(),
      }),
      { mode: 0o600 },
    );

    await assert.rejects(
      withBrokerLock(directory, async () => {}, {
        staleMs: 0,
        processIdentityReader: createProcessIdentityReader(),
      }),
      (error) =>
        error.code === 'STALE_BROKER_LOCK' &&
        error.details.ownerState === ownerState,
    );
  });
}

test('readRegistry rejects a state directory accessible by other users', async () => {
  const directory = await stateDir();
  await chmod(directory, 0o755);
  await assert.rejects(
    readRegistry(directory),
    (error) => error.code === 'INSECURE_STATE_DIRECTORY',
  );
});

test('reconcileContext removes a stale observation when the process is absent', async () => {
  const result = await reconcileContext(
    declaration,
    { contextId: 'requested', processIdentity: identity },
    provider({ healthy: false, reason: 'PROCESS_ABSENT' }),
  );

  assert.deepEqual(result, {
    status: 'absent',
    reason: 'PROCESS_ABSENT',
    discardObservation: true,
  });
});

test('reconcileContext rejects PID reuse through start identity mismatch', async () => {
  const result = await reconcileContext(
    declaration,
    { contextId: 'requested', processIdentity: identity },
    provider({
      healthy: true,
      endpoint: 'http://127.0.0.1:41000',
      processIdentity: { ...identity, startIdentity: 'start-2' },
    }),
  );

  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'PROCESS_IDENTITY_MISMATCH');
  assert.equal(result.discardObservation, true);
});

for (const [name, replacement] of [
  ['profile root', { profileRoot: '/profiles/other' }],
  ['owner', { owner: 'someone-else' }],
  ['executable', { executable: '/opt/other-browser' }],
]) {
  test(`reconcileContext rejects mismatched ${name}`, async () => {
    const result = await reconcileContext(
      declaration,
      { contextId: 'requested', processIdentity: identity },
      provider({
        healthy: true,
        endpoint: 'http://127.0.0.1:41000',
        processIdentity: { ...identity, ...replacement },
      }),
    );

    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'PROCESS_IDENTITY_MISMATCH');
  });
}

test('reconcileContext rejects an endpoint not correlated to the attested process', async () => {
  const result = await reconcileContext(
    declaration,
    { contextId: 'requested', processIdentity: identity },
    provider({
      healthy: true,
      endpoint: 'http://127.0.0.1:41000',
      endpointProcessIdentity: { pid: 999, startIdentity: 'other' },
      processIdentity: identity,
    }),
  );

  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'ENDPOINT_PROCESS_MISMATCH');
});

test('reconcileContext accepts only fresh complete attestation', async () => {
  const result = await reconcileContext(
    declaration,
    { contextId: 'requested', processIdentity: identity },
    provider({
      healthy: true,
      endpoint: 'http://127.0.0.1:41000',
      endpointProcessIdentity: {
        pid: identity.pid,
        startIdentity: identity.startIdentity,
      },
      processIdentity: identity,
    }),
  );

  assert.equal(result.status, 'healthy');
  assert.equal(result.endpoint, 'http://127.0.0.1:41000');
  assert.deepEqual(result.processIdentity, identity);
});

test('updating one context preserves unrelated registry records', async () => {
  const directory = await stateDir();
  const registry = {
    version: 1,
    contexts: {
      requested: { contextId: 'requested', endpoint: 'old' },
      unrelated: { contextId: 'unrelated', endpoint: 'keep' },
    },
    leases: {},
  };
  await writeRegistry(directory, registry);

  await withBrokerLock(directory, async () => {
    const current = await readRegistry(directory);
    current.contexts.requested = { contextId: 'requested', endpoint: 'new' };
    await writeRegistry(directory, current);
  });

  assert.equal((await readRegistry(directory)).contexts.unrelated.endpoint, 'keep');
});
