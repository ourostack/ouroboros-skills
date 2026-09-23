#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { acquireContext } from '../src/broker.mjs';
import { startLeaseProxy } from '../src/cdp-proxy.mjs';
import { BrokerError } from '../src/claims.mjs';
import { createLease, releaseLease } from '../src/leases.mjs';
import { invokeProvider } from '../src/provider.mjs';
import { readRegistry } from '../src/registry.mjs';

const SECRET_KEY = /(token|secret|password|cookie|authorization|environment|^env$)/i;

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith('--')) {
      throw new BrokerError('INVALID_ARGUMENTS', `Unexpected argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === 'json') options.json = true;
    else {
      const next = rest[++index];
      if (next === undefined || next.startsWith('--')) {
        throw new BrokerError('INVALID_ARGUMENTS', `Missing value for --${key}`);
      }
      options[key] = next;
    }
  }
  return { command, options };
}

function requireOption(options, name) {
  if (!options[name]) throw new BrokerError('INVALID_ARGUMENTS', `Missing required --${name}`);
  return options[name];
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, item]) => [key, redact(item)]),
  );
}

function providerFor(config) {
  const provider = config.provider;
  if (!provider?.command) {
    throw new BrokerError('INVALID_PROVIDER_CONFIG', 'Configuration must declare provider.command');
  }
  return (operation, payload) =>
    invokeProvider(provider.command, operation, payload, {
      args: provider.args ?? [],
      timeoutMs: provider.timeoutMs,
      cwd: provider.cwd,
      env: provider.environment
        ? { ...process.env, ...provider.environment }
        : process.env,
    });
}

function statusResult(registry) {
  return {
    contexts: Object.values(registry.contexts).map((context) => ({
      contextId: context.contextId,
      claims: context.claims ?? {},
      endpoint: context.endpoint,
      processIdentity: context.processIdentity,
      lastAttestedAt: context.lastAttestedAt,
      health: context.processIdentity ? 'observed' : 'unknown',
    })),
    leases: Object.values(registry.leases).map((lease) => ({
      leaseId: lease.id,
      contextId: lease.contextId,
      owner: lease.owner,
      targetCount: lease.targetIds.length,
      createdAt: lease.createdAt,
      heartbeatAt: lease.heartbeatAt,
      expiresAt: lease.expiresAt,
      proxy: lease.proxy,
      releasing: lease.releasing ?? false,
    })),
  };
}

async function atomicJson(file, value) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${randomUUID()}`);
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

async function run(command, options) {
  const stateDir = requireOption(options, 'state-dir');
  if (command === 'acquire') {
    const config = await loadJson(requireOption(options, 'config'));
    const request = options.alias
      ? { alias: options.alias }
      : JSON.parse(requireOption(options, 'request'));
    const acquired = await acquireContext({
      config,
      request,
      stateDir,
      providerInvoker: providerFor(config),
    });
    const lease = await createLease({
      stateDir,
      context: acquired.context,
      owner: options.owner ?? process.env.USER ?? `pid-${process.pid}`,
      rawEndpoint: acquired.rawEndpoint,
    });
    return {
      leaseId: lease.id,
      contextId: acquired.context.id,
      claims: acquired.context.claims,
      rawEndpoint: acquired.rawEndpoint,
      proxyToken: lease.proxyToken,
    };
  }

  const registry = await readRegistry(stateDir);
  if (command === 'proxy') {
    const leaseId = requireOption(options, 'lease');
    const lease = registry.leases[leaseId];
    if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`);
    const rawEndpoint = registry.contexts[lease.contextId]?.endpoint;
    if (!rawEndpoint) {
      throw new BrokerError('CONTEXT_ENDPOINT_MISSING', `Context endpoint missing for lease: ${leaseId}`);
    }
    const proxy = await startLeaseProxy({ stateDir, leaseId, rawEndpoint });
    const ready = {
      endpoint: proxy.endpoint,
      pid: proxy.pid,
      startIdentity: proxy.startIdentity,
    };
    await atomicJson(requireOption(options, 'json-ready'), ready);
    await new Promise((resolve) => {
      const stop = () => resolve();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    await proxy.close();
    return ready;
  }

  if (command === 'release') {
    const leaseId = requireOption(options, 'lease');
    const lease = registry.leases[leaseId];
    if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`);
    const rawEndpoint = registry.contexts[lease.contextId]?.endpoint;
    if (!rawEndpoint) {
      throw new BrokerError('CONTEXT_ENDPOINT_MISSING', `Context endpoint missing for lease: ${leaseId}`);
    }
    return releaseLease({ stateDir, leaseId, rawEndpoint });
  }

  if (command === 'status') return statusResult(registry);

  if (command === 'doctor') {
    const now = Date.now();
    const diagnostics = Object.values(registry.leases)
      .filter((lease) => Date.parse(lease.expiresAt) <= now)
      .map((lease) => ({
        severity: 'warning',
        code: 'STALE_LEASE',
        leaseId: lease.id,
        contextId: lease.contextId,
        owner: lease.owner,
        message: 'Lease heartbeat has expired; run cleanup for this exact lease.',
      }));
    return { ...statusResult(registry), diagnostics };
  }

  if (command === 'cleanup') {
    const leaseId = requireOption(options, 'lease');
    const lease = registry.leases[leaseId];
    if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`);
    if (Date.parse(lease.expiresAt) > Date.now()) {
      throw new BrokerError('LEASE_NOT_STALE', `Lease is still active: ${leaseId}`, { leaseId });
    }
    const rawEndpoint = registry.contexts[lease.contextId]?.endpoint;
    if (!rawEndpoint) {
      throw new BrokerError('CONTEXT_ENDPOINT_MISSING', `Context endpoint missing for lease: ${leaseId}`);
    }
    return releaseLease({ stateDir, leaseId, rawEndpoint });
  }

  throw new BrokerError('UNKNOWN_COMMAND', `Unknown command: ${command ?? '(missing)'}`);
}

async function main() {
  let command;
  try {
    const parsed = parseArguments(process.argv.slice(2));
    command = parsed.command;
    const result = await run(command, parsed.options);
    if (command !== 'proxy') {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command,
        result: command === 'acquire' ? result : redact(result),
      })}\n`);
    }
  } catch (error) {
    const brokerError = error instanceof BrokerError
      ? error
      : new BrokerError('UNEXPECTED_ERROR', error.message);
    const envelope = {
      ok: false,
      error: {
        code: brokerError.code,
        message: brokerError.message,
        details: redact(brokerError.details ?? {}),
      },
    };
    process.stderr.write(`${JSON.stringify(envelope)}\n`);
    process.exitCode = brokerError.code === 'INVALID_ARGUMENTS' ||
      brokerError.code === 'UNKNOWN_COMMAND'
      ? 2
      : 3;
  }
}

await main();
