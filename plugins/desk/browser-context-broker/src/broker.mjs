import { matchContext } from './claims.mjs';
import { BrokerError } from './claims.mjs';
import { reserveEndpoint } from './endpoint.mjs';
import { withBrokerLock } from './lock.mjs';
import { readRegistry, reconcileContext, writeRegistry } from './registry.mjs';

async function updateContext(stateDir, contextId, observation) {
  await withBrokerLock(stateDir, async () => {
    const registry = await readRegistry(stateDir);
    if (observation) registry.contexts[contextId] = observation;
    else delete registry.contexts[contextId];
    await writeRegistry(stateDir, registry);
  });
}

function publicResult(declaration, reconciled, recovery) {
  return {
    context: declaration,
    rawEndpoint: reconciled.endpoint,
    processIdentity: reconciled.processIdentity,
    recovery,
  };
}

export async function acquireContext({
  config,
  request,
  stateDir,
  providerInvoker,
  endpointAllocator = () => reserveEndpoint(config?.endpoint),
}) {
  const declaration = matchContext(config, request);

  return withBrokerLock(
    stateDir,
    async () => {
      const registry = await readRegistry(stateDir);
      const registryObservation = registry.contexts[declaration.id];
      const discovery = await providerInvoker('discover', {
        declaration,
        observation: registryObservation,
      });
      const observation = discovery?.found ? discovery.observation : undefined;
      let recovery = registryObservation ? 'recovered' : 'provisioned';

      if (observation) {
        const reconciled = await reconcileContext(
          declaration,
          observation,
          providerInvoker,
        );
        if (reconciled.status === 'healthy') {
          const freshObservation = {
            contextId: declaration.id,
            claims: declaration.claims,
            endpoint: reconciled.endpoint,
            processIdentity: reconciled.processIdentity,
            lastAttestedAt: new Date().toISOString(),
          };
          await updateContext(stateDir, declaration.id, freshObservation);
          return publicResult(declaration, reconciled, 'reused');
        }
        recovery = 'recovered';
        await updateContext(stateDir, declaration.id, undefined);
      } else if (registryObservation) {
        await updateContext(stateDir, declaration.id, undefined);
      }

      const maxAttempts = config?.endpoint?.maxAttempts ?? 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const endpoint = await endpointAllocator();
        let launch;
        try {
          launch = await providerInvoker('launch', {
            declaration,
            endpoint,
            attempt,
          });
        } catch (error) {
          if (error.code === 'ENDPOINT_COLLISION' && attempt < maxAttempts) continue;
          throw error;
        }
        if (launch?.code === 'ENDPOINT_COLLISION') {
          if (attempt < maxAttempts) continue;
          throw new BrokerError('ENDPOINT_COLLISION', 'No collision-free endpoint could be allocated', {
            attempts: maxAttempts,
          });
        }
        if (!launch?.observation) {
          throw new BrokerError('PROVIDER_LAUNCH_FAILED', 'Provider did not return a launch observation');
        }

        const reconciled = await reconcileContext(
          declaration,
          launch.observation,
          providerInvoker,
        );
        if (reconciled.status !== 'healthy') {
          throw new BrokerError(
            'LAUNCH_ATTESTATION_FAILED',
            'Launched context failed fresh attestation',
            { contextId: declaration.id, reason: reconciled.reason },
          );
        }

        await updateContext(stateDir, declaration.id, {
          contextId: declaration.id,
          claims: declaration.claims,
          endpoint: reconciled.endpoint,
          processIdentity: reconciled.processIdentity,
          lastAttestedAt: new Date().toISOString(),
        });
        return publicResult(declaration, reconciled, recovery);
      }

      throw new BrokerError('PROVIDER_LAUNCH_FAILED', 'Provider launch attempts were exhausted');
    },
    { name: `context-${declaration.id}` },
  );
}
