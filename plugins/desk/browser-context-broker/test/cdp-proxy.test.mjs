import assert from 'node:assert/strict';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';

import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import { createLease } from '../src/leases.mjs';
import { startFakeCdpServer } from './fixtures/fake-cdp-server.mjs';

const scratchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.proxy-state');
const cleanups = [];

async function stateDir() {
  const directory = path.join(scratchRoot, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

async function openSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function exchange(socket) {
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    } else {
      events.push(message);
    }
  });
  return {
    events,
    send(method, params = {}) {
      const requestId = ++id;
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return new Promise((resolve) => pending.set(requestId, resolve));
    },
  };
}

test.afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

test.after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

async function setup() {
  const fake = await startFakeCdpServer();
  cleanups.push(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: { id: 'shared', claims: { surface: 'work' } },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
  });
  const proxy = await startLeaseProxy({
    stateDir: directory,
    leaseId: lease.id,
    rawEndpoint: fake.endpoint,
  });
  cleanups.push(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  cleanups.push(async () => socket.close());
  return { fake, directory, lease, proxy, socket, cdp: exchange(socket) };
}

test('proxy filters target discovery to lease-owned targets', async () => {
  const { lease, cdp } = await setup();
  const response = await cdp.send('Target.getTargets');
  assert.deepEqual(
    response.result.targetInfos.map(({ targetId }) => targetId),
    lease.targetIds,
  );
});

test('proxy owns createTarget results and forces background creation', async () => {
  const { fake, cdp } = await setup();
  const response = await cdp.send('Target.createTarget', {
    url: 'https://owned.example.test',
    background: false,
  });
  const discovery = await cdp.send('Target.getTargets');

  assert.ok(discovery.result.targetInfos.some(({ targetId }) => targetId === response.result.targetId));
  const invocation = fake.methods.findLast(({ method }) => method === 'Target.createTarget');
  assert.equal(invocation.params.background, true);
});

test('proxy inherits popup descendants of owned targets', async () => {
  const { fake, lease, cdp } = await setup();
  await cdp.send('Target.getTargets');
  fake.emitTargetCreated({
    targetId: 'popup-1',
    openerId: lease.targetIds[0],
    type: 'page',
    title: 'Popup',
    url: 'https://popup.example.test',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const discovery = await cdp.send('Target.getTargets');
  assert.ok(discovery.result.targetInfos.some(({ targetId }) => targetId === 'popup-1'));
});

test('proxy denies activation commands and unowned target closure', async () => {
  const { fake, cdp } = await setup();
  for (const method of ['Target.activateTarget', 'Page.bringToFront']) {
    const response = await cdp.send(method, { targetId: 'unowned-existing' });
    assert.equal(response.error.code, -32001);
  }
  const close = await cdp.send('Target.closeTarget', { targetId: 'unowned-existing' });
  assert.equal(close.error.code, -32002);
  assert.ok(fake.targets.has('unowned-existing'));
  assert.ok(!fake.methods.some(({ method }) => method === 'Target.activateTarget'));
});

test('proxy denies attaching to an unowned target', async () => {
  const { fake, cdp } = await setup();
  const response = await cdp.send('Target.attachToTarget', {
    targetId: 'unowned-existing',
    flatten: true,
  });
  assert.equal(response.error.code, -32002);
  assert.ok(!fake.methods.some(({ method }) => method === 'Target.attachToTarget'));
});

test('proxy suppresses target events for unowned targets', async () => {
  const { fake, cdp } = await setup();
  await cdp.send('Target.getTargets');
  fake.emitTargetCreated({
    targetId: 'unowned-popup',
    openerId: 'unowned-existing',
    type: 'page',
    title: 'Hidden',
    url: 'https://hidden.example.test',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!cdp.events.some(({ params }) => params?.targetInfo?.targetId === 'unowned-popup'));
});

test('proxy transparently forwards non-target commands', async () => {
  const { cdp } = await setup();
  const response = await cdp.send('Runtime.evaluate', { expression: '40 + 2' });
  assert.equal(response.result.result.value, 42);
});
