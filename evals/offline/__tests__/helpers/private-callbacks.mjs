import fs from "node:fs";
import path from "node:path";
import { sha256, jsonBytes } from "../../core.mjs";

export const success = value => ({ resultType: "success", textResultForLlm: JSON.stringify(value) });
export const refusal = { resultType: "failure", error: "Synthetic test refusal", textResultForLlm: "Synthetic test refusal" };
export function privateFixture(root, fault = () => {}, initiallyEnabled = true) {
  const privateRoot = path.join(root, "store");
  const canonical = path.join(root, "canonical");
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(canonical, { mode: 0o700 });
  fs.writeFileSync(path.join(canonical, "task.md"), "Canonical synthetic task.\n");
  const state = { items: new Map(), recording: initiallyEnabled, calls: [], retained: new Map() };
  const store = path.join(privateRoot, "records.json");
  const save = () => fs.writeFileSync(store, JSON.stringify({ recording: state.recording, items: [...state.items] }), { mode: 0o600 });
  save();
  let sequence = 0;
  async function ledger(input) {
    state.calls.push(input);
    let result;
    if (["person", "namespace", "state_dir"].some(key => key in input) || !state.recording && input.action === "intake") result = refusal;
    else if (input.action === "report") result = success({ recording: { enabled: state.recording } });
    else if (input.action === "set_recording") { state.recording = input.enabled; save(); result = success({ recording: { enabled: state.recording } }); }
    else if (input.action === "intake") {
      const work_item_id = `synthetic-item-${++sequence}`;
      state.items.set(work_item_id, { work_item_id, revision: 1, request: input.request, commitment: null });
      save();
      result = success({ work_item_id });
    } else if (input.action === "inspect") result = state.items.has(input.work_item_id) ? success({ work_item: state.items.get(input.work_item_id) }) : refusal;
    else if (input.action === "commit") {
      state.items.get(input.work_item_id).commitment = { ...input, task_ref: { ...input.task_ref, path: "task.md" } };
      save();
      result = success({ status: "committed" });
    } else if (input.action === "correct") {
      const item = state.items.get(input.work_item_id);
      item.request = input.value;
      item.revision++;
      save();
      result = success({ work_item: item });
    } else if (input.action === "delete") { state.items.delete(input.work_item_id); save(); result = success({ status: "deleted" }); }
    else throw new Error("Unmapped synthetic action");
    return await fault({ input, result, state, store, canonical, privateRoot }) ?? result;
  }
  const callbacks = { canonical: { create: async () => success({}), update: async () => success({}), archive: async () => success({}) }, private: { ledger, feedback: async () => success({}) } };
  const options = {
    callbacks, taskRef: { track: "track", slug: "task" }, request: "Fixed synthetic own-work request.", requestedBy: "operator",
    operatorGo: { by: "operator", at: "2026-01-01T00:00:00Z" }, commitment: { outcome: "Synthetic", scope: "Synthetic", evidence: "Synthetic", delivery_endpoint: "local" },
    privateRoot, privateUid: process.getuid(), gitRoots: [canonical], arbitraryStore: path.join(root, "not-a-store"),
    retain: (name, value) => { const bytes = jsonBytes(value); state.retained.set(name, bytes); return { path: name, sha256: sha256(bytes) }; },
    legacy: async () => { fs.appendFileSync(path.join(canonical, "task.md"), "Actual synthetic legacy operation.\n"); return success({}); },
  };
  return { options, callbacks, state };
}
