import assert from 'node:assert/strict';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';

import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import { createLease, releaseLease } from '../src/leases.mjs';
import { readRegistry } from '../src/registry.mjs';
import { startFakeCdpServer } from './fixtures/fake-cdp-server.mjs';

const scratchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.lease-state');

async function stateDir() {
  const directory = path.join(scratchRoot, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

test.after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

test('N concurrent leases receive distinct initial targets and isolated target views', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const leases = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      createLease({
        stateDir: directory,
        context: { id: 'shared', claims: { surface: 'work' } },
        owner: `agent-${index}`,
        rawEndpoint: fake.endpoint,
      })),
  );
  const proxies = await Promise.all(
    leases.map((lease) =>
      startLeaseProxy({
        stateDir: directory,
        leaseId: lease.id,
        rawEndpoint: fake.endpoint,
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

test('release closes only owned targets, preserves other leases, and leaves browser alive', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const first = await createLease({
    stateDir: directory,
    context: { id: 'shared', claims: {} },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
  });
  const second = await createLease({
    stateDir: directory,
    context: { id: 'shared', claims: {} },
    owner: 'agent-b',
    rawEndpoint: fake.endpoint,
  });

  await releaseLease({
    stateDir: directory,
    leaseId: first.id,
    rawEndpoint: fake.endpoint,
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
