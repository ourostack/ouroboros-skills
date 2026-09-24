import http from 'node:http';
import { WebSocketServer } from 'ws';

export async function startFakeCdpServer(options = {}) {
  const targets = new Map([
    ['unowned-existing', {
      targetId: 'unowned-existing',
      type: 'page',
      title: 'Unowned',
      url: 'https://unowned.example.test',
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
    socket.on('message', async (data) => {
      const message = JSON.parse(data.toString());
      methods.push({ method: message.method, params: message.params });
      let result = {};
      if (message.method === 'Target.getTargets') {
        result = { targetInfos: [...targets.values()] };
      } else if (message.method === 'Target.createTarget') {
        await options.beforeCreateTarget?.(message);
        const targetId = `target-${nextTarget++}`;
        const targetInfo = {
          targetId,
          type: 'page',
          title: '',
          url: message.params.url,
        };
        targets.set(targetId, targetInfo);
        result = { targetId };
        queueMicrotask(() => {
          socket.send(JSON.stringify({
            method: 'Target.targetCreated',
            params: { targetInfo },
          }));
        });
      } else if (message.method === 'Target.closeTarget') {
        result = { success: targets.delete(message.params.targetId) };
      } else if (message.method === 'Target.attachToTarget') {
        result = { sessionId: `session-${message.params.targetId}` };
      } else if (message.method === 'Runtime.evaluate') {
        result = { result: { type: 'number', value: 42 } };
      }
      socket.send(JSON.stringify({ id: message.id, result, sessionId: message.sessionId }));
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
    async close() {
      for (const client of sockets.clients) client.close();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
