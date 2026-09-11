import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runTerminalProtocol } from "../native-protocol.mjs";
import dataset from "../cases/v2-alpha-v1/dataset.json" with { type: "json" };
import { fixture } from "./helpers/native-sdk.mjs";
import { workRoot } from "./helpers/paths.mjs";
import { jsonBytes, sha256 } from "../core.mjs";

let sequence = 0;
function configured(options = {}) {
  const root = workRoot(`native-subject-${++sequence}`);
  const actorRoot = path.join(root, "actor");
  const pluginRoot = path.join(root, "plugin");
  const canonicalRoot = path.join(root, "canonical");
  for (const directory of [actorRoot, pluginRoot, canonicalRoot]) fs.mkdirSync(directory, { recursive: true });
  const agentBytes = Buffer.from("---\nname: worker\n---\nUse the installed method and this workspace.\n");
  fs.writeFileSync(path.join(pluginRoot, "worker.md"), agentBytes);
  const sourceBytes = Buffer.from("export const source = true;\n");
  fs.writeFileSync(path.join(actorRoot, "source.mjs"), sourceBytes);
  const spec = {
    schemaVersion: 1, caseId: "discussion-then-go", turnIndex: 0, sessionId: `source-session-${sequence}`, resume: false,
    actorRoot, canonicalRoot, person: "operator", taskRef: null, agent: "fixture:worker",
    pluginDirectories: [pluginRoot], mcpServers: {},
    sourceSeals: [{ root: pluginRoot, files: [{ path: "worker.md", sha256: sha256(agentBytes) }] }],
  };
  const f = fixture({ send: async ({ configuration, emit, event, state }) => {
    emit(event("start", "session.start", { sessionId: configuration.sessionId, selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" }));
    emit(event("turn", "assistant.turn_start", { turnId: "subject-turn" }));
    emit(event("usage", "assistant.usage", { model: options.model ?? "gpt-6-astra", reasoningEffort: "high", contentFilterTriggered: false, finishReason: "stop" }));
    if (options.review) {
      const tool = configuration.tools.find(tool => tool.name === "request_review");
      state.reviewResult = await tool.handler({ sha: "a".repeat(40) }, { sessionId: configuration.sessionId, toolName: "request_review", toolCallId: "independent-review" });
    }
    emit(event("answer", "assistant.message", { turnId: "subject-turn", content: "The actual implementation treats zero as the default. I have not changed it.", toolRequests: [] }));
    emit({ ...event("idle", "session.idle", { mode: "interactive" }), ephemeral: true });
    return "current-prompt";
  } });
  const Original = f.input.sdk.CopilotClient;
  f.input.sdk.CopilotClient = class extends Original {
    async createSession(configuration) {
      const session = await super.createSession(configuration);
      session.rpc.agent = { getCurrent: async () => ({ agent: { id: options.agent ?? spec.agent, path: path.join(pluginRoot, "worker.md"), name: "worker" } }) };
      session.rpc.mcp = { list: async () => ({ servers: options.servers ?? [{ name: "desk", status: "connected" }], host: { mcp3pEnabled: true, clients: ["desk"], pendingConnections: [], failedServers: {}, needsAuthServers: {}, filteredServers: [], disabledServers: [] } }) };
      session.rpc.skills = { getInvoked: async () => ({ skills: [] }) };
      session.rpc.tools.getCurrentMetadata = async () => ({ tools: options.tools ?? [{ name: "bash" }, { name: "view" }, { name: "apply_patch" }, { name: "rg" }, { name: "glob" }, { name: "desk_task_create" }] });
      return session;
    }
    async resumeSession(sessionId, configuration) {
      f.state.resumed = sessionId;
      return this.createSession({ ...configuration, sessionId });
    }
  };
  return { ...f, spec, root, agentBytes };
}

test("the existing native loop consumes a file-based subject agent and fixed case prompt, not report-control prose", async () => {
  const f = configured();
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec });
  assert.equal(result.kind, "subject-turn-finished");
  assert.equal(result.status, "observed");
  assert.equal(result.grade, null);
  assert.equal(f.state.client.mode, "copilot-cli");
  assert.equal(f.state.client.workingDirectory, f.spec.actorRoot);
  assert.deepEqual(f.state.session.pluginDirectories, f.spec.pluginDirectories);
  assert.equal(f.state.session.agent, f.spec.agent);
  assert.equal(f.state.session.enableSkills, true);
  assert.equal(f.state.session.enableConfigDiscovery, false);
  assert.equal(f.state.session.skipCustomInstructions, false);
  assert.equal(f.state.session.coauthorEnabled, false);
  assert.equal(f.state.session.systemMessage.mode, "append");
  assert.doesNotMatch(f.state.session.systemMessage.content, /Use the installed method/);
  assert.equal(result.promptSha256, sha256(dataset.cases[0].turns[0].prompt));
  assert.equal(result.effectiveConfiguration.verified, true);
  assert.equal(result.activation.agent.id, f.spec.agent);
  assert.equal(result.activation.agentSource.sha256, sha256(f.agentBytes));
  assert.equal(f.state.session.tools.some(tool => tool.name === "report_result"), false);
  assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
});

test("a subsequent ordinary turn resumes the real SDK session instead of reconstructing conversation text", async () => {
  const f = configured();
  f.spec.resume = true;
  f.spec.turnIndex = 1;
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec });
  assert.equal(f.state.resumed, f.spec.sessionId);
  assert.equal(result.promptSha256, sha256(dataset.cases[0].turns[1].prompt));
});

for (const [name, options] of [
  ["wrong selected agent", { agent: "other:worker" }],
  ["no live Desk", { servers: [] }],
  ["duplicate live Desk", { servers: [{ name: "desk", status: "connected" }, { name: "desk", status: "connected" }] }],
  ["unrestricted subagents", { tools: [{ name: "bash" }, { name: "view" }, { name: "task" }] }],
]) test(`native subject refuses ${name} before dispatch`, async () => {
  const f = configured(options);
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec });
  assert.equal(result.status, "unavailable");
  assert.equal(f.state.events.some(event => event.type === "assistant.message"), false);
});

test("a model that changes from the frozen subject configuration remains unavailable", async () => {
  const f = configured({ model: "claude-opus-5" });
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec });
  assert.equal(result.status, "unavailable");
  assert.equal(result.effectiveConfiguration.verified, false);
});

test("the native subject uses its bound review callback with the requested source commit", async () => {
  const f = configured({ review: true });
  const calls = [];
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec, reviewHandler: async request => { calls.push(request); return { resultType: "failure", textResultForLlm: "The declared reviewer dependency is absent." }; } });
  assert.equal(result.status, "observed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sha, "a".repeat(40));
  assert.equal(calls[0].sessionId, f.spec.sessionId);
  assert.equal(f.state.reviewResult.resultType, "failure");
});

test("subject source identity is checked before an SDK client is created", async () => {
  const f = configured();
  fs.appendFileSync(path.join(f.spec.pluginDirectories[0], "worker.md"), "\nchanged");
  await assert.rejects(runTerminalProtocol({ ...f.input, subjectTurn: f.spec }), { code: "SUBJECT_SOURCE_CHANGED" });
  assert.equal(f.state.client, undefined);
});

test("the subject cannot replace a frozen case prompt or choose an undeclared case", async () => {
  for (const change of [spec => { spec.prompt = "override"; }, spec => { spec.caseId = "not-a-fixed-case"; }, spec => { spec.turnIndex = 99; }]) {
    const f = configured();
    change(f.spec);
    await assert.rejects(runTerminalProtocol({ ...f.input, subjectTurn: f.spec }), { code: "INVALID_NATIVE_SUBJECT" });
    assert.equal(f.state.client, undefined);
  }
});

test("the existing native subject seam provides actual session access before dispatch for canonical operations", async () => {
  const f = configured();
  const calls = [];
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec, subjectBeforeSend: async ({ session, sessionId, artifact, phase }) => {
    calls.push(sessionId);
    artifact("test-canonical-observation.json", await phase(() => session.rpc.mcp.list()));
    assert.equal(f.state.events.length, 0);
  } });
  assert.equal(result.status, "observed");
  assert.deepEqual(calls, [f.spec.sessionId]);
  assert.equal(f.state.records.filter(row => row.kind === "artifact" && row.ref.path === "test-canonical-observation.json").length, 1);
});

test("an installation changed during subject work cannot produce an admitted observation", async () => {
  const f = configured();
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec, subjectBeforeSend: () => {
    fs.appendFileSync(path.join(f.spec.pluginDirectories[0], "worker.md"), "\nchanged after activation");
  } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.failure.code, "SUBJECT_SOURCE_CHANGED");
});

for (const reason of ["timed_out", "cancelled"]) test(`subject source re-verification failure cannot replace ${reason}`, async () => {
  const f = configured();
  const controller = new AbortController();
  let now = 0;
  const result = await runTerminalProtocol({ ...f.input, subjectTurn: f.spec, signal: controller.signal, clock: () => now, subjectBeforeSend: () => {
    fs.appendFileSync(path.join(f.spec.pluginDirectories[0], "worker.md"), "\nchanged source at bounded stop");
    if (reason === "timed_out") now = 1001;
    else controller.abort();
  } });
  assert.equal(result.status, reason);
  assert.equal(result.grade, null);
  assert.equal(result.failure.code, reason === "timed_out" ? "NATIVE_DEADLINE" : "NATIVE_CANCELLED");
});
