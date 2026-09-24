import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { createLease } from '../src/leases.mjs';
import { readRegistry, writeRegistry } from '../src/registry.mjs';
import { startFakeCdpServer } from './fixtures/fake-cdp-server.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cli = path.join(packageRoot, 'bin/browser-context-broker.mjs');
const providerFixture = path.join(packageRoot, 'test/fixtures/fake-provider.mjs');
const scratchRoot = path.join(packageRoot, 'test/.cli-state');
const packageScratchRoot = path.resolve(packageRoot, '../../../..', '.browser-context-broker-package-test');

async function stateDir() {
  const directory = path.join(scratchRoot, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  return directory;
}

async function writeConfig(directory, rawEndpoint) {
  const configPath = path.join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    provider: {
      command: process.execPath,
      args: [providerFixture],
      environment: { PROVIDER_SECRET: 'must-not-appear' },
    },
    aliases: {
      default: {
        surface: 'work',
        identity: 'operator@example.test',
        persistence: 'persistent',
      },
    },
    contexts: [
      {
        id: 'work',
        claims: {
          surface: 'work',
          identity: 'operator@example.test',
          persistence: 'persistent',
        },
        launch: {
          executable: '/opt/browser',
          profileRoot: '/profiles/work',
          environment: { API_TOKEN: 'must-not-appear' },
        },
        testEndpoint: rawEndpoint,
      },
    ],
  }));
  return configPath;
}

const testProcessIdentity = {
  pid: 900,
  startIdentity: 'start-900',
  owner: 'operator',
  executable: '/opt/browser',
  profileRoot: '/profiles/work',
};

async function run(args, options = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cli, ...args], {
      cwd: packageRoot,
      ...options,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

async function waitForChildExit(child, timeoutMs = 1_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return {
      exited: true,
      code: child.exitCode,
      signal: child.signalCode,
    };
  }
  return Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => {
      resolve({ exited: true, code, signal });
    })),
    new Promise((resolve) => setTimeout(() => resolve({ exited: false }), timeoutMs)),
  ]);
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

test.after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
  await rm(packageScratchRoot, { recursive: true, force: true });
});

test('acquire emits the stable launcher-facing JSON contract', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const result = await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ]);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, 'acquire');
  assert.equal(envelope.result.contextId, 'work');
  assert.ok(envelope.result.leaseId);
  assert.deepEqual(envelope.result.claims, {
    surface: 'work',
    identity: 'operator@example.test',
    persistence: 'persistent',
  });
  assert.deepEqual(Object.keys(envelope.result).sort(), [
    'claims',
    'contextId',
    'leaseId',
  ]);
  assert.ok(!result.stdout.includes(fake.endpoint));
  assert.ok(!result.stdout.includes('proxyToken'));
});

test('CLI failures use stable JSON error envelopes and exit codes', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const result = await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--request', JSON.stringify({ surface: 'missing' }),
    '--json',
  ]);
  await fake.close();

  assert.equal(result.exitCode, 3);
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    error: {
      code: 'NO_CONTEXT_MATCH',
      message: 'No context declaration matches all requested claims',
      details: { request: { surface: 'missing' } },
    },
  });
});

test('status redacts tokens, secrets, environment, and provider configuration', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ]);
  const result = await run(['status', '--state-dir', directory, '--json']);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  const output = result.stdout.toLowerCase();
  assert.ok(!output.includes('proxytoken'));
  assert.ok(!output.includes('must-not-appear'));
  assert.ok(!output.includes('environment'));
  assert.ok(!output.includes(providerFixture.toLowerCase()));
  assert.ok(!result.stdout.includes(fake.endpoint));
});

test('status does not publish a usable authenticated proxy endpoint', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const acquired = JSON.parse((await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ])).stdout).result;
  const registry = await readRegistry(directory);
  const proxyToken = registry.leases[acquired.leaseId].proxyToken;
  registry.leases[acquired.leaseId].proxy = {
    endpoint: `http://127.0.0.1:12345/${proxyToken}`,
    pid: 123,
    startIdentity: 'proxy-start',
  };
  await writeRegistry(directory, registry);

  const result = await run(['status', '--state-dir', directory, '--json']);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(!result.stdout.includes(proxyToken));
  assert.ok(!result.stdout.includes('/devtools/browser/'));
});

test('doctor reports stale leases without exposing their proxy token', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const lease = await createLease({
    stateDir: directory,
    context: {
      id: 'work',
      claims: {},
    },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity: testProcessIdentity,
  });
  const registry = await readRegistry(directory);
  registry.leases[lease.id].expiresAt = new Date(0).toISOString();
  await writeRegistry(directory, registry);

  const result = await run(['doctor', '--state-dir', directory, '--json']);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.result.diagnostics[0].code, 'STALE_LEASE');
  assert.equal(envelope.result.diagnostics[0].leaseId, lease.id);
  assert.ok(!result.stdout.includes(lease.proxyToken));
});

test('doctor freshly attests registry observations through the configured provider', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ]);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.contexts[0].testAttestation = 'unhealthy';
  await writeFile(configPath, JSON.stringify(config));

  const result = await run([
    'doctor',
    '--config', configPath,
    '--state-dir', directory,
    '--json',
  ]);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.result.contextHealth[0].status, 'absent');
  assert.equal(envelope.result.contextHealth[0].reason, 'TEST_ATTESTATION_FAILED');
  assert.ok(envelope.result.diagnostics.some(({ code }) => code === 'CONTEXT_ATTESTATION_FAILED'));
  assert.ok(!result.stdout.includes(fake.endpoint));
});

test('cleanup expires only the specified stale lease and its owned targets', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const first = await createLease({
    stateDir: directory,
    context: { id: 'work', claims: {} },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity: testProcessIdentity,
  });
  const second = await createLease({
    stateDir: directory,
    context: { id: 'work', claims: {} },
    owner: 'agent-b',
    rawEndpoint: fake.endpoint,
    processIdentity: testProcessIdentity,
  });
  const registry = await readRegistry(directory);
  registry.contexts.work = { contextId: 'work', endpoint: fake.endpoint };
  registry.leases[first.id].expiresAt = new Date(0).toISOString();
  await writeRegistry(directory, registry);

  const result = await run([
    'cleanup',
    '--config', configPath,
    '--state-dir', directory,
    '--lease', first.id,
    '--json',
  ]);
  const after = await readRegistry(directory);
  await fake.close();

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(after.leases[first.id], undefined);
  assert.ok(after.leases[second.id]);
  assert.ok(!fake.targets.has(first.targetIds[0]));
  assert.ok(fake.targets.has(second.targetIds[0]));
});

test('cleanup fails disconnected instead of following repaired registry state', async () => {
  const original = await startFakeCdpServer();
  const replacement = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, original.endpoint);
  const acquired = JSON.parse((await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ])).stdout).result;
  const registry = await readRegistry(directory);
  const ownedTarget = registry.leases[acquired.leaseId].targetIds[0];
  registry.leases[acquired.leaseId].expiresAt = new Date(0).toISOString();
  registry.contexts.work.endpoint = replacement.endpoint;
  registry.contexts.work.processIdentity = {
    ...registry.contexts.work.processIdentity,
    startIdentity: 'replacement-generation',
  };
  await writeRegistry(directory, registry);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.contexts[0].testAttestation = 'replacement';
  await writeFile(configPath, JSON.stringify(config));

  const result = await run([
    'cleanup',
    '--config', configPath,
    '--state-dir', directory,
    '--lease', acquired.leaseId,
    '--json',
  ]);
  const after = await readRegistry(directory);
  await original.close();
  await replacement.close();

  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.stderr).error.code, 'CONTEXT_DISCONNECTED');
  assert.ok(after.leases[acquired.leaseId]);
  assert.ok(original.targets.has(ownedTarget));
  assert.equal(replacement.methods.length, 0);
});

test('cleanup removes a stale lease after proving its owner generation is absent', async () => {
  const original = await startFakeCdpServer();
  const replacement = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, original.endpoint);
  const acquired = JSON.parse((await run([
    'acquire',
    '--config', configPath,
    '--state-dir', directory,
    '--alias', 'default',
    '--json',
  ])).stdout).result;
  const registry = await readRegistry(directory);
  const ownedTarget = registry.leases[acquired.leaseId].targetIds[0];
  registry.leases[acquired.leaseId].expiresAt = new Date(0).toISOString();
  registry.contexts.work.endpoint = replacement.endpoint;
  registry.contexts.work.processIdentity = {
    ...registry.contexts.work.processIdentity,
    startIdentity: 'replacement-generation',
  };
  await writeRegistry(directory, registry);
  await original.close();
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.contexts[0].testAttestation = 'absent';
  await writeFile(configPath, JSON.stringify(config));

  const result = await run([
    'cleanup',
    '--config', configPath,
    '--state-dir', directory,
    '--lease', acquired.leaseId,
    '--json',
  ]);
  const after = await readRegistry(directory);
  await replacement.close();

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(after.leases[acquired.leaseId], undefined);
  assert.equal(replacement.methods.length, 0);
  assert.deepEqual(JSON.parse(result.stdout).result, {
    leaseId: acquired.leaseId,
    released: true,
    closedTargetIds: [],
    unclosedTargetIds: [ownedTarget],
    targetsClosed: false,
    reason: 'OWNER_GENERATION_GONE',
    contextReason: 'PROCESS_ABSENT',
  });
});

test('proxy publishes exact readiness metadata for a lease', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const lease = await createLease({
    stateDir: directory,
    context: { id: 'work', claims: {} },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity: testProcessIdentity,
  });
  const registry = await readRegistry(directory);
  registry.contexts.work = { contextId: 'work', endpoint: fake.endpoint };
  await writeRegistry(directory, registry);
  const readyPath = path.join(directory, 'proxy-ready.json');
  const child = spawn(process.execPath, [
    cli,
    'proxy',
    '--config', configPath,
    '--state-dir', directory,
    '--lease', lease.id,
    '--json-ready', readyPath,
  ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] });

  let ready;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      ready = JSON.parse(await readFile(readyPath, 'utf8'));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await fake.close();

  assert.ok(ready?.endpoint);
  assert.equal(ready.pid, child.pid);
  assert.ok(ready.startIdentity);
});

test('proxy exits and releases its listener when ready-file publication fails', async () => {
  const fake = await startFakeCdpServer();
  const directory = await stateDir();
  const configPath = await writeConfig(directory, fake.endpoint);
  const lease = await createLease({
    stateDir: directory,
    context: { id: 'work', claims: {} },
    owner: 'agent-a',
    rawEndpoint: fake.endpoint,
    processIdentity: testProcessIdentity,
  });
  const registry = await readRegistry(directory);
  registry.contexts.work = { contextId: 'work', endpoint: fake.endpoint };
  await writeRegistry(directory, registry);
  const readyPath = path.join(directory, 'missing-parent', 'proxy-ready.json');
  const child = spawn(process.execPath, [
    cli,
    'proxy',
    '--config', configPath,
    '--state-dir', directory,
    '--lease', lease.id,
    '--json-ready', readyPath,
  ], { cwd: packageRoot, stdio: ['ignore', 'pipe', 'pipe'] });

  let listener;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await readRegistry(directory);
    listener = current.leases[lease.id]?.proxy?.listener;
    if (listener) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const exit = await waitForChildExit(child);
  if (!exit.exited) {
    child.kill('SIGTERM');
    await waitForChildExit(child);
  }
  await fake.close();

  assert.ok(listener?.port);
  assert.equal(exit.exited, true, 'proxy process remained alive after readiness failure');
  assert.equal(await canConnect(listener.port), false);
});

test('clean source package installs production dependencies and launches help and status', async () => {
  const directory = await stateDir();
  const copyRoot = path.join(packageScratchRoot, randomUUID());
  await mkdir(packageScratchRoot, { recursive: true });
  await cp(packageRoot, copyRoot, {
    recursive: true,
    filter: (source) => {
      const parts = source.split(path.sep);
      return !parts.includes('node_modules') &&
        !parts.some((part) => /^\..+-state$/u.test(part));
    },
  });
  const packageReadme = await readFile(path.join(copyRoot, 'README.md'), 'utf8');
  assert.match(packageReadme, /plugin-relative source/);
  assert.match(packageReadme, /host overlay.*executable path/is);
  assert.match(packageReadme, /does not.*PATH/is);
  await execFileAsync('npm', ['ci', '--omit=dev', '--ignore-scripts'], {
    cwd: copyRoot,
    timeout: 120_000,
  });
  const copiedCli = path.join(copyRoot, 'bin/browser-context-broker.mjs');
  const help = await execFileAsync(process.execPath, [copiedCli, '--help'], {
    cwd: copyRoot,
  });
  const copiedState = path.join(directory, 'copied-state');
  await mkdir(copiedState, { mode: 0o700 });
  const status = await execFileAsync(process.execPath, [
    copiedCli,
    'status',
    '--state-dir', copiedState,
    '--json',
  ], { cwd: copyRoot });

  assert.match(help.stdout, /browser-context-broker/);
  assert.equal(JSON.parse(status.stdout).command, 'status');
});
