import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { readCommittedRun } from "../output.mjs";
import { fixture } from "./helpers/native-sdk.mjs";
import { engine, plan, response } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

let sequence = 0;
const criterion = "The retained external check passes.";
async function input(verdict = "pass", options = {}) {
  const root = workRoot(`assessment-runtime-${++sequence}`);
  const evidenceRoot = path.join(root, "evidence");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const bytes = jsonBytes({ exitCode: verdict === "pass" ? 0 : 1 });
  fs.writeFileSync(path.join(evidenceRoot, "check.json"), bytes);
  const assessment = { caseId: "source-bound-check", criteria: [criterion], fixedVerdicts: [{ criterion, verdict }], evidenceRoot, evidenceIndex: { files: ["check.json"] }, evidenceSeal: [{ path: "check.json", sha256: sha256(bytes) }] };
  const overall = verdict === "unclear" ? "investigate" : verdict;
  const value = { status: overall, summary: "Actual check result.", reasoning: "The retained external result determines the criterion.", observations: [], criteria: [{ criterion, verdict, evidence: "check.json:1" }] };
  const controller = new AbortController();
  let now = 0;
  const f = fixture({ send: async ({ configuration, emit, event }) => {
    emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" }));
    emit(event("turn", "assistant.turn_start", { turnId: "root" }));
    emit(event("usage", "assistant.usage", { model: "gpt-6-astra", reasoningEffort: "high", contentFilterTriggered: false, finishReason: "tool_calls" }));
    if (options.cancel) { controller.abort(); return new Promise(() => {}); }
    emit(event("request", "assistant.message", { turnId: "root", content: "", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: value }] }));
    if (options.expire) now = 1001;
    const returned = await configuration.tools.find(tool => tool.name === "report_result").handler(value, { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result" });
    emit(event("complete", "tool.execution_complete", { toolCallId: "report", success: returned.resultType === "success" }));
    emit({ ...event("idle", "session.idle", { mode: "interactive" }), ephemeral: true });
    return "sent";
  } });
  if (options.failHistory) {
    const Original = f.input.sdk.CopilotClient;
    f.input.sdk.CopilotClient = class extends Original {
      async createSession(configuration) {
        const session = await super.createSession(configuration);
        session.getEvents = async () => { throw new Error("The actual history response failed"); };
        return session;
      }
    };
  }
  const outcome = await runTerminalProtocol({ ...f.input, assessment, signal: controller.signal, clock: () => now });
  if (options.expectedStatus) assert.equal(outcome.status, options.expectedStatus);
  else assert.equal(outcome.grade.status, overall);
  const raw = Buffer.from(f.state.records.map(row => JSON.stringify(row)).join("\n") + "\n");
  return { root, assessment, bytes, raw, records: f.state.records };
}

for (const [verdict, status, exitCode] of [["pass", "passed", 0], ["fail", "product_failure", 1], ["unclear", "inconclusive", 2]]) test(`the fixed native runtime publishes a replay-verified ${verdict} assessment`, async () => {
  const data = await input(verdict);
  const value = plan();
  const fake = engine(value, { execution: response(data.raw) });
  const outputRoot = path.join(data.root, "output");
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot, execute: fake.execute });
  assert.equal(result.status, status);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.grade.status, verdict === "unclear" ? "investigate" : verdict);
  assert.equal(result.counts.admittedGrades, 1);
  assert.equal(result.scored, true);
  const envelope = JSON.parse(fake.state.calls.find(call => call.argv[0] === "start").settings.input);
  assert.equal(envelope.assessment.evidenceRoot, "/run/controller/evidence");
  assert.equal(envelope.evidence.length, 1);
  assert.deepEqual(Buffer.from(envelope.evidence[0].base64, "base64"), data.bytes);
  assert.ok(envelope.files.some(file => file.path === "native-assessment.mjs"));
  assert.ok(envelope.files.some(file => file.path === "evidence.mjs"));
  assert.equal(readCommittedRun(outputRoot).receipt.grade.status, verdict === "unclear" ? "investigate" : verdict);
  assert.equal(result.cleanup.removed, true);
});

test("an outer timeout retains valid judge requests without rescuing the assessment", async () => {
  const data = await input();
  const value = plan();
  const fake = engine(value, { execution: { ...response(data.raw, null), error: Object.assign(new Error("actual outer timeout"), { code: "ETIMEDOUT" }) } });
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot: path.join(data.root, "timeout"), execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.grade, null);
  assert.deepEqual(result.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 });
});

test("claimed terminal grades cannot replace conflicting captured effective configuration", async () => {
  const data = await input();
  const usage = data.records.find(row => row.kind === "raw-event" && JSON.parse(Buffer.from(row.base64, "base64")).type === "assistant.usage");
  const original = JSON.parse(Buffer.from(usage.base64, "base64"));
  original.data.reasoningEffort = "slow";
  const bytes = jsonBytes(original);
  assert.equal(bytes.length, usage.ref.byteLength);
  usage.ref.sha256 = sha256(bytes);
  usage.base64 = bytes.toString("base64");
  const value = plan();
  const fake = engine(value, { execution: response(data.records.map(row => JSON.stringify(row)).join("\n") + "\n") });
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot: path.join(data.root, "mismatch"), execute: fake.execute });
  assert.equal(result.grade, null);
  assert.equal(result.counts.observedRequests, 1);
  assert.notEqual(result.status, "passed");
});

test("native assessment evidence identity is checked before credential acquisition", async () => {
  const data = await input();
  fs.appendFileSync(path.join(data.assessment.evidenceRoot, "check.json"), "changed");
  const fake = engine(plan());
  await assert.rejects(runRuntimeQualification({ plan: plan(), assessment: data.assessment, outputRoot: path.join(data.root, "changed"), execute: fake.execute }), { code: "ASSESSMENT_EVIDENCE_CHANGED" });
  assert.equal(fake.state.calls.length, 0);
});

for (const [name, options, status] of [
  ["late handler after the native deadline", { expire: true, expectedStatus: "timed_out" }, "timed_out"],
  ["actual explicit native cancellation", { cancel: true, expectedStatus: "cancelled" }, "cancelled"],
  ["failed actual history response", { failHistory: true, expectedStatus: "unavailable" }, "unavailable"],
]) test(`raw replay preserves ${name} without a grade`, async () => {
  const data = await input("pass", options);
  const value = plan();
  const fake = engine(value, { execution: response(data.raw, 1) });
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot: path.join(data.root, "outcome"), execute: fake.execute });
  assert.equal(result.status, status);
  assert.equal(result.grade, null);
  assert.equal(result.counts.admittedGrades, 0);
});

test("a corrupt retained artifact keeps prefix counts but refuses native assessment admission", async () => {
  const data = await input();
  data.records.find(row => row.kind === "artifact").ref.sha256 = "0".repeat(64);
  const value = plan();
  const fake = engine(value, { execution: response(data.records.map(row => JSON.stringify(row)).join("\n") + "\n") });
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot: path.join(data.root, "corrupt"), execute: fake.execute });
  assert.equal(result.grade, null);
  assert.equal(result.counts.observedRequests, 1);
  assert.equal(result.failure.code, "NATIVE_RAW_REFERENCE_MISMATCH");
});

test("a terminal label cannot fabricate an explicit run cancellation", async () => {
  const data = await input();
  const terminal = data.records.find(row => row.kind === "assessment-finished");
  terminal.status = "cancelled";
  terminal.grade = null;
  terminal.counts = { ...terminal.counts, admittedGrades: 0 };
  terminal.failure = { code: "NATIVE_CANCELLED", message: "Unobserved claim" };
  const value = plan();
  const fake = engine(value, { execution: response(data.records.map(row => JSON.stringify(row)).join("\n") + "\n", 1) });
  const result = await runRuntimeQualification({ plan: value, assessment: data.assessment, outputRoot: path.join(data.root, "false-cancel"), execute: fake.execute });
  assert.notEqual(result.status, "cancelled");
  assert.equal(result.failure.code, "ASSESSMENT_CANCELLATION_UNOBSERVED");
});
