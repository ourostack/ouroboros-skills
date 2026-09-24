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

const scratchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.proxy-state');
const cleanups = [];
const declaration = {
  id: 'shared',
  claims: { surface: 'work' },
  launch: {
    executable: '/opt/browser',
    profileRoot: '/profiles/shared',
  },
};
const processIdentity = {
  pid: 800,
  startIdentity: 'start-800',
  owner: 'operator',
  executable: declaration.launch.executable,
  profileRoot: declaration.launch.profileRoot,
};

async function attestingProvider(operation, payload) {
  assert.equal(operation, 'attest');
  return {
    healthy: true,
    endpoint: payload.observation.endpoint,
    processIdentity: payload.observation.processIdentity,
    endpointProcessIdentity: {
      pid: payload.observation.processIdentity.pid,
      startIdentity: payload.observation.processIdentity.startIdentity,
    },
  };
}

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

async function rejectedSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  return new Promise((resolve) => {
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode);
      socket.terminate();
    });
    socket.once('open', () => {
      resolve(101);
      socket.close();
    });
    socket.once('error', () => resolve(0));
  });
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
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });
  const proxy = await startLeaseProxy({
    stateDir: directory,
    leaseId: lease.id,
    rawEndpoint: fake.endpoint,
    declaration,
    providerInvoker: attestingProvider,
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

test('proxy rejects WebSocket upgrades without the unguessable lease credential', async () => {
  const { lease, proxy } = await setup();
  const authenticated = new URL(proxy.webSocketEndpoint);
  const unauthenticated = new URL(authenticated);
  unauthenticated.pathname = `/devtools/browser/${lease.id}`;
  const wrongCredential = new URL(authenticated);
  wrongCredential.pathname = authenticated.pathname.replace(lease.proxyToken, 'wrong-token');

  assert.equal(await rejectedSocket(unauthenticated), 401);
  assert.equal(await rejectedSocket(wrongCredential), 401);
});

test('proxy fails disconnected instead of following a replacement process generation', async () => {
  const fake = await startFakeCdpServer();
  cleanups.push(() => fake.close());
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: declaration,
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity,
  });

  await assert.rejects(
    startLeaseProxy({
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

test('proxy denies commands addressed to an unowned target session', async () => {
  const { fake, cdp, socket } = await setup();
  let response;
  socket.send(JSON.stringify({
    id: 99,
    sessionId: 'session-for-another-lease',
    method: 'Runtime.evaluate',
    params: { expression: '40 + 2' },
  }));
  response = await new Promise((resolve) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.id === 99) {
        socket.off('message', onMessage);
        resolve(message);
      }
    };
    socket.on('message', onMessage);
  });
  assert.equal(response.error.code, -32003);
  assert.ok(!fake.methods.some(({ params }) => params?.expression === '40 + 2'));
  assert.equal(cdp.events.length, 0);
});

test('proxy denies detaching another lease target session', async () => {
  const { fake, cdp } = await setup();
  const response = await cdp.send('Target.detachFromTarget', {
    sessionId: 'session-for-another-lease',
  });
  assert.equal(response.error.code, -32003);
  assert.ok(!fake.methods.some(({ method }) => method === 'Target.detachFromTarget'));
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

test('proxy transparently forwards commands for an owned target session', async () => {
  const { lease, cdp, socket } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const response = await new Promise((resolve) => {
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.id === 100) {
        socket.off('message', onMessage);
        resolve(message);
      }
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({
      id: 100,
      sessionId: attached.result.sessionId,
      method: 'Runtime.evaluate',
      params: { expression: '40 + 2' },
    }));
  });
  assert.equal(response.result.result.value, 42);
});

test('proxy denies browser termination and browser-global mutation commands', async () => {
  const { fake, cdp } = await setup();
  for (const method of [
    'Browser.close',
    'Browser.setDownloadBehavior',
    'Browser.grantPermissions',
    'Security.setIgnoreCertificateErrors',
  ]) {
    const response = await cdp.send(method, {});
    assert.equal(response.error.code, -32004, method);
  }
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.close'));
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.setDownloadBehavior'));
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.grantPermissions'));
  assert.ok(!fake.methods.some(({ method }) => method === 'Security.setIgnoreCertificateErrors'));
});

test('proxy constrains required browser-global auto-attach to avoid pausing other leases', async () => {
  const { fake, cdp } = await setup();
  const response = await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
  });

  assert.deepEqual(response.result, {});
  const invocation = fake.methods.findLast(({ method }) => method === 'Target.setAutoAttach');
  assert.equal(invocation.params.autoAttach, true);
  assert.equal(invocation.params.waitForDebuggerOnStart, false);
  assert.equal(invocation.params.flatten, true);
});

test('late createTarget racing release is compensated without leaking a target', async (t) => {
  let createCount = 0;
  let allowLateCreate;
  let lateCreateStarted;
  const blocked = new Promise((resolve) => {
    allowLateCreate = resolve;
  });
  const started = new Promise((resolve) => {
    lateCreateStarted = resolve;
  });
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createCount += 1;
      if (createCount === 1) return;
      lateCreateStarted();
      await blocked;
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
  const proxy = await startLeaseProxy({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });
  t.after(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  t.after(() => socket.close());
  const cdp = exchange(socket);

  const creating = cdp.send('Target.createTarget', { url: 'https://late.example.test' });
  await started;
  const releasing = releaseLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });
  allowLateCreate();
  const [createResponse] = await Promise.all([creating, releasing]);

  assert.ok(createResponse.result.targetId);
  assert.equal((await readRegistry(directory)).leases[lease.id], undefined);
  assert.deepEqual([...fake.targets.keys()], ['unowned-existing']);
});
