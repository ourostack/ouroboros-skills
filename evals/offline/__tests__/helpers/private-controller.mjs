import fs from "node:fs";
import path from "node:path";
import { jsonBytes, sha256 } from "../../core.mjs";
import { controllerFixture } from "./controller-fixture.mjs";
import { privateFixture } from "./private-callbacks.mjs";

// Source-only callbacks and raw protocol records. None of these qualify a native producer.
export async function privateControllerFixture(options = {}) {
  const f = await controllerFixture("private-recording-boundaries", options);
  const controls = path.join(f.root, "private-controls");
  fs.mkdirSync(controls);
  const p = privateFixture(controls, options.fault);
  f.input.createDeskCallbacks = async () => p.callbacks;
  f.opened.privateOperations = p.options;
  f.opened.session = { synthetic: true };
  const close = f.opened.close;
  const runId = "source-private";
  const raw = new Map();
  const row = type => {
    const value = { type, runId, pid: 4242, spawnIdentity: runId, ...(type === "exit" ? { exited: true } : {}) };
    const bytes = jsonBytes(value);
    raw.set(`${type}.json`, bytes);
    return { pid: 4242, spawnIdentity: runId, rawRef: { path: `${type}.json`, sha256: sha256(bytes) }, ...(type === "exit" ? { exited: true } : {}) };
  };
  const stopped = { runId, receipt: { runId, completedWithinBudget: true, unverifiedPids: [], ownedSpawns: [row("spawn")], exitObservations: [row("exit")] }, readArtifact: name => raw.get(name) };
  f.opened.close = async () => { await close(); return stopped; };
  f.opened.legacy = async () => {
    fs.writeFileSync(path.join(f.input.roots.canonical, "task.md"), "Source-only canonical legacy write.\n");
    return p.options.legacy();
  };
  return Object.assign(f, { p, stopped });
}
