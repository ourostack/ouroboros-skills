import { randomBytes, randomUUID } from 'node:crypto';

import { CdpClient } from './cdp-client.mjs';
import { BrokerError } from './claims.mjs';
import { withBrokerLock } from './lock.mjs';
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

export async function createLease({
  stateDir,
  context,
  owner,
  rawEndpoint,
  initialUrl = 'about:blank',
  ttlMs = 300_000,
}) {
  const client = await CdpClient.connect(rawEndpoint);
  let targetId;
  try {
    ({ targetId } = await client.send('Target.createTarget', {
      url: initialUrl,
      background: true,
    }));
  } finally {
    await client.close();
  }

  const now = new Date();
  const lease = {
    id: randomUUID(),
    contextId: context.id,
    claims: context.claims ?? {},
    owner,
    proxyToken: randomBytes(32).toString('base64url'),
    targetIds: [targetId],
    createdAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };

  await withBrokerLock(stateDir, async () => {
    const registry = await readRegistry(stateDir);
    registry.leases[lease.id] = lease;
    await writeRegistry(stateDir, registry);
  });
  return structuredClone(lease);
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
      endpoint,
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

export async function releaseLease({ stateDir, leaseId, rawEndpoint }) {
  const lease = await mutateLease(stateDir, leaseId, (record) => {
    record.releasing = true;
    return structuredClone(record);
  });
  const client = await CdpClient.connect(rawEndpoint);
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
}
