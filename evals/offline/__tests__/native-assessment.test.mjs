import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { validateTerminalReport } from "../admission.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { workRoot } from "./helpers/paths.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

const criterion = "The actual external caller returns the frozen value.";
const rubric = { criteria: [criterion], evidenceIndex: { files: ["check.json"] }, fixedVerdicts: [{ criterion, verdict: "pass" }] };
const report = (verdict = "pass") => ({ status: verdict === "unclear" ? "investigate" : verdict, summary: "The retained caller result is available.", reasoning: "The external observation determines this criterion.", observations: [], criteria: [{ criterion, verdict, evidence: "check.json:1" }] });
let sequence = 0;
function assessment(overrides = {}) {
  const root = workRoot(`assessment-evidence-${++sequence}`);
  fs.mkdirSync(root, { recursive: true });
  const bytes = jsonBytes({ actual: 7, expected: 7, exitCode: 0 });
  fs.writeFileSync(`${root}/check.json`, bytes);
  return { caseId: "external-caller", evidenceRoot: root, ...structuredClone(rubric), evidenceSeal: [{ path: "check.json", sha256: sha256(bytes) }], ...overrides };
}
function subject(options = {}) {
  return fixture({ send: async ({ configuration, state, emit, event }) => {
    if (options.sessionStart !== false) emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: options.model ?? "gpt-6-astra", reasoningEffort: options.effort ?? "high", contextTier: options.context ?? "default" }));
    emit(event("turn", "assistant.turn_start", { turnId: "root-turn" }));
    if (options.usage !== false) emit(event("usage", "assistant.usage", { model: options.usageModel ?? "gpt-6-astra", reasoningEffort: options.usageEffort ?? "high", contentFilterTriggered: options.filtered === true, finishReason: options.filtered ? "content_filter" : "tool_calls" }));
    if (options.read) state.read = await configuration.tools.find(tool => tool.name === "read_evidence").handler(options.read);
    for (const [index, value] of (options.reports ?? [report()]).entries()) {
      const toolCallId = `report-${index}`;
      emit(event(`request-${index}`, "assistant.message", { turnId: "root-turn", content: "", toolRequests: [{ toolCallId, name: "report_result", arguments: value }] }));
      const returned = await configuration.tools.find(tool => tool.name === "report_result").handler(value, { sessionId: configuration.sessionId, toolCallId, toolName: "report_result" });
      (state.returnedReports ??= []).push(returned);
      emit(event(`complete-${index}`, "tool.execution_complete", { toolCallId, success: returned.resultType === "success" }));
    }
    options.beforeIdle?.();
    emit({ ...event("idle", "session.idle", { mode: "interactive" }), ephemeral: true });
    return "sent";
  } });
}

test("the existing native loop admits an actual source-sealed independent judge report", async () => {
  const f = subject({ read: { path: "check.json", offset: 0, length: 8 } });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment() });
  assert.equal(result.status, "passed");
  assert.equal(result.grade.status, "pass");
  assert.deepEqual(result.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 1 });
  assert.equal(f.state.read.text.length, 8);
  assert.ok(f.state.read.nextOffset > 0);
  assert.deepEqual(f.state.session.availableTools, ["custom:read_evidence", "custom:report_result"]);
  assert.equal(f.state.session.enableSkills, false);
  assert.equal(f.state.session.enableConfigDiscovery, false);
  assert.equal(f.state.session.systemMessage.mode, "replace");
  assert.match(f.state.session.systemMessage.content, /external caller/);
  assert.doesNotMatch(f.state.session.systemMessage.content, /zero-value API|fixed control evidence/);
  assert.equal(f.state.records.at(-1).kind, "assessment-finished");
  assert.equal(f.state.stopped, true);
});

test("native judge correction retains a rejected deterministic false-green report before one valid result", async () => {
  const f = subject({ reports: [report(), report("fail")] });
  const value = assessment({ fixedVerdicts: [{ criterion, verdict: "fail" }] });
  const result = await runTerminalProtocol({ ...f.input, assessment: value });
  assert.equal(result.status, "product_failure");
  assert.deepEqual(f.state.returnedReports.map(row => row.resultType), ["failure", "success"]);
  assert.deepEqual(result.counts, { observedRequests: 2, schemaAcceptedHandlers: 2, validatorAcceptedReports: 1, admittedGrades: 1 });
});

test("native assessment rejects two validator-accepted reports instead of choosing one", async () => {
  const f = subject({ reports: [report(), report()] });
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment() });
  assert.equal(result.status, "protocol_failure");
  assert.equal(result.grade, null);
  assert.equal(result.counts.validatorAcceptedReports, 2);
});

for (const [name, options] of [
  ["missing native session start", { sessionStart: false }],
  ["missing effective usage", { usage: false }],
  ["wrong session model", { model: "claude-opus-5" }],
  ["wrong session effort", { effort: "low" }],
  ["wrong context tier", { context: "long_context" }],
  ["wrong usage model", { usageModel: "claude-opus-5" }],
  ["wrong effective usage effort", { usageEffort: "low" }],
  ["content-filtered inference", { filtered: true }],
]) test(`native assessment never grades ${name}`, async () => {
  const f = subject(options);
  const result = await runTerminalProtocol({ ...f.input, assessment: assessment() });
  assert.equal(result.status, "unavailable");
  assert.equal(result.grade, null);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.effectiveConfiguration.verified, false);
});

test("changed sealed judge evidence cannot retain an admitted grade", async () => {
  const value = assessment();
  const f = subject({ beforeIdle: () => fs.appendFileSync(`${value.evidenceRoot}/check.json`, "\nchanged") });
  const result = await runTerminalProtocol({ ...f.input, assessment: value });
  assert.equal(result.grade, null);
  assert.equal(result.status, "unavailable");
  assert.equal(result.evidenceVerified, false);
});

test("the judge refuses a changed input seal before starting an SDK runtime", async () => {
  const f = subject();
  await assert.rejects(runTerminalProtocol({ ...f.input, assessment: assessment({ evidenceSeal: [{ path: "check.json", sha256: "0".repeat(64) }] }) }), { code: "ASSESSMENT_EVIDENCE_CHANGED" });
  assert.equal(f.state.client, undefined);
});

for (const [name, fixedVerdicts, verdict] of [
  ["failed checker", [{ criterion, verdict: "fail" }], "pass"],
  ["passed checker", [{ criterion, verdict: "pass" }], "fail"],
  ["unknown frozen criterion", [{ criterion: "not in rubric", verdict: "pass" }], "pass"],
  ["duplicated frozen criterion", [{ criterion, verdict: "pass" }, { criterion, verdict: "pass" }], "pass"],
  ["unsupported frozen verdict", [{ criterion, verdict: "success" }], "pass"],
  ["non-array frozen verdicts", null, "pass"],
]) test(`report validation refuses contradiction or malformed ${name}`, () => {
  assert.equal(validateTerminalReport(report(verdict), { ...rubric, fixedVerdicts }).ok, false);
});

test("matching deterministic evidence and ordinary semantic rubrics preserve existing report behavior", () => {
  assert.equal(validateTerminalReport(report(), rubric).ok, true);
  assert.equal(validateTerminalReport(report("fail"), { ...rubric, fixedVerdicts: [] }).ok, true);
});
