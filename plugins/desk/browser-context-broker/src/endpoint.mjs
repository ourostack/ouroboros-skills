import net from 'node:net';

import { BrokerError } from './claims.mjs';

export async function reserveEndpoint(options = {}) {
  const host = options.host ?? '127.0.0.1';
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (cause) => {
      reject(new BrokerError('ENDPOINT_RESERVATION_FAILED', 'Could not reserve a local endpoint', {
        cause: cause.message,
      }));
    });
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(new BrokerError('ENDPOINT_RESERVATION_FAILED', 'Could not release endpoint reservation', {
            cause: error.message,
          }));
          return;
        }
        resolve(`http://${host}:${address.port}`);
      });
    });
  });
}
