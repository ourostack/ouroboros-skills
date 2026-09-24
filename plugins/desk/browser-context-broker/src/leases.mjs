import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { CdpClient } from './cdp-client.mjs';
import { BrokerError } from './claims.mjs';
import { withBrokerLock } from './lock.mjs';
import { reconcileContext } from './registry.mjs';
import { readRegistry, writeRegistry } from './registry.mjs';

const PROCESS_START_IDENTITY = `${process.pid}:${Date.now() - Math.floor(process.uptime() * 1_000)}`;

async function mutateLease(stateDir, leaseId, mutation) {
  return withBrokerLock(stateDir, async () => {
    const registry = await readRegistry(stateDir);
    const lease = registry.leases[leaseId];
    if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`, { leaseId });
    const result = await mutation(lease, registry);
    await writeRegistry(stateDir, registry);
    return result ?? structuredClone(lease);
  });
}

function leaseLockName(leaseId) {
  return `lease-${createHash('sha256').update(leaseId).digest('hex')}`;
}

export function withLeaseOperation(stateDir, leaseId, operation) {
  return withBrokerLock(stateDir, operation, { name: leaseLockName(leaseId) });
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

async function readLease(stateDir, leaseId) {
  const lease = (await readRegistry(stateDir)).leases[leaseId];
  if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`, { leaseId });
  return structuredClone(lease);
}

async function reconcileLeaseContext({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
}) {
  const lease = await readLease(stateDir, leaseId);
  if (
    !lease.rawEndpoint ||
    !lease.processIdentity ||
    declaration?.id !== lease.contextId ||
    typeof providerInvoker !== 'function'
  ) {
    throw new BrokerError(
      'CONTEXT_DISCONNECTED',
      `Lease context is not bound to an attestable process generation: ${leaseId}`,
      { leaseId, contextId: lease.contextId, reason: 'LEASE_ATTESTATION_UNAVAILABLE' },
    );
  }
  const reconciled = await reconcileContext(
    declaration,
    {
      contextId: lease.contextId,
      endpoint: lease.rawEndpoint,
      processIdentity: lease.processIdentity,
    },
    providerInvoker,
  );
  return { lease, reconciled };
}

function isExactHealthyLease(lease, reconciled) {
  return (
    reconciled.status === 'healthy' &&
    reconciled.endpoint === lease.rawEndpoint &&
    sameProcessIdentity(reconciled.processIdentity, lease.processIdentity)
  );
}

function disconnectedLeaseError(lease, reconciled) {
  return new BrokerError(
    'CONTEXT_DISCONNECTED',
    `Lease context process generation is no longer connected: ${lease.id}`,
    {
      leaseId: lease.id,
      contextId: lease.contextId,
      reason: reconciled.reason ?? 'LEASE_PROCESS_GENERATION_CHANGED',
    },
  );
}

export async function attestLeaseContext(options) {
  const { lease, reconciled } = await reconcileLeaseContext(options);
  if (!isExactHealthyLease(lease, reconciled)) {
    throw disconnectedLeaseError(lease, reconciled);
  }
  return lease;
}

export async function createLease({
  stateDir,
  context,
  owner,
  rawEndpoint,
  processIdentity,
  initialUrl = 'about:blank',
  ttlMs = 300_000,
}) {
  if (!rawEndpoint || !processIdentity) {
    throw new BrokerError(
      'INVALID_LEASE_CONTEXT',
      'Lease creation requires an acquired endpoint and attested process identity',
    );
  }
  const now = new Date();
  const lease = {
    id: randomUUID(),
    contextId: context.id,
    claims: context.claims ?? {},
    owner,
    rawEndpoint,
    processIdentity: structuredClone(processIdentity),
    proxyToken: randomBytes(32).toString('base64url'),
    targetIds: [],
    creating: true,
    createdAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  await withBrokerLock(stateDir, async () => {
    const registry = await readRegistry(stateDir);
    registry.leases[lease.id] = lease;
    await writeRegistry(stateDir, registry);
  });

  let targetId;
  try {
    return await withLeaseOperation(stateDir, lease.id, async () => {
      const current = await readLease(stateDir, lease.id);
      if (current.releasing) {
        throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${lease.id}`);
      }
      const client = await CdpClient.connect(rawEndpoint);
      try {
        ({ targetId } = await client.send('Target.createTarget', {
          url: initialUrl,
          background: true,
        }));
      } finally {
        await client.close();
      }
      return mutateLease(stateDir, lease.id, (record) => {
        if (record.releasing) {
          throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${lease.id}`);
        }
        record.targetIds.push(targetId);
        record.creating = false;
      });
    });
  } catch (error) {
    if (targetId) {
      const client = await CdpClient.connect(rawEndpoint).catch(() => undefined);
      if (client) {
        await client.send('Target.closeTarget', { targetId }).catch(() => {});
        await client.close().catch(() => {});
      }
    }
    await withBrokerLock(stateDir, async () => {
      const registry = await readRegistry(stateDir);
      delete registry.leases[lease.id];
      await writeRegistry(stateDir, registry);
    });
    throw error;
  }
}

export async function addOwnedTarget(stateDir, leaseId, targetId) {
  return mutateLease(stateDir, leaseId, (lease) => {
    if (lease.releasing) {
      throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${leaseId}`);
    }
    if (!lease.targetIds.includes(targetId)) lease.targetIds.push(targetId);
    lease.heartbeatAt = new Date().toISOString();
  });
}

export async function removeOwnedTarget(stateDir, leaseId, targetId) {
  return mutateLease(stateDir, leaseId, (lease) => {
    lease.targetIds = lease.targetIds.filter((owned) => owned !== targetId);
    lease.heartbeatAt = new Date().toISOString();
  });
}

export async function recordProxy(stateDir, leaseId, endpoint) {
  return mutateLease(stateDir, leaseId, (lease) => {
    lease.proxy = {
      listener: endpoint,
      pid: process.pid,
      startIdentity: PROCESS_START_IDENTITY,
      heartbeatAt: new Date().toISOString(),
    };
  });
}

export async function heartbeatLease(stateDir, leaseId, ttlMs = 300_000) {
  return mutateLease(stateDir, leaseId, (lease) => {
    const now = new Date();
    lease.heartbeatAt = now.toISOString();
    lease.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    if (lease.proxy) lease.proxy.heartbeatAt = now.toISOString();
  });
}

export async function releaseLease({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
}) {
  return withLeaseOperation(stateDir, leaseId, async () => {
    await attestLeaseContext({ stateDir, leaseId, declaration, providerInvoker });
    const lease = await mutateLease(stateDir, leaseId, (record) => {
      record.releasing = true;
      return structuredClone(record);
    });
    const client = await CdpClient.connect(lease.rawEndpoint);
    try {
      for (const targetId of lease.targetIds) {
        await client.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    } finally {
      await client.close();
    }
    await withBrokerLock(stateDir, async () => {
      const registry = await readRegistry(stateDir);
      delete registry.leases[leaseId];
      await writeRegistry(stateDir, registry);
    });
    return { leaseId, released: true, closedTargetIds: lease.targetIds };
  });
}

export async function cleanupStaleLease({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
}) {
  return withLeaseOperation(stateDir, leaseId, async () => {
    const { lease, reconciled } = await reconcileLeaseContext({
      stateDir,
      leaseId,
      declaration,
      providerInvoker,
    });
    if (reconciled.status === 'absent' && reconciled.discardObservation) {
      await withBrokerLock(stateDir, async () => {
        const registry = await readRegistry(stateDir);
        delete registry.leases[leaseId];
        await writeRegistry(stateDir, registry);
      });
      return {
        leaseId,
        released: true,
        closedTargetIds: [],
        unclosedTargetIds: lease.targetIds,
        targetsClosed: false,
        reason: 'OWNER_GENERATION_GONE',
        contextReason: reconciled.reason,
      };
    }
    if (!isExactHealthyLease(lease, reconciled)) {
      throw disconnectedLeaseError(lease, reconciled);
    }
    const releasingLease = await mutateLease(stateDir, leaseId, (record) => {
      record.releasing = true;
      return structuredClone(record);
    });
    const client = await CdpClient.connect(releasingLease.rawEndpoint);
    try {
      for (const targetId of releasingLease.targetIds) {
        await client.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    } finally {
      await client.close();
    }
    await withBrokerLock(stateDir, async () => {
      const registry = await readRegistry(stateDir);
      delete registry.leases[leaseId];
      await writeRegistry(stateDir, registry);
    });
    return {
      leaseId,
      released: true,
      closedTargetIds: releasingLease.targetIds,
    };
  });
}
