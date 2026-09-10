import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createEvidenceReader } from "../evidence.mjs";
import { jsonBytes, readRegular, sha256 } from "../core.mjs";
import { openRunOutput, readCommittedRun } from "../output.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { verifyProtocolEvidence } from "../native-runtime.mjs";
import { fixture as nativeFixture } from "./helpers/native-sdk.mjs";
import { plan as nativePlan } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

const counts = { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 };
const limits = { maxStreamBytes: 8192, maxFileBytes: 8192, maxTotalBytes: 12288, maxFiles: 32 };
function publication(name, executionKind = "subject_with_judge") {
  const root = workRoot(name);
  const outputRoot = path.join(root, "attempt");
  const context = { runId: "attempt", cellId: "cell", planSha256: sha256("frozen plan"), executionKind };
  const output = openRunOutput({ outputRoot, authorizedRoot: root, protectedRoots: [], runContext: context, limits });
  return { root, outputRoot, output, context };
}
function receipt(status, grade = null, value = counts) {
  return { schemaVersion: 1, runId: "attempt", status, grade, counts: { ...value } };
}

for (const consumer of ["producer", "verifier"]) for (const mutation of ["partial-request", "aborted-terminal", "missing-terminal", "wrong-terminal-mode"]) test(`I2 native ${consumer} reconciles ${mutation}`, async () => {
  const original = nativeFixture();
  assert.equal((await runTerminalProtocol(original.input)).ok, true);
  const history = structuredClone(original.state.events);
  if (mutation === "partial-request") history.splice(-1, 0, { id: "hidden-partial", type: "assistant.tool_call_delta", data: { turnId: "supported-turn", toolCallId: "extra", toolName: "report_result" } });
  if (mutation === "aborted-terminal") history.at(-1).data.aborted = true;
  if (mutation === "missing-terminal") history.pop();
  if (mutation === "wrong-terminal-mode") history.at(-1).data.mode = "autopilot";
  if (consumer === "producer") {
    const candidate = nativeFixture({ history });
    const result = await runTerminalProtocol(candidate.input);
    assert.equal(result.ok, false);
    assert.equal(result.historicalMatches, false);
  } else {
    const row = original.state.records.find(row => row.kind === "artifact" && row.ref.path === "history-response.json");
    const bytes = jsonBytes(history);
    row.base64 = bytes.toString("base64");
    row.ref.sha256 = sha256(bytes);
    row.ref.byteLength = bytes.length;
    assert.throws(() => verifyProtocolEvidence(original.state.records, nativePlan()), { code: "NATIVE_HISTORY_MISMATCH" });
  }
});

for (const consumer of ["readRegular", "createEvidenceReader"]) test(`I1 ${consumer} refuses a real outside descriptor before reading or sealing bytes`, t => {
  const parent = workRoot(`descriptor-swap-${consumer}`);
  const root = path.join(parent, "evidence");
  const directory = path.join(root, "ancestor");
  const outside = path.join(parent, "outside-evidence");
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(directory, "proof.txt"), "INSIDE-ROOT-WITNESS");
  fs.writeFileSync(path.join(outside, "proof.txt"), "OUTSIDE-ROOT-WITNESS");
  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const outsideDescriptors = new Set();
  let exposedReads = 0;
  t.mock.method(fs, "openSync", (filename, ...args) => {
    if (filename !== path.join(directory, "proof.txt")) return originalOpen(filename, ...args);
    fs.renameSync(directory, `${directory}.saved`);
    fs.symlinkSync(outside, directory);
    try {
      const descriptor = originalOpen(filename, ...args);
      outsideDescriptors.add(descriptor);
      return descriptor;
    } finally {
      fs.unlinkSync(directory);
      fs.renameSync(`${directory}.saved`, directory);
    }
  });
  t.mock.method(fs, "readSync", (descriptor, ...args) => {
    if (outsideDescriptors.has(descriptor)) exposedReads++;
    return originalRead(descriptor, ...args);
  });
  assert.throws(() => consumer === "readRegular" ? readRegular(root, "ancestor/proof.txt") : createEvidenceReader({ root, index: { files: ["ancestor/proof.txt"] } }), { code: "FILE_CHANGED" });
  assert.equal(exposedReads, 0);
  assert.equal(fs.readFileSync(path.join(directory, "proof.txt"), "utf8"), "INSIDE-ROOT-WITNESS");
});

for (const status of ["passed", "product_failure"]) test(`I3 deterministic ${status} publishes without a model grade or invented activity`, () => {
  const { output, outputRoot, context } = publication(`deterministic-${status}`, "deterministic");
  let committed;
  assert.doesNotThrow(() => { committed = output.commit(receipt(status)); });
  assert.equal(committed.receipt.executionKind, context.executionKind);
  assert.equal(readCommittedRun(outputRoot).receipt.status, status);
  assert.equal(committed.receipt.grade, null);
  assert.deepEqual(committed.receipt.counts, counts);
});

test("I4 a supplied model receipt with two validator-accepted reports cannot be committed", () => {
  const { output } = publication("multiple-valid-reports");
  assert.throws(() => output.commit(receipt("passed", { status: "pass" }, { observedRequests: 2, schemaAcceptedHandlers: 2, validatorAcceptedReports: 2, admittedGrades: 1 })), { code: "OUTPUT_WRITE_FAILED" });
});

test("I4 rehashing a previously committed receipt cannot hide multiple valid reports from its reader", () => {
  const { output, outputRoot } = publication("multiple-valid-resealed");
  output.commit(receipt("passed", { status: "pass" }, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 1 }));
  const value = JSON.parse(fs.readFileSync(path.join(outputRoot, "receipt.json")));
  value.counts = { observedRequests: 2, schemaAcceptedHandlers: 2, validatorAcceptedReports: 2, admittedGrades: 1 };
  const bytes = jsonBytes(value);
  fs.writeFileSync(path.join(outputRoot, "receipt.json"), bytes);
  const inventory = JSON.parse(fs.readFileSync(path.join(outputRoot, "inventory.json")));
  const member = inventory.files.find(member => member.path === "receipt.json");
  member.bytes = bytes.length; member.sha256 = sha256(bytes);
  const inventoryBytes = jsonBytes(inventory);
  fs.writeFileSync(path.join(outputRoot, "inventory.json"), inventoryBytes);
  const marker = JSON.parse(fs.readFileSync(path.join(outputRoot, "COMMITTED.json")));
  marker.receipt.sha256 = sha256(bytes); marker.inventory.sha256 = sha256(inventoryBytes);
  fs.writeFileSync(path.join(outputRoot, "COMMITTED.json"), jsonBytes(marker));
  assert.throws(() => readCommittedRun(outputRoot), { code: "INVALID_ADMISSION_COUNTS" });
});

test("I5 aggregate stream capture fails before exceeding its budget and reserves an intact failure envelope", () => {
  const { output, outputRoot } = publication("aggregate-before-append");
  let failure;
  for (const channel of ["stdout", "stderr", "sdk-events", "schema-events"]) {
    try { output.appendRaw(channel, Buffer.alloc(4096, "x")); }
    catch (error) { failure = error; break; }
  }
  const retained = fs.readdirSync(outputRoot).reduce((sum, name) => sum + fs.statSync(path.join(outputRoot, name)).size, 0);
  assert.ok(failure, `Four appends retained ${retained} bytes without latching the ${limits.maxTotalBytes}-byte aggregate budget.`);
  assert.ok(retained <= limits.maxTotalBytes);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, "receipt.incomplete.json"))).grade, null);
  assert.throws(() => output.commit(receipt("infrastructure_failure")), { code: "OUTPUT_NOT_COMMITTABLE" });
  assert.equal(fs.existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});

test("I5 a small result commits within the same aggregate budget", () => {
  const { output, outputRoot } = publication("aggregate-small-control");
  output.appendRaw("stdout", Buffer.from("small"));
  output.commit(receipt("infrastructure_failure"));
  assert.equal(readCommittedRun(outputRoot).receipt.status, "infrastructure_failure");
  assert.ok(fs.readdirSync(outputRoot).reduce((sum, name) => sum + fs.statSync(path.join(outputRoot, name)).size, 0) <= limits.maxTotalBytes);
});
