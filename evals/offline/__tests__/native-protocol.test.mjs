import assert from "node:assert/strict";
import test from "node:test";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { fixture } from "./helpers/native-sdk.mjs";

test("the SDK loop keeps named auth in its explicit child environment and offers only the fixed tools", async () => {
  const { input, state } = fixture();
  await runTerminalProtocol(input);
  assert.ok(state.client, "The actual SDK constructor must be consumed.");
  assert.equal(state.client.env.COPILOT_GITHUB_TOKEN, input.token);
  assert.equal(state.client.gitHubToken, undefined);
  assert.equal(state.client.useLoggedInUser, false);
  assert.equal(state.client.mode, "empty");
  assert.ok(state.client.connection.args.includes("--secret-env-vars=COPILOT_GITHUB_TOKEN"));
  assert.deepEqual(state.session.availableTools, ["custom:read_evidence", "custom:report_result"]);
  assert.equal(state.session.tools.find(tool => tool.name === "report_result").isTerminal, true);
  assert.equal(state.session.reasoningEffort, "high");
  assert.equal(state.session.contextTier, "default");
  assert.equal(JSON.stringify(state.records).includes(input.token), false);
});

test("semantic failure completes the terminal tool successfully without admitting a product grade", async () => {
  const { input, state } = fixture();
  const result = await runTerminalProtocol(input);
  assert.equal(result.ok, true);
  assert.equal(state.returned.resultType, "success");
  assert.equal(result.grade, null);
  assert.deepEqual(result.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 });
  assert.equal(result.cleanup.complete, true);
  assert.equal(state.aborted, true);
  assert.ok(state.records.some(record => record.kind === "invocation-signal-aborted" && record.explicitRunCancellation === false));
});

test("observed failed RPC completion cannot be converted into a successful protocol control", async () => {
  const { input, state } = fixture({ executionSuccess: false });
  const result = await runTerminalProtocol(input);
  assert.equal(result.ok, false);
  assert.ok(state.returned, "The handler must execute before its unsuccessful delivery is assessed.");
  assert.equal(result.grade, null);
  assert.equal(result.counts.admittedGrades, 0);
  assert.equal(result.admissionStatus, "infrastructure_failure");
});

test("actual stop errors remain an unsuccessful cleanup rather than a clean component observation", async () => {
  const { input } = fixture({ stopErrors: [new Error("owned stop failed")] });
  const result = await runTerminalProtocol(input);
  assert.equal(result.ok, false);
  assert.ok(result.cleanup, "The owned cleanup result must be observed.");
  assert.equal(result.cleanup.complete, false);
  assert.match(JSON.stringify(result.cleanup.errors), /owned stop failed/);
});
