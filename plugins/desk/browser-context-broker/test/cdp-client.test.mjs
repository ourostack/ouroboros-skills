import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocketServer } from 'ws';

import {
  CdpClient,
  resolveBrowserWebSocket,
} from '../src/cdp-client.mjs';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('HTTP discovery times out when the version endpoint stays silent', async (t) => {
  const server = http.createServer(() => {});
  const port = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await assert.rejects(
    resolveBrowserWebSocket(`http://127.0.0.1:${port}`, { timeoutMs: 25 }),
    (error) =>
      error.code === 'CDP_DISCOVERY_TIMEOUT' &&
      error.details.timeoutMs === 25,
  );
});

test('WebSocket connect times out when the upgrade server stays silent', async (t) => {
  const sockets = new Set();
  const silentUpgradeServer = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const upgradePort = await listen(silentUpgradeServer);
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silentUpgradeServer.close(resolve));
  });
  const discoveryServer = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${upgradePort}/silent`,
    }));
  });
  const discoveryPort = await listen(discoveryServer);
  t.after(() => new Promise((resolve) => discoveryServer.close(resolve)));

  await assert.rejects(
    CdpClient.connect(`http://127.0.0.1:${discoveryPort}`, {
      connectTimeoutMs: 25,
    }),
    (error) =>
      error.code === 'CDP_CONNECT_TIMEOUT' &&
      error.details.timeoutMs === 25,
  );
});

test('command timeout rejects and removes the pending request before closing the socket', async (t) => {
  const server = http.createServer((request, response) => {
    const address = server.address();
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({
      webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/silent`,
    }));
  });
  const webSockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request);
    });
  });
  const port = await listen(server);
  t.after(async () => {
    for (const socket of webSockets.clients) socket.terminate();
    await new Promise((resolve) => webSockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

  const client = await CdpClient.connect(`http://127.0.0.1:${port}`, {
    commandTimeoutMs: 25,
  });

  await assert.rejects(
    client.send('Target.getTargets'),
    (error) =>
      error.code === 'CDP_COMMAND_TIMEOUT' &&
      error.details.method === 'Target.getTargets' &&
      error.details.timeoutMs === 25,
  );
  assert.equal(client.pending.size, 0);
  if (client.socket.readyState !== client.socket.CLOSED) {
    await new Promise((resolve) => client.socket.once('close', resolve));
  }
  assert.equal(client.socket.readyState, client.socket.CLOSED);
});
