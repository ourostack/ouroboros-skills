import assert from 'node:assert/strict';
import test from 'node:test';

import { invokeProvider } from '../src/provider.mjs';

const fixture = new URL('./fixtures/json-provider.mjs', import.meta.url);

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
