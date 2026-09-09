import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { reconcileJudgeHistory } from "../admission.mjs";
import { validateRunSetInventory } from "../comparison.mjs";
import { openRunOutput, readCommittedRun } from "../output.mjs";
import { sha256 } from "../core.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { fixture as nativeFixture } from "./helpers/native-sdk.mjs";
import { diskRunSet, expectedFixture } from "./helpers/run-set.mjs";
import { workRoot } from "./helpers/paths.mjs";

let sequence = 0;
const emptyCounts = () => ({ observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
const failed = () => ({ schemaVersion: 1, runId: "attempt", status: "infrastructure_failure", grade: null, counts: emptyCounts() });
function setup(overrides = {}) {
  const root = workRoot(`implementation-boundary-${++sequence}`);
  const input = { outputRoot: path.join(root, "attempt"), authorizedRoot: root, protectedRoots: [], runContext: { runId: "attempt", cellId: "cell", planSha256: sha256("fixed"), executionKind: "subject_with_judge" }, limits: { maxStreamBytes: 8192, maxFileBytes: 8192, maxTotalBytes: 12288, maxFiles: 32 }, ...overrides };
  return { input, output: openRunOutput(input) };
}

test("I2 unsupported history shapes remain unavailable while the actual complete control reconciles", async () => {
  const control = nativeFixture();
  const result = await runTerminalProtocol(control.input);
  const args = { observed: result.observation, sessionId: result.sessionId, rootAgentId: null, expectedMode: "interactive" };
  assert.equal(reconcileJudgeHistory({ ...args, history: control.state.events }), true);
  for (const history of [undefined, null, {}, [null]]) assert.equal(reconcileJudgeHistory({ ...args, history }), false);
});

test("I3 deterministic and model grading routes cannot override their frozen context", () => {
  for (const [index, kind] of ["deterministic", "subject_with_judge", undefined].entries()) {
    const { input, output } = setup({ runContext: { runId: "attempt", cellId: `cell-${index}`, planSha256: sha256("fixed"), executionKind: kind } });
    const claimed = { ...failed(), status: "passed", executionKind: kind === "subject_with_judge" ? "deterministic" : "subject_with_judge", grade: { status: "pass" }, counts: { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 1 } };
    assert.throws(() => output.commit(claimed), { code: "OUTPUT_WRITE_FAILED" });
    assert.equal(fs.existsSync(path.join(input.outputRoot, "COMMITTED.json")), false);
  }
});

test("I3 deterministic outcomes reject invented activity and an LLM-only inconclusive grade", () => {
  for (const value of [
    { ...failed(), status: "passed", counts: { ...emptyCounts(), observedRequests: 1 } },
    { ...failed(), status: "inconclusive" },
  ]) {
    const { output } = setup({ runContext: { runId: "attempt", cellId: "cell", planSha256: sha256("fixed"), executionKind: "deterministic" } });
    assert.throws(() => output.commit(value), { code: "OUTPUT_WRITE_FAILED" });
  }
});

test("I3 inventory consumers require the exact grading route from their frozen expected cell", () => {
  const fixture = diskRunSet(workRoot("execution-kind-inventory"), { id: "deterministic", deterministic: true, status: "passed" });
  assert.equal(validateRunSetInventory(fixture).inventoryComplete, true);
  fixture.expectedCells = expectedFixture(fixture.plan);
  fixture.plan.expectedCells = fixture.put("expected-cells.json", fixture.expectedCells);
  fixture.runSet.expectedCells = fixture.plan.expectedCells;
  fixture.runSet.plan = fixture.put("plan.json", fixture.plan);
  fixture.save();
  assert.throws(() => validateRunSetInventory(fixture), { code: "RECEIPT_EXECUTION_KIND_MISMATCH" });
});

test("I5 impossible failure reserves and invalid declared kinds fail before creating an output", () => {
  for (const [index, delta] of [
    { limits: { maxStreamBytes: 128, maxFileBytes: 128, maxTotalBytes: 8192, maxFiles: 32 } },
    { limits: { maxStreamBytes: 1024, maxFileBytes: 8192, maxTotalBytes: 1024, maxFiles: 32 } },
    { limits: { maxStreamBytes: 1024, maxFileBytes: 8192, maxTotalBytes: 65536, maxFiles: 3 } },
    { runContext: { runId: "attempt", cellId: "cell", planSha256: sha256("fixed"), executionKind: "undeclared" } },
  ].entries()) {
    const root = workRoot(`impossible-reserve-${index}`);
    const outputRoot = path.join(root, "attempt");
    assert.throws(() => openRunOutput({ outputRoot, authorizedRoot: root, protectedRoots: [], runContext: { runId: "attempt", cellId: "cell", planSha256: sha256("fixed") }, ...delta }));
    assert.equal(fs.existsSync(outputRoot), false);
  }
});

test("I5 artifact writes share the capture budget and cannot create publisher-owned files", () => {
  const { input, output } = setup();
  for (const name of ["receipt.json", "COMMITTED.json", "stdout.raw", "inventory.json"]) assert.throws(() => output.writeArtifact(name, Buffer.from("fake")), { code: "INVALID_OUTPUT_ARTIFACT" });
  assert.throws(() => output.writeArtifact("../outside", Buffer.from("fake")), { code: "INVALID_PATH" });
  assert.throws(() => output.writeArtifact("decoded.txt", "not raw"), { code: "INVALID_OUTPUT_ARTIFACT" });
  output.writeArtifact("checks.json", Buffer.from('{"checked":true}\n'));
  output.commit(failed());
  assert.ok(readCommittedRun(input.outputRoot).inventory.files.some(item => item.path === "checks.json"));
  assert.throws(() => output.writeArtifact("late.txt", Buffer.from("late")), { code: "OUTPUT_NOT_COMMITTABLE" });
});

test("I5 duplicate artifact writes cannot lower accounted bytes or replace an immutable capture", () => {
  const { input, output } = setup();
  output.writeArtifact("proof.bin", Buffer.alloc(4096, "x"));
  assert.throws(() => output.writeArtifact("proof.bin", Buffer.alloc(0)), { code: "OUTPUT_WRITE_FAILED" });
  assert.equal(fs.statSync(path.join(input.outputRoot, "proof.bin")).size, 4096);
  assert.throws(() => output.commit(failed()), { code: "OUTPUT_NOT_COMMITTABLE" });
});

test("I5 regular-file and aggregate artifact limits apply before any oversized write", () => {
  for (const oversizedFile of [true, false]) {
    const { input, output } = setup();
    if (!oversizedFile) output.writeArtifact("prior.bin", Buffer.alloc(8192));
    assert.throws(() => output.writeArtifact("rejected.bin", Buffer.alloc(oversizedFile ? 8193 : 4096)), { code: "OUTPUT_WRITE_FAILED" });
    assert.equal(fs.existsSync(path.join(input.outputRoot, "rejected.bin")), false);
    assert.ok(fs.readdirSync(input.outputRoot).reduce((sum, name) => sum + fs.statSync(path.join(input.outputRoot, name)).size, 0) <= input.limits.maxTotalBytes);
  }
});

test("I5 aggregate file count leaves the reserved annotation slot available", () => {
  const { input, output } = setup({ limits: { maxStreamBytes: 8192, maxFileBytes: 8192, maxTotalBytes: 12288, maxFiles: 5 } });
  output.writeArtifact("one.txt", Buffer.from("one"));
  assert.throws(() => output.writeArtifact("two.txt", Buffer.from("two")), { code: "OUTPUT_WRITE_FAILED" });
  assert.equal(fs.existsSync(path.join(input.outputRoot, "two.txt")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(input.outputRoot, "receipt.incomplete.json"))).grade, null);
  assert.ok(fs.readdirSync(input.outputRoot).length <= 5);
});

test("I5 failure annotations bound hostile error text without consuming the retained envelope", () => {
  const { input, output } = setup({ io: { appendFileSync() { throw Object.assign(new Error("\0".repeat(10000)), { code: "EIO" }); } } });
  assert.throws(() => output.appendRaw("stdout", Buffer.from("x")), { code: "OUTPUT_WRITE_FAILED" });
  const envelope = JSON.parse(fs.readFileSync(path.join(input.outputRoot, "receipt.incomplete.json")));
  assert.equal(envelope.error.message.length, 256);
  assert.equal(envelope.grade, null);
  assert.ok(fs.readdirSync(input.outputRoot).reduce((sum, name) => sum + fs.statSync(path.join(input.outputRoot, name)).size, 0) <= input.limits.maxTotalBytes);
});

test("I5 an externally planted stream is not silently adopted into the capture ledger", () => {
  const { input, output } = setup();
  fs.writeFileSync(path.join(input.outputRoot, "schema-events.jsonl"), "");
  assert.throws(() => output.appendRaw("schema-events", Buffer.from("{}\n")), { code: "OUTPUT_WRITE_FAILED" });
  assert.throws(() => output.commit(failed()), { code: "OUTPUT_NOT_COMMITTABLE" });
});
