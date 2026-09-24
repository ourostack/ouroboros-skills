import assert from 'node:assert/strict';
import { chmod, mkdir, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright-core';
import WebSocket from 'ws';

import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import { createLease, releaseLease } from '../src/leases.mjs';
import { withBrokerLock } from '../src/lock.mjs';
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

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function exchange(socket) {
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.on('close', () => {
    for (const { reject } of pending.values()) {
      reject(new Error('CDP proxy connection closed'));
    }
    pending.clear();
  });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id) {
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    } else {
      events.push(message);
    }
  });
  return {
    events,
    send(method, params = {}, sessionId) {
      const requestId = ++id;
      socket.send(JSON.stringify({
        id: requestId,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
      return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
    },
  };
}

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
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

test('current Playwright connects through the proxy without exposing unowned targets', async () => {
  const { fake, lease, proxy } = await setup();
  let browser;
  try {
    browser = await chromium.connectOverCDP(proxy.endpoint, { noDefaults: true });
  } catch (error) {
    assert.fail(`${error.message}\nMethods: ${JSON.stringify(fake.methods)}`);
  }
  cleanups.push(() => browser.close());

  const pages = browser.contexts().flatMap((context) => context.pages());
  assert.equal(pages.length, 1);
  const targetInfo = fake.methods.findLast(({ method }) => method === 'Target.getTargetInfo');
  assert.equal(targetInfo.params.targetId, lease.targetIds[0]);
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

test('proxy startup closes its listener when registry publication fails', async () => {
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
  const port = await availablePort();
  let proxy;
  let failure;
  try {
    proxy = await startLeaseProxy({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
      port,
      recordProxyFn: async () => {
        throw new Error('record proxy failed');
      },
    });
  } catch (error) {
    failure = error;
  }
  if (proxy) await proxy.close();

  assert.match(failure?.message ?? '', /record proxy failed/);
  assert.equal(await canConnect(port), false);
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

test('proxy owns createTarget results, preserves the requested URL, and forces background creation', async () => {
  const { fake, cdp } = await setup();
  const requestedUrl = 'https://owned.example.test/app#/router?view=detail';
  const response = await cdp.send('Target.createTarget', {
    url: requestedUrl,
    background: false,
  });
  const discovery = await cdp.send('Target.getTargets');

  assert.ok(discovery.result.targetInfos.some(({ targetId }) => targetId === response.result.targetId));
  const invocation = fake.methods.findLast(({ method }) => method === 'Target.createTarget');
  assert.equal(invocation.params.background, true);
  assert.match(invocation.params.url, /^data:text\/html,/u);
  assert.doesNotMatch(invocation.params.url, /owned\.example\.test/u);
  assert.equal(fake.targets.get(response.result.targetId).url, requestedUrl);
  const navigate = fake.methods.findLast(({ method }) => method === 'Page.navigate');
  assert.equal(navigate.params.url, requestedUrl);
});

test('proxy records ownership before an app immediately redirects after navigation', async (t) => {
  const redirectedUrl = 'https://login.example.test/redirected';
  const fake = await startFakeCdpServer({
    navigateTarget: async (_message, targetInfo) => {
      targetInfo.url = redirectedUrl;
      return { loaderId: 'redirect-loader' };
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

  const response = await cdp.send('Target.createTarget', {
    url: 'https://app.example.test/#/start',
  });

  assert.equal(fake.targets.get(response.result.targetId).url, redirectedUrl);
  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.ok(persisted.targetIds.includes(response.result.targetId));
  assert.deepEqual(persisted.pendingTargetCreates, []);
});

test('proxy reports navigation failure while retaining the marker target for cleanup', async (t) => {
  let navigations = 0;
  const fake = await startFakeCdpServer({
    navigateTarget: async () => {
      navigations += 1;
      if (navigations > 1) throw new Error('navigation rejected');
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

  const response = await cdp.send('Target.createTarget', {
    url: 'https://navigation-fails.example.test/#/router',
  });

  assert.equal(response.error.code, -32005);
  assert.match(response.error.message, /navigation/u);
  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.equal(persisted.targetIds.length, 2);
  const [failure] = Object.values(persisted.targetCreateFailures);
  assert.equal(failure.status, 'NAVIGATION_FAILED');
  assert.match(fake.targets.get(failure.targetId).url, /^data:text\/html,/u);

  const released = await releaseLease({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
  });
  assert.equal(released.released, true);
});

test('downstream requests reach upstream in arrival order without waiting for earlier responses', async (t) => {
  let releaseCreateResponse;
  let releaseCreateValidation;
  let validationStarted;
  const createResponseGate = new Promise((resolve) => {
    releaseCreateResponse = resolve;
  });
  const validationGate = new Promise((resolve) => {
    releaseCreateValidation = resolve;
  });
  const validationBlocked = new Promise((resolve) => {
    validationStarted = resolve;
  });
  let createCount = 0;
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createCount += 1;
      if (createCount > 1) await createResponseGate;
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
  let attestations = 0;
  const proxy = await startLeaseProxy({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: async (operation, payload) => {
      attestations += 1;
      if (attestations === 2) {
        validationStarted();
        await validationGate;
      }
      return attestingProvider(operation, payload);
    },
  });
  t.after(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  t.after(() => socket.close());
  const cdp = exchange(socket);

  const creating = cdp.send('Target.createTarget', {
    url: 'https://ordered.example.test',
  });
  await validationBlocked;
  const discovering = cdp.send('Target.getTargets');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const discoveryOvertookValidation =
    fake.methods.some(({ method }) => method === 'Target.getTargets');

  releaseCreateValidation();
  try {
    await waitFor(
      () => fake.methods.some(({ method }) => method === 'Target.getTargets'),
      'later downstream request did not reach upstream',
    );
    assert.equal(discoveryOvertookValidation, false);
    assert.deepEqual(
      fake.methods
        .filter(({ method }) =>
          method === 'Target.createTarget' || method === 'Target.getTargets')
        .slice(-2)
        .map(({ method }) => method),
      ['Target.createTarget', 'Target.getTargets'],
    );
    await discovering;
  } finally {
    releaseCreateResponse();
  }
  assert.ok((await creating).result.targetId);
});

test('proxy remaps colliding downstream IDs without stranding internal target creation', async (t) => {
  let releaseCreate;
  let createStarted;
  const createGate = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  const createBlocked = new Promise((resolve) => {
    createStarted = resolve;
  });
  let createCount = 0;
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createCount += 1;
      if (createCount === 1) return;
      createStarted();
      await createGate;
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
    internalRequestTimeoutMs: 200,
  });
  t.after(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  t.after(() => socket.close());
  const responses = new Map();
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id !== undefined) responses.set(message.id, message);
  });

  socket.send(JSON.stringify({
    id: 77,
    method: 'Target.createTarget',
    params: { url: 'https://collision.example.test' },
  }));
  await createBlocked;
  socket.send(JSON.stringify({
    id: 1_000_000_001,
    method: 'Target.getTargets',
    params: {},
  }));
  socket.send(JSON.stringify({
    id: -1,
    method: 'Target.getTargets',
    params: {},
  }));
  try {
    await waitFor(
      () => responses.has(1_000_000_001) && responses.has(-1),
      'colliding downstream response was not remapped',
    );
  } finally {
    releaseCreate();
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.equal(responses.get(1_000_000_001).id, 1_000_000_001);
  assert.equal(responses.get(-1).id, -1);
  assert.ok(responses.has(77), 'internal target creation did not settle');
  assert.equal(responses.get(77).id, 77);
  assert.ok(responses.get(77).result.targetId);
  const forwardedIds = fake.methods
    .filter(({ method }) =>
      method === 'Target.createTarget' || method === 'Target.getTargets')
    .slice(-3)
    .map(({ id }) => id);
  assert.ok(!forwardedIds.includes(77));
  assert.ok(!forwardedIds.includes(1_000_000_001));
  assert.ok(!forwardedIds.includes(-1));
  await Promise.race([
    releaseLease({
      stateDir: directory,
      leaseId: lease.id,
      declaration,
      providerInvoker: attestingProvider,
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('lease lock remained held after colliding IDs')),
      500,
    )),
  ]);
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

test('targetCreated ownership persists before a later discovery response is filtered', async () => {
  const { fake, directory, lease, cdp } = await setup();
  let releasePersistence;
  let persistenceBlocked;
  const gate = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const blocked = new Promise((resolve) => {
    persistenceBlocked = resolve;
  });
  const lock = withBrokerLock(directory, async () => {
    persistenceBlocked();
    await gate;
  });
  await blocked;

  const getTargetsBefore = fake.methods.filter(
    ({ method }) => method === 'Target.getTargets',
  ).length;
  fake.emitTargetCreated({
    targetId: 'delayed-popup',
    openerId: lease.targetIds[0],
    type: 'page',
    title: 'Delayed popup',
    url: 'https://delayed-popup.example.test',
  });
  const discovering = cdp.send('Target.getTargets');
  try {
    await waitFor(
      () => fake.methods.filter(({ method }) => method === 'Target.getTargets').length >
        getTargetsBefore,
      'discovery request did not reach upstream',
    );
  } finally {
    releasePersistence();
    await lock;
  }

  const discovery = await discovering;
  assert.ok(
    discovery.result.targetInfos.some(({ targetId }) => targetId === 'delayed-popup'),
  );
  assert.ok(
    (await readRegistry(directory)).leases[lease.id].targetIds.includes('delayed-popup'),
  );
});

test('upstream targetCreated bursts preserve descendant and discovery arrival order', async () => {
  const { fake, directory, lease, cdp } = await setup();
  let releasePersistence;
  let persistenceBlocked;
  const gate = new Promise((resolve) => {
    releasePersistence = resolve;
  });
  const blocked = new Promise((resolve) => {
    persistenceBlocked = resolve;
  });
  const lock = withBrokerLock(directory, async () => {
    persistenceBlocked();
    await gate;
  });
  await blocked;

  const targetInfos = [
    {
      targetId: 'burst-popup-1',
      openerId: lease.targetIds[0],
      type: 'page',
      title: 'Burst popup 1',
      url: 'https://burst-1.example.test',
    },
    {
      targetId: 'burst-popup-2',
      openerId: 'burst-popup-1',
      type: 'page',
      title: 'Burst popup 2',
      url: 'https://burst-2.example.test',
    },
    {
      targetId: 'burst-popup-3',
      openerId: 'burst-popup-2',
      type: 'page',
      title: 'Burst popup 3',
      url: 'https://burst-3.example.test',
    },
  ];
  const getTargetsBefore = fake.methods.filter(
    ({ method }) => method === 'Target.getTargets',
  ).length;
  for (const targetInfo of targetInfos) fake.emitTargetCreated(targetInfo);
  const discovering = cdp.send('Target.getTargets');
  try {
    await waitFor(
      () => fake.methods.filter(({ method }) => method === 'Target.getTargets').length >
        getTargetsBefore,
      'burst discovery request did not reach upstream',
    );
  } finally {
    releasePersistence();
    await lock;
  }

  const discovery = await discovering;
  const burstIds = targetInfos.map(({ targetId }) => targetId);
  assert.deepEqual(
    cdp.events
      .filter(({ method }) => method === 'Target.targetCreated')
      .map(({ params }) => params.targetInfo.targetId),
    burstIds,
  );
  assert.deepEqual(
    discovery.result.targetInfos
      .map(({ targetId }) => targetId)
      .filter((targetId) => burstIds.includes(targetId)),
    burstIds,
  );
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
  assert.ok(!fake.methods.some(
    ({ method, params }) =>
      method === 'Target.attachToTarget' &&
      params.targetId === 'unowned-existing',
  ));
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
  assert.ok(!fake.methods.some(
    ({ method, params }) =>
      method === 'Target.detachFromTarget' &&
      params.sessionId === 'session-for-another-lease',
  ));
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

test('proxy forwards Playwright page navigation and lifecycle events for an owned session', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;
  const frame = {
    id: 'frame-1',
    loaderId: 'loader-1',
    url: 'https://owned.example.test/',
    domainAndRegistry: 'example.test',
    securityOrigin: 'https://owned.example.test',
    mimeType: 'text/html',
    adFrameStatus: { adFrameType: 'none' },
    secureContextType: 'Secure',
    crossOriginIsolatedContextType: 'NotIsolated',
    gatedAPIFeatures: [],
  };

  fake.emitSessionEvent(sessionId, 'Page.frameNavigated', {
    frame,
    type: 'Navigation',
  });
  fake.emitSessionEvent(sessionId, 'Page.lifecycleEvent', {
    frameId: frame.id,
    loaderId: frame.loaderId,
    name: 'DOMContentLoaded',
    timestamp: 123.456,
  });

  await waitFor(
    () => cdp.events.filter(({ sessionId: eventSession }) => eventSession === sessionId).length === 2,
    'owned session events were not forwarded',
  );
  assert.deepEqual(
    cdp.events
      .filter(({ sessionId: eventSession }) => eventSession === sessionId)
      .map(({ method }) => method),
    ['Page.frameNavigated', 'Page.lifecycleEvent'],
  );
});

test('proxy suppresses ordinary events for an unowned target session', async () => {
  const { fake, cdp } = await setup();
  fake.emitSessionEvent('session-for-another-lease', 'Page.frameNavigated', {
    frame: {
      id: 'hidden-frame',
      loaderId: 'hidden-loader',
      url: 'https://hidden.example.test/',
      domainAndRegistry: 'example.test',
      securityOrigin: 'https://hidden.example.test',
      mimeType: 'text/html',
    },
    type: 'Navigation',
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!cdp.events.some(({ sessionId }) => sessionId === 'session-for-another-lease'));
});

test('proxy retains target ownership filtering for browser-level events with an owned session', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  fake.emitSessionEvent(attached.result.sessionId, 'Target.targetInfoChanged', {
    targetInfo: {
      targetId: 'unowned-existing',
      type: 'page',
      title: 'Unowned',
      url: 'https://unowned.example.test/',
      browserContextId: 'default',
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!cdp.events.some(
    ({ method, params }) =>
      method === 'Target.targetInfoChanged' &&
      params?.targetInfo?.targetId === 'unowned-existing',
  ));
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

test('proxy denies browser-global mutations through an owned session without disconnecting upstream', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;

  const close = await cdp.send('Browser.close', {}, sessionId);
  assert.equal(close.error.code, -32004);
  const mutate = await cdp.send(
    'Browser.setDownloadBehavior',
    { behavior: 'allow', downloadPath: '/owned-session-downloads' },
    sessionId,
  );
  assert.equal(mutate.error.code, -32004);
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.close'));
  assert.ok(!fake.methods.some(({ method }) => method === 'Browser.setDownloadBehavior'));

  const safeBrowser = await cdp.send('Browser.getVersion', {}, sessionId);
  assert.equal(safeBrowser.result.product, 'Chrome/140.0.0.0');
  const safeSession = await cdp.send(
    'Runtime.evaluate',
    { expression: '40 + 2' },
    sessionId,
  );
  assert.equal(safeSession.result.result.value, 42);
});

test('proxy denies profile-wide cookie reads through an owned session without response leakage', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;
  const methods = [
    'Network.getAllCookies',
    'Network.getCookies',
    'Storage.getCookies',
  ];

  for (const method of methods) {
    const response = await cdp.send(method, {}, sessionId);
    assert.equal(response.error.code, -32004, method);
    assert.equal(response.result, undefined, method);
  }
  assert.ok(!fake.methods.some(({ method }) => methods.includes(method)));
});

test('proxy denies profile-wide cookie mutation through an owned session', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;
  const methods = [
    'Network.setCookie',
    'Network.setCookies',
    'Network.deleteCookies',
    'Network.clearBrowserCookies',
    'Storage.setCookies',
    'Storage.clearCookies',
  ];

  for (const method of methods) {
    const response = await cdp.send(method, {}, sessionId);
    assert.equal(response.error.code, -32004, method);
  }
  assert.ok(!fake.methods.some(({ method }) => methods.includes(method)));
});

test('proxy denies profile-wide storage reads through an owned session without response leakage', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;
  const methods = [
    'Storage.getUsageAndQuota',
    'Storage.getTrustTokens',
    'Storage.getSharedStorageEntries',
    'DOMStorage.getDOMStorageItems',
    'IndexedDB.requestDatabaseNames',
    'CacheStorage.requestCacheNames',
    'Database.getDatabaseTableNames',
    'FileSystem.getDirectory',
  ];

  for (const method of methods) {
    const response = await cdp.send(method, {}, sessionId);
    assert.equal(response.error.code, -32004, method);
    assert.equal(response.result, undefined, method);
  }
  assert.ok(!fake.methods.some(({ method }) => methods.includes(method)));
});

test('proxy denies profile-wide storage clearing through an owned session', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;
  const methods = [
    'Storage.clearDataForOrigin',
    'Storage.clearDataForStorageKey',
    'Storage.clearTrustTokens',
    'Storage.clearSharedStorageEntries',
    'DOMStorage.clear',
    'IndexedDB.clearObjectStore',
    'IndexedDB.deleteDatabase',
    'CacheStorage.deleteCache',
    'Database.executeSQL',
  ];

  for (const method of methods) {
    const response = await cdp.send(method, {}, sessionId);
    assert.equal(response.error.code, -32004, method);
  }
  assert.ok(!fake.methods.some(({ method }) => methods.includes(method)));
});

test('proxy preserves representative frame-local Playwright commands for an owned session', async () => {
  const { fake, lease, cdp } = await setup();
  const attached = await cdp.send('Target.attachToTarget', {
    targetId: lease.targetIds[0],
    flatten: true,
  });
  const sessionId = attached.result.sessionId;

  const runtime = await cdp.send(
    'Runtime.evaluate',
    { expression: '40 + 2' },
    sessionId,
  );
  assert.equal(runtime.result.result.value, 42);
  assert.deepEqual((await cdp.send('Page.enable', {}, sessionId)).result, {});
  assert.deepEqual((await cdp.send('Network.enable', {}, sessionId)).result, {});
  assert.ok(fake.methods.some(({ method }) => method === 'Runtime.evaluate'));
  assert.ok(fake.methods.some(({ method }) => method === 'Page.enable'));
  assert.ok(fake.methods.some(({ method }) => method === 'Network.enable'));
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

test('proxy reconciles delayed createTarget success after its upstream timeout', async (t) => {
  let createCount = 0;
  const fake = await startFakeCdpServer({
    afterCreateTarget: async () => {
      createCount += 1;
      if (createCount > 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
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
  const proxy = await startLeaseProxy({
    stateDir: directory,
    leaseId: lease.id,
    declaration,
    providerInvoker: attestingProvider,
    internalRequestTimeoutMs: 25,
  });
  t.after(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  t.after(() => socket.close());
  const cdp = exchange(socket);

  const response = await cdp.send('Target.createTarget', {
    url: 'https://proxy-created.example.test/path#existing',
  });

  assert.ok(response.result.targetId);
  const target = fake.targets.get(response.result.targetId);
  assert.equal(target.url, 'https://proxy-created.example.test/path#existing');
  const create = fake.methods
    .filter(({ method }) => method === 'Target.createTarget')
    .at(-1);
  assert.match(create.params.url, /^data:text\/html,/u);
  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.ok(persisted.targetIds.includes(response.result.targetId));
  assert.deepEqual(persisted.pendingTargetCreates, []);
});

test('upstream disconnect rejects pending createTarget and preserves indeterminate marker evidence', async (t) => {
  let createCount = 0;
  let pendingCreateStarted;
  const started = new Promise((resolve) => {
    pendingCreateStarted = resolve;
  });
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createCount += 1;
      if (createCount === 1) return;
      pendingCreateStarted();
      await new Promise(() => {});
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

  const creating = cdp.send('Target.createTarget', {
    url: 'https://disconnect.example.test',
  });
  await started;
  fake.disconnectClients();

  await assert.rejects(
    Promise.race([
      creating,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('pending createTarget did not reject promptly')),
        500,
      )),
    ]),
    /CDP proxy connection closed/u,
  );
  await assert.rejects(
    Promise.race([
      releaseLease({
        stateDir: directory,
        leaseId: lease.id,
        declaration,
        providerInvoker: attestingProvider,
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('release remained blocked by createTarget')),
        500,
      )),
    ]),
    (error) =>
      error.code === 'PARTIAL_RELEASE' &&
      error.details.pendingTargetCreates[0].diagnostic.status === 'ZERO_MARKER_MATCHES',
  );
  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.equal(persisted.pendingTargetCreates.length, 1);
  assert.match(persisted.pendingTargetCreates[0].markerUrl, /^data:text\/html,/u);
});

test('internal upstream create timeout releases the lock but preserves marker evidence', async (t) => {
  let createCount = 0;
  const fake = await startFakeCdpServer({
    beforeCreateTarget: async () => {
      createCount += 1;
      if (createCount === 1) return;
      await new Promise(() => {});
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
    internalRequestTimeoutMs: 50,
  });
  t.after(() => proxy.close());
  const socket = await openSocket(proxy.webSocketEndpoint);
  t.after(() => socket.close());
  const cdp = exchange(socket);

  const response = await Promise.race([
    cdp.send('Target.createTarget', {
      url: 'https://timeout.example.test',
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('internal request did not time out promptly')),
      500,
    )),
  ]);
  assert.equal(response.error.code, -32005);
  await assert.rejects(
    Promise.race([
      releaseLease({
        stateDir: directory,
        leaseId: lease.id,
        declaration,
        providerInvoker: attestingProvider,
      }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('release remained blocked after request timeout')),
        500,
      )),
    ]),
    (error) =>
      error.code === 'PARTIAL_RELEASE' &&
      error.details.pendingTargetCreates[0].diagnostic.status === 'ZERO_MARKER_MATCHES',
  );
  const persisted = (await readRegistry(directory)).leases[lease.id];
  assert.equal(persisted.pendingTargetCreates.length, 1);
});
