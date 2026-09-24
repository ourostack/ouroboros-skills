import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

import { resolveBrowserWebSocket } from './cdp-client.mjs';
import { BrokerError } from './claims.mjs';
import {
  addOwnedTarget,
  attestLeaseContext,
  heartbeatLease,
  recordProxy,
  removeOwnedTarget,
  withLeaseOperation,
} from './leases.mjs';

const ACTIVATION_METHODS = new Set([
  'Target.activateTarget',
  'Page.bringToFront',
]);
const BROWSER_METHOD_ALLOWLIST = new Set([
  'Browser.getVersion',
  'Target.attachToTarget',
  'Target.closeTarget',
  'Target.createTarget',
  'Target.detachFromTarget',
  'Target.getTargetInfo',
  'Target.getTargets',
  'Target.setAutoAttach',
  'Target.setDiscoverTargets',
]);
const DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS = 10_000;

function errorResponse(id, code, message) {
  return JSON.stringify({ id, error: { code, message } });
}

export async function startLeaseProxy({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
  host = '127.0.0.1',
  port = 0,
  internalRequestTimeoutMs = DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS,
}) {
  const lease = await attestLeaseContext({
    stateDir,
    leaseId,
    declaration,
    providerInvoker,
  });
  const ownedTargets = new Set(lease.targetIds);
  const upstreamMetadata = await resolveBrowserWebSocket(lease.rawEndpoint);
  const credentialPath = `/${lease.proxyToken}`;
  const server = http.createServer((request, response) => {
    if (
      request.url === `${credentialPath}/json/version` ||
      request.url === `${credentialPath}/json/version/`
    ) {
      const address = server.address();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        Browser: upstreamMetadata.Browser ?? 'BrowserContextBroker',
        webSocketDebuggerUrl:
          `ws://${host}:${address.port}${credentialPath}/devtools/browser/${leaseId}`,
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const downstreamServer = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== `${credentialPath}/devtools/browser/${leaseId}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    downstreamServer.handleUpgrade(request, socket, head, (websocket) => {
      downstreamServer.emit('connection', websocket, request);
    });
  });

  downstreamServer.on('connection', (downstream) => {
    const upstream = new WebSocket(upstreamMetadata.webSocketDebuggerUrl);
    const requests = new Map();
    const ownedSessions = new Set();
    const queued = [];
    let downstreamMessageProcessing = Promise.resolve();
    let upstreamMessageProcessing = Promise.resolve();
    let nextDownstreamUpstreamId = 0;
    let nextInternalId = 0;
    const sendUpstream = (message) => {
      const serialized = JSON.stringify(message);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(serialized);
      else queued.push(serialized);
    };
    const requestWithResponse = ({
      id,
      method,
      params,
      downstreamId,
      sessionId,
    }) => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!requests.delete(id)) return;
          const error = new Error(`Timed out waiting for upstream ${method}`);
          error.code = 'UPSTREAM_REQUEST_TIMEOUT';
          reject(error);
        }, internalRequestTimeoutMs);
        timer.unref();
        requests.set(id, {
          method,
          targetId: params.targetId,
          downstreamId,
          resolve,
          reject,
          timer,
        });
        sendUpstream({ id, method, params, sessionId });
      });
    };
    const requestInternal = (method, params = {}) =>
      requestWithResponse({
        id: --nextInternalId,
        method,
        params,
      });
    const requestManagedDownstream = (message, params) =>
      requestWithResponse({
        id: ++nextDownstreamUpstreamId,
        method: message.method,
        params,
        downstreamId: message.id,
        sessionId: message.sessionId,
      });
    const rejectPendingRequests = (error) => {
      for (const [id, request] of requests) {
        if (!request?.reject) continue;
        clearTimeout(request.timer);
        requests.delete(id);
        request.reject(error);
      }
    };
    const compensateTarget = async (targetId) => {
      await requestInternal('Target.closeTarget', { targetId }).catch(() => {});
      ownedTargets.delete(targetId);
    };
    upstream.on('open', () => {
      for (const message of queued) upstream.send(message);
      queued.length = 0;
    });
    upstream.on('error', (error) => {
      rejectPendingRequests(error);
    });
    const processDownstreamMessage = async (data) => {
      const message = JSON.parse(data.toString());
      if (ACTIVATION_METHODS.has(message.method)) {
        downstream.send(errorResponse(message.id, -32001, 'Target activation is denied by the lease proxy'));
        return;
      }
      if (message.sessionId && !ownedSessions.has(message.sessionId)) {
        downstream.send(errorResponse(message.id, -32003, 'Cannot access a target session owned by another lease'));
        return;
      }
      if (!message.sessionId && !BROWSER_METHOD_ALLOWLIST.has(message.method)) {
        downstream.send(errorResponse(
          message.id,
          -32004,
          'Browser-global command is denied by the lease proxy',
        ));
        return;
      }
      if (
        message.method === 'Target.detachFromTarget' &&
        message.params?.sessionId &&
        !ownedSessions.has(message.params.sessionId)
      ) {
        downstream.send(errorResponse(
          message.id,
          -32003,
          'Cannot access a target session owned by another lease',
        ));
        return;
      }
      if (message.method === 'Target.getTargetInfo' && !message.params?.targetId) {
        const [targetId] = ownedTargets;
        if (!targetId) {
          downstream.send(errorResponse(message.id, -32002, 'Lease has no owned target'));
          return;
        }
        message.params = { ...message.params, targetId };
      }
      if (
        message.method?.startsWith('Target.') &&
        message.params?.targetId &&
        !ownedTargets.has(message.params?.targetId)
      ) {
        downstream.send(errorResponse(message.id, -32002, 'Cannot access a target owned by another lease'));
        return;
      }
      if (message.method === 'Target.setAutoAttach') {
        message.params = {
          ...message.params,
          waitForDebuggerOnStart: false,
        };
      }
      if (message.method === 'Target.createTarget') {
        let markDispatched;
        let dispatched = false;
        const upstreamDispatched = new Promise((resolve) => {
          markDispatched = () => {
            if (dispatched) return;
            dispatched = true;
            resolve();
          };
        });
        void withLeaseOperation(stateDir, leaseId, async () => {
          await attestLeaseContext({
            stateDir,
            leaseId,
            declaration,
            providerInvoker,
          });
          const responsePromise = requestManagedDownstream(message, {
            ...message.params,
            background: true,
          });
          markDispatched();
          const response = await responsePromise;
          if (response.error || !response.result?.targetId) {
            if (downstream.readyState === WebSocket.OPEN) {
              downstream.send(JSON.stringify(response));
            }
            return;
          }
          const targetId = response.result.targetId;
          try {
            await addOwnedTarget(stateDir, leaseId, targetId);
            ownedTargets.add(targetId);
            if (downstream.readyState === WebSocket.OPEN) {
              downstream.send(JSON.stringify(response));
            }
          } catch {
            await compensateTarget(targetId);
            if (downstream.readyState === WebSocket.OPEN) {
              downstream.send(errorResponse(
                message.id,
                -32005,
                'Lease was released before target ownership could be recorded',
              ));
            }
          }
        })
          .catch(() => {
            if (downstream.readyState === WebSocket.OPEN) {
              downstream.send(errorResponse(
                message.id,
                -32005,
                'Lease was released before target creation completed',
              ));
            }
          })
          .finally(markDispatched);
        await upstreamDispatched;
        return;
      }
      const upstreamId = ++nextDownstreamUpstreamId;
      requests.set(upstreamId, {
        method: message.method,
        targetId: message.params?.targetId,
        downstreamId: message.id,
      });
      sendUpstream({ ...message, id: upstreamId });
    };
    downstream.on('message', (data) => {
      downstreamMessageProcessing = downstreamMessageProcessing
        .then(() => processDownstreamMessage(data))
        .catch(() => {
          if (downstream.readyState === WebSocket.OPEN) {
            downstream.close();
          }
        });
    });
    const processUpstreamMessage = async (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) {
        const request = requests.get(message.id);
        requests.delete(message.id);
        if (!request) return;
        if (request?.resolve) {
          clearTimeout(request.timer);
          request.resolve(
            request.downstreamId === undefined
              ? message
              : { ...message, id: request.downstreamId },
          );
          return;
        }
        if (request?.method === 'Target.getTargets' && message.result?.targetInfos) {
          message.result.targetInfos = message.result.targetInfos.filter(({ targetId }) =>
            ownedTargets.has(targetId),
          );
        } else if (request?.method === 'Target.createTarget' && message.result?.targetId) {
          ownedTargets.add(message.result.targetId);
          await addOwnedTarget(stateDir, leaseId, message.result.targetId);
        } else if (request?.method === 'Target.attachToTarget' && message.result?.sessionId) {
          ownedSessions.add(message.result.sessionId);
        } else if (
          request?.method === 'Target.closeTarget' &&
          message.result?.success &&
          request.targetId
        ) {
          ownedTargets.delete(request.targetId);
          await removeOwnedTarget(stateDir, leaseId, request.targetId);
        }
        if (downstream.readyState === WebSocket.OPEN) {
          downstream.send(JSON.stringify({ ...message, id: request.downstreamId }));
        }
        return;
      }

      const targetInfo = message.params?.targetInfo;
      if (
        message.method === 'Target.attachedToTarget' &&
        targetInfo?.targetId &&
        ownedTargets.has(targetInfo.targetId)
      ) {
        ownedSessions.add(message.params.sessionId);
      }
      if (
        message.method === 'Target.detachedFromTarget' &&
        message.params?.sessionId
      ) {
        if (!ownedSessions.delete(message.params.sessionId)) return;
      } else if (message.sessionId && !ownedSessions.has(message.sessionId)) {
        return;
      }
      if (
        message.method === 'Target.targetCreated' &&
        targetInfo?.openerId &&
        ownedTargets.has(targetInfo.openerId)
      ) {
        try {
          await withLeaseOperation(stateDir, leaseId, async () => {
            await addOwnedTarget(stateDir, leaseId, targetInfo.targetId);
            ownedTargets.add(targetInfo.targetId);
          });
        } catch {
          await compensateTarget(targetInfo.targetId);
          return;
        }
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
    };
    upstream.on('message', (data) => {
      upstreamMessageProcessing = upstreamMessageProcessing
        .then(() => processUpstreamMessage(data))
        .catch(() => {
          if (downstream.readyState === WebSocket.OPEN) downstream.close();
        });
    });
    const closePeer = () => {
      if (upstream.readyState === WebSocket.OPEN) upstream.close();
    };
    downstream.on('close', closePeer);
    upstream.on('close', () => {
      const error = new Error('Upstream CDP connection closed');
      error.code = 'UPSTREAM_DISCONNECTED';
      rejectPendingRequests(error);
      if (downstream.readyState === WebSocket.OPEN) downstream.close();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const listener = { host, port: address.port };
  const endpoint = `http://${host}:${address.port}${credentialPath}`;
  const recordedLease = await recordProxy(stateDir, leaseId, listener);
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
    webSocketEndpoint:
      `ws://${host}:${address.port}${credentialPath}/devtools/browser/${leaseId}`,
    pid: process.pid,
    startIdentity: recordedLease.proxy.startIdentity,
    close,
  };
}
