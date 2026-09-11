import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { fixture, validReport } from "./helpers/native-sdk.mjs";
import { engine, plan, response } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

async function filteredCapture(data) {
  const f = fixture({ send: async ({ configuration, emit, event }) => {
    emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" }));
    emit(event("turn", "assistant.turn_start", { turnId: "root" }));
    emit(event("filtered", "assistant.usage", { model: "gpt-6-astra", reasoningEffort: "high", ...data }));
    emit(event("message", "assistant.message", { content: "The model returned no content because the response was blocked by content filtering.", toolRequests: [] }));
    emit(event("idle", "session.idle", { mode: "interactive", aborted: false }));
  } });
  await runTerminalProtocol(f.input);
  return Buffer.from(f.state.records.map(row => JSON.stringify(row)).join("\n") + "\n");
}

for (const data of [{ contentFilterTriggered: true }, { contentFilterTriggered: false, finishReason: "content_filter" }]) test(`native content filtering is explicit unavailable, not a grade or unexplained protocol failure: ${JSON.stringify(data)}`, async () => {
  const value = plan();
  const raw = await filteredCapture(data);
  const fake = engine(value, { execution: response(raw, 1) });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot(`filter-${Object.keys(data).length}`), "output"), execute: fake.execute });
  assert.equal(result.status, "unavailable");
  assert.equal(result.exitCode, 3);
  assert.equal(result.grade, null);
  assert.equal(result.scored, false);
  assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
  assert.equal(result.modelAvailability.reason, "content_filter");
  assert.equal(result.modelAvailability.rawEventRefs.length, 1);
  assert.equal(result.modelAvailability.rawEventRefs[0].eventId, "filtered");
  assert.equal(fake.state.calls.filter(call => call.argv[0] === "start").length, 1);
  assert.equal(result.cleanup.removed, true);
});

test("a retained filtering observation does not replace an outer timeout", async () => {
  const value = plan();
  const raw = await filteredCapture({ contentFilterTriggered: true, finishReason: "content_filter" });
  const fake = engine(value, { execution: { ...response(raw, null), error: { code: "ETIMEDOUT" } } });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("filter-timeout"), "output"), execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.modelAvailability.reason, "content_filter");
  assert.equal(result.grade, null);
  assert.equal(result.counts.admittedGrades, 0);
});

for (const child of [false, true]) test(`a filtering observation is scoped to the root even when a delivered report follows: child=${child}`, async () => {
  const f = fixture({ send: async ({ configuration, emit, event }) => {
    emit(event("turn", "assistant.turn_start", { turnId: "root" }));
    emit({ ...event("filtered", "assistant.usage", { contentFilterTriggered: true }), ...(child ? { agentId: "child" } : {}) });
    emit(event("unknown-usage", "assistant.usage", null));
    const report = validReport();
    emit(event("request", "assistant.message", { turnId: "root", content: "", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: report }] }));
    await configuration.tools.find(tool => tool.name === "report_result").handler(report, { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result" });
    emit(event("complete", "tool.execution_complete", { toolCallId: "report", success: true }));
    emit(event("idle", "session.idle", { mode: "interactive", aborted: false }));
  } });
  await runTerminalProtocol(f.input);
  const value = plan();
  const raw = Buffer.from(f.state.records.map(row => JSON.stringify(row)).join("\n") + "\n");
  const fake = engine(value, { execution: response(raw) });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot(`filter-child-${child}`), "output"), execute: fake.execute });
  assert.equal(result.status, child ? "component_observed" : "unavailable");
  assert.equal(result.grade, null);
  assert.equal(result.counts.observedRequests, 1);
  assert.equal(result.counts.admittedGrades, 0);
});
