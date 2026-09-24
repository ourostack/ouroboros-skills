import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { invokeProvider } from '../src/provider.mjs';

const fixture = new URL('./fixtures/json-provider.mjs', import.meta.url);
const scratchRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '.provider-state');

test.before(async () => {
  await mkdir(scratchRoot, { recursive: true });
});

test.after(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

test('invokeProvider exchanges one JSON request and response', async () => {
  const response = await invokeProvider(process.execPath, 'discover', {
    fixture: 'success',
    value: 42,
  }, {
    args: [fixture.pathname],
  });

  assert.deepEqual(response, {
    ok: true,
    operation: 'discover',
    payload: { fixture: 'success', value: 42 },
  });
});

test('invokeProvider reports non-zero exits with bounded stderr diagnostics', async () => {
  await assert.rejects(
    invokeProvider(process.execPath, 'discover', { fixture: 'exit' }, {
      args: [fixture.pathname],
    }),
    (error) =>
      error.code === 'PROVIDER_EXITED' &&
      error.details.exitCode === 7 &&
      error.details.stderr === 'fixture exit',
  );
});

test('invokeProvider preserves approved structured provider errors', async () => {
  const cases = [
    {
      fixture: 'structured-endpoint-collision',
      code: 'ENDPOINT_COLLISION',
      message: 'Selected endpoint was claimed before launch',
      details: { endpoint: 'http://127.0.0.1:45001', attempt: 1 },
    },
    {
      fixture: 'structured-unsupported-recovery',
      code: 'UNSUPPORTED_CONTEXT_RECOVERY',
      message: 'Provider cannot recover this browser generation',
      details: { contextId: 'requested', reason: 'PROFILE_LOCKED' },
    },
    {
      fixture: 'structured-error-without-details',
      code: 'ENDPOINT_COLLISION',
      message: 'Selected endpoint was claimed before launch',
      details: {},
    },
  ];

  for (const expected of cases) {
    await assert.rejects(
      invokeProvider(process.execPath, 'launch', { fixture: expected.fixture }, {
        args: [fixture.pathname],
      }),
      (error) => {
        assert.equal(error.code, expected.code);
        assert.equal(error.message, expected.message);
        assert.deepEqual(error.details, expected.details);
        return true;
      },
    );
  }
});

test('invokeProvider maps malformed and unapproved provider errors to PROVIDER_EXITED', async () => {
  for (const fixtureName of [
    'exit-malformed-error',
    'exit-unapproved-error',
    'exit-missing-error-message',
    'exit-invalid-error-details',
    'exit-error-extra-field',
    'exit-blank-error-message',
  ]) {
    await assert.rejects(
      invokeProvider(process.execPath, 'launch', { fixture: fixtureName }, {
        args: [fixture.pathname],
      }),
      (error) =>
        error.code === 'PROVIDER_EXITED' &&
        typeof error.details.exitCode === 'number',
    );
  }
});

test('invokeProvider rejects malformed JSON', async () => {
  await assert.rejects(
    invokeProvider(process.execPath, 'discover', { fixture: 'malformed' }, {
      args: [fixture.pathname],
    }),
    (error) => error.code === 'PROVIDER_INVALID_JSON',
  );
});

test('invokeProvider enforces a timeout', async () => {
  await assert.rejects(
    invokeProvider(process.execPath, 'discover', { fixture: 'timeout' }, {
      args: [fixture.pathname],
      timeoutMs: 25,
    }),
    (error) => error.code === 'PROVIDER_TIMEOUT',
  );
});

test('invokeProvider kills a provider that ignores SIGTERM before rejecting', async () => {
  const pidFile = path.join(scratchRoot, 'ignore-sigterm.pid');
  let pid;
  try {
    await assert.rejects(
      invokeProvider(process.execPath, 'discover', {
        fixture: 'ignore-sigterm',
        pidFile,
      }, {
        args: [fixture.pathname],
        timeoutMs: 150,
        terminationGraceMs: 25,
      }),
      (error) => error.code === 'PROVIDER_TIMEOUT',
    );
    pid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
});
