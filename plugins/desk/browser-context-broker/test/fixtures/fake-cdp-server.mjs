import http from 'node:http';
import { WebSocketServer } from 'ws';

export async function startFakeCdpServer(options = {}) {
  const targets = new Map([
    ['unowned-existing', {
      targetId: 'unowned-existing',
      type: 'page',
      title: 'Unowned',
      url: 'https://unowned.example.test',
      browserContextId: 'default',
    }],
  ]);
  const methods = [];
  let nextTarget = 1;

  const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      const address = server.address();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        Browser: 'GenericBrowser/1',
        webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/browser/fake`,
      }));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      sockets.emit('connection', websocket, request);
    });
  });
  sockets.on('connection', (socket) => {
    const attachedTargets = new Set();
    socket.on('message', async (data) => {
      const message = JSON.parse(data.toString());
      methods.push({ id: message.id, method: message.method, params: message.params });
      await options.beforeRequest?.(message);
      let result = {};
      if (message.method === 'Browser.getVersion') {
        result = {
          protocolVersion: '1.3',
          product: 'Chrome/140.0.0.0',
          revision: '@fake',
          userAgent: 'Mozilla/5.0 HeadlessChrome/140.0.0.0',
          jsVersion: '14.0.0',
        };
      } else if (message.method === 'Target.getTargets') {
        result = { targetInfos: [...targets.values()] };
      } else if (message.method === 'Target.getTargetInfo') {
        result = { targetInfo: targets.get(message.params.targetId) };
      } else if (message.method === 'Target.createTarget') {
        await options.beforeCreateTarget?.(message);
        const targetId = `target-${nextTarget++}`;
        const targetInfo = {
          targetId,
          type: 'page',
          title: '',
          url: message.params.url,
          browserContextId: 'default',
        };
        targets.set(targetId, targetInfo);
        result = { targetId };
        await options.afterCreateTarget?.(message, targetInfo, targets);
        queueMicrotask(() => {
          if (socket.readyState !== socket.OPEN) return;
          socket.send(JSON.stringify({
            method: 'Target.targetCreated',
            params: { targetInfo },
          }));
        });
      } else if (message.method === 'Target.closeTarget') {
        try {
          result = await options.closeTarget?.(message, targets) ??
            { success: targets.delete(message.params.targetId) };
        } catch (error) {
          socket.send(JSON.stringify({
            id: message.id,
            error: { code: -32000, message: error.message },
            sessionId: message.sessionId,
          }));
          return;
        }
        await options.afterCloseTarget?.(message, result, targets);
      } else if (message.method === 'Target.attachToTarget') {
        result = { sessionId: `session-${message.params.targetId}` };
      } else if (message.method === 'Target.setAutoAttach' && message.params.autoAttach) {
        for (const targetInfo of targets.values()) {
          if (attachedTargets.has(targetInfo.targetId)) continue;
          attachedTargets.add(targetInfo.targetId);
          queueMicrotask(() => {
            socket.send(JSON.stringify({
              method: 'Target.attachedToTarget',
              params: {
                sessionId: `session-${targetInfo.targetId}`,
                targetInfo,
                waitingForDebugger: false,
              },
            }));
          });
        }
      } else if (message.method === 'Runtime.evaluate') {
        result = { result: { type: 'number', value: 42 } };
      }
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ id: message.id, result, sessionId: message.sessionId }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    methods,
    targets,
    emitTargetCreated(targetInfo) {
      targets.set(targetInfo.targetId, targetInfo);
      for (const client of sockets.clients) {
        client.send(JSON.stringify({
          method: 'Target.targetCreated',
          params: { targetInfo },
        }));
      }
    },
    emitSessionEvent(sessionId, method, params) {
      for (const client of sockets.clients) {
        client.send(JSON.stringify({ sessionId, method, params }));
      }
    },
    disconnectClients() {
      for (const client of sockets.clients) client.terminate();
    },
    async close() {
      for (const client of sockets.clients) client.close();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
