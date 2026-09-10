import assert from "node:assert/strict";
import test from "node:test";
import { createProcessObserver, runTerminalProtocol } from "../native-protocol.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

test("an SDK rejection without an Error object remains a recorded failure with cleanup", async () => {
  for (const startError of [null, undefined]) {
    const control = fixture({ startError });
    let result;
    await assert.doesNotReject(async () => { result = await runTerminalProtocol(control.input); }, "Nullable SDK rejections must produce the structured failure envelope.");
    assert.equal(result.ok, false);
    assert.equal(result.grade, null);
    assert.ok(result.cleanup);
    assert.equal(result.failure.message, String(startError));
  }
});

test("a never-resolving SDK send remains inside the outer deadline and invokes owned cleanup", async () => {
  let now = 0, sendEntered = false;
  const control = fixture({ send: () => {
    sendEntered = true;
    now = 10;
    return new Promise(() => {});
  } });
  control.input.limits.startupSendWorkMs = 10;
  control.input.clock = () => now;
  const result = await runTerminalProtocol(control.input);
  assert.equal(sendEntered, true);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "NATIVE_DEADLINE");
  assert.equal(control.state.aborted, true);
  assert.equal(control.state.stopped, true);
});

test("native session errors and rejected event captures do not turn into control success", async () => {
  for (const invalidCapture of [false, true]) {
    const control = fixture({
      send: async ({ emit, event }) => {
        emit(invalidCapture ? event("bad", "assistant.message", { content: "synthetic-native-controller-entitlement-value" }) : event("error", "session.error", { message: "controlled runtime failure" }));
      },
    });
    const result = await runTerminalProtocol(control.input);
    assert.equal(result.ok, false);
    assert.equal(result.grade, null);
    if (invalidCapture) assert.equal(result.captureErrors.length, 1);
    assert.equal(JSON.stringify(control.state.records).includes(control.input.token), false);
  }
});

test("credential-bearing errors are withheld and failed unobserved cleanup remains explicit", async () => {
  const control = fixture({ startError: new Error("synthetic-native-controller-entitlement-value"), forceError: new Error("force cleanup failed") });
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, false);
  assert.equal(result.failure.message, "Credential-bearing error withheld.");
  assert.equal(result.cleanup.complete, false);
  assert.match(JSON.stringify(result.cleanup.errors), /force cleanup failed/);
  assert.equal(JSON.stringify(control.state.records).includes(control.input.token), false);
});

test("the default process reader is a Linux observation, not an invented PID result", () => {
  const observer = createProcessObserver();
  const row = observer.read(process.pid);
  assert.ok(row === null || row.pid === process.pid);
});

test("events after the work window remain visible as cleanup events instead of rewriting admission", async () => {
  const control = fixture();
  const Parent = control.input.sdk.CopilotClient;
  control.input.sdk.CopilotClient = class extends Parent {
    async stop() {
      control.state.session.onEvent({ id: "cleanup-only", type: "session.idle", parentId: null, timestamp: "2026-09-09T00:00:01Z", data: { mode: "interactive", aborted: true } });
      return super.stop();
    }
  };
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, true);
  assert.ok(control.state.records.some(record => record.kind === "post-window-sdk-event"));
});

test("the default emitter still emits credential-free records when no collector override is supplied", async t => {
  const control = fixture({ startError: new Error("controlled default-emitter failure") });
  delete control.input.emit;
  delete control.input.processObserver;
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  t.mock.method(process.stdout, "write", chunk => { chunks.push(String(chunk)); return true; });
  try {
    const result = await runTerminalProtocol(control.input);
    assert.equal(result.ok, false);
    assert.ok(chunks.some(chunk => chunk.includes('"probe-finished"')));
    assert.equal(chunks.join("").includes(control.input.token), false);
  } finally {
    process.stdout.write = original;
  }
});
