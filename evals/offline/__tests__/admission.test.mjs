import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { repository } from "./helpers/paths.mjs";

const moduleUrl = pathToFileURL(resolve(repository, "evals/offline/admission.mjs"));
const sessionId = "judge-session";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const schemaSha256 = hash("declared report schema fixture");
const criteria = ["The installed public API passes its fixed matrix."];
const evidenceIndex = { files: ["checks/consumer.txt"] };
const report = (status = "pass") => ({
  status,
  summary: status === "fail" ? "The installed consumer failed." : "The installed consumer passed.",
  reasoning: "The retained external consumer result supplies the observed outcome.",
  observations: [],
  criteria: [{ criterion: criteria[0], verdict: status, evidence: "checks/consumer.txt:1" }],
});

async function setup() {
  const { createReportAdmission } = await import(moduleUrl);
  let now = 1;
  const cleanupArtifacts = new Map();
  const admission = createReportAdmission({ runId: "fixture-run", sessionId, rootAgentId: null, expectedMode: "interactive", criteria, evidenceIndex, schemaSha256, deadlineAt: 100, clock: () => now, readArtifact: (path) => cleanupArtifacts.get(path) });
  const sdkRecords = [];
  const schemaRecords = [];
  const raw = (event, records, path, boundSessionId = sessionId) => {
    const rawRecord = Buffer.from(`${JSON.stringify(event)}\n`);
    const ref = {
      path,
      sessionId: boundSessionId,
      eventId: event.id,
      byteOffset: records.reduce((sum, bytes) => sum + bytes.length, 0),
      byteLength: rawRecord.length,
      sha256: hash(rawRecord),
    };
    records.push(rawRecord);
    return { sessionId: boundSessionId, rawRecord, ref };
  };
  const sdk = (event, boundSessionId) => admission.observeSdkEvent(raw(event, sdkRecords, "sdk-events.jsonl", boundSessionId));
  const message = (id, requests) => ({
    id,
    type: "assistant.message",
    parentId: "turn-start",
    timestamp: "2026-01-01T00:00:00Z",
    data: { messageId: id, turnId: "supported-turn", content: "", toolRequests: requests.map(([toolCallId, arguments_]) => ({ toolCallId, name: "report_result", arguments: arguments_ })) },
  });
  const schema = (id, value, decision = "accepted", overrides = {}) => {
    const event = {
      id: `schema-${id}`,
      type: "report.schema_decision",
      sessionId,
      toolCallId: id,
      origin: "handler",
      schemaSha256,
      argumentsSha256: hash(JSON.stringify(value)),
      decision,
      reason: decision === "accepted" ? null : "Invalid declared report shape.",
      ...overrides,
    };
    admission.observeSchemaEvent(raw(event, schemaRecords, "schema-events.jsonl"));
  };
  const handle = (id, value, signal) => admission.handle(value, { sessionId, toolCallId: id, toolName: "report_result", arguments: value, signal });
  const complete = (id, success = true, eventId = `complete-${id}`) => sdk({
    id: eventId,
    type: "tool.execution_complete",
    parentId: null,
    timestamp: "2026-01-01T00:00:01Z",
    data: { toolCallId: id, success, ...(success ? {} : { error: { message: "Tool execution failed." } }) },
  });
  sdk({ id: "turn-start", type: "assistant.turn_start", parentId: null, timestamp: "2026-01-01T00:00:00Z", data: { turnId: "supported-turn" } });
  const cleanupRecord = (value) => {
    const data = Buffer.from(`${JSON.stringify(value)}\n`);
    const path = value.type === "spawn" ? "owned-spawn.json" : "owned-exit.json";
    cleanupArtifacts.set(path, data);
    return { path, sha256: hash(data), byteLength: data.length };
  };
  const cleanupReceipt = {
    runId: "fixture-run",
    ownedSpawns: [{ pid: 12345, spawnIdentity: "synthetic-owned-spawn", rawRef: cleanupRecord({ type: "spawn", pid: 12345, spawnIdentity: "synthetic-owned-spawn", fixtureOnly: true }) }],
    exitObservations: [{ pid: 12345, spawnIdentity: "synthetic-owned-spawn", exited: true, rawRef: cleanupRecord({ type: "exit", pid: 12345, spawnIdentity: "synthetic-owned-spawn", exited: true, fixtureOnly: true }) }],
    unverifiedPids: [],
    completedWithinBudget: true,
  };
  const coverage = (overrides = {}) => {
    const historyBytes = Buffer.from(`${JSON.stringify(sdkRecords.map((record) => JSON.parse(record)))}\n`);
    cleanupArtifacts.set("history-response.json", historyBytes);
    return {
    status: "complete",
    sessionId,
    observedFromSessionStart: true,
    rawEventsSha256: hash(Buffer.concat(sdkRecords)),
    rawSchemaEventsSha256: hash(Buffer.concat(schemaRecords)),
    recordCount: sdkRecords.length,
    terminalEventId: "idle",
    rootWindow: { startEventId: "turn-start", terminalEventId: "idle", rootAgentId: null, supportedTurnIds: ["supported-turn"], dispatchCount: 1, unambiguous: true },
    historyReconciled: true,
    historyResponseRef: { path: "history-response.json", sha256: hash(historyBytes), byteLength: historyBytes.length },
    pendingCallIds: [],
    truncated: false,
    captureErrors: [],
    ...overrides,
    };
  };
  const finish = (overrides = {}, coverageOverrides = {}) => {
    sdk({ id: "idle", type: "session.idle", parentId: null, timestamp: "2026-01-01T00:00:02Z", data: { mode: "interactive", aborted: false } });
    return admission.finish({
      endReason: "idle",
      attemptCoverage: coverage(coverageOverrides),
      sourceVerified: true,
      evidenceVerified: true,
      runtimeVerified: true,
      cleanupReceipt,
      ...overrides,
    });
  };
  const one = (id = "one", value = report()) => {
    sdk(message(`message-${id}`, [[id, value]]));
    schema(id, value);
    const returned = handle(id, value);
    return { returned, value };
  };
  return { admission, sdk, message, schema, handle, complete, coverage, finish, one, cleanupReceipt, artifacts: cleanupArtifacts, setNow: (value) => { now = value; } };
}

for (const mutation of ["unobserved-request", "partial-request", "aborted-terminal", "wrong-terminal-mode", "complete-control"]) test(`I2 full historical root coverage: ${mutation}`, async () => {
  const state = await setup();
  assert.equal(state.one().returned.resultType, "success");
  state.complete("one");
  state.sdk({ id: "idle", type: "session.idle", data: { mode: "interactive", aborted: false } });
  const coverage = state.coverage();
  const history = JSON.parse(state.artifacts.get("history-response.json"));
  if (mutation === "unobserved-request") history.splice(-1, 0, { id: "historical-unobserved", type: "assistant.message", data: { turnId: "supported-turn", toolRequests: [{ toolCallId: "extra", name: "report_result" }] } });
  if (mutation === "partial-request") history.splice(-1, 0, { id: "historical-partial", type: "assistant.tool_call_delta", data: { turnId: "supported-turn", toolCallId: "extra", toolName: "report_result" } });
  if (mutation === "aborted-terminal") history.at(-1).data.aborted = true;
  if (mutation === "wrong-terminal-mode") history.at(-1).data.mode = "autopilot";
  const bytes = Buffer.from(`${JSON.stringify(history)}\n`);
  state.artifacts.set("history-response.json", bytes);
  coverage.historyResponseRef = { path: "history-response.json", sha256: hash(bytes), byteLength: bytes.length };
  const result = state.admission.finish({ endReason: "idle", attemptCoverage: coverage, sourceVerified: true, evidenceVerified: true, runtimeVerified: true, cleanupReceipt: state.cleanupReceipt });
  assert.equal(result.status, mutation === "complete-control" ? "passed" : "unavailable");
  assert.equal(result.counts.admittedGrades, Number(mutation === "complete-control"));
  assert.equal(result.modelProtocolViolation, false);
});

test("handler success without actual SDK completion cannot admit", async () => {
  const state = await setup();
  assert.equal(state.one().returned.resultType, "success");
  const result = state.finish();
  assert.equal(result.status, "unavailable");
  assert.equal(result.modelProtocolViolation, false);
  assert.equal(result.grade, null);
  assert.equal(result.counts.admittedGrades, 0);
});

test("failed SDK completion overrides a proposed successful handler result", async () => {
  const state = await setup();
  state.one();
  state.complete("one", false);
  const result = state.finish();
  assert.equal(result.status, "infrastructure_failure");
  assert.equal(result.modelProtocolViolation, false);
  assert.equal(result.grade, null);
  assert.equal(result.counts.validatorAcceptedReports, 1);
  assert.equal(result.counts.admittedGrades, 0);
});

test("a semantic failure with evidenced execution success admits a product failure", async () => {
  const state = await setup();
  assert.equal(state.one("one", report("fail")).returned.resultType, "success");
  state.complete("one");
  const result = state.finish();
  assert.equal(result.status, "product_failure");
  assert.equal(result.grade.status, "fail");
  assert.equal(result.counts.admittedGrades, 1);
  assert.deepEqual(result.attempts[0].executionCompletionRefs.map((ref) => ref.eventId), ["complete-one"]);
  assert.deepEqual(result.attempts[0].schemaEventRefs.map((ref) => ref.eventId), ["schema-one"]);
});

test("an evidenced malformed failure may precede one corrected successful terminal execution", async () => {
  const state = await setup();
  const malformed = { ...report(), summary: "   " };
  assert.equal(state.one("malformed", malformed).returned.resultType, "failure");
  state.complete("malformed", false);
  assert.equal(state.one("corrected").returned.resultType, "success");
  state.complete("corrected");
  const result = state.finish();
  assert.equal(result.status, "passed");
  assert.equal(result.counts.observedRequests, 2);
  assert.equal(result.counts.schemaAcceptedHandlers, 2);
  assert.equal(result.counts.validatorAcceptedReports, 1);
  assert.equal(result.counts.admittedGrades, 1);
});

test("missing schema observation prevents admission despite handler and completion", async () => {
  const state = await setup();
  const value = report();
  state.sdk(state.message("message-one", [["one", value]]));
  state.handle("one", value);
  state.complete("one");
  const result = state.finish();
  assert.equal(result.status, "unavailable");
  assert.equal(result.modelProtocolViolation, false);
  assert.equal(result.grade, null);
  assert.equal(result.counts.schemaAcceptedHandlers, 0);
  assert.equal(result.counts.admittedGrades, 0);
});

test("schema observation is bound to declared schema and exact handler arguments", async () => {
  const state = await setup();
  const value = report();
  state.sdk(state.message("message-one", [["one", value]]));
  state.schema("one", value, "accepted", { argumentsSha256: hash("different arguments") });
  state.handle("one", value);
  state.complete("one");
  assert.equal(state.finish().counts.admittedGrades, 0);
});

test("two valid requests sharing one assistant event ID are both counted", async () => {
  const state = await setup();
  const first = report("fail");
  const second = report();
  state.sdk(state.message("one-real-batch-event", [["first", first], ["second", second]]));
  state.schema("first", first);
  state.handle("first", first);
  state.complete("first");
  state.complete("second", false);
  const result = state.finish();
  assert.equal(result.status, "protocol_failure");
  assert.equal(result.grade, null);
  assert.equal(result.counts.observedRequests, 2);
  assert.equal(result.counts.schemaAcceptedHandlers, 1);
  assert.equal(result.counts.validatorAcceptedReports, 2);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.attempts.find((attempt) => attempt.toolCallId === "second").handlerEntered, false);
});

test("replaying one real batch event does not duplicate either call", async () => {
  const state = await setup();
  const event = state.message("batch", [["first", report()], ["second", report("fail")]]);
  state.sdk(event);
  state.sdk(event);
  const result = state.finish({}, { status: "incomplete", pendingCallIds: ["first", "second"] });
  assert.equal(result.counts.observedRequests, 2);
  assert.equal(result.counts.admittedGrades, 0);
});

test("handler and schema may precede the SDK observer without losing later proof", async () => {
  const state = await setup();
  const value = report();
  state.schema("one", value);
  state.handle("one", value);
  state.sdk(state.message("message-one", [["one", value]]));
  state.complete("one");
  const result = state.finish();
  assert.equal(result.status, "passed");
  assert.equal(result.counts.admittedGrades, 1);
});

test("normal SDK finally-abort of a tool signal is not run cancellation", async () => {
  const state = await setup();
  const controller = new AbortController();
  const value = report();
  state.schema("one", value);
  state.handle("one", value, controller.signal);
  controller.abort();
  state.sdk(state.message("message-one", [["one", value]]));
  state.complete("one");
  assert.equal(state.finish().status, "passed");
});

test("unscoped handler evidence is unavailable when child and root share its call ID", async () => {
  const state = await setup();
  const value = report();
  state.sdk(state.message("root", [["one", value]]));
  state.sdk({ ...state.message("child", [["one", value]]), agentId: "child-agent" });
  state.schema("one", value);
  state.handle("one", value);
  state.complete("one");
  const result = state.finish();
  assert.equal(result.counts.observedRequests, 1);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.status, "unavailable");
  assert.equal(result.modelProtocolViolation, false);
});

test("a completion from another session cannot complete this judge's report", async () => {
  const state = await setup();
  state.one();
  state.sdk({ id: "foreign-completion", type: "tool.execution_complete", parentId: null, timestamp: "2026-01-01T00:00:01Z", data: { toolCallId: "one", success: true } }, "different-session");
  const result = state.finish();
  assert.equal(result.status, "unavailable");
  assert.equal(result.modelProtocolViolation, false);
  assert.equal(result.counts.admittedGrades, 0);
});

for (const [name, coverage] of [
  ["explicit incomplete coverage", { status: "incomplete" }],
  ["capture started late", { observedFromSessionStart: false }],
  ["history unavailable", { historyReconciled: false }],
  ["history claim without raw response proof", { historyResponseRef: null }],
  ["pending call", { pendingCallIds: ["one"] }],
  ["raw stream overflow", { truncated: true }],
  ["capture write error", { captureErrors: ["ENOSPC"] }],
  ["wrong raw stream hash", { rawEventsSha256: hash("different stream") }],
]) {
  test(`${name} suppresses an otherwise fully executed valid report`, async () => {
    const state = await setup();
    state.one();
    state.complete("one");
    const result = state.finish({}, coverage);
    assert.equal(result.grade, null);
    assert.equal(result.counts.admittedGrades, 0);
  });
}

test("conflicting reuse of an event ID cannot replace the prior report", async () => {
  const state = await setup();
  state.sdk(state.message("reused", [["one", report("fail")]]));
  state.sdk(state.message("reused", [["one", report()]]));
  const result = state.finish();
  assert.notEqual(result.status, "passed");
  assert.equal(result.grade, null);
});

test("a failed completion cannot be replaced by a later successful completion", async () => {
  const state = await setup();
  state.one();
  state.complete("one", false, "failed-completion");
  state.complete("one", true, "later-completion");
  const result = state.finish();
  assert.equal(result.status, "infrastructure_failure");
  assert.equal(result.modelProtocolViolation, false);
  assert.equal(result.grade, null);
});

test("outer cancellation and expiry still suppress actual successful completion", async () => {
  for (const reason of ["cancelled", "deadline"]) {
    const state = await setup();
    state.one();
    state.complete("one");
    if (reason === "deadline") state.setNow(100);
    const result = state.finish({ endReason: reason });
    assert.equal(result.status, reason === "deadline" ? "timed_out" : "cancelled");
    assert.equal(result.grade, null);
  }
});

test("truthy strings are not source, evidence, or runtime verification", async () => {
  for (const field of ["sourceVerified", "evidenceVerified", "runtimeVerified"]) {
    const state = await setup();
    state.one();
    state.complete("one");
    assert.equal(state.finish({ [field]: "true" }).grade, null);
  }
});

test("a finished admission result and its nested counters are immutable", async () => {
  const state = await setup();
  state.one();
  state.complete("one");
  const result = state.finish();
  assert.throws(() => { result.counts.admittedGrades = 9; }, TypeError);
  assert.throws(() => { result.grade.status = "fail"; }, TypeError);
  assert.equal(state.admission.finish({}).counts.admittedGrades, 1);
});

test("completed strict rejection without a correction is a protocol failure", async () => {
  const state = await setup();
  state.one("bad", { ...report(), summary: " " });
  state.complete("bad", false);
  assert.equal(state.finish().status, "protocol_failure");
});

test("empty complete capture remains unavailable, and post-finish callbacks cannot add a grade", async () => {
  const state = await setup();
  const result = state.finish();
  assert.equal(result.status, "unavailable");
  assert.equal(state.handle("late", report()).resultType, "failure");
  assert.equal(state.sdk(state.message("late", [["late", report()]])).accepted, false);
  assert.equal(result.counts.admittedGrades, 0);
});

test("raw capture errors and non-JSON callback input stay outside admission", async () => {
  const state = await setup();
  assert.equal(state.admission.observeSdkEvent({ sessionId, rawRecord: Buffer.from("{}"), ref: {} }).accepted, false);
  const circular = {};
  circular.self = circular;
  assert.equal(state.handle("circular", circular).resultType, "failure");
  state.one();
  state.complete("one");
  assert.equal(state.finish().grade, null);
});

test("an unclear frozen criterion admits an investigate grade only with successful completion", async () => {
  const state = await setup();
  const value = report();
  value.status = "investigate";
  value.criteria[0].verdict = "unclear";
  state.one("one", value);
  state.complete("one");
  assert.equal(state.finish().status, "inconclusive");
});

test("two valid observed root-turn requests cannot collapse into one favorable call-ID replay", async () => {
  const state = await setup();
  state.one("reused");
  state.complete("reused");
  state.sdk({ id: "second-start", type: "assistant.turn_start", data: { turnId: "second-turn" } });
  const second = state.message("second-message", [["reused", report()]]);
  second.data.turnId = "second-turn";
  state.sdk(second);
  const rootWindow = { startEventId: "turn-start", terminalEventId: "idle", rootAgentId: null, supportedTurnIds: ["second-turn", "supported-turn"], dispatchCount: 1, unambiguous: true };
  const result = state.finish({}, { rootWindow });
  assert.equal(result.counts.observedRequests, 2);
  assert.equal(result.status, "protocol_failure");
  assert.equal(result.grade, null);
});

test("a rehashed history response from another observed root window cannot reconcile this dispatch", async () => {
  const state = await setup();
  state.one();
  state.complete("one");
  state.sdk({ id: "idle", type: "session.idle", data: { mode: "interactive", aborted: false } });
  const coverage = state.coverage();
  const history = JSON.parse(state.artifacts.get("history-response.json"));
  history[0].id = "another-start";
  const altered = Buffer.from(`${JSON.stringify(history)}\n`);
  state.artifacts.set("history-response.json", altered);
  coverage.historyResponseRef.sha256 = hash(altered);
  coverage.historyResponseRef.byteLength = altered.length;
  const result = state.admission.finish({ endReason: "idle", attemptCoverage: coverage, sourceVerified: true, evidenceVerified: true, runtimeVerified: true, cleanupReceipt: state.cleanupReceipt });
  assert.equal(result.grade, null);
  assert.equal(result.modelProtocolViolation, false);
});
