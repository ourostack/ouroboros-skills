import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

import { acquireContext } from '../src/broker.mjs';
import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import {
  addOwnedTarget,
  cleanupStaleLease,
  createLease,
  heartbeatLease,
  releaseLease,
  withLeaseOperation,
} from '../src/leases.mjs';
import { readRegistry, writeRegistry } from '../src/registry.mjs';
import { startFakeCdpServer } from './fixtures/fake-cdp-server.mjs';

const scratchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.lease-state');
const holdLeaseLockFixture = new URL('./fixtures/hold-lease-lock.mjs', import.meta.url);

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
  id: 'shared',
  claims: { surface: 'work' },
  launch: {
    executable: '/opt/browser',
    profileRoot: '/profiles/shared',
  },
};

const processIdentity = {
  pid: 700,
  startIdentity: 'start-700',
  owner: 'operator',
  executable: declaration.launch.executable,
  profileRoot: declaration.launch.profileRoot,
};

function attestingProvider(operation, payload) {
  assert.equal(operation, 'attest');
  return Promise.resolve({
    healthy: true,
    endpoint: payload.observation.endpoint,
    processIdentity: payload.observation.processIdentity,
    endpointProcessIdentity: {
      pid: payload.observation.processIdentity.pid,
      startIdentity: payload.observation.processIdentity.startIdentity,
    },
  });
}

test('N concurrent leases receive distinct initial targets and isolated target views', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const leases = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createLease({
        stateDir: directory,
        context: declaration,
        owner: `agent-${index}`,
        rawEndpoint: fake.endpoint,
        processIdentity,
      })),
  );
  const proxies = await Promise.all(
    leases.map((lease) =>
      startLeaseProxy({
        stateDir: directory,
        leaseId: lease.id,
        declaration,
        providerInvoker: attestingProvider,
      })),
  );

  try {
    assert.equal(new Set(leases.flatMap(({ targetIds }) => targetIds)).size, 4);
    for (let index = 0; index < proxies.length; index += 1) {
      const socket = new WebSocket(proxies[index].webSocketEndpoint);
      await new Promise((resolve) => socket.once('open', resolve));
      const response = await new Promise((resolve) => {
        socket.once('message', (data) => resolve(JSON.parse(data.toString())));
        socket.send(JSON.stringify({ id: 1, method: 'Target.getTargets', params: {} }));
      });
      assert.deepEqual(
        response.result.targetInfos.map(({ targetId }) => targetId),
        leases[index].targetIds,
      );
      socket.close();
    }
  } finally {
    await Promise.all(proxies.map(({ close }) => close()));
    await fake.close();
  }
});

test('concurrent acquisitions provision one shared context and create distinct leases and targets', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  let launchCount = 0;
  const providerInvoker = async (operation, payload) => {
    if (operation === 'discover') {
      return payload.observation
        ? { found: true, observation: payload.observation }
        : { found: false };
    }
    if (operation === 'launch') {
      launchCount += 1;
      return {
        observation: {
          contextId: declaration.id,
          endpoint: fake.endpoint,
          processIdentity,
        },
      };
    }
    if (operation === 'attest') return attestingProvider(operation, payload);
    throw new Error(`unexpected operation ${operation}`);
  };

  const acquisitions = await Promise.all(
    Array.from({ length: 4 }, () =>
      acquireContext({
        config: { contexts: [declaration] },
        request: { surface: 'work' },
        stateDir: directory,
        providerInvoker,
        endpointAllocator: async () => fake.endpoint,
      })),
  );
  const leases = await Promise.all(
    acquisitions.map((acquired, index) =>
      createLease({
        stateDir: directory,
        context: acquired.context,
        owner: `agent-${index}`,
        rawEndpoint: acquired.rawEndpoint,
        processIdentity: acquired.processIdentity,
      })),
  );

  assert.equal(launchCount, 1);
  assert.equal(acquisitions.length, 4);
  assert.equal(leases.length, 4);
  assert.equal(new Set(leases.map(({ id }) => id)).size, 4);
  assert.equal(new Set(leases.flatMap(({ targetIds }) => targetIds)).size, 4);
  await fake.close();
});

test('lease persists its acquired endpoint and attested process generation', async (t) => {
  const fake = await startFakeCdpServer();
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });

  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.equal(persisted.rawEndpoint, fake.endpoint);
  assert.deepEqual(persisted.processIdentity, processIdentity);
});

test('release fails disconnected when fresh attestation observes another process generation', async (t) => {
  const fake = await startFakeCdpServer();
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });

  await assert.rejects(
    releaseLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: async () => ({
        healthy: true,
        endpoint: fake.endpoint,
        processIdentity: { ...processIdentity, startIdentity: 'replacement-generation' },
        endpointProcessIdentity: {
          pid: processIdentity.pid,
          startIdentity: 'replacement-generation',
        },
      }),
    }),
    (error) => error.code === 'CONTEXT_DISCONNECTED',
  );
  assert.ok((await readRegistry(directory)).leases[lease.id]);
  assert.ok(fake.targets.has(lease.targetIds[0]));
});

test('cleanup rejects when a heartbeat renews a lease after stale observation', async (t) => {
  const fake = await startFakeCdpServer();
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  const registry = await readRegistry(directory);
  registry.leases[lease.id].expiresAt = new Date(0).toISOString();
  await writeRegistry(directory, registry);

  const observedByCleanupCli = (await readRegistry(directory)).leases[lease.id];
  assert.ok(Date.parse(observedByCleanupCli.expiresAt) <= Date.now());
  await heartbeatLease(directory, lease.id);

  await assert.rejects(
    cleanupStaleLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
    }),
    (error) => error.code === 'LEASE_NOT_STALE',
  );

  const current = (await readRegistry(directory)).leases[lease.id];
  assert.ok(current);
  assert.ok(Date.parse(current.expiresAt) > Date.now());
  assert.ok(fake.targets.has(lease.targetIds[0]));
});

test('heartbeat serializes with and refuses a releasing lease', async (t) => {
  const fake = await startFakeCdpServer();
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  let entered;
  let unblock;
  const operationEntered = new Promise((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise((resolve) => {
    unblock = resolve;
  });
  const releasing = withLeaseOperation(directory, lease.id, async () => {
    const registry = await readRegistry(directory);
    registry.leases[lease.id].releasing = true;
    await writeRegistry(directory, registry);
    entered();
    await blocked;
  });
  await operationEntered;

  let heartbeatSettled = false;
  const heartbeat = heartbeatLease(directory, lease.id).finally(() => {
    heartbeatSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(heartbeatSettled, false);

  unblock();
  await releasing;
  await assert.rejects(heartbeat, (error) => error.code === 'LEASE_RELEASING');
  const current = (await readRegistry(directory)).leases[lease.id];
  assert.equal(current.releasing, true);
  assert.equal(current.expiresAt, lease.expiresAt);
});

test('release serializes with late target creation and leaves no leaked target', async () => {
  let allowCreate;
  let createStarted;
  const blocked = new Promise((resolve) => {
    allowCreate = resolve;
  });
  const started = new Promise((resolve) => {
    createStarted = resolve;
  });
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createStarted();
      await blocked;
    },
  });
  const directory = await stateDir();
  const creating = createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  await started;
  const registry = await readRegistry(directory);
  const [leaseId] = Object.keys(registry.leases);
  if (!leaseId) {
    allowCreate();
    await creating;
    await fake.close();
    assert.fail('ownership must be durable before target creation completes');
  }

  const releasing = releaseLease({
    stateDir: directory,
    leaseId,
    declaration,
    providerInvoker: attestingProvider,
  });
  allowCreate();
  await creating;
  await releasing;

  assert.equal((await readRegistry(directory)).leases[leaseId], undefined);
  assert.deepEqual([...fake.targets.keys()], ['unowned-existing']);
  await fake.close();
});

test('release reclaims a stale lease operation lock after its exact owner process terminates', async (t) => {
  const fake = await startFakeCdpServer();
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  const child = spawn(process.execPath, [
    holdLeaseLockFixture.pathname,
    directory,
    lease.id,
  ], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  });
  child.stdout.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', (chunk) => {
      assert.match(chunk, /locked/u);
      resolve();
    });
  });
  const lockName = `lease-${createHash('sha256').update(lease.id).digest('hex')}`;
  const ownerPath = path.join(directory, `${lockName}.lock`, 'owner.json');

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('close', resolve));
  const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
  await writeFile(
    ownerPath,
    JSON.stringify({ ...owner, createdAt: new Date(0).toISOString() }),
    { mode: 0o600 },
  );

  const result = await releaseLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });

  assert.equal(result.released, true);
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
  assert.ok(!fake.targets.has(lease.targetIds[0]));
});

test('release closes only owned targets, preserves other leases, and leaves browser alive', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const first = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  const second = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-b',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });

  await releaseLease({
    stateDir: directory,
    leaseId: first.id,
    declaration,
    providerInvoker: attestingProvider,
  });

  const registry = await readRegistry(directory);
  assert.equal(registry.leases[first.id], undefined);
  assert.ok(registry.leases[second.id]);
  assert.ok(!fake.targets.has(first.targetIds[0]));
  assert.ok(fake.targets.has(second.targetIds[0]));
  const version = await fetch(`${fake.endpoint}/json/version`).then((response) => response.json());
  assert.equal(version.Browser, 'GenericBrowser/1');
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.close'));

  await fake.close();
});

test('release retains failed target ownership and retries only the failed targets', async (t) => {
  let failTarget = true;
  const fake = await startFakeCdpServer({
    closeTarget: async (message, targets) => {
      if (message.params.targetId === 'target-retry' && failTarget) {
        return { success: false };
      }
      return { success: targets.delete(message.params.targetId) };
    },
  });
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  fake.emitTargetCreated({
    targetId: 'target-retry',
    type: 'page',
    title: '',
    url: 'about:blank',
    browserContextId: 'default',
  });
  await addOwnedTarget(directory, lease.id, 'target-retry');

  await assert.rejects(
    releaseLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
    }),
    (error) =>
      error.code === 'PARTIAL_RELEASE' &&
      error.details.leaseId === lease.id &&
      error.details.failedTargetIds.length === 1 &&
      error.details.failedTargetIds[0] === 'target-retry',
  );
  const retained = (await readRegistry(directory)).leases[lease.id];
  assert.deepEqual(retained.targetIds, ['target-retry']);
  assert.equal(retained.releasing, true);
  assert.ok(!fake.targets.has(lease.targetIds[0]));
  assert.ok(fake.targets.has('target-retry'));

  failTarget = false;
  const retried = await releaseLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });

  assert.deepEqual(retried, {
    leaseId: lease.id,
    released: true,
    closedTargetIds: ['target-retry'],
    failedTargetIds: [],
  });
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
  assert.ok(!fake.targets.has('target-retry'));
});

test('release records a silent close as failed and releases its operation lock for retry', async (t) => {
  let silenceClose = true;
  const fake = await startFakeCdpServer({
    beforeRequest: async (message) => {
      if (message.method === 'Target.closeTarget' && silenceClose) {
        await new Promise(() => {});
      }
    },
  });
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });

  await assert.rejects(
    releaseLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
      cdpClientOptions: { commandTimeoutMs: 25 },
    }),
    (error) =>
      error.code === 'PARTIAL_RELEASE' &&
      error.details.failedTargetIds[0] === lease.targetIds[0],
  );
  const retained = (await readRegistry(directory)).leases[lease.id];
  assert.deepEqual(retained.targetIds, lease.targetIds);
  assert.equal(retained.releasing, true);

  silenceClose = false;
  const retried = await Promise.race([
    releaseLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
      cdpClientOptions: { commandTimeoutMs: 25 },
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('release operation lock was not released')),
      500,
    )),
  ]);

  assert.equal(retried.released, true);
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
});

test('stale cleanup retains targets whose close throws and retries only those targets', async (t) => {
  let throwForTarget = true;
  const fake = await startFakeCdpServer({
    closeTarget: async (message, targets) => {
      if (message.params.targetId === 'target-retry' && throwForTarget) {
        throw new Error('close failed');
      }
      return { success: targets.delete(message.params.targetId) };
    },
  });
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  fake.emitTargetCreated({
    targetId: 'target-retry',
    type: 'page',
    title: '',
    url: 'about:blank',
    browserContextId: 'default',
  });
  await addOwnedTarget(directory, lease.id, 'target-retry');
  const registry = await readRegistry(directory);
  registry.leases[lease.id].expiresAt = new Date(0).toISOString();
  await writeRegistry(directory, registry);

  const partial = await cleanupStaleLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });

  assert.deepEqual(partial, {
    leaseId: lease.id,
    released: false,
    closedTargetIds: [lease.targetIds[0]],
    failedTargetIds: ['target-retry'],
  });
  const retained = (await readRegistry(directory)).leases[lease.id];
  assert.deepEqual(retained.targetIds, ['target-retry']);
  assert.equal(retained.releasing, false);
  assert.ok(!fake.targets.has(lease.targetIds[0]));
  assert.ok(fake.targets.has('target-retry'));

  throwForTarget = false;
  const retried = await cleanupStaleLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });

  assert.deepEqual(retried, {
    leaseId: lease.id,
    released: true,
    closedTargetIds: ['target-retry'],
    failedTargetIds: [],
  });
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
  assert.ok(!fake.targets.has('target-retry'));
});

test('stale cleanup records a silent close as failed and releases its operation lock for retry', async (t) => {
  let silenceClose = true;
  const fake = await startFakeCdpServer({
    beforeRequest: async (message) => {
      if (message.method === 'Target.closeTarget' && silenceClose) {
        await new Promise(() => {});
      }
    },
  });
  t.after(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  const registry = await readRegistry(directory);
  registry.leases[lease.id].expiresAt = new Date(0).toISOString();
  await writeRegistry(directory, registry);

  const partial = await cleanupStaleLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
    cdpClientOptions: { commandTimeoutMs: 25 },
  });

  assert.deepEqual(partial, {
    leaseId: lease.id,
    released: false,
    closedTargetIds: [],
    failedTargetIds: lease.targetIds,
  });
  const retained = (await readRegistry(directory)).leases[lease.id];
  assert.deepEqual(retained.targetIds, lease.targetIds);
  assert.equal(retained.releasing, false);

  silenceClose = false;
  const retried = await Promise.race([
    cleanupStaleLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
      cdpClientOptions: { commandTimeoutMs: 25 },
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('cleanup operation lock was not released')),
      500,
    )),
  ]);

  assert.equal(retried.released, true);
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
});
