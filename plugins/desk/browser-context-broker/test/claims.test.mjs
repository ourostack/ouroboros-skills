import assert from 'node:assert/strict';
import test from 'node:test';

import { expandRequest, matchContext } from '../src/claims.mjs';

const config = {
  aliases: {
    'work-default': {
      surface: 'work',
      identity: 'operator@example.test',
      tenant: 'tenant-a',
      posture: ['managed', 'trusted-network'],
      persistence: 'persistent',
      isolation: 'dedicated-profile',
      capabilities: ['files', 'messages'],
    },
  },
  contexts: [
    {
      id: 'work-a',
      claims: {
        surface: 'work',
        identity: 'operator@example.test',
        tenant: 'tenant-a',
        posture: ['managed', 'trusted-network'],
        persistence: 'persistent',
        isolation: 'dedicated-profile',
        capabilities: ['files', 'messages', 'calendar'],
      },
    },
    {
      id: 'work-b',
      claims: {
        surface: 'work',
        identity: 'other@example.test',
        tenant: 'tenant-b',
        posture: ['managed'],
        persistence: 'persistent',
        isolation: 'dedicated-profile',
        capabilities: ['files'],
      },
    },
  ],
};

test('expandRequest expands aliases and preserves explicit compatible claims', () => {
  assert.deepEqual(
    expandRequest(config, { alias: 'work-default', capabilities: ['messages'] }),
    {
      alias: 'work-default',
      surface: 'work',
      identity: 'operator@example.test',
      tenant: 'tenant-a',
      posture: ['managed', 'trusted-network'],
      persistence: 'persistent',
      isolation: 'dedicated-profile',
      capabilities: ['messages'],
    },
  );
});

test('expandRequest rejects explicit claims that conflict with an alias', () => {
  assert.throws(
    () => expandRequest(config, { alias: 'work-default', tenant: 'tenant-b' }),
    (error) => error.code === 'CONFLICTING_REQUEST_CLAIMS',
  );
});

test('matchContext accepts exact scalar identity and tenant claims', () => {
  assert.equal(
    matchContext(config, {
      surface: 'work',
      identity: 'operator@example.test',
      tenant: 'tenant-a',
    }).id,
    'work-a',
  );
});

test('matchContext accepts request allow-lists containing declaration identity and tenant', () => {
  assert.equal(
    matchContext(config, {
      surface: 'work',
      identity: ['missing@example.test', 'operator@example.test'],
      tenant: ['tenant-z', 'tenant-a'],
    }).id,
    'work-a',
  );
});

test('matchContext requires all requested capabilities and posture labels', () => {
  assert.equal(
    matchContext(config, {
      surface: 'work',
      identity: 'operator@example.test',
      posture: ['managed', 'trusted-network'],
      capabilities: ['messages', 'calendar'],
    }).id,
    'work-a',
  );

  assert.throws(
    () =>
      matchContext(config, {
        surface: 'work',
        identity: 'operator@example.test',
        posture: ['managed', 'missing-posture'],
      }),
    (error) => error.code === 'NO_CONTEXT_MATCH',
  );
});

test('matchContext rejects declarations with missing evidence', () => {
  assert.throws(
    () => matchContext({ contexts: [{ id: 'incomplete', claims: { surface: 'work' } }] }, {
      surface: 'work',
      identity: 'operator@example.test',
    }),
    (error) => error.code === 'NO_CONTEXT_MATCH',
  );
});

test('matchContext fails closed when multiple declarations match', () => {
  const ambiguous = {
    contexts: [
      { id: 'one', claims: { surface: 'work', capabilities: ['files'] } },
      { id: 'two', claims: { surface: 'work', capabilities: ['files'] } },
    ],
  };

  assert.throws(
    () => matchContext(ambiguous, { surface: 'work', capabilities: ['files'] }),
    (error) =>
      error.code === 'AMBIGUOUS_CONTEXT_MATCH' &&
      error.details.matches.join(',') === 'one,two',
  );
});
