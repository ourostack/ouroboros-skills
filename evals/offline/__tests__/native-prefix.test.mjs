import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { fixture, validReport } from "./helpers/native-sdk.mjs";
import { engine, plan, response } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("the durable initial envelope binds the entire source closure before the named provider runs", async () => {
  const value = plan();
  const outputRoot = path.join(workRoot("native-source-first"), "attempt");
  let beforeAuth;
  const fake = engine(value, { before: command => { if (command === "gh") beforeAuth = JSON.parse(readFileSync(path.join(outputRoot, "receipt.incomplete.json"))); } });
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.ok(Array.isArray(beforeAuth.sourceManifest));
  assert.equal(beforeAuth.sourceManifest.length, 15);
  assert.deepEqual(beforeAuth.sourceManifest, result.sourceManifest);
  assert.equal(beforeAuth.sourceManifestSha256, sha256(jsonBytes(result.sourceManifest)));
  assert.match(beforeAuth.hostControllerSha256, /^[a-f0-9]{64}$/);
  assert.match(beforeAuth.bootstrapSha256, /^[a-f0-9]{64}$/);
});

test("the validated plan is an immutable input snapshot before provider callbacks can mutate the caller object", async () => {
  const value = plan();
  const fake = engine(value, { before: command => { if (command === "gh") value.model = "claude-opus-5"; } });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-plan-snapshot"), "attempt"), execute: fake.execute });
  const input = JSON.parse(fake.state.calls.find(call => call.argv[0] === "start").settings.input);
  assert.equal(result.modelRequested, "gpt-6-astra");
  assert.equal(input.model, "gpt-6-astra");
});

test("a delivered RPC failure retains observed requests, schema entries and validator acceptance without a grade", async () => {
  const control = fixture({ executionSuccess: false });
  await runTerminalProtocol(control.input);
  const value = plan();
  const fake = engine(value, { execution: response(control.state.records.map(row => JSON.stringify(row)).join("\n") + "\n", 1) });
  const outputRoot = path.join(workRoot("native-failed-attempt-counts"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.deepEqual(result.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 });
  assert.equal(result.attemptCoverage, "verified_observed_prefix");
  assert.equal(result.attempts[0].toolCallId, "report");
  assert.equal(result.attempts[0].executionFailed, true);
  assert.equal(result.grade, null);
  assert.ok(readFileSync(path.join(outputRoot, "sdk-events.jsonl")).length > 0);
});

test("truncated trailing output preserves verified earlier attempts but never rescues a timed-out execution", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const value = plan();
  const complete = control.state.records.map(row => JSON.stringify(row)).join("\n") + "\n";
  const fake = engine(value, { execution: { ...response(`${complete}{"partial":`, null), error: Object.assign(new Error("outer deadline"), { code: "ETIMEDOUT" }) } });
  const outputRoot = path.join(workRoot("native-truncated-prefix"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.counts.observedRequests, 1);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.grade, null);
  assert.equal(result.decodeErrors.length, 1);
  assert.equal(readFileSync(path.join(outputRoot, "stdout.raw"), "utf8"), `${complete}{"partial":`);
});

test("a foreign callback records its actual invocation session rather than claiming root schema acceptance", async () => {
  const control = fixture({
    send: async ({ configuration, emit, event }) => {
      emit(event("turn", "assistant.turn_start", {}));
      emit(event("request", "assistant.message", { toolRequests: [{ toolCallId: "report", name: "report_result", arguments: validReport() }] }));
      await configuration.tools.find(tool => tool.name === "report_result").handler(validReport(), { sessionId: "foreign-session", toolCallId: "report", toolName: "report_result" });
      emit(event("execution", "tool.execution_complete", { toolCallId: "report", success: false }));
      emit(event("idle", "session.idle", { mode: "interactive", aborted: false }));
    },
  });
  const result = await runTerminalProtocol(control.input);
  const decision = control.state.records.filter(row => row.kind === "raw-event" && row.ref.path === "schema-events.jsonl").map(row => JSON.parse(Buffer.from(row.base64, "base64")))[0];
  assert.equal(decision.sessionId, "foreign-session");
  assert.equal(decision.toolName, "report_result");
  assert.equal(result.counts.schemaAcceptedHandlers, 0);
  assert.equal(result.ok, false);
});

test("a late callback exposes the closed work window and returns typed failure", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const callback = control.state.session.tools.find(tool => tool.name === "report_result").handler;
  const returned = await callback(validReport(), { sessionId: control.state.session.sessionId, toolCallId: "late", toolName: "report_result" });
  assert.equal(returned.resultType, "failure");
  const decision = JSON.parse(Buffer.from(control.state.records.findLast(row => row.kind === "raw-event").base64, "base64"));
  assert.equal(decision.withinWorkWindow, false);
  assert.equal(decision.toolCallId, "late");
});
