import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stageAssessmentEvidence, prepareNativeAssessment, observeEffectiveConfiguration } from "../native-assessment.mjs";
import { reportSchema, runTerminalProtocol } from "../native-protocol.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { fixture, criterion, validReport } from "./helpers/native-sdk.mjs";
import { workRoot } from "./helpers/paths.mjs";

const member = (name = "nested/check.txt", bytes = Buffer.from("actual evidence")) => ({ path: name, sha256: sha256(bytes), base64: bytes.toString("base64") });
const archive = () => {
  const file = member();
  return { evidence: [file], assessment: { evidenceRoot: "/run/controller/evidence", evidenceSeal: [{ path: file.path, sha256: file.sha256 }] } };
};
function writes() {
  const calls = [];
  return { calls, filesystem: { mkdirSync: (...args) => calls.push(["mkdir", ...args]), writeFileSync: (...args) => calls.push(["write", ...args]) } };
}

test("the fixed evidence staging boundary writes only prevalidated private no-overwrite members", () => {
  const data = archive();
  const io = writes();
  stageAssessmentEvidence(data, io.filesystem);
  assert.deepEqual(io.calls, [
    ["mkdir", "/run/controller/evidence", { mode: 0o700 }],
    ["mkdir", "/run/controller/evidence/nested", { recursive: true, mode: 0o700 }],
    ["write", "/run/controller/evidence/nested/check.txt", Buffer.from("actual evidence"), { flag: "wx", mode: 0o600 }],
  ]);
});

for (const [name, change] of [
  ["missing assessment", data => { data.assessment = null; }],
  ["other destination", data => { data.assessment.evidenceRoot = "/work/actor"; }],
  ["missing members", data => { data.evidence = null; }],
  ["empty members", data => { data.evidence = []; }],
  ["excess member count", data => { data.evidence = Array(4097).fill(data.evidence[0]); }],
  ["missing seal", data => { data.assessment.evidenceSeal = null; }],
  ["incomplete seal", data => { data.assessment.evidenceSeal = []; }],
  ["extra member fields", data => { data.evidence[0].command = "not an executable escape"; }],
  ["nontext base64", data => { data.evidence[0].base64 = 1; }],
  ["excess encoded size", data => { data.evidence[0].base64 = "A".repeat(22369625); }],
  ["parent traversal", data => { data.evidence[0].path = "../outside"; }],
  ["noncanonical base64", data => { data.evidence[0].base64 += "\n"; }],
  ["hash mismatch", data => { data.evidence[0].sha256 = "0".repeat(64); }],
  ["unsealed path", data => { data.assessment.evidenceSeal[0].path = "different"; }],
  ["unsealed bytes", data => { data.assessment.evidenceSeal[0].sha256 = "0".repeat(64); }],
  ["duplicate members", data => { data.evidence.push(data.evidence[0]); data.assessment.evidenceSeal.push(data.assessment.evidenceSeal[0]); }],
  ["binary evidence", data => { const file = member("check.txt", Buffer.from([0])); data.evidence = [file]; data.assessment.evidenceSeal = [{ path: file.path, sha256: file.sha256 }]; }],
]) test(`native evidence staging refuses ${name} before the first filesystem write`, () => {
  const data = archive();
  const io = writes();
  change(data);
  assert.throws(() => stageAssessmentEvidence(data, io.filesystem));
  assert.deepEqual(io.calls, []);
});

test("decoded file and aggregate byte budgets are checked before any privileged staging write", () => {
  for (const lengths of [[16777217], [16777216, 16777216, 1]]) {
    const evidence = lengths.map((length, index) => member(`check-${index}.txt`, Buffer.alloc(length, 65)));
    const io = writes();
    assert.throws(() => stageAssessmentEvidence({ evidence, assessment: { evidenceRoot: "/run/controller/evidence", evidenceSeal: evidence.map(({ path, sha256 }) => ({ path, sha256 })) } }, io.filesystem), { code: "ASSESSMENT_ARCHIVE_MISMATCH" });
    assert.deepEqual(io.calls, []);
  }
});

test("filesystem publication errors are not translated into a prepared evidence claim", () => {
  const failure = new Error("private staging failed");
  for (const at of ["mkdirSync", "writeFileSync"]) {
    const io = writes();
    io.filesystem[at] = () => { throw failure; };
    assert.throws(() => stageAssessmentEvidence(archive(), io.filesystem), error => error === failure);
  }
});

test("native assessment rejects missing, extra and empty contracts before reader access", () => {
  for (const input of [null, {}, { caseId: "", criteria: [], evidenceRoot: "absent", evidenceIndex: { files: [] }, evidenceSeal: [], fixedVerdicts: [] }, { caseId: "empty", criteria: [criterion], evidenceRoot: "absent", evidenceIndex: { files: [] }, evidenceSeal: [], fixedVerdicts: [] }]) assert.throws(() => prepareNativeAssessment(input, reportSchema), { code: "INVALID_NATIVE_ASSESSMENT" });
});

test("effective configuration excludes foreign sessions and child-agent evidence", () => {
  const event = (type, data, overrides = {}) => ({ sessionId: "ours", rawRecord: jsonBytes({ type, data, ...overrides }), ref: { path: type } });
  const events = [
    { ...event("session.start", { sessionId: "ours", selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" }), sessionId: "foreign" },
    event("session.start", {}, { agentId: "child" }),
    event("assistant.usage", {}, { agentId: "child" }),
    { sessionId: "ours", rawRecord: Buffer.from("null"), ref: {} },
    event("unrelated", {}),
  ];
  assert.equal(observeEffectiveConfiguration({ events, sessionId: "ours", model: "gpt-6-astra" }).verified, false);
});

test("the assessment loop retains an invalid SDK event as unavailable, not an admitted grade", async () => {
  const evidenceRoot = workRoot("invalid-assessment-sdk-event");
  fs.mkdirSync(path.join(evidenceRoot, "checks"), { recursive: true });
  const bytes = Buffer.from("The fixed API returned three.");
  fs.writeFileSync(path.join(evidenceRoot, "checks/proof.txt"), bytes);
  const assessment = { caseId: "invalid-event", criteria: [criterion], evidenceRoot, evidenceIndex: { files: ["checks/proof.txt"] }, evidenceSeal: [{ path: "checks/proof.txt", sha256: sha256(bytes) }], fixedVerdicts: [] };
  const f = fixture({ send: async ({ configuration }) => configuration.onEvent({ type: "session.start", data: {} }) });
  const result = await runTerminalProtocol({ ...f.input, assessment });
  assert.equal(result.grade, null);
  assert.equal(result.status, "unavailable");
  assert.equal(result.failure.code, "ASSESSMENT_CAPTURE_UNAVAILABLE");
});

test("late assessment callbacks return typed failure without reopening admitted state", async () => {
  const evidenceRoot = workRoot("late-assessment-callback");
  fs.mkdirSync(path.join(evidenceRoot, "checks"), { recursive: true });
  const bytes = Buffer.from("The fixed API returned three.");
  fs.writeFileSync(path.join(evidenceRoot, "checks/proof.txt"), bytes);
  const assessment = { caseId: "late", criteria: [criterion], evidenceRoot, evidenceIndex: { files: ["checks/proof.txt"] }, evidenceSeal: [{ path: "checks/proof.txt", sha256: sha256(bytes) }], fixedVerdicts: [] };
  const f = fixture();
  const result = await runTerminalProtocol({ ...f.input, assessment });
  const before = jsonBytes(result);
  const returned = await f.state.session.tools.find(tool => tool.name === "report_result").handler(validReport(), { sessionId: f.state.session.sessionId, toolCallId: "late", toolName: "report_result" });
  assert.equal(returned.resultType, "failure");
  assert.deepEqual(jsonBytes(result), before);
  assert.equal(f.state.records.at(-1).kind, "post-window-report-callback");
});
