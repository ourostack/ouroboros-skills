import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createCanonicalController, requireCallbacks, runPrivateOperations } from "../controller-callbacks.mjs";
import { workRoot } from "./helpers/paths.mjs";

const root = workRoot("controller-callbacks");
let dirs = 0;
function privateOptions() {
  const directory = path.join(root, String(++dirs));
  fs.mkdirSync(directory, { mode: 0o700 });
  const canonical = path.join(directory, "canonical");
  const store = path.join(directory, "store");
  fs.mkdirSync(canonical, { mode: 0o700 });
  fs.mkdirSync(store, { mode: 0o700 });
  return {
    taskRef: { track: "track", slug: "task" }, request: "synthetic authorized controller work", requestedBy: "operator",
    operatorGo: { by: "operator", at: "2026-01-01T00:00:00Z" }, commitment: { outcome: "test", scope: "test", evidence: "test", delivery_endpoint: "local" },
    privateRoot: store, privateUid: process.getuid(), gitRoots: [canonical], arbitraryStore: path.join(directory, "not-a-store"),
  };
}

// These in-memory transports test controller ordering only. They are never native evidence.
const success = value => ({ resultType: "success", textResultForLlm: JSON.stringify(value) });
function callbacks() {
  const calls = [];
  const entries = new Map();
  let recording = true;
  let sequence = 0;
  const invoke = async input => {
    calls.push(input);
    if (["person", "state_dir", "namespace"].some(key => key in input) || (!recording && input.action === "intake")) return { resultType: "failure", error: "controlled refusal" };
    if (input.action === "set_recording") { recording = input.enabled; return success({ enabled: recording }); }
    if (input.action === "intake") {
      const work_item_id = `item-${++sequence}`;
      entries.set(work_item_id, { work_item_id, request: input.request, revision: 1 });
      return success({ work_item_id });
    }
    if (input.action === "inspect") {
      if (!entries.has(input.work_item_id)) return { resultType: "failure", error: "missing" };
      return success({ work_item: entries.get(input.work_item_id) });
    }
    if (input.action === "correct") { const item = entries.get(input.work_item_id); item.request = input.value; item.revision++; return success({ work_item: item }); }
    if (input.action === "delete") { entries.delete(input.work_item_id); return success({ status: "deleted" }); }
    if (input.action === "report") return success({ recording: { enabled: recording } });
    return success({ status: "ok" });
  };
  return {
    calls, entries,
    canonical: Object.fromEntries(["create", "update", "archive"].map(name => [name, async input => { calls.push({ name, ...input }); return success({ status: "ok" }); }])),
    private: { ledger: invoke, feedback: invoke },
  };
}

test("all concrete native Desk callbacks are required before any operation", () => {
  const good = callbacks();
  assert.equal(requireCallbacks(good), good);
  for (const group of ["canonical", "private"]) for (const name of Object.keys(good[group])) {
    const bad = callbacks();
    delete bad[group][name];
    assert.throws(() => requireCallbacks(bad), { code: "NATIVE_CALLBACK_UNMAPPED" });
    assert.equal(bad.calls.length, 0);
  }
  assert.throws(() => requireCallbacks(null), { code: "NATIVE_CALLBACK_UNMAPPED" });
});

test("private operations exercise the real call contract without manufacturing a passing verdict", async () => {
  const c = callbacks();
  const retained = [];
  const result = await runPrivateOperations({
    ...privateOptions(), callbacks: c,
    retain: (name, value) => { retained.push({ name, value }); return { path: name, sha256: "a".repeat(64) }; },
    legacy: async () => c.canonical.update({ track: "track", slug: "task", frontmatter: { status: "doing" } }),
  });
  assert.equal(result.grade, null);
  assert.equal(result.admitted, false);
  assert.ok(c.calls.some(input => input.action === "set_recording" && input.enabled === false));
  assert.ok(c.calls.some(input => input.action === "set_recording" && input.enabled === true));
  assert.ok(c.calls.some(input => input.action === "commit" && input.task_ref.track === "track"));
  assert.equal(c.entries.size, 0);
  assert.ok(retained.length > 10);
});

test("canonical restart retains the same native record instead of seeding a new identity", async () => {
  const c = callbacks();
  const readbacks = [];
  let state = "original history";
  const controller = createCanonicalController({
    callbacks: c, task: { track: "track", slug: "task" },
    scenario: { outcome: "discount items", initialAuthority: "review only", deliveryEndpoint: "local commit", laterScopeRevision: "empty order zero" },
    readCanonical: async () => Buffer.from(state),
    retain: (name, value) => { readbacks.push({ name, value }); return { path: name, sha256: "a".repeat(64) }; },
  });
  await controller.seed();
  await controller.reviewFailure({ resultType: "failure", error: "missing binary" });
  await controller.restart("old", "new");
  state += "\nnew scope";
  await controller.scope();
  assert.equal(c.calls.filter(input => input.name === "create").length, 1);
  assert.ok(c.calls.some(input => input.name === "update"));
  assert.ok(readbacks.length >= 3);
  await assert.rejects(controller.restart("same", "same"), { code: "CANONICAL_RESTART_NOT_FRESH" });
});
