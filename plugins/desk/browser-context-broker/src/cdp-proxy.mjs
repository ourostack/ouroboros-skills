import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

import { resolveBrowserWebSocket } from './cdp-client.mjs';
import { BrokerError } from './claims.mjs';
import {
  addOwnedTarget,
  heartbeatLease,
  recordProxy,
  removeOwnedTarget,
} from './leases.mjs';
import { readRegistry } from './registry.mjs';

const ACTIVATION_METHODS = new Set([
  'Target.activateTarget',
  'Page.bringToFront',
]);

function errorResponse(id, code, message) {
  return JSON.stringify({ id, error: { code, message } });
}

export async function startLeaseProxy({
  stateDir,
  leaseId,
  rawEndpoint,
  host = '127.0.0.1',
  port = 0,
}) {
  const registry = await readRegistry(stateDir);
  const lease = registry.leases[leaseId];
  if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`);
  const ownedTargets = new Set(lease.targetIds);
  const upstreamMetadata = await resolveBrowserWebSocket(rawEndpoint);
  const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      const address = server.address();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        Browser: upstreamMetadata.Browser ?? 'BrowserContextBroker',
        webSocketDebuggerUrl: `ws://${host}:${address.port}/devtools/browser/${leaseId}`,
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const downstreamServer = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    downstreamServer.handleUpgrade(request, socket, head, (websocket) => {
      downstreamServer.emit('connection', websocket, request);
    });
  });

  downstreamServer.on('connection', (downstream) => {
    const upstream = new WebSocket(upstreamMetadata.webSocketDebuggerUrl);
    const requests = new Map();
    const queued = [];
    upstream.on('open', () => {
      for (const message of queued) upstream.send(message);
      queued.length = 0;
    });
    downstream.on('message', (data) => {
      const raw = data.toString();
      const message = JSON.parse(raw);
      if (ACTIVATION_METHODS.has(message.method)) {
        downstream.send(errorResponse(message.id, -32001, 'Target activation is denied by the lease proxy'));
        return;
      }
      if (
        message.method?.startsWith('Target.') &&
        message.params?.targetId &&
        !ownedTargets.has(message.params?.targetId)
      ) {
        downstream.send(errorResponse(message.id, -32002, 'Cannot access a target owned by another lease'));
        return;
      }
      if (message.method === 'Target.createTarget') {
        message.params = { ...message.params, background: true };
      }
      requests.set(message.id, {
        method: message.method,
        targetId: message.params?.targetId,
      });
      const serialized = JSON.stringify(message);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(serialized);
      else queued.push(serialized);
    });
    upstream.on('message', async (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) {
        const request = requests.get(message.id);
        requests.delete(message.id);
        if (request?.method === 'Target.getTargets' && message.result?.targetInfos) {
          message.result.targetInfos = message.result.targetInfos.filter(({ targetId }) =>
            ownedTargets.has(targetId),
          );
        } else if (request?.method === 'Target.createTarget' && message.result?.targetId) {
          ownedTargets.add(message.result.targetId);
          await addOwnedTarget(stateDir, leaseId, message.result.targetId);
        } else if (
          request?.method === 'Target.closeTarget' &&
          message.result?.success &&
          request.targetId
        ) {
          ownedTargets.delete(request.targetId);
          await removeOwnedTarget(stateDir, leaseId, request.targetId);
        }
        if (downstream.readyState === WebSocket.OPEN) downstream.send(JSON.stringify(message));
        return;
      }

      const targetInfo = message.params?.targetInfo;
      if (
        message.method === 'Target.targetCreated' &&
        targetInfo?.openerId &&
        ownedTargets.has(targetInfo.openerId)
      ) {
        ownedTargets.add(targetInfo.targetId);
        await addOwnedTarget(stateDir, leaseId, targetInfo.targetId);
      }
      const targetId =
        targetInfo?.targetId ??
        message.params?.targetId;
      if (!targetId || !ownedTargets.has(targetId)) return;
      if (message.method === 'Target.targetDestroyed') {
        ownedTargets.delete(targetId);
        await removeOwnedTarget(stateDir, leaseId, targetId).catch(() => {});
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(JSON.stringify(message));
    });
    const closePeer = () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    downstream.on('close', closePeer);
    upstream.on('close', () => {
      if (downstream.readyState === WebSocket.OPEN) downstream.close();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const endpoint = `http://${host}:${address.port}`;
  const recordedLease = await recordProxy(stateDir, leaseId, endpoint);
  const heartbeat = setInterval(() => {
    heartbeatLease(stateDir, leaseId).catch(async (error) => {
      if (error.code === 'LEASE_NOT_FOUND') {
        clearInterval(heartbeat);
        await close();
      }
    });
  }, 10_000);
  heartbeat.unref();

  let closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      clearInterval(heartbeat);
      for (const client of downstreamServer.clients) client.close();
      await new Promise((resolve) => downstreamServer.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    })();
    return closing;
  }

  return {
    endpoint,
    webSocketEndpoint: `ws://${host}:${address.port}/devtools/browser/${leaseId}`,
    pid: process.pid,
    startIdentity: recordedLease.proxy.startIdentity,
    close,
  };
}
