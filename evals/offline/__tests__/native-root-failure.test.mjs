import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function pendingMetadata() {
  const value = fixture(), gate = deferred(), entered = deferred(), calls = [];
  const Base = value.input.sdk.CopilotClient;
  value.input.sdk.CopilotClient = class extends Base {
    async createSession(configuration) {
      const session = await super.createSession(configuration);
      const metadata = session.rpc.tools.getCurrentMetadata.bind(session.rpc.tools);
      session.rpc.tools.getCurrentMetadata = async () => {
        const result = await metadata();
        calls.push("metadata-pending");
        entered.resolve();
        await gate.promise;
        calls.push("metadata-resolved");
        return result;
      };
      for (const name of ["send", "getEvents", "abort"]) {
        const operation = session[name].bind(session);
        session[name] = (...args) => { calls.push(name); return operation(...args); };
      }
      return session;
    }
    async stop() { calls.push("stop"); return super.stop(); }
    async forceStop() { calls.push("forceStop"); return super.forceStop(); }
  };
  function event(type, id = "metadata-fault", agentId) {
    const value = { id, type, parentId: null, timestamp: "2026-09-09T00:00:00Z", data: { message: "Controlled failure while metadata is pending." } };
    if (agentId) value.agentId = agentId;
    return value;
  }
  function emit(event) {
    value.state.events.push(event);
    value.state.session.onEvent(event);
  }
  return { ...value, calls, gate, entered, event, emit };
}

async function enter(value, pending) {
  await Promise.race([value.entered.promise, pending.then(() => { throw new Error("The deferred metadata phase was not reached."); })]);
}

test("N1 a root error during pending metadata prevents every subsequent SDK work phase", async t => {
  const value = pendingMetadata();
  const pending = runTerminalProtocol(value.input);
  await enter(value, pending);
  value.emit(value.event("session.error"));
  await new Promise(resolve => setImmediate(resolve));
  value.gate.resolve();
  const result = await pending;
  t.diagnostic(JSON.stringify({ kind: "root-error-metadata-contrast", calls: value.calls, result, records: value.state.records }));
  assert.equal(value.calls.includes("metadata-resolved"), true);
  assert.equal(value.calls.includes("send"), false, "Resolving metadata after root failure must not dispatch a prompt.");
  assert.equal(value.calls.includes("getEvents"), false);
  assert.equal(value.state.records.some(record => record.kind === "runtime-configuration"), false);
  assert.equal(result.ok, false);
  assert.equal(result.failure.message, "The native session reported an error.");
  assert.equal(result.grade, null);
  assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
  assert.equal(result.cleanup.complete, true);
  assert.equal(value.state.aborted, true);
  assert.equal(value.state.stopped, true);
});

for (const reason of [new Error("Controlled first capture failure."), null, undefined]) test(`N1 a ${String(reason)} capture rejection remains sticky across a later root error`, async t => {
  const value = pendingMetadata();
  const emitRecord = value.input.emit;
  value.input.emit = record => {
    if (record.kind === "raw-event" && record.ref.eventId === "capture-fault") throw reason;
    emitRecord(record);
  };
  const pending = runTerminalProtocol(value.input);
  await enter(value, pending);
  value.emit(value.event("assistant.message", "capture-fault"));
  value.emit(value.event("session.error", "later-root-error"));
  value.gate.resolve();
  const result = await pending;
  t.diagnostic(JSON.stringify({ kind: "capture-error-metadata-contrast", reason: String(reason), calls: value.calls, result }));
  assert.equal(value.calls.includes("send"), false);
  assert.equal(value.calls.includes("getEvents"), false);
  assert.equal(result.failure.message, reason instanceof Error ? reason.message : String(reason));
  assert.equal(result.captureErrors.length, 1);
  assert.equal(result.grade, null);
  assert.equal(result.cleanup.complete, true);
});

test("N1 a child-session error during pending root metadata does not cancel the healthy root", async () => {
  const value = pendingMetadata();
  const pending = runTerminalProtocol(value.input);
  await enter(value, pending);
  value.emit(value.event("session.error", "child-error", "independent-child"));
  value.gate.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(value.calls.filter(name => name === "send").length, 1);
  assert.equal(result.failure, null);
  assert.equal(result.cleanup.complete, true);
});

test("N1 the original deadline keeps precedence if metadata resolves after expiry and root error", async () => {
  const value = pendingMetadata();
  let now = 0;
  value.input.clock = () => now;
  const pending = runTerminalProtocol(value.input);
  await enter(value, pending);
  value.emit(value.event("session.error"));
  now = value.input.limits.startupSendWorkMs;
  value.gate.resolve();
  const result = await pending;
  assert.equal(value.calls.includes("send"), false);
  assert.equal(result.failure.code, "NATIVE_DEADLINE");
  assert.equal(result.grade, null);
  assert.equal(result.cleanup.complete, true);
});
