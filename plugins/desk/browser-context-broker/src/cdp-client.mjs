import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

import { BrokerError } from './claims.mjs';

const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

export async function resolveBrowserWebSocket(
  endpoint,
  { timeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, '')}/json/version`,
      { signal: controller.signal },
    );
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BrokerError(
        'CDP_DISCOVERY_TIMEOUT',
        'Timed out discovering the CDP WebSocket endpoint',
        { timeoutMs },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class CdpClient extends EventEmitter {
  constructor(socket, { commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) {
    super();
    this.socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new BrokerError('CDP_COMMAND_FAILED', message.error.message, {
          cdpCode: message.error.code,
        }));
        else pending.resolve(message.result);
        return;
      }
      this.emit('event', message);
    });
    socket.on('error', () => {
      this.#rejectPending(new BrokerError('CDP_DISCONNECTED', 'CDP connection failed'));
    });
    socket.on('close', () => {
      this.#rejectPending(new BrokerError('CDP_DISCONNECTED', 'CDP connection closed'));
      this.emit('close');
    });
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  static async connect(endpoint, options = {}) {
    const {
      discoveryTimeoutMs = DEFAULT_DISCOVERY_TIMEOUT_MS,
      connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    } = options;
    const metadata = await resolveBrowserWebSocket(endpoint, {
      timeoutMs: discoveryTimeoutMs,
    });
    const socket = new WebSocket(metadata.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new BrokerError(
          'CDP_CONNECT_TIMEOUT',
          'Timed out connecting to the CDP WebSocket endpoint',
          { timeoutMs: connectTimeoutMs },
        ));
      }, connectTimeoutMs);
      timer.unref();
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return new CdpClient(socket, options);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new BrokerError(
          'CDP_COMMAND_TIMEOUT',
          `Timed out waiting for CDP command ${method}`,
          { method, timeoutMs: this.commandTimeoutMs },
        ));
        this.socket.terminate();
      }, this.commandTimeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
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
