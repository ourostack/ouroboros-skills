import assert from 'node:assert/strict';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { acquireContext } from '../src/broker.mjs';
import { readRegistry, writeRegistry } from '../src/registry.mjs';

const scratchRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '.broker-state',
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

const requestedDeclaration = {
  id: 'requested',
  claims: {
    surface: 'work',
    identity: 'requested@example.test',
    persistence: 'persistent',
  },
  launch: {
    executable: '/opt/browser',
    profileRoot: '/profiles/requested',
  },
};

const unrelatedDeclaration = {
  id: 'unrelated',
  claims: {
    surface: 'work',
    identity: 'unrelated@example.test',
    persistence: 'persistent',
  },
  launch: {
    executable: '/opt/browser',
    profileRoot: '/profiles/unrelated',
  },
};

const config = {
  contexts: [requestedDeclaration, unrelatedDeclaration],
  endpoint: { host: '127.0.0.1' },
};

function processIdentity(declaration, pid = 100) {
  return {
    pid,
    startIdentity: `start-${pid}`,
    owner: 'operator',
    executable: declaration.launch.executable,
    profileRoot: declaration.launch.profileRoot,
  };
}

function healthy(declaration, endpoint, pid = 100) {
  const identity = processIdentity(declaration, pid);
  return {
    healthy: true,
    endpoint,
    processIdentity: identity,
    endpointProcessIdentity: {
      pid: identity.pid,
      startIdentity: identity.startIdentity,
    },
  };
}

test('ignores an unrelated lower-endpoint browser and provisions the absent requested context', async () => {
  const directory = await stateDir();
  await writeRegistry(directory, {
    version: 1,
    contexts: {
      unrelated: {
        contextId: 'unrelated',
        endpoint: 'http://127.0.0.1:40000',
        processIdentity: processIdentity(unrelatedDeclaration, 200),
      },
    },
    leases: {},
  });
  const operations = [];
  const providerInvoker = async (operation, payload) => {
    operations.push({ operation, contextId: payload.declaration.id, endpoint: payload.endpoint });
    assert.equal(payload.declaration.id, 'requested');
    if (operation === 'discover') return { found: false };
    if (operation === 'launch') {
      return {
        observation: {
          contextId: 'requested',
          endpoint: payload.endpoint,
          processIdentity: processIdentity(requestedDeclaration, 300),
        },
      };
    }
    if (operation === 'attest') return healthy(requestedDeclaration, payload.observation.endpoint, 300);
    throw new Error(`unexpected operation ${operation}`);
  };

  const result = await acquireContext({
    config,
    request: { surface: 'work', identity: 'requested@example.test' },
    stateDir: directory,
    providerInvoker,
    endpointAllocator: async () => 'http://127.0.0.1:45000',
  });

  assert.equal(result.context.id, 'requested');
  assert.equal(result.rawEndpoint, 'http://127.0.0.1:45000');
  assert.equal(result.recovery, 'provisioned');
  assert.deepEqual(
    operations.map(({ operation }) => operation),
    ['discover', 'launch', 'attest'],
  );
  assert.equal((await readRegistry(directory)).contexts.unrelated.endpoint, 'http://127.0.0.1:40000');
});

test('reuses a freshly discovered requested context regardless of endpoint ordering', async () => {
  const directory = await stateDir();
  const observation = {
    contextId: 'requested',
    endpoint: 'http://127.0.0.1:49999',
    processIdentity: processIdentity(requestedDeclaration, 500),
  };
  const operations = [];

  const result = await acquireContext({
    config,
    request: { surface: 'work', identity: 'requested@example.test' },
    stateDir: directory,
    providerInvoker: async (operation, payload) => {
      operations.push(operation);
      if (operation === 'discover') return { found: true, observation };
      if (operation === 'attest') return healthy(requestedDeclaration, observation.endpoint, 500);
      throw new Error(`unexpected operation ${operation}`);
    },
  });

  assert.equal(result.rawEndpoint, observation.endpoint);
  assert.equal(result.recovery, 'reused');
  assert.deepEqual(operations, ['discover', 'attest']);
});

test('retries with a new dynamic endpoint after a collision', async () => {
  const directory = await stateDir();
  const endpoints = ['http://127.0.0.1:45001', 'http://127.0.0.1:45002'];
  let launchCount = 0;

  const result = await acquireContext({
    config,
    request: { surface: 'work', identity: 'requested@example.test' },
    stateDir: directory,
    endpointAllocator: async () => endpoints.shift(),
    providerInvoker: async (operation, payload) => {
      if (operation === 'discover') return { found: false };
      if (operation === 'launch') {
        launchCount += 1;
        if (launchCount === 1) return { ok: false, code: 'ENDPOINT_COLLISION' };
        return {
          observation: {
            contextId: 'requested',
            endpoint: payload.endpoint,
            processIdentity: processIdentity(requestedDeclaration, 600),
          },
        };
      }
      if (operation === 'attest') return healthy(requestedDeclaration, payload.observation.endpoint, 600);
      throw new Error(`unexpected operation ${operation}`);
    },
  });

  assert.equal(result.rawEndpoint, 'http://127.0.0.1:45002');
  assert.equal(launchCount, 2);
});

test('repairs stale registry state only for the requested context', async () => {
  const directory = await stateDir();
  await writeRegistry(directory, {
    version: 1,
    contexts: {
      requested: {
        contextId: 'requested',
        endpoint: 'http://127.0.0.1:41000',
        processIdentity: processIdentity(requestedDeclaration, 700),
      },
      unrelated: {
        contextId: 'unrelated',
        endpoint: 'http://127.0.0.1:41001',
        processIdentity: processIdentity(unrelatedDeclaration, 701),
      },
    },
    leases: {},
  });
  let launched = false;

  const result = await acquireContext({
    config,
    request: { surface: 'work', identity: 'requested@example.test' },
    stateDir: directory,
    endpointAllocator: async () => 'http://127.0.0.1:46000',
    providerInvoker: async (operation, payload) => {
      if (operation === 'discover') return { found: true, observation: payload.observation };
      if (operation === 'attest' && !launched) return { healthy: false, reason: 'PROCESS_ABSENT' };
      if (operation === 'launch') {
        launched = true;
        return {
          observation: {
            contextId: 'requested',
            endpoint: payload.endpoint,
            processIdentity: processIdentity(requestedDeclaration, 702),
          },
        };
      }
      if (operation === 'attest') return healthy(requestedDeclaration, payload.observation.endpoint, 702);
      throw new Error(`unexpected operation ${operation}`);
    },
  });

  assert.equal(result.recovery, 'recovered');
  const registry = await readRegistry(directory);
  assert.equal(registry.contexts.requested.endpoint, 'http://127.0.0.1:46000');
  assert.equal(registry.contexts.unrelated.endpoint, 'http://127.0.0.1:41001');
});

test('does not publish a launch that fails attestation', async () => {
  const directory = await stateDir();
  await assert.rejects(
    acquireContext({
      config,
      request: { surface: 'work', identity: 'requested@example.test' },
      stateDir: directory,
      endpointAllocator: async () => 'http://127.0.0.1:47000',
      providerInvoker: async (operation, payload) => {
        if (operation === 'discover') return { found: false };
        if (operation === 'launch') {
          return {
            observation: {
              contextId: 'requested',
              endpoint: payload.endpoint,
              processIdentity: processIdentity(requestedDeclaration, 800),
            },
          };
        }
        if (operation === 'attest') return { healthy: false, reason: 'VISIBLE_CLAIM_MISMATCH' };
        throw new Error(`unexpected operation ${operation}`);
      },
    }),
    (error) =>
      error.code === 'LAUNCH_ATTESTATION_FAILED' &&
      error.details.reason === 'VISIBLE_CLAIM_MISMATCH',
  );
  assert.equal((await readRegistry(directory)).contexts.requested, undefined);
});
