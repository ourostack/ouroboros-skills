import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runTerminalProtocol, reportSchema } from "../native-protocol.mjs";
import { stageAssessmentEvidence } from "../native-assessment.mjs";
import { validFrozenRubric } from "../admission.mjs";
import { fixture, criterion, validReport } from "./helpers/native-sdk.mjs";
import { sha256 } from "../core.mjs";
import { workRoot } from "./helpers/paths.mjs";

let sequence = 0;
function assessment() {
  const evidenceRoot = workRoot(`cancel-assessment-${++sequence}`);
  fs.mkdirSync(path.join(evidenceRoot, "checks"), { recursive: true });
  const bytes = Buffer.from("The zero API returned three.");
  fs.writeFileSync(path.join(evidenceRoot, "checks/proof.txt"), bytes);
  return { caseId: "cancel", criteria: [criterion], evidenceRoot, evidenceIndex: { files: ["checks/proof.txt"] }, evidenceSeal: [{ path: "checks/proof.txt", sha256: sha256(bytes) }], fixedVerdicts: [] };
}

test("an explicit run cancellation closes a pending SDK send and retains the actual cancellation record", async () => {
  const controller = new AbortController();
  const f = fixture({ send: async ({ emit, event }) => {
    emit(event("turn", "assistant.turn_start", {}));
    controller.abort();
    return new Promise(() => {});
  } });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment(), signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.grade, null);
  assert.equal(f.state.aborted, true);
  const cancellation = f.state.records.find(row => row.kind === "artifact" && row.ref.path === "run-cancellation.json");
  assert.equal(JSON.parse(Buffer.from(cancellation.base64, "base64")).runId, result.runId);
});

test("a pre-aborted run never starts an SDK session", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment(), signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(f.state.session, undefined);
});

test("a reached work deadline retains precedence over a later cancellation", async () => {
  let now = 0;
  const controller = new AbortController();
  const f = fixture({ send: async ({ emit, event }) => {
    emit(event("turn", "assistant.turn_start", {}));
    now = 1001;
    controller.abort();
  } });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment(), signal: controller.signal, clock: () => now });
  assert.equal(result.status, "timed_out");
});

test("missing execution completion remains an explicitly pending report, never an admitted grade", async () => {
  const f = fixture({ send: async ({ configuration, emit, event }) => {
    emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" }));
    emit(event("turn", "assistant.turn_start", {}));
    emit(event("usage", "assistant.usage", { model: "gpt-6-astra", reasoningEffort: "high", contentFilterTriggered: false, finishReason: "tool_calls" }));
    emit(event("request", "assistant.message", { toolRequests: [{ toolCallId: "pending", name: "report_result", arguments: validReport() }] }));
    await configuration.tools.find(tool => tool.name === "report_result").handler(validReport(), { sessionId: configuration.sessionId, toolCallId: "pending", toolName: "report_result" });
    emit(event("idle", "session.idle", { mode: "interactive" }));
  } });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment() });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.attemptCoverage.pendingCallIds, ["pending"]);
});

test("ordinary rubrics keep zero deterministic constraints, and default staging rejects an absent archive", () => {
  assert.equal(validFrozenRubric({ criteria: [criterion], evidenceIndex: { files: ["checks/proof.txt"] } }), true);
  assert.throws(() => stageAssessmentEvidence({}), { code: "INVALID_ASSESSMENT_ARCHIVE" });
  assert.equal(reportSchema.properties.criteria.minItems, 1);
});

test("cancellation never masks the already latched root-session error", async () => {
  const controller = new AbortController();
  const f = fixture({ send: async ({ emit, event }) => {
    emit(event("error", "session.error", {}));
    controller.abort();
  } });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment(), signal: controller.signal });
  assert.equal(result.status, "unavailable");
  assert.equal(result.failure.message, "The native session reported an error.");
});

test("a cancellation-capture failure remains visible while the owned runtime is stopped", async () => {
  const controller = new AbortController();
  const f = fixture({ send: async () => { controller.abort(); } });
  const result = await runTerminalProtocol({
    ...f.input, assessment: assessment(), signal: controller.signal,
    emit: record => {
      if (record.kind === "artifact" && record.ref.path === "run-cancellation.json") throw new Error("Cannot retain cancellation evidence");
      f.state.records.push(record);
    },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.grade, null);
  assert.equal(result.attemptCoverage.captureErrors[0].message, "Cannot retain cancellation evidence");
  assert.equal(f.state.stopped, true);
});

test("non-native cancellation objects are refused before runtime creation", async () => {
  const f = fixture();
  await assert.rejects(runTerminalProtocol({ ...f.input, signal: {} }), { code: "INVALID_NATIVE_PROTOCOL" });
  assert.equal(f.state.client, undefined);
});
