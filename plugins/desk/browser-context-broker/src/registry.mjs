import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { BrokerError } from './claims.mjs';

export const EMPTY_REGISTRY = Object.freeze({
  version: 1,
  contexts: {},
  leases: {},
});

export async function ensureStateDirectory(stateDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const metadata = await stat(stateDir);
  if (!metadata.isDirectory()) {
    throw new BrokerError('INVALID_STATE_DIRECTORY', 'Broker state path is not a directory');
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new BrokerError(
      'INSECURE_STATE_DIRECTORY',
      'Broker state directory must not be accessible by group or other users',
      { mode: (metadata.mode & 0o777).toString(8) },
    );
  }
}

function validateRegistry(registry) {
  if (
    !registry ||
    registry.version !== 1 ||
    typeof registry.contexts !== 'object' ||
    Array.isArray(registry.contexts) ||
    typeof registry.leases !== 'object' ||
    Array.isArray(registry.leases)
  ) {
    throw new BrokerError('INVALID_REGISTRY', 'Broker registry has an unsupported schema');
  }
  return registry;
}

export async function readRegistry(stateDir) {
  await ensureStateDirectory(stateDir);
  try {
    const contents = await readFile(path.join(stateDir, 'registry.json'), 'utf8');
    return validateRegistry(JSON.parse(contents));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(EMPTY_REGISTRY);
    if (error instanceof SyntaxError) {
      throw new BrokerError('INVALID_REGISTRY', 'Broker registry is not valid JSON');
    }
    throw error;
  }
}

export async function writeRegistry(stateDir, registry) {
  await ensureStateDirectory(stateDir);
  validateRegistry(registry);
  const destination = path.join(stateDir, 'registry.json');
  const temporary = path.join(stateDir, `.registry-${randomUUID()}.json`);
  try {
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    await chmod(temporary, 0o600);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function sameProcessIdentity(left, right) {
  return (
    left?.pid === right?.pid &&
    left?.startIdentity === right?.startIdentity &&
    left?.owner === right?.owner &&
    left?.executable === right?.executable &&
    left?.profileRoot === right?.profileRoot
  );
}

export async function reconcileContext(declaration, observation, provider) {
  if (!observation) {
    return { status: 'absent', reason: 'NO_OBSERVATION', discardObservation: false };
  }

  const attestation = await provider('attest', { declaration, observation });
  if (!attestation?.healthy) {
    return {
      status: 'absent',
      reason: attestation?.reason ?? 'ATTESTATION_UNHEALTHY',
      discardObservation: true,
    };
  }

  const expected = observation.processIdentity;
  const actual = attestation.processIdentity;
  const matchesDeclaration =
    actual?.executable === declaration.launch?.executable &&
    actual?.profileRoot === declaration.launch?.profileRoot;
  if (!sameProcessIdentity(expected, actual) || !matchesDeclaration) {
    return {
      status: 'invalid',
      reason: 'PROCESS_IDENTITY_MISMATCH',
      discardObservation: true,
    };
  }

  if (
    attestation.endpointProcessIdentity?.pid !== actual.pid ||
    attestation.endpointProcessIdentity?.startIdentity !== actual.startIdentity
  ) {
    return {
      status: 'invalid',
      reason: 'ENDPOINT_PROCESS_MISMATCH',
      discardObservation: true,
    };
  }

  return {
    status: 'healthy',
    endpoint: attestation.endpoint,
    processIdentity: actual,
    evidence: attestation.evidence,
    discardObservation: false,
  };
}
