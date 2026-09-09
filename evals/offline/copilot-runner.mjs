import { nonblank, parseRawJson, plainObject, readRawReference, requireCondition } from "./core.mjs";

const identity = row => JSON.stringify([row.pid, row.spawnIdentity]);
function observedProcess(row, type, runId, readArtifact) {
  requireCondition(plainObject(row) && Number.isSafeInteger(row.pid) && row.pid > 0 && nonblank(row.spawnIdentity), "INVALID_PROCESS_IDENTITY", "Process ownership requires a PID and a unique spawn identity");
  const bytes = readRawReference(row.rawRef, readArtifact);
  const raw = parseRawJson(bytes);
  requireCondition((row.rawRef.byteLength === undefined || row.rawRef.byteLength === bytes.length) && raw.type === type && raw.pid === row.pid && raw.spawnIdentity === row.spawnIdentity && (raw.runId === undefined || raw.runId === runId), "PROCESS_REFERENCE_MISMATCH", "Process observation does not match its raw reference or run");
  if (type === "exit") requireCondition(row.exited === true && raw.exited === true, "PROCESS_EXIT_UNVERIFIED", "An observed exit is required");
  return identity(row);
}
function ownedIdentities(rows, runId, readArtifact) {
  requireCondition(Array.isArray(rows) && rows.length > 0 && rows.length <= 1024, "OWNERSHIP_NOT_VERIFIED", "Expected a bounded owned-spawn inventory");
  const identities = rows.map(row => observedProcess(row, "spawn", runId, readArtifact));
  requireCondition(new Set(identities).size === identities.length, "DUPLICATE_PROCESS_IDENTITY", "Owned spawn identities must be unique");
  return identities;
}
export function validateCleanupReceipt(receipt, { runId, readArtifact }) {
  try {
    requireCondition(nonblank(runId) && plainObject(receipt) && receipt.runId === runId && receipt.completedWithinBudget === true && Array.isArray(receipt.unverifiedPids) && receipt.unverifiedPids.length === 0, "INVALID_CLEANUP_RECEIPT", "Cleanup requires a scoped, within-budget receipt without unverified PIDs");
    const owned = ownedIdentities(receipt.ownedSpawns, runId, readArtifact);
    requireCondition(Array.isArray(receipt.exitObservations) && receipt.exitObservations.length === owned.length, "INCOMPLETE_EXIT_INVENTORY", "Every owned spawn requires exactly one exit observation");
    const exited = receipt.exitObservations.map(row => observedProcess(row, "exit", runId, readArtifact));
    requireCondition(new Set(exited).size === exited.length && exited.every(key => owned.includes(key)), "EXIT_INVENTORY_MISMATCH", "Exit observations must match the owned spawn inventory");
    return { ok: true };
  } catch (error) { return { ok: false, reason: error.message }; }
}
export function validateActivationReceipt({ requested, observed }) {
  // Native activation qualification is a separate, unreleased adapter; names and reconstructed prose are not proof.
  return { availability: "unavailable", reason: observed == null ? "activation_not_observed" : "native_activation_not_qualified", requested };
}
export async function cleanupOwnedRuntime({ runId, ownedSpawns, session, client, verifyExit, readArtifact, budget, clock = Date.now }) {
  requireCondition(nonblank(runId) && plainObject(budget) && [budget.totalMs, budget.abortMs, budget.stopMs].every(value => Number.isSafeInteger(value) && value > 0) && budget.abortMs + budget.stopMs < budget.totalMs, "INVALID_CLEANUP_BUDGET", "Abort, stop and final verification require a finite total budget");
  ownedIdentities(ownedSpawns, runId, readArtifact);
  const startedAt = clock();
  const errors = [];
  async function bounded(phase, operation, allowance) {
    const remaining = Math.min(allowance, budget.totalMs - (clock() - startedAt));
    if (remaining <= 0) {
      errors.push({ phase, reason: "cleanup_budget_exhausted" });
      return null;
    }
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise(resolve => { timer = setTimeout(() => { errors.push({ phase, reason: "cleanup_phase_timeout" }); resolve(null); }, remaining); }),
      ]);
    } catch (error) {
      errors.push({ phase, reason: error.message });
      return null;
    } finally { clearTimeout(timer); }
  }
  await bounded("abort", () => session.abort(), budget.abortMs);
  await bounded("stop", () => client.stop(), budget.stopMs);
  await bounded("forceStop", () => client.forceStop(), budget.totalMs);
  const verification = await bounded("verifyExit", () => verifyExit(ownedSpawns), budget.totalMs);
  const elapsedMs = clock() - startedAt;
  const receipt = {
    runId, ownedSpawns,
    exitObservations: Array.isArray(verification?.exitObservations) ? verification.exitObservations : [],
    unverifiedPids: Array.isArray(verification?.unverifiedPids) ? verification.unverifiedPids : ownedSpawns.map(row => row.pid),
    completedWithinBudget: elapsedMs <= budget.totalMs,
  };
  return { complete: validateCleanupReceipt(receipt, { runId, readArtifact }).ok, elapsedMs, errors, receipt };
}
