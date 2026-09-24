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

function errorDiagnostic(error) {
  return {
    code: error?.code ?? 'UNKNOWN_ERROR',
    message: error?.message ?? String(error),
    ...(error?.details ? { details: error.details } : {}),
  };
}

function markerTargetUrl(marker) {
  const html = `<!doctype html><meta charset="utf-8"><title>Desk target marker</title><meta name="desk-target-marker" content="${marker}">`;
  return `data:text/html,${encodeURIComponent(html)}`;
}

async function listTargets(rawEndpoint, cdpClientOptions) {
  const client = await CdpClient.connect(rawEndpoint, cdpClientOptions);
  try {
    const result = await client.send('Target.getTargets');
    return result?.targetInfos ?? [];
  } finally {
    await client.close().catch(() => {});
  }
}

async function beginTargetCreate(stateDir, leaseId, requestedUrl) {
  const marker = `${leaseId}:${randomUUID()}`;
  const markerUrl = markerTargetUrl(marker);
  await mutateLease(stateDir, leaseId, (lease) => {
    if (lease.releasing) {
      throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${leaseId}`);
    }
    lease.pendingTargetCreates ??= [];
    lease.pendingTargetCreates.push({
      marker,
      requestedUrl,
      markerUrl,
      startedAt: new Date().toISOString(),
    });
  });
  return { marker, markerUrl };
}

async function settleTargetCreate(
  stateDir,
  leaseId,
  marker,
  targetIds,
  failure,
) {
  return mutateLease(stateDir, leaseId, (lease) => {
    lease.pendingTargetCreates = (lease.pendingTargetCreates ?? [])
      .filter((pending) => pending.marker !== marker);
    for (const targetId of targetIds) {
      if (!lease.targetIds.includes(targetId)) lease.targetIds.push(targetId);
    }
    lease.targetCreateFailures ??= {};
    if (failure) lease.targetCreateFailures[marker] = failure;
    else delete lease.targetCreateFailures[marker];
  });
}

async function retainPendingCreateDiagnostic(stateDir, leaseId, marker, diagnostic) {
  return mutateLease(stateDir, leaseId, (lease) => {
    const pending = (lease.pendingTargetCreates ?? [])
      .find((candidate) => candidate.marker === marker);
    if (pending) pending.diagnostic = diagnostic;
  });
}

async function recordTargetCreateFailure(stateDir, leaseId, marker, diagnostic) {
  return mutateLease(stateDir, leaseId, (lease) => {
    lease.targetCreateFailures ??= {};
    if (diagnostic) lease.targetCreateFailures[marker] = diagnostic;
    else delete lease.targetCreateFailures[marker];
  });
}

async function reconcileTargetCreate({
  stateDir,
  leaseId,
  rawEndpoint,
  marker,
  markerUrl,
  cause,
  cdpClientOptions,
}) {
  let matches;
  try {
    const targetInfos = await listTargets(rawEndpoint, cdpClientOptions);
    matches = targetInfos.filter(({ url }) => url === markerUrl);
  } catch (error) {
    const diagnostic = {
      status: 'RECONCILIATION_FAILED',
      cause: errorDiagnostic(cause),
      reconciliation: errorDiagnostic(error),
    };
    await retainPendingCreateDiagnostic(stateDir, leaseId, marker, diagnostic);
    throw new BrokerError(
      'TARGET_CREATE_INDETERMINATE',
      `Target creation could not be reconciled for lease ${leaseId}`,
      { leaseId, marker, markerUrl, diagnostic },
    );
  }

  if (matches.length === 1) {
    const [match] = matches;
    await settleTargetCreate(stateDir, leaseId, marker, [match.targetId]);
    return { targetId: match.targetId, marker, markerUrl, reconciled: true };
  }
  if (matches.length === 0) {
    const diagnostic = {
      status: 'ZERO_MARKER_MATCHES',
      cause: errorDiagnostic(cause),
    };
    await retainPendingCreateDiagnostic(stateDir, leaseId, marker, diagnostic);
    throw new BrokerError(
      'TARGET_CREATE_INDETERMINATE',
      `Target creation has not produced a queryable marker target for lease ${leaseId}`,
      { leaseId, marker, markerUrl, diagnostic },
    );
  }

  const candidateTargetIds = matches.map(({ targetId }) => targetId);
  const diagnostic = {
    status: 'MULTIPLE_MARKER_MATCHES',
    cause: errorDiagnostic(cause),
    candidateTargetIds,
  };
  await settleTargetCreate(
    stateDir,
    leaseId,
    marker,
    candidateTargetIds,
    diagnostic,
  );
  throw new BrokerError(
    'TARGET_CREATE_INDETERMINATE',
    `Multiple targets matched a unique create marker for lease ${leaseId}`,
    { leaseId, marker, markerUrl, diagnostic },
  );
}

async function navigateOwnedTarget({
  stateDir,
  leaseId,
  rawEndpoint,
  targetId,
  marker,
  markerUrl,
  requestedUrl,
  cdpClientOptions,
}) {
  let client;
  let sessionId;
  try {
    client = await CdpClient.connect(rawEndpoint, cdpClientOptions);
    const attached = await client.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    sessionId = attached?.sessionId;
    if (!sessionId) {
      throw new BrokerError(
        'CDP_COMMAND_FAILED',
        'Target.attachToTarget omitted sessionId',
        { method: 'Target.attachToTarget', targetId },
      );
    }
    const navigated = await client.send(
      'Page.navigate',
      { url: requestedUrl },
      sessionId,
    );
    if (navigated?.errorText) {
      throw new BrokerError(
        'CDP_COMMAND_FAILED',
        `Page.navigate failed: ${navigated.errorText}`,
        { method: 'Page.navigate', targetId, errorText: navigated.errorText },
      );
    }
    await recordTargetCreateFailure(stateDir, leaseId, marker, undefined);
    return { targetId, marker, markerUrl, requestedUrl };
  } catch (error) {
    const diagnostic = {
      status: 'NAVIGATION_FAILED',
      targetId,
      markerUrl,
      requestedUrl,
      cause: errorDiagnostic(error),
    };
    await recordTargetCreateFailure(stateDir, leaseId, marker, diagnostic);
    throw new BrokerError(
      'TARGET_NAVIGATION_FAILED',
      `Owned target could not be navigated for lease ${leaseId}`,
      { leaseId, targetId, marker, markerUrl, requestedUrl, diagnostic },
    );
  } finally {
    if (client && sessionId) {
      await client.send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }
    await client?.close().catch(() => {});
  }
}

export async function createOwnedTarget({
  stateDir,
  leaseId,
  rawEndpoint,
  params = {},
  cdpClientOptions,
  onDispatched,
}) {
  const requestedUrl = params.url ?? 'about:blank';
  const { marker, markerUrl } = await beginTargetCreate(
    stateDir,
    leaseId,
    requestedUrl,
  );
  let client;
  let created;
  let dispatched = false;
  try {
    client = await CdpClient.connect(rawEndpoint, cdpClientOptions);
    const response = client.send('Target.createTarget', {
      ...params,
      url: markerUrl,
      background: true,
    });
    dispatched = true;
    onDispatched?.();
    const result = await response;
    if (!result?.targetId) {
      throw new BrokerError(
        'CDP_COMMAND_FAILED',
        'Target.createTarget omitted targetId',
        { method: 'Target.createTarget' },
      );
    }
    await settleTargetCreate(stateDir, leaseId, marker, [result.targetId]);
    created = {
      targetId: result.targetId,
      marker,
      markerUrl,
      reconciled: false,
    };
  } catch (error) {
    if (!dispatched) {
      await settleTargetCreate(stateDir, leaseId, marker, []);
      throw error;
    }
    created = await reconcileTargetCreate({
      stateDir,
      leaseId,
      rawEndpoint,
      marker,
      markerUrl,
      cause: error,
      cdpClientOptions,
    });
  } finally {
    await client?.close().catch(() => {});
  }
  const navigated = await navigateOwnedTarget({
    stateDir,
    leaseId,
    rawEndpoint,
    targetId: created.targetId,
    marker,
    markerUrl,
    requestedUrl,
    cdpClientOptions,
  });
  return { ...created, ...navigated };
}

async function closeTargetWithReconciliation(
  rawEndpoint,
  targetId,
  cdpClientOptions,
  onDispatched,
) {
  let cause;
  let client;
  try {
    client = await CdpClient.connect(rawEndpoint, cdpClientOptions);
    const response = client.send('Target.closeTarget', { targetId });
    onDispatched?.();
    const result = await response;
    if (result?.success === true) return { closed: true };
    cause = new BrokerError(
      'CDP_COMMAND_FAILED',
      `Target.closeTarget did not confirm closure for ${targetId}`,
      { method: 'Target.closeTarget', targetId, result },
    );
  } catch (error) {
    cause = error;
  } finally {
    await client?.close().catch(() => {});
  }

  try {
    const targetInfos = await listTargets(rawEndpoint, cdpClientOptions);
    if (!targetInfos.some((target) => target.targetId === targetId)) {
      return { closed: true, reconciled: true };
    }
    return {
      closed: false,
      diagnostic: {
        status: 'TARGET_STILL_PRESENT',
        cause: errorDiagnostic(cause),
      },
    };
  } catch (error) {
    return {
      closed: false,
      diagnostic: {
        status: 'RECONCILIATION_FAILED',
        cause: errorDiagnostic(cause),
        reconciliation: errorDiagnostic(error),
      },
    };
  }
}

export async function closeOwnedTarget({
  stateDir,
  leaseId,
  rawEndpoint,
  targetId,
  cdpClientOptions,
  onDispatched,
}) {
  const result = await closeTargetWithReconciliation(
    rawEndpoint,
    targetId,
    cdpClientOptions,
    onDispatched,
  );
  await mutateLease(stateDir, leaseId, (lease) => {
    lease.targetCloseFailures ??= {};
    if (result.closed) {
      lease.targetIds = lease.targetIds.filter((owned) => owned !== targetId);
      delete lease.targetCloseFailures[targetId];
    } else {
      lease.targetCloseFailures[targetId] = result.diagnostic;
    }
  });
  return result;
}

async function closeOwnedTargets(rawEndpoint, targetIds, cdpClientOptions) {
  const closedTargetIds = [];
  const failedTargetIds = [];
  const failureDiagnostics = {};
  for (const targetId of targetIds) {
    const result = await closeTargetWithReconciliation(
      rawEndpoint,
      targetId,
      cdpClientOptions,
    );
    if (result.closed) closedTargetIds.push(targetId);
    else {
      failedTargetIds.push(targetId);
      failureDiagnostics[targetId] = result.diagnostic;
    }
  }
  return { closedTargetIds, failedTargetIds, failureDiagnostics };
}

async function reconcilePendingTargetCreates(
  stateDir,
  leaseId,
  rawEndpoint,
  cdpClientOptions,
) {
  const lease = await readLease(stateDir, leaseId);
  const failed = [];
  for (const pending of lease.pendingTargetCreates ?? []) {
    try {
      const targetInfos = await listTargets(rawEndpoint, cdpClientOptions);
      const markerUrl = pending.markerUrl ?? pending.markedUrl;
      const matches = targetInfos.filter(({ url }) => url === markerUrl);
      if (matches.length === 0) {
        const diagnostic = {
          status: 'ZERO_MARKER_MATCHES',
          ...(pending.diagnostic?.cause ? { cause: pending.diagnostic.cause } : {}),
        };
        await retainPendingCreateDiagnostic(
          stateDir,
          leaseId,
          pending.marker,
          diagnostic,
        );
        failed.push({
          marker: pending.marker,
          markerUrl,
          diagnostic,
        });
        continue;
      }
      const targetIds = matches.map(({ targetId }) => targetId);
      const diagnostic = matches.length > 1
        ? {
            status: 'MULTIPLE_MARKER_MATCHES',
            candidateTargetIds: targetIds,
          }
        : undefined;
      await settleTargetCreate(
        stateDir,
        leaseId,
        pending.marker,
        targetIds,
        diagnostic,
      );
    } catch (error) {
      const diagnostic = {
        status: 'RECONCILIATION_FAILED',
        reconciliation: errorDiagnostic(error),
      };
      await retainPendingCreateDiagnostic(
        stateDir,
        leaseId,
        pending.marker,
        diagnostic,
      );
      failed.push({
        marker: pending.marker,
        markerUrl: pending.markerUrl ?? pending.markedUrl,
        diagnostic,
      });
    }
  }
  return failed;
}

async function recordTargetClosures(
  stateDir,
  leaseId,
  closedTargetIds,
  failedTargetIds,
  failureDiagnostics = {},
  { retainReleasing = false } = {},
) {
  return withBrokerLock(stateDir, async () => {
    const registry = await readRegistry(stateDir);
    const lease = registry.leases[leaseId];
    if (!lease) throw new BrokerError('LEASE_NOT_FOUND', `Lease not found: ${leaseId}`, { leaseId });
    const closed = new Set(closedTargetIds);
    lease.targetIds = lease.targetIds.filter((targetId) => !closed.has(targetId));
    lease.targetCloseFailures ??= {};
    for (const targetId of closedTargetIds) delete lease.targetCloseFailures[targetId];
    for (const targetId of failedTargetIds) {
      lease.targetCloseFailures[targetId] = failureDiagnostics[targetId];
    }
    const released =
      failedTargetIds.length === 0 &&
      lease.targetIds.length === 0 &&
      (lease.pendingTargetCreates?.length ?? 0) === 0;
    if (released) delete registry.leases[leaseId];
    else if (!retainReleasing) lease.releasing = false;
    await writeRegistry(stateDir, registry);
    return {
      leaseId,
      released,
      closedTargetIds,
      failedTargetIds,
    };
  });
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
  cdpClientOptions,
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
    pendingTargetCreates: [],
    targetCreateFailures: {},
    targetCloseFailures: {},
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

  try {
    return await withLeaseOperation(stateDir, lease.id, async () => {
      const current = await readLease(stateDir, lease.id);
      if (current.releasing) {
        throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${lease.id}`);
      }
      await createOwnedTarget({
        stateDir,
        leaseId: lease.id,
        rawEndpoint,
        params: { url: initialUrl },
        cdpClientOptions,
      });
      return mutateLease(stateDir, lease.id, (record) => {
        if (record.releasing) {
          throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${lease.id}`);
        }
        record.creating = false;
      });
    });
  } catch (error) {
    let retained = false;
    await withBrokerLock(stateDir, async () => {
      const registry = await readRegistry(stateDir);
      const current = registry.leases[lease.id];
      if (
        current &&
        (
          current.targetIds.length > 0 ||
          (current.pendingTargetCreates?.length ?? 0) > 0
        )
      ) {
        current.creating = false;
        current.createFailure = errorDiagnostic(error);
        retained = true;
      } else {
        delete registry.leases[lease.id];
      }
      await writeRegistry(stateDir, registry);
    });
    if (retained && error instanceof BrokerError) {
      error.details = { ...error.details, leaseId: lease.id, retained: true };
    }
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
    if (lease.targetCloseFailures) delete lease.targetCloseFailures[targetId];
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
  return withLeaseOperation(stateDir, leaseId, () => {
    return mutateLease(stateDir, leaseId, (lease) => {
      if (lease.releasing) {
        throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${leaseId}`);
      }
      const now = new Date();
      lease.heartbeatAt = now.toISOString();
      lease.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      if (lease.proxy) lease.proxy.heartbeatAt = now.toISOString();
    });
  });
}

export async function releaseLease({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
  cdpClientOptions,
}) {
  return withLeaseOperation(stateDir, leaseId, async () => {
    await attestLeaseContext({ stateDir, leaseId, declaration, providerInvoker });
    const lease = await mutateLease(stateDir, leaseId, (record) => {
      record.releasing = true;
      return structuredClone(record);
    });
    const pendingCreateFailures = await reconcilePendingTargetCreates(
      stateDir,
      leaseId,
      lease.rawEndpoint,
      cdpClientOptions,
    );
    if (pendingCreateFailures.length > 0) {
      throw new BrokerError(
        'PARTIAL_RELEASE',
        `Lease release has indeterminate target creation: ${leaseId}`,
        { leaseId, pendingTargetCreates: pendingCreateFailures },
      );
    }
    const current = await readLease(stateDir, leaseId);
    const {
      closedTargetIds,
      failedTargetIds,
      failureDiagnostics,
    } = await closeOwnedTargets(
      lease.rawEndpoint,
      current.targetIds,
      cdpClientOptions,
    );
    const result = await recordTargetClosures(
      stateDir,
      leaseId,
      closedTargetIds,
      failedTargetIds,
      failureDiagnostics,
      { retainReleasing: true },
    );
    if (!result.released) {
      throw new BrokerError(
        'PARTIAL_RELEASE',
        `Lease release incomplete: ${leaseId}`,
        {
          leaseId,
          failedTargetIds: result.failedTargetIds,
          targetFailures: failureDiagnostics,
        },
      );
    }
    return result;
  });
}

export async function cleanupStaleLease({
  stateDir,
  leaseId,
  declaration,
  providerInvoker,
  cdpClientOptions,
}) {
  return withLeaseOperation(stateDir, leaseId, async () => {
    await mutateLease(stateDir, leaseId, (record) => {
      if (record.releasing) {
        throw new BrokerError('LEASE_RELEASING', `Lease is being released: ${leaseId}`);
      }
      if (Date.parse(record.expiresAt) > Date.now()) {
        throw new BrokerError('LEASE_NOT_STALE', `Lease is still active: ${leaseId}`, { leaseId });
      }
      record.releasing = true;
    });
    try {
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
      const pendingCreateFailures = await reconcilePendingTargetCreates(
        stateDir,
        leaseId,
        lease.rawEndpoint,
        cdpClientOptions,
      );
      if (pendingCreateFailures.length > 0) {
        throw new BrokerError(
          'PARTIAL_RELEASE',
          `Stale lease cleanup has indeterminate target creation: ${leaseId}`,
          { leaseId, pendingTargetCreates: pendingCreateFailures },
        );
      }
      const current = await readLease(stateDir, leaseId);
      const {
        closedTargetIds,
        failedTargetIds,
        failureDiagnostics,
      } = await closeOwnedTargets(
        lease.rawEndpoint,
        current.targetIds,
        cdpClientOptions,
      );
      return recordTargetClosures(
        stateDir,
        leaseId,
        closedTargetIds,
        failedTargetIds,
        failureDiagnostics,
      );
    } catch (error) {
      await withBrokerLock(stateDir, async () => {
        const registry = await readRegistry(stateDir);
        const lease = registry.leases[leaseId];
        if (lease?.releasing) {
          lease.releasing = false;
          await writeRegistry(stateDir, registry);
        }
      });
      throw error;
    }
  });
}
