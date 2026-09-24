import { writeFile } from 'node:fs/promises';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
switch (request.payload.fixture) {
  case 'exit':
    process.stderr.write('fixture exit');
    process.exitCode = 7;
    break;
  case 'structured-endpoint-collision':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      message: 'Selected endpoint was claimed before launch',
      details: { endpoint: 'http://127.0.0.1:45001', attempt: 1 },
    }));
    process.exitCode = 9;
    break;
  case 'structured-unsupported-recovery':
    process.stdout.write(JSON.stringify({
      code: 'UNSUPPORTED_CONTEXT_RECOVERY',
      message: 'Provider cannot recover this browser generation',
      details: { contextId: 'requested', reason: 'PROFILE_LOCKED' },
    }));
    process.exitCode = 10;
    break;
  case 'structured-error-without-details':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      message: 'Selected endpoint was claimed before launch',
    }));
    process.exitCode = 18;
    break;
  case 'exit-malformed-error':
    process.stdout.write('{broken');
    process.exitCode = 11;
    break;
  case 'exit-unapproved-error':
    process.stdout.write(JSON.stringify({
      code: 'INTERNAL_PROVIDER_SECRET',
      message: 'Do not expose this provider code',
      details: { unsafe: true },
    }));
    process.exitCode = 12;
    break;
  case 'exit-missing-error-message':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      details: { attempt: 1 },
    }));
    process.exitCode = 15;
    break;
  case 'exit-invalid-error-details':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      message: 'Invalid details shape',
      details: ['not', 'an', 'object'],
    }));
    process.exitCode = 16;
    break;
  case 'exit-error-extra-field':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      message: 'Unexpected envelope field',
      details: { attempt: 1 },
      internal: 'not approved',
    }));
    process.exitCode = 17;
    break;
  case 'exit-blank-error-message':
    process.stdout.write(JSON.stringify({
      code: 'ENDPOINT_COLLISION',
      message: '   ',
      details: { attempt: 1 },
    }));
    process.exitCode = 19;
    break;
  case 'broker-retry':
    if (request.operation === 'discover') {
      process.stdout.write(JSON.stringify({ found: false }));
    } else if (request.operation === 'launch' && request.payload.attempt === 1) {
      process.stdout.write(JSON.stringify({
        code: 'ENDPOINT_COLLISION',
        message: 'Endpoint was claimed during provider launch',
        details: { attempt: request.payload.attempt, endpoint: request.payload.endpoint },
      }));
      process.exitCode = 13;
    } else if (request.operation === 'launch') {
      process.stdout.write(JSON.stringify({
        observation: {
          contextId: request.payload.declaration.id,
          endpoint: request.payload.endpoint,
          processIdentity: {
            pid: 650,
            startIdentity: 'start-650',
            owner: 'operator',
            executable: request.payload.declaration.launch.executable,
            profileRoot: request.payload.declaration.launch.profileRoot,
          },
        },
      }));
    } else if (request.operation === 'attest') {
      process.stdout.write(JSON.stringify({
        healthy: true,
        endpoint: request.payload.observation.endpoint,
        processIdentity: request.payload.observation.processIdentity,
        endpointProcessIdentity: {
          pid: request.payload.observation.processIdentity.pid,
          startIdentity: request.payload.observation.processIdentity.startIdentity,
        },
      }));
    }
    break;
  case 'broker-unsupported-recovery':
    if (request.operation === 'discover') {
      process.stdout.write(JSON.stringify({
        found: true,
        observation: request.payload.observation,
      }));
    } else {
      process.stdout.write(JSON.stringify({
        code: 'UNSUPPORTED_CONTEXT_RECOVERY',
        message: 'Existing context cannot be recovered by this provider',
        details: {
          contextId: request.payload.declaration.id,
          reason: 'PROFILE_VERSION_MISMATCH',
        },
      }));
      process.exitCode = 14;
    }
    break;
  case 'malformed':
    process.stdout.write('{broken');
    break;
  case 'timeout':
    setTimeout(() => process.stdout.write('{}'), 1_000);
    break;
  case 'ignore-sigterm':
    await writeFile(request.payload.pidFile, `${process.pid}\n`);
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1_000);
    break;
  default:
    process.stdout.write(JSON.stringify({
      ok: true,
      operation: request.operation,
      payload: request.payload,
    }));
}
