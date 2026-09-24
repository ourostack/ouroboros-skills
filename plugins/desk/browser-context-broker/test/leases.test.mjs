import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';

import { acquireContext } from '../src/broker.mjs';
import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import { createLease, releaseLease } from '../src/leases.mjs';
import { readRegistry } from '../src/registry.mjs';
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
