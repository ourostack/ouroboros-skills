import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { repository } from "./helpers/paths.mjs";

const moduleUrl = pathToFileURL(resolve(repository, "evals/offline/copilot-runner.mjs"));
const spawn = { pid: 12345, spawnIdentity: "synthetic-owned-spawn" };
const records = new Map([
  ["spawn.json", Buffer.from(`${JSON.stringify({ type: "spawn", ...spawn, fixtureOnly: true })}\n`)],
  ["exit.json", Buffer.from(`${JSON.stringify({ type: "exit", ...spawn, exited: true, fixtureOnly: true })}\n`)],
]);
const ref = (path) => ({ path, sha256: createHash("sha256").update(records.get(path)).digest("hex"), byteLength: records.get(path).length });
const ownership = { runId: "fixture-run", ownedSpawns: [{ ...spawn, rawRef: ref("spawn.json") }], readArtifact: (path) => records.get(path) };
const observedExit = () => ({ exitObservations: [{ ...spawn, exited: true, rawRef: ref("exit.json") }], unverifiedPids: [] });

test("a never-resolving abort cannot prevent bounded stop and owned force-stop", async (t) => {
  const { cleanupOwnedRuntime } = await import(moduleUrl);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const calls = [];
  const cleanup = cleanupOwnedRuntime({
    ...ownership,
    session: { abort: () => { calls.push("abort"); return new Promise(() => {}); } },
    client: {
      stop: () => { calls.push("stop"); return new Promise(() => {}); },
      forceStop: async () => { calls.push("forceStop"); },
    },
    verifyExit: async () => { calls.push("verifyExit"); return observedExit(); },
    budget: { totalMs: 30, abortMs: 10, stopMs: 10 },
    clock: Date.now,
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10);
  await new Promise((resolve) => setImmediate(resolve));
  const result = await cleanup;
  assert.ok(calls.includes("abort"));
  assert.ok(calls.includes("stop"));
  assert.ok(calls.includes("forceStop"));
  assert.ok(result.elapsedMs <= 30);
});

test("unverified owned exit is never reported as complete cleanup", async () => {
  const { cleanupOwnedRuntime } = await import(moduleUrl);
  const result = await cleanupOwnedRuntime({
    ...ownership,
    session: { abort: async () => {} },
    client: { stop: async () => [], forceStop: async () => {} },
    verifyExit: async () => false,
    budget: { totalMs: 30, abortMs: 10, stopMs: 10 },
    clock: Date.now,
  });
  assert.equal(result.complete, false);
});

for (const hanging of ["forceStop", "verifyExit"]) test(`a never-resolving ${hanging} also remains inside the total cleanup budget`, async (t) => {
  const { cleanupOwnedRuntime } = await import(moduleUrl);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const pending = () => new Promise(() => {});
  const cleanup = cleanupOwnedRuntime({
    ...ownership,
    session: { abort: async () => {} },
    client: { stop: pending, forceStop: hanging === "forceStop" ? pending : async () => {} },
    verifyExit: hanging === "verifyExit" ? pending : async () => observedExit(),
    budget: { totalMs: 30, abortMs: 10, stopMs: 10 },
    clock: Date.now,
  });
  await new Promise((resolve) => setImmediate(resolve));
  for (let n = 0; n < 3; n += 1) {
    t.mock.timers.tick(10);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const result = await cleanup;
  assert.equal(result.complete, false);
  assert.ok(result.elapsedMs <= 30);
});

test("cleanup phase exceptions remain visible and cannot fabricate an observed exit", async () => {
  const { cleanupOwnedRuntime } = await import(moduleUrl);
  const fail = async () => { throw new Error("owned cleanup failure"); };
  const result = await cleanupOwnedRuntime({ ...ownership, session: { abort: fail }, client: { stop: fail, forceStop: fail }, verifyExit: fail, budget: { totalMs: 100, abortMs: 20, stopMs: 20 } });
  assert.equal(result.complete, false);
  assert.deepEqual(result.errors.map(error => error.phase), ["abort", "stop", "forceStop", "verifyExit"]);
  assert.deepEqual(result.receipt.unverifiedPids, [spawn.pid]);
});

test("cleanup raw records are bound to their run when that supported field is present", async () => {
  const { validateCleanupReceipt } = await import(moduleUrl);
  const artifacts = new Map();
  const entry = type => {
    const raw = Buffer.from(`${JSON.stringify({ type, ...spawn, runId: "fixture-run", ...(type === "exit" ? { exited: true } : {}) })}\n`);
    const path = `${type}.json`;
    artifacts.set(path, raw);
    return { ...spawn, ...(type === "exit" ? { exited: true } : {}), rawRef: { path, sha256: createHash("sha256").update(raw).digest("hex") } };
  };
  const receipt = { runId: "fixture-run", ownedSpawns: [entry("spawn")], exitObservations: [entry("exit")], unverifiedPids: [], completedWithinBudget: true };
  const options = { runId: "fixture-run", readArtifact: path => artifacts.get(path) };
  assert.equal(validateCleanupReceipt(receipt, options).ok, true);
  receipt.exitObservations[0].spawnIdentity = "another-process";
  assert.equal(validateCleanupReceipt(receipt, options).ok, false);
});
