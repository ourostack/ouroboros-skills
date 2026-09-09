import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { verifyProtocolEvidence } from "../native-runtime.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

const plan = { model: "gpt-6-astra", reasoningEffort: "high", contextTier: "default", runtime: { cliVersion: "1.0.84-1" } };
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function changeRaw(row, change) {
  const value = JSON.parse(Buffer.from(row.base64, "base64"));
  change(value);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  row.base64 = bytes.toString("base64");
  row.ref.sha256 = hash(bytes);
  row.ref.byteLength = bytes.length;
}
async function records() {
  const control = fixture();
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, true);
  return control.state.records;
}

test("the control verifier consumes actual producer records rather than a success-shaped envelope alone", async () => {
  const value = verifyProtocolEvidence(await records(), plan);
  assert.deepEqual(value.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 });
  assert.ok(value.files.has("history-response.json"));
  assert.equal(value.observation.admissionEligible, true);
});

test("a schema observation must retain the same event identity as its raw reference", async () => {
  const rows = await records();
  rows.find(row => row.kind === "raw-event" && row.ref.path === "schema-events.jsonl").ref.eventId = "forged-schema-id";
  assert.throws(() => verifyProtocolEvidence(rows, plan));
});

test("rehashing a history response from another root window cannot make it match this invocation", async () => {
  const rows = await records();
  changeRaw(rows.find(row => row.kind === "artifact" && row.ref.path === "history-response.json"), events => {
    events.find(event => event.type === "assistant.turn_start").id = "different-root-window";
  });
  assert.throws(() => verifyProtocolEvidence(rows, plan), { code: "NATIVE_HISTORY_MISMATCH" });
});

test("a schema decision from another declared schema is refused even when its bytes are rehashed", async () => {
  const rows = await records();
  changeRaw(rows.find(row => row.kind === "raw-event" && row.ref.path === "schema-events.jsonl"), value => { value.schemaSha256 = "0".repeat(64); });
  assert.throws(() => verifyProtocolEvidence(rows, plan), { code: "NATIVE_EXECUTION_UNAVAILABLE" });
});

test("source-scoped configuration, contiguous streams and actual exit references are all required", async () => {
  const original = await records();
  for (const mutate of [
    rows => { rows.find(row => row.kind === "runtime-configuration").modelRequested = "claude-opus-5"; },
    rows => { rows.find(row => row.kind === "raw-event").ref.byteOffset = 1; },
    rows => { rows.find(row => row.kind === "raw-event").ref.sessionId = "another-session"; },
    rows => { rows.find(row => row.kind === "raw-event").ref.sha256 = "0".repeat(64); },
    rows => { rows.push(structuredClone(rows.find(row => row.kind === "artifact"))); },
    rows => { rows.find(row => row.kind === "probe-finished").cleanup.receipt.exitObservations = []; },
    rows => { rows.find(row => row.kind === "probe-finished").counts.admittedGrades = 1; },
    rows => { rows.splice(rows.findIndex(row => row.kind === "runtime-configuration"), 1); },
  ]) {
    const rows = structuredClone(original);
    mutate(rows);
    assert.throws(() => verifyProtocolEvidence(rows, plan));
  }
});
