import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

import { BrokerError } from './claims.mjs';

export async function resolveBrowserWebSocket(endpoint) {
  const response = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`);
  if (!response.ok) {
    throw new BrokerError('CDP_DISCOVERY_FAILED', 'CDP version endpoint returned an error', {
      status: response.status,
    });
  }
  const metadata = await response.json();
  if (!metadata.webSocketDebuggerUrl) {
    throw new BrokerError('CDP_DISCOVERY_FAILED', 'CDP version response omitted webSocketDebuggerUrl');
  }
  return metadata;
}

export class CdpClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new BrokerError('CDP_COMMAND_FAILED', message.error.message, {
          cdpCode: message.error.code,
        }));
        else pending.resolve(message.result);
        return;
      }
      this.emit('event', message);
    });
    socket.on('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new BrokerError('CDP_DISCONNECTED', 'CDP connection closed'));
      }
      this.pending.clear();
      this.emit('close');
    });
  }

  static async connect(endpoint) {
    const metadata = await resolveBrowserWebSocket(endpoint);
    const socket = new WebSocket(metadata.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      this.socket.once('close', resolve);
      this.socket.close();
    });
  }
}
