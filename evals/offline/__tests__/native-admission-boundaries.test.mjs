import assert from "node:assert/strict";
import test from "node:test";
import { isSuccessfulIdle, normalizeJudgeObservations, reconcileJudgeHistory } from "../admission.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { validReport } from "./helpers/native-sdk.mjs";

test("idle needs an explicit expected mode and rejects malformed or cancelled flags", () => {
  for (const data of [undefined, null, {}, [], { mode: "autopilot" }, { mode: "interactive", aborted: true }, { mode: "interactive", aborted: null }, { mode: "interactive", aborted: "false" }]) assert.equal(isSuccessfulIdle(data, "interactive"), false);
  for (const expected of [undefined, null, ""]) assert.equal(isSuccessfulIdle({ mode: expected }, expected), false);
  assert.equal(isSuccessfulIdle({ mode: "interactive" }, "interactive"), true);
  assert.equal(isSuccessfulIdle({ mode: "interactive", aborted: false }, "interactive"), true);
});

function observed(history) {
  let offset = 0;
  return normalizeJudgeObservations({
    sessionId: "native", rootAgentId: null, expectedMode: "interactive",
    events: history.map(event => {
      const rawRecord = jsonBytes(event);
      const value = { sessionId: "native", rawRecord, ref: { path: "events.jsonl", sessionId: "native", eventId: event.id, byteOffset: offset, byteLength: rawRecord.length, sha256: sha256(rawRecord) } };
      offset += rawRecord.length;
      return value;
    }),
  });
}
const event = (id, type, data) => ({ id, type, data });
const stream = () => [
  event("turn", "assistant.turn_start", { turnId: "turn" }),
  event("report", "assistant.message", { turnId: "turn", toolRequests: [{ name: "report_result", toolCallId: "report-call", arguments: validReport() }] }),
  { ...event("idle", "session.idle", { mode: "interactive" }), ephemeral: true },
];
test("ephemeral terminal handling does not erase missing, partial, unobserved or extra root attempts", () => {
  const live = stream();
  const observation = observed(live);
  const compare = history => reconcileJudgeHistory({ history, observed: observation, sessionId: "native", rootAgentId: null, expectedMode: "interactive" });
  assert.equal(compare(live.slice(0, -1)), true);
  assert.equal(compare(live.slice(0, 1)), false);
  assert.equal(compare(live.slice(1, -1)), false);
  assert.equal(compare([...live.slice(0, -1), event("partial", "assistant.tool_call_delta", { turnId: "turn", toolName: "report_result", toolCallId: "pending" })]), false);
  assert.equal(compare([...live.slice(0, -1), event("unobserved", "assistant.message", { turnId: "turn", toolRequests: [{ name: "report_result", toolCallId: "unobserved" }] })]), false);
  assert.equal(compare([...live.slice(0, -1), event("extra", "assistant.message", { turnId: "turn", toolRequests: [{ name: "report_result", toolCallId: "extra", arguments: validReport() }] })]), false);
  assert.equal(compare([...live.slice(0, -1), event("idle", "session.idle", { mode: "interactive", aborted: false })]), true);
  assert.equal(compare([...live.slice(0, -1), event("other-idle", "session.idle", { mode: "interactive", aborted: false })]), false);
});
