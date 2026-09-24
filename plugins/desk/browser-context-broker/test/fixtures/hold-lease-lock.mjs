import { withLeaseOperation } from '../../src/leases.mjs';

const [stateDir, leaseId] = process.argv.slice(2);

await withLeaseOperation(stateDir, leaseId, async () => {
  process.stdout.write('locked\n');
  await new Promise(() => {});
});
