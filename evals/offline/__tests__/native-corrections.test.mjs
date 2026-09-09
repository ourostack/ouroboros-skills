import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { fixture } from "./helpers/native-sdk.mjs";
import { engine, plan, response } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function delayed(phase, releaseDuringStop = false) {
  const value = fixture();
  const gate = deferred(), entered = deferred(), calls = [];
  const Original = value.input.sdk.CopilotClient;
  async function invoke(name, operation) {
    calls.push(name);
    const result = await operation();
    if (name === phase) { entered.resolve(); await gate.promise; }
    return result;
  }
  value.input.sdk.CopilotClient = class extends Original {
    start() { return invoke("start", () => super.start()); }
    getStatus() { return invoke("getStatus", () => super.getStatus()); }
    createSession(configuration) {
      return invoke("createSession", async () => {
        const session = await super.createSession(configuration);
        for (const [owner, name] of [[session.rpc.tools, "initializeAndValidate"], [session.rpc.tools, "getCurrentMetadata"], [session, "send"], [session, "getEvents"]]) {
          const original = owner[name].bind(owner);
          owner[name] = (...args) => invoke(name, () => original(...args));
        }
        return session;
      });
    }
    async stop() { calls.push("stop"); return super.stop(); }
    async forceStop() {
      calls.push("forceStop");
      if (releaseDuringStop) gate.resolve();
      return super.forceStop();
    }
  };
  value.input.limits = { startupSendWorkMs: 1000, cleanupMs: 60 };
  return { ...value, gate, entered, calls };
}

for (const phase of ["start", "getStatus", "createSession", "initializeAndValidate", "getCurrentMetadata", "send", "getEvents"]) test(`N1 resolving ${phase} after timeout cannot resume SDK work or artifact publication`, async () => {
  const value = delayed(phase);
  const pending = runTerminalProtocol(value.input);
  await Promise.race([value.entered.promise, pending.then(() => { throw new Error("The intended deferred phase was never reached."); })]);
  const result = await pending;
  assert.equal(result.failure.code, "NATIVE_DEADLINE");
  assert.equal(result.ok, false);
  if (phase === "start") assert.equal(result.cleanup.startupPending, true);
  const closedCalls = [...value.calls], closedRecords = value.state.records.length;
  value.gate.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(value.calls, closedCalls, "A closed work body must not issue another SDK operation.");
  assert.equal(value.state.records.length, closedRecords, "A closed work body must not publish a late history artifact.");
  assert.equal(result.grade, null);
});

test("N1 startup resolving during force-stop cannot open a session inside cleanup", async () => {
  const value = delayed("start", true);
  const pending = runTerminalProtocol(value.input);
  await Promise.race([value.entered.promise, pending.then(() => { throw new Error("The intended deferred startup was never reached."); })]);
  const result = await pending;
  assert.equal(result.failure.code, "NATIVE_DEADLINE");
  assert.equal(value.calls.includes("forceStop"), true);
  assert.equal(value.calls.includes("getStatus"), false);
  assert.equal(value.calls.includes("createSession"), false);
  assert.equal(value.calls.includes("send"), false);
  assert.equal(result.cleanup.startupPending, false);
});

async function observedPrefix() {
  const value = fixture();
  const result = await runTerminalProtocol(value.input);
  assert.equal(result.ok, true, "The fresh injected producer must complete before its transport prefix is tested.");
  return Buffer.from(value.state.records.map(row => JSON.stringify(row)).join("\n") + "\n");
}
const expectedCounts = { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 };

for (const ending of ["ascii-partial", "split-utf8", "stdout-overflow", "stderr-overflow"]) for (const timedOut of [false, true]) test(`N2 ${ending} retains verifiable prefix counters with ${timedOut ? "timeout" : "failure"} precedence`, async t => {
  const prefix = await observedPrefix();
  t.diagnostic(JSON.stringify({ kind: "N2-injected-prefix", ending, timedOut, bytes: prefix.length, base64: prefix.toString("base64") }));
  const value = plan();
  let stdout = prefix, stderr = Buffer.alloc(0);
  if (ending === "ascii-partial") stdout = Buffer.concat([prefix, Buffer.from('{"kind":')]);
  if (ending === "split-utf8") stdout = Buffer.concat([prefix, Buffer.from([0xe2, 0x82])]);
  if (ending === "stdout-overflow") {
    value.limits.maxStreamBytes = prefix.length + 8;
    stdout = Buffer.concat([prefix, Buffer.alloc(128, "x")]);
  }
  if (ending === "stderr-overflow") {
    value.limits.maxStreamBytes = prefix.length + 8;
    stderr = Buffer.alloc(value.limits.maxStreamBytes + 128, "x");
  }
  const execution = response(stdout, timedOut ? null : 1, stderr);
  if (timedOut) execution.error = Object.assign(new Error("controlled transport deadline"), { code: "ETIMEDOUT" });
  const fake = engine(value, { execution });
  const outputRoot = path.join(workRoot(`native-prefix-${ending}-${timedOut}`), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(fake.state.removed, true, "The exact injected container must still be cleaned up.");
  assert.ok(fs.readFileSync(path.join(outputRoot, "stdout.raw")).subarray(0, prefix.length).equals(prefix));
  assert.deepEqual(result.counts, expectedCounts, "Retained complete records cannot disappear because a later byte or write failed.");
  assert.equal(result.attemptCoverage, "verified_observed_prefix");
  assert.equal(result.grade, null);
  assert.equal(result.exitCode, 3);
  assert.notEqual(result.status, "component_observed");
  if (timedOut) assert.equal(result.status, "timed_out");
});

test("N2 complete controls retain blank JSONL separators without confusing them with corrupt records", async () => {
  const prefix = await observedPrefix();
  const value = plan();
  const fake = engine(value, { execution: response(Buffer.concat([Buffer.from("\n \t\r\n"), prefix, Buffer.from("\n")])) });
  const outputRoot = path.join(workRoot("native-blank-lines"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "component_observed");
  assert.deepEqual(result.counts, expectedCounts);
  assert.deepEqual(result.decodeErrors, []);
});

test("N2 a request beyond the retained byte boundary cannot enter any counter", async () => {
  const prefix = await observedPrefix();
  const value = plan();
  const lines = prefix.toString().trim().split("\n");
  const request = lines.findIndex(line => JSON.parse(line).ref?.eventId === "request");
  assert.ok(request > 0);
  value.limits.maxStreamBytes = Buffer.byteLength(lines.slice(0, request).join("\n") + "\n") + 16;
  const fake = engine(value, { execution: response(prefix, 1) });
  const outputRoot = path.join(workRoot("native-unretained-request"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(fs.readFileSync(path.join(outputRoot, "stdout.raw")).length, value.limits.maxStreamBytes);
  assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
  assert.equal(result.grade, null);
  assert.equal(result.exitCode, 3);
});

test("N2 successful transport cannot promote a control with a corrupt final UTF-8 fragment", async () => {
  const prefix = await observedPrefix();
  const value = plan();
  const fake = engine(value, { execution: response(Buffer.concat([prefix, Buffer.from([0xe2, 0x82])])) });
  const outputRoot = path.join(workRoot("native-success-corrupt-tail"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.deepEqual(result.counts, expectedCounts);
  assert.equal(result.failure.code, "NATIVE_RECORD_DECODE_FAILED");
  assert.equal(result.exitCode, 3);
  assert.equal(result.grade, null);
});

test("N2 rejected stderr representation cannot erase already captured stdout observations", async () => {
  const prefix = await observedPrefix();
  const value = plan();
  const fake = engine(value, { execution: { ...response(prefix, 1), stderr: "not raw bytes" } });
  const outputRoot = path.join(workRoot("native-prefix-invalid-stderr"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.deepEqual(result.counts, expectedCounts);
  assert.equal(result.failure.code, "NATIVE_RAW_BYTES_REQUIRED");
  assert.equal(result.status, "capture_incomplete");
  assert.equal(fs.existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});
