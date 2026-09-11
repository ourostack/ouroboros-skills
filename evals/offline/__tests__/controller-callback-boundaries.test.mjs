import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCanonicalController, createReviewHandler, nativeValue, observeReviewerEvents, runPrivateOperations } from "../controller-callbacks.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { workRoot } from "./helpers/paths.mjs";
import { privateFixture, refusal, success } from "./helpers/private-callbacks.mjs";

const root = workRoot("controller-boundaries");
let sequence = 0;
function directory() { const value = path.join(root, String(++sequence)); fs.mkdirSync(value); return value; }
test("native value decoding never turns errors or malformed text into successful objects", () => {
  for (const result of [undefined, refusal]) assert.throws(() => nativeValue(result), { code: "NATIVE_OPERATION_FAILED" });
  assert.throws(() => nativeValue({ resultType: "success", textResultForLlm: "not-json" }), SyntaxError);
});
test("private source controls bind actual returned IDs to protected bytes and restore the original disabled state", async () => {
  const f = privateFixture(directory(), undefined, false);
  const result = await runPrivateOperations(f.options);
  assert.equal(result.boundToDestination, true);
  assert.equal(result.protectedStore, true);
  assert.equal(result.noGitPayload, true);
  assert.equal(result.observations["protected-own-work"].visibility, "operator-private-only");
  assert.equal(result.observations["protected-own-work"].producerBindingAdmitted, false);
  assert.equal(f.state.recording, false);
  assert.equal(f.state.items.size, 0);
});
test("missing private context, an existing arbitrary path and unknown initial recording state refuse before capture", async () => {
  const f = privateFixture(directory());
  await assert.rejects(runPrivateOperations({ ...f.options, privateRoot: undefined }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  fs.mkdirSync(f.options.arbitraryStore);
  await assert.rejects(runPrivateOperations(f.options), { code: "PRIVATE_CONTROL_PATH_EXISTS" });
  const bad = privateFixture(directory(), ({ input }) => input.action === "report" ? success({}) : undefined);
  await assert.rejects(runPrivateOperations(bad.options), { code: "PRIVATE_STATE_UNOBSERVED" });
});
for (const [label, fault, code] of [
  ["missing returned identity", ({ input }) => input.action === "intake" ? success({}) : undefined, "PRIVATE_ID_UNOBSERVED"],
  ["unexpected success on negative", ({ input }) => input.person ? success({}) : undefined, "PRIVATE_ROUTE_UNEXPECTED_RESULT"],
  ["incorrect corrected value", ({ input, result }) => input.action === "inspect" && result.resultType === "success" && JSON.parse(result.textResultForLlm).work_item.revision > 1 ? success({ work_item: { request: "wrong" } }) : undefined, "PRIVATE_READBACK_MISMATCH"],
  ["partial negative mutation", ({ input, store }) => { if (input.person) fs.appendFileSync(store, "changed"); }, "PRIVATE_PARTIAL_MUTATION"],
  ["unexpected store creation", ({ input, canonical }) => { if (input.state_dir) fs.mkdirSync(input.state_dir); }, "PRIVATE_PARTIAL_MUTATION"],
  ["unrelated record changed", ({ input, state }) => { if (input.action === "delete" && input.work_item_id.endsWith("-1")) state.items.get("synthetic-item-2").request = "changed unrelated"; }, "PRIVATE_PARTIAL_MUTATION"],
]) test(`private failure retains ${label} and restores the switch`, async () => {
  const f = privateFixture(directory(), fault);
  await assert.rejects(runPrivateOperations(f.options), { code });
  assert.equal(f.state.recording, true);
});
test("disabled legacy mutation, legacy failure and independent cleanup errors are not swallowed", async () => {
  const f = privateFixture(directory());
  const legacy = f.options.legacy;
  f.options.legacy = async () => { fs.appendFileSync(path.join(f.options.privateRoot, "records.json"), "changed"); return legacy(); };
  await assert.rejects(runPrivateOperations(f.options), { code: "PRIVATE_DISABLED_MUTATION" });
  const bad = privateFixture(directory());
  await assert.rejects(runPrivateOperations({ ...bad.options, legacy: async () => refusal }), { code: "NATIVE_OPERATION_FAILED" });
  for (const failOriginal of [false, true]) {
    const failing = privateFixture(directory(), ({ input }) => {
      if (input.action === "delete" && input.work_item_id.endsWith("-2")) throw new Error("Owned deletion failed");
      if (failOriginal && input.person) throw new Error("Original failure");
    });
    await assert.rejects(runPrivateOperations(failing.options), error => error instanceof AggregateError && error.errors.length === (failOriginal ? 2 : 1));
  }
  const restore = privateFixture(directory(), ({ input, state }) => { if (input.action === "set_recording" && state.calls.filter(call => call.action === "set_recording").length === 3) throw new Error("Restore failed"); });
  await assert.rejects(runPrivateOperations(restore.options), AggregateError);
});
test("OS protection or Git leakage does not get a private-only visibility label", async () => {
  for (const kind of ["uid", "mode", "file", "git", "task"]) {
    const f = privateFixture(directory(), ({ input, canonical, state, store }) => {
      if (input.action === "commit") {
        if (kind === "git") fs.writeFileSync(path.join(canonical, "leak"), input.work_item_id);
        if (kind === "file") fs.chmodSync(store, 0o644);
        if (kind === "task") state.items.get(input.work_item_id).commitment.task_ref.track = "different";
      }
    });
    if (kind === "uid") f.options.privateUid++;
    if (kind === "mode") fs.chmodSync(f.options.privateRoot, 0o755);
    const result = await runPrivateOperations(f.options);
    assert.equal(result.observations["protected-own-work"].visibility, "unavailable");
  }
});
test("canonical controllers refuse missing readback, nonbytes, changed history and fake review failure", async () => {
  const f = privateFixture(directory());
  const input = { callbacks: f.callbacks, task: f.options.taskRef, scenario: { outcome: "test", initialAuthority: "review", deliveryEndpoint: "local", laterScopeRevision: "more" }, retain: f.options.retain, readCanonical: async () => Buffer.from("one") };
  assert.throws(() => createCanonicalController({ ...input, readCanonical: null }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  await assert.rejects(createCanonicalController({ ...input, readCanonical: async () => "not raw" }).seed(), { code: "CANONICAL_READBACK_UNAVAILABLE" });
  const c = createCanonicalController(input);
  await assert.rejects(c.reviewFailure(success({})), { code: "CANONICAL_REVIEW_NOT_FAILURE" });
  await assert.rejects(c.restart("old", "new"), { code: "CANONICAL_HISTORY_CHANGED" });
  let bytes = "one";
  const changed = createCanonicalController({ ...input, readCanonical: async () => Buffer.from(bytes) });
  await changed.seed();
  bytes = "different";
  await assert.rejects(changed.restart("old", "new"), { code: "CANONICAL_HISTORY_CHANGED" });
  assert.deepEqual(await changed.checkpoint(), Buffer.from(bytes));
});

function reviewFixture(options = {}) {
  const parentDir = directory();
  const binary = path.join(parentDir, "source-reviewer");
  fs.writeFileSync(binary, "Synthetic binary bytes; never executed.\n");
  const retained = [];
  const calls = [];
  const reviewer = {
    prepareReviewTarget: ({ parentDir, sha }) => {
      const target = path.join(parentDir, "checkout");
      fs.mkdirSync(target);
      if (options.config) fs.writeFileSync(path.join(target, ".roborev.toml"), "backup_agent='other'");
      return { checkout: { path: target, sha }, argv: ["review", "--agent", options.backend ?? "copilot"] };
    },
    materializeScopedEntry: input => ({ dir: input.dir }),
    materializeReviewerEnv: () => ({}),
    buildContainedEnv: () => ({}),
    assertCopilotOnlyEffective: value => ({ ok: value.effectiveAgent === "copilot" }),
    spawnReviewChild: input => {
      calls.push(input);
      return { run: () => {}, killTree: () => {}, sweep: () => {}, refused: [], output: () => Buffer.from("Synthetic findings."), errorOutput: () => Buffer.alloc(0), drainedFully: options.drained !== false };
    },
    runBounded: async input => {
      input.refused();
      if (options.failure) throw options.failure;
      if (!fs.existsSync(calls.at(-1).command)) throw Object.assign(new Error("Real absent scoped path"), { code: "ENOENT" });
      return { admitted: true, timedOut: false, survived: [], unverified: [], result: { code: 0, signal: null }, ...options.execution };
    },
    admitReview: () => options.findings ? { admitted: false, reason: "findings", findings: [{ text: "Actual synthetic finding" }] } : { admitted: true, findings: [] },
  };
  const runtime = { roborevBin: binary, copilotEntry: "/opt/native/index.js", node: process.execPath, path: "/usr/bin:/bin", sourceSha: "a".repeat(40), binaryReceipt: { sourceSha: "a".repeat(40), binarySha256: sha256(fs.readFileSync(binary)) }, spawnFn: () => { throw new Error("No native OS role is launched by this source fixture"); }, psFn: () => [] };
  const args = {
    reviewer, runtimePolicy: { resolveRuntime: value => value, assertReviewerIdentity: (claim, receipt) => ({ ok: claim.binarySha256 === receipt.binarySha256 }) },
    runtime, handoff: { reviewer: {} }, parentDir, model: "gpt-6-astra", deadlineMs: 1000, stopped: async () => async () => {}, assertConfinement: async () => {},
    retain: (name, value) => { retained.push({ name, value }); return { path: name, sha256: sha256(jsonBytes(value)) }; },
    observeRun: async () => ({ authObserved: true, agent: "copilot", reviewerSessionId: "synthetic-reviewer" }),
  };
  const request = { sha: "b".repeat(40), sessionId: "subject", toolCallId: "review-call", actorRoot: parentDir };
  return { args, request, calls, retained, parentDir };
}
test("review control really uses an absent scoped executable, then restores the same pinned path", async () => {
  const f = reviewFixture();
  const handler = createReviewHandler(f.args);
  const absent = await handler({ ...f.request, dependencyAvailable: false });
  assert.equal(JSON.parse(absent.textResultForLlm).dependencyFailureObserved, true);
  assert.equal(absent.resultType, "failure");
  const restored = await handler(f.request);
  assert.equal(restored.resultType, "success");
  assert.equal(f.calls[0].command, f.calls[1].command);
  assert.equal(f.calls[1].spawnFn, f.args.runtime.spawnFn);
  assert.equal(f.calls[1].psFn, f.args.runtime.psFn);
  await handler(f.request);
  await assert.rejects(handler({ ...f.request, dependencyAvailable: false }), { code: "REVIEW_DEPENDENCY_CONTROL_REUSED" });
  fs.chmodSync(f.calls.at(-1).command, 0o700);
  fs.appendFileSync(f.calls.at(-1).command, "changed");
  await assert.rejects(handler(f.request), { code: "REVIEW_BINARY_CHANGED" });
});
test("all reviewer policy exports, initial handoff and the measured binary receipt are mandatory", () => {
  const f = reviewFixture();
  for (const key of Object.keys(f.args.reviewer)) assert.throws(() => createReviewHandler({ ...f.args, reviewer: { ...f.args.reviewer, [key]: undefined } }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  for (const key of ["handoff", "stopped", "assertConfinement", "retain", "runtimePolicy"]) assert.throws(() => createReviewHandler({ ...f.args, [key]: undefined }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  for (const key of ["spawnFn", "psFn"]) assert.throws(() => createReviewHandler({ ...f.args, runtime: { ...f.args.runtime, [key]: undefined } }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  f.args.runtime.binaryReceipt.binarySha256 = "0".repeat(64);
  assert.throws(() => createReviewHandler(f.args), { code: "REVIEW_BINARY_UNBOUND" });
});
for (const options of [
  { failure: new Error("Observed execution rejection") }, { drained: false }, { execution: { admitted: false } },
  { execution: { cleanupError: "failed" } }, { execution: { timedOut: true } }, { execution: { survived: [1] } },
  { execution: { unverified: [1] } }, { execution: { result: { code: 1, signal: null } } }, { execution: { result: { code: 0, signal: "SIGTERM" } } },
  { config: true }, { backend: "other" },
]) test(`review refuses real failure evidence ${JSON.stringify(options)}`, async () => {
  const f = reviewFixture(options);
  await assert.rejects(createReviewHandler(f.args)(f.request));
  if (!options.config && !options.backend) assert.ok(f.retained.length > 0);
});
test("substantive review findings go back to the sole builder instead of becoming clean approval", async () => {
  const f = reviewFixture({ findings: true });
  const result = await createReviewHandler(f.args)(f.request);
  assert.equal(result.resultType, "failure");
  assert.equal(JSON.parse(result.textResultForLlm).findings.length, 1);
});
test("credential-bearing captures and absent OS confinement fail before evidence or review admission", async () => {
  for (const credential of ["", "synthetic-secret"]) {
    const f = reviewFixture();
    f.args.reviewer.buildContainedEnv = () => ({ COPILOT_GITHUB_TOKEN: credential });
    assert.equal((await createReviewHandler(f.args)(f.request)).resultType, "success");
  }
  const leaking = reviewFixture({ failure: new Error("synthetic-secret") });
  leaking.args.reviewer.buildContainedEnv = () => ({ COPILOT_GITHUB_TOKEN: "synthetic-secret" });
  await assert.rejects(createReviewHandler(leaking.args)(leaking.request), { code: "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD" });
  assert.equal(leaking.retained.length, 0);
  const unconfined = reviewFixture();
  unconfined.args.assertConfinement = async () => { throw new Error("No independent OS role"); };
  await assert.rejects(createReviewHandler(unconfined.args)(unconfined.request), /No independent OS role/);
  assert.equal(unconfined.calls.length, 0);
});
test("the reviewer releases the genuine writer hold on success and preserves both execution and release failures", async () => {
  const missing = reviewFixture();
  missing.args.stopped = async () => undefined;
  await assert.rejects(createReviewHandler(missing.args)(missing.request), { code: "REVIEW_WRITER_HOLD_UNMAPPED" });
  assert.equal(missing.calls.length, 0);
  for (const failure of [undefined, new Error("execution failure")]) {
    const f = reviewFixture({ failure });
    f.args.stopped = async () => async () => { throw new Error("release failure"); };
    await assert.rejects(createReviewHandler(f.args)(f.request), error => error instanceof AggregateError && error.errors.length === (failure ? 2 : 1));
  }
});
function reviewerEvents(root, events, id = "session") {
  const directory = path.join(root, "home/.copilot/session-state", id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "events.jsonl"), events.map(value => JSON.stringify(value)).join("\n") + "\n");
}
const events = () => [
  { id: "start", type: "session.start", data: { sessionId: "reviewer", selectedModel: "gpt-6-astra", reasoningEffort: "high", contextTier: "default" } },
  { id: "usage", type: "assistant.usage", data: { model: "gpt-6-astra", reasoningEffort: "high", contentFilterTriggered: false, finishReason: "stop" } },
  { id: "reply", type: "assistant.message", data: { content: "A substantive response." } },
];
test("review authentication comes from actual retained native events, never possession of a token", async () => {
  const root = directory();
  reviewerEvents(root, events());
  reviewerEvents(root, [{ id: "probe", type: "probe" }], "probe");
  const value = observeReviewerEvents({ directory: root, model: "gpt-6-astra", retain: (path, value) => ({ path, sha256: sha256(jsonBytes(value)) }) });
  assert.equal(value.authObserved, true);
  assert.equal(value.reviewerSessionId, "reviewer");
  const f = reviewFixture();
  delete f.args.observeRun;
  const prepare = f.args.reviewer.prepareReviewTarget;
  f.args.reviewer.prepareReviewTarget = input => { const result = prepare(input); reviewerEvents(input.parentDir, events()); return result; };
  assert.equal((await createReviewHandler(f.args)(f.request)).resultType, "success");
  for (const bad of [events().slice(0, 1), [...events().slice(0, 2), { id: "reply", type: "assistant.message", agentId: "child", data: { content: "wrong root" } }], [...events().slice(0, 2), { id: "reply", type: "assistant.message", data: { content: " " } }]]) {
    const root = directory();
    reviewerEvents(root, bad);
    assert.throws(() => observeReviewerEvents({ directory: root, model: "gpt-6-astra", retain: () => ({}) }), { code: "REVIEW_AUTH_UNOBSERVED" });
  }
});
