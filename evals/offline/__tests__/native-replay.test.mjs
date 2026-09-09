import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { verifyProtocolEvidence } from "../native-runtime.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { fixture, validReport } from "./helpers/native-sdk.mjs";
import { plan } from "./helpers/native-engine.mjs";

test("text and evidence-reading turns remain visible without being counted as report requests", async () => {
  const control = fixture({
    send: async ({ configuration, emit, event }) => {
      emit(event("reading-turn", "assistant.turn_start", {}));
      emit(event("text", "assistant.message", { content: "Reading the supplied evidence." }));
      emit(event("read", "assistant.message", { toolRequests: [{ toolCallId: "read", name: "read_evidence", arguments: { path: "checks/proof.txt" } }] }));
      const text = await configuration.tools.find(tool => tool.name === "read_evidence").handler({ path: "checks/proof.txt" });
      assert.match(text, /returned 3/);
      emit(event("read-complete", "tool.execution_complete", { toolCallId: "read", success: true }));
      emit(event("reporting-turn", "assistant.turn_start", {}));
      emit(event("report", "assistant.message", { toolRequests: [{ toolCallId: "report", name: "report_result", arguments: validReport() }] }));
      await configuration.tools.find(tool => tool.name === "report_result").handler(validReport(), { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result" });
      emit(event("report-complete", "tool.execution_complete", { toolCallId: "report", success: true }));
      emit(event("idle", "session.idle", { mode: "interactive", aborted: false }));
    },
  });
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.observation.supportedTurnIds, []);
  const verified = verifyProtocolEvidence(control.state.records, plan());
  assert.equal(verified.counts.observedRequests, 1);
  assert.equal(verified.observation.completeRootRequests[0].scopeStartEventId, "reporting-turn");
});

test("replay of the same schema event is deduplicated rather than counted as a second dispatch", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const row = control.state.records.find(row => row.kind === "raw-event" && row.ref.path === "schema-events.jsonl");
  const replay = structuredClone(row);
  replay.ref.byteOffset += row.ref.byteLength;
  control.state.records.splice(control.state.records.indexOf(row) + 1, 0, replay);
  let verified;
  assert.doesNotThrow(() => { verified = verifyProtocolEvidence(control.state.records, plan()); });
  assert.equal(verified.counts.schemaAcceptedHandlers, 1);
  assert.equal(verified.files.get("schema-events.jsonl").length, row.ref.byteLength * 2);
});

test("conflicting schema bytes under the same event identity cannot pass a complete control", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const row = control.state.records.find(row => row.kind === "raw-event" && row.ref.path === "schema-events.jsonl");
  const replay = structuredClone(row);
  const value = JSON.parse(Buffer.from(row.base64, "base64"));
  value.decision = "rejected";
  const bytes = jsonBytes(value);
  replay.base64 = bytes.toString("base64");
  replay.ref.byteOffset += row.ref.byteLength;
  replay.ref.byteLength = bytes.length;
  replay.ref.sha256 = sha256(bytes);
  control.state.records.splice(control.state.records.indexOf(row) + 1, 0, replay);
  assert.throws(() => verifyProtocolEvidence(control.state.records, plan()), { code: "NATIVE_SCHEMA_EVENT_CONFLICT" });
});
