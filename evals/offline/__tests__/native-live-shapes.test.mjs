import assert from "node:assert/strict";
import test from "node:test";
import { validateTerminalReport } from "../admission.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { criterion, fixture, validReport } from "./helpers/native-sdk.mjs";

function liveFixture({ absentAbort = false, ephemeral = false, historyIdle = true, historyAbort } = {}) {
  return fixture({ send: async ({ configuration, state, emit, event, session }) => {
    emit(event("turn", "assistant.turn_start", { turnId: "supported-turn" }));
    const report = validReport();
    emit(event("request", "assistant.message", { turnId: "supported-turn", content: "", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: report }] }));
    state.returned = await configuration.tools.find(tool => tool.name === "report_result").handler(report, { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result", arguments: report });
    emit(event("execution", "tool.execution_complete", { toolCallId: "report", success: true }));
    const idle = { ...event("idle", "session.idle", { mode: "interactive", ...(absentAbort ? {} : { aborted: false }) }), ephemeral };
    emit(idle);
    session.getEvents = async () => state.events.flatMap(value => value.type !== "session.idle" ? [value] : !historyIdle ? [] : [{ ...value, data: { ...value.data, ...(historyAbort === undefined ? {} : { aborted: historyAbort }) } }]);
    return "request";
  } });
}

test("the documented omitted aborted flag is ordinary idle, not a fabricated timeout", async () => {
  const value = liveFixture({ absentAbort: true });
  value.input.limits.startupSendWorkMs = 80;
  const result = await runTerminalProtocol(value.input);
  assert.equal(result.failure, null);
  assert.equal(result.ok, true);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.cleanup.complete, true);
});

test("the actual history may omit a live idle explicitly marked ephemeral without losing attempts", async () => {
  const value = liveFixture({ ephemeral: true, historyIdle: false });
  const result = await runTerminalProtocol(value.input);
  assert.equal(result.historicalMatches, true);
  assert.equal(result.ok, true);
  const history = value.state.records.find(record => record.kind === "artifact" && record.ref.path === "history-response.json");
  assert.equal(JSON.parse(Buffer.from(history.base64, "base64")).some(event => event.type === "session.idle"), false);
});

test("a missing durable terminal or contradictory historical abort still cannot reconcile", async () => {
  for (const configuration of [{ historyIdle: false }, { ephemeral: true, historyAbort: true }, { ephemeral: true, historyAbort: null }]) {
    const value = liveFixture(configuration);
    const result = await runTerminalProtocol(value.input);
    assert.equal(result.ok, false);
    assert.equal(result.historicalMatches, false);
  }
});

test("a listed file with a positive line number and grep-style colon still is an exact citation", () => {
  const report = validReport();
  report.criteria[0].evidence = "checks/proof.txt:1: The approved zero-value API returned 3 for input 0; the expected value is 0.";
  assert.equal(validateTerminalReport(report, { criteria: [criterion], evidenceIndex: { files: ["checks/proof.txt"] } }).ok, true);
  for (const evidence of ["checks/proof.txt:0: text", "checks/proof.txt:garbage", "checks/proof.txtx:1: text", "elsewhere/checks/proof.txt:1: text"]) {
    report.criteria[0].evidence = evidence;
    assert.equal(validateTerminalReport(report, { criteria: [criterion], evidenceIndex: { files: ["checks/proof.txt"] } }).ok, false);
  }
});
