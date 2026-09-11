import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prepareNativeSubjectTurn, observeSubjectActivation, observeSubjectCompletion } from "../native-subject.mjs";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { engine, plan } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";
import { jsonBytes, sha256 } from "../core.mjs";

let sequence = 0;
function fixture() {
  const root = workRoot(`subject-boundaries-${++sequence}`);
  const actorRoot = path.join(root, "actor");
  const canonicalRoot = path.join(root, "canonical");
  const pluginRoot = path.join(root, "plugin");
  for (const directory of [actorRoot, canonicalRoot, pluginRoot, path.join(canonicalRoot, "desks", "operator")]) fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(actorRoot, "source.mjs"), "export const visible = true;\n");
  const bytes = Buffer.from("Actual installed worker instructions.\n");
  fs.writeFileSync(path.join(pluginRoot, "worker.md"), bytes);
  const spec = { schemaVersion: 1, caseId: "discussion-then-go", turnIndex: 0, sessionId: "actual-session", resume: false, actorRoot, canonicalRoot, person: "operator", taskRef: null, agent: "fixture:worker", pluginDirectories: [pluginRoot], mcpServers: {}, sourceSeals: [{ root: pluginRoot, files: [{ path: "worker.md", sha256: sha256(bytes) }] }] };
  const live = { servers: [{ name: "desk", status: "connected" }], host: { mcp3pEnabled: true, clients: ["desk"], pendingConnections: [], failedServers: {}, needsAuthServers: {}, disabledServers: [], filteredServers: [] } };
  const agent = { agent: { id: spec.agent, path: path.join(pluginRoot, "worker.md") } };
  const session = { rpc: { agent: { getCurrent: async () => agent }, mcp: { list: async () => live } } };
  const metadata = { tools: [{ name: "bash" }, { name: "view" }] };
  return { root, spec, live, agent, session, metadata, prepare: () => prepareNativeSubjectTurn(spec) };
}

for (const [name, modify] of [
  ["traversing canonical person", spec => { spec.person = "../../../outside"; }],
  ["traversing session identity", spec => { spec.sessionId = "../outside"; }],
  ["null source row", spec => { spec.sourceSeals = [null]; }],
]) test(`subject input rejects ${name} through its own typed boundary`, () => {
  const f = fixture();
  modify(f.spec);
  assert.throws(f.prepare, { code: "INVALID_NATIVE_SUBJECT" });
});

test("native write permission uses the exact SDK fileName field", () => {
  const f = fixture();
  const permission = f.prepare().sessionOptions.onPermissionRequest;
  assert.deepEqual(permission({ kind: "write", fileName: path.join(f.spec.actorRoot, "new.mjs") }), { kind: "approve-once" });
});

test("a managed human-only approval cannot be granted by the subject controller", () => {
  const permission = fixture().prepare().sessionOptions.onPermissionRequest;
  assert.equal(permission({ kind: "shell", managedApprovalRequired: true }).kind, "reject");
});

test("unknown and MCP tools require the real permission context rather than bypassing it", () => {
  const preTool = fixture().prepare().sessionOptions.hooks.onPreToolUse;
  assert.equal(preTool({ toolName: "mcp__outside__write", toolArgs: {} }).permissionDecision, "ask");
});

test("live Desk admission cross-checks the native host's actual connected clients", async () => {
  const f = fixture();
  f.live.host.clients = [];
  await assert.rejects(observeSubjectActivation({ prepared: f.prepare(), session: f.session, metadata: f.metadata, phase: operation => operation() }), { code: "SUBJECT_DESK_UNAVAILABLE" });
});

test("raw native activation responses survive a wrong-agent refusal", async () => {
  const f = fixture();
  f.agent.agent.id = "other:agent";
  const observations = [];
  await assert.rejects(observeSubjectActivation({ prepared: f.prepare(), session: f.session, metadata: f.metadata, phase: operation => operation(), artifact: (name, value) => observations.push({ name, value }) }), { code: "SUBJECT_AGENT_UNOBSERVED" });
  assert.deepEqual(observations.map(row => row.name), ["subject-agent.json", "subject-mcps.json"]);
});

test("resumed subject effort/context is reconciled with actual persisted start and current usage", () => {
  const f = fixture();
  f.spec.resume = true;
  const start = { id: "start", type: "session.start", data: { sessionId: f.spec.sessionId, selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" } };
  const usage = { id: "usage", type: "assistant.usage", data: { model: "gpt-6-astra", reasoningEffort: "high", contentFilterTriggered: false } };
  const bytes = jsonBytes(usage);
  const history = [start];
  const result = observeSubjectCompletion({ prepared: f.prepare(), records: [{ sessionId: f.spec.sessionId, ref: { path: "sdk-events.jsonl", sha256: sha256(bytes), byteLength: bytes.length }, rawRecord: bytes }], history, sessionId: f.spec.sessionId, model: "gpt-6-astra", cleanup: { complete: true }, failure: null, endReason: "idle", skills: { skills: [] }, historyRef: { path: "history-response.json", sha256: sha256(jsonBytes(history)) } });
  assert.equal(result.status, "observed");
  assert.equal(result.effectiveConfiguration.verified, true);
  assert.equal(result.effectiveConfiguration.basis, "persisted_sdk_start_and_current_normalized_usage_not_raw_provider_http");
});

test("the actual controller archive includes its new static subject dependency and fixed dataset", async () => {
  const control = plan();
  let files;
  const driver = engine(control, { before: (command, args, options) => { if (command === "docker" && args[0] === "start") files = JSON.parse(options.input).files; } });
  await runRuntimeQualification({ plan: control, outputRoot: path.join(workRoot("subject-source-closure"), "run"), execute: driver.execute });
  assert.ok(files.some(file => file.path === "native-subject.mjs"));
  assert.ok(files.some(file => file.path === "cases/v2-alpha-v1/dataset.json"));
});

test("native built-in hooks confine reads and patches without making the discussion target read-only", () => {
  const f = fixture();
  f.spec.taskRef = "track/change/task.md";
  const prepared = f.prepare();
  assert.match(prepared.sessionOptions.systemMessage.content, /track\/change\/task.md/);
  const hook = (toolName, toolArgs) => prepared.sessionOptions.hooks.onPreToolUse({ toolName, toolArgs }).permissionDecision;
  assert.equal(hook("view", { path: path.join(f.spec.actorRoot, "source.mjs") }), "allow");
  assert.equal(hook("view", {}), "deny");
  assert.equal(hook("view", { path: "bad\0name" }), "deny");
  assert.equal(hook("view", { path: path.join(f.root, "outside") }), "deny");
  fs.symlinkSync(path.join(f.spec.actorRoot, "source.mjs"), path.join(f.spec.actorRoot, "alias"));
  assert.equal(hook("view", { path: path.join(f.spec.actorRoot, "alias") }), "deny");
  assert.equal(hook("rg", {}), "allow");
  assert.equal(hook("glob", { paths: f.spec.actorRoot }), "allow");
  assert.equal(hook("rg", { paths: [f.spec.actorRoot, f.spec.canonicalRoot] }), "allow");
  assert.equal(hook("glob", { paths: [f.spec.actorRoot, f.root] }), "deny");
  const patch = "*** Begin Patch\n*** Add File: new.mjs\n+export const value = 1;\n*** End Patch\n";
  assert.equal(hook("apply_patch", patch), "allow");
  assert.equal(hook("apply_patch", { input: patch }), "allow");
  assert.equal(hook("apply_patch", {}), "deny");
  assert.equal(hook("apply_patch", "not a patch"), "deny");
  assert.equal(hook("apply_patch", "*** Update File: ../outside"), "deny");
  assert.equal(hook("apply_patch", `*** Add File: ${f.spec.canonicalRoot}/desks/operator/task.md`), "allow");
  assert.equal(hook("apply_patch", `*** Add File: ${f.spec.canonicalRoot}/desks/someone-else/task.md`), "deny");
  assert.equal(hook("task", {}), "deny");
  assert.equal(hook("bash", { command: "node --test" }), "allow");
});

test("the native permission boundary distinguishes actual Desk, external, read and bypass requests", () => {
  const f = fixture();
  const permission = f.prepare().sessionOptions.onPermissionRequest;
  for (const request of [{ kind: "shell" }, { kind: "mcp", serverName: "desk" }, { kind: "read", path: path.join(f.spec.actorRoot, "source.mjs") }]) assert.equal(permission(request).kind, "approve-once");
  for (const request of [{ kind: "url" }, { kind: "mcp", serverName: "external" }, { kind: "read", path: f.root }, { kind: "write", fileName: f.root }, { kind: "shell", requestSandboxBypass: true }]) assert.equal(permission(request).kind, "reject");
});

test("empty native MCP failure maps and bounded terminal outcomes stay explicit", async () => {
  const f = fixture();
  const prepared = f.prepare();
  const observed = await observeSubjectActivation({ prepared, session: f.session, metadata: f.metadata, phase: operation => operation() });
  assert.equal(observed.agent.id, f.spec.agent);
  for (const endReason of ["timed_out", "cancelled"]) {
    const result = observeSubjectCompletion({ prepared, records: [], history: [], sessionId: f.spec.sessionId, model: "gpt-6-astra", cleanup: { complete: false }, failure: { code: "actual-bounded-stop" }, endReason, skills: null });
    assert.equal(result.status, endReason);
    assert.equal(result.effectiveConfiguration.verified, false);
  }
});

test("the pinned native host's required connection inventories cannot be omitted or malformed", async () => {
  for (const modify of [
    host => { delete host.failedServers; },
    host => { host.needsAuthServers = null; },
    host => { host.clients = "desk"; },
    host => { host.disabledServers = ["desk"]; },
    host => { host.filteredServers = ["desk"]; },
  ]) {
    const f = fixture();
    modify(f.live.host);
    await assert.rejects(observeSubjectActivation({ prepared: f.prepare(), session: f.session, metadata: f.metadata, phase: operation => operation() }), { code: "SUBJECT_DESK_UNAVAILABLE" });
  }
});

test("native shell work cannot silently detach from the bounded subject lifetime", () => {
  const f = fixture();
  assert.equal(f.prepare().sessionOptions.hooks.onPreToolUse({ toolName: "bash", toolArgs: { command: "node server.mjs", mode: "async", detach: true } }).permissionDecision, "deny");
});
