import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { fixture, validReport } from "./helpers/native-sdk.mjs";

test("only an active root interactive non-aborted idle may finish the dispatched work", async () => {
  let workFinished;
  const finished = new Promise(resolve => { workFinished = resolve; });
  const control = fixture({
    send: async ({ configuration, emit, event }) => {
      emit(event("before-root", "session.idle", { mode: "interactive", aborted: false }));
      emit(event("turn", "assistant.turn_start", {}));
      emit(event("wrong-mode", "session.idle", { mode: "autopilot", aborted: false }));
      emit(event("aborted-idle", "session.idle", { mode: "interactive", aborted: true }));
      emit({ ...event("child-idle", "session.idle", { mode: "interactive", aborted: false }), agentId: "child" });
      emit({ ...event("child-error", "session.error", { message: "Child observation is not a root session error." }), agentId: "child" });
      setImmediate(async () => {
        emit(event("report", "assistant.message", { toolRequests: [{ toolCallId: "report", name: "report_result", arguments: validReport() }] }));
        await configuration.tools.find(tool => tool.name === "report_result").handler(validReport(), { sessionId: configuration.sessionId, toolCallId: "report", toolName: "report_result" });
        emit(event("execution", "tool.execution_complete", { toolCallId: "report", success: true }));
        emit(event("actual-idle", "session.idle", { mode: "interactive", aborted: false }));
        workFinished();
      });
    },
  });
  const Parent = control.input.sdk.CopilotClient;
  control.input.sdk.CopilotClient = class extends Parent {
    async createSession(configuration) {
      const session = await super.createSession(configuration);
      configuration.onEvent({ id: "startup-idle", type: "session.idle", parentId: null, data: { mode: "interactive", aborted: false } });
      return session;
    }
  };
  const result = await runTerminalProtocol(control.input);
  await finished;
  assert.equal(result.ok, true);
  assert.equal(result.observation.rootIdle.eventId, "actual-idle");
  assert.equal(result.counts.observedRequests, 1);
});
