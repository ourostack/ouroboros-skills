import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadNativeInputs, requireNativeInputs, runFixedCase, runFixedController } from "../fixed-controller.mjs";
import { openRunOutput } from "../output.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { main } from "../cli.mjs";
import { controllerFixture } from "./helpers/controller-fixture.mjs";
import { validateRunSetInventory } from "../comparison.mjs";
import { heldOutChecks, requireTrustedChecker } from "../check-executor.mjs";

function outputFor(f) {
  const outputRoot = path.join(f.root, "case-output");
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: { runId: "unit-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 }, limits: f.plan.limits });
  return { output, outputRoot };
}
test("actual held-out capability refusal wins before acquisition, allocation calls or any model attempt", async () => {
  const f = await controllerFixture();
  let acquisition = 0;
  let allocation = 0;
  f.input.open = async () => { acquisition++; throw new Error("Must not acquire"); };
  f.nativeInputs.assertAllocation = async () => { allocation++; };
  const synthetic = heldOutChecks.assertAvailable;
  heldOutChecks.assertAvailable = requireTrustedChecker;
  try {
    await assert.rejects(runFixedController({ prepared: f.prepared, nativeInputs: f.nativeInputs }), { code: "NATIVE_QUALIFICATION_REQUIRED" });
    await assert.rejects(runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, ...outputFor(f) }), { code: "NATIVE_QUALIFICATION_REQUIRED" });
    await assert.rejects(main(["run", "--plan", path.join(f.inputRoot, "plan.json"), "--output", path.join(f.root, "checker-hold")], undefined, f.nativeInputs), error => error.code === "NATIVE_QUALIFICATION_REQUIRED" && error.exitCode === 3 && error.artifacts === path.join(f.root, "checker-hold"));
  } finally { heldOutChecks.assertAvailable = synthetic; }
  assert.equal(acquisition, 0);
  assert.equal(allocation, 0);
  assert.equal(f.prepared.runSet.attempts.length, 0);
  assert.equal(f.prepared.runSet.unstartedCellIds.length, 12);
});
test("unmapped native acquisition, canonical, permission, review and admission functions refuse all cells before launch", async () => {
  const f = await controllerFixture();
  requireNativeInputs(f.prepared, f.nativeInputs);
  for (const name of ["assertAllocation", "assertSourceAndRuntime"]) assert.throws(() => requireNativeInputs(f.prepared, { ...f.nativeInputs, [name]: null }), { code: "NATIVE_QUALIFICATION_REQUIRED" });
  for (const name of ["open", "assertConfinement", "readCanonical", "withPermission", "createDeskCallbacks", "subjectBeforeSend", "reviewHandler"]) {
    const bad = { ...f.input, [name]: undefined };
    const cells = new Map(f.nativeInputs.cells);
    cells.set(f.cell.id, bad);
    assert.throws(() => requireNativeInputs(f.prepared, { ...f.nativeInputs, cells }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  }
  assert.throws(() => requireNativeInputs(f.prepared, { ...f.nativeInputs, cells: new Map() }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  f.nativeInputs.assertAllocation = async () => { throw new Error("No actual allocation"); };
  await assert.rejects(runFixedController({ prepared: f.prepared, nativeInputs: f.nativeInputs }), /No actual allocation/);
  assert.equal(f.actorInput.state.session, undefined);
  assert.equal(f.prepared.runSet.attempts.length, 0);
  f.nativeInputs.assertAllocation = async ({ expected }) => { expected.cells[0].subject.model = "other"; };
  await assert.rejects(runFixedController({ prepared: f.prepared, nativeInputs: f.nativeInputs }), TypeError);
  assert.equal(f.prepared.runSet.attempts.length, 0);
});
test("the executable input module must be a raw-byte member of the existing frozen tooling manifest", async () => {
  const f = await controllerFixture();
  const filename = path.join(f.inputRoot, "native.mjs");
  fs.writeFileSync(filename, "export const nativeInputs = {marker: 'source-control-only'};\n");
  const inventory = jsonBytes({ schemaVersion: 1, files: [{ path: "native.mjs", sha256: sha256(fs.readFileSync(filename)) }] });
  fs.writeFileSync(path.join(f.inputRoot, "tooling-source-manifest.json"), inventory);
  f.prepared.plan.toolingSourceManifestSha256 = sha256(inventory);
  assert.equal((await loadNativeInputs({ filename, prepared: f.prepared, inputRoot: f.inputRoot })).marker, "source-control-only");
  fs.appendFileSync(filename, "// changed\n");
  await assert.rejects(loadNativeInputs({ filename, prepared: f.prepared, inputRoot: f.inputRoot }), { code: "NATIVE_INPUT_SOURCE_UNBOUND" });
});
test("the controller runs the maintained checker and native grader protocol through synthetic test-only transports", async () => {
  const f = await controllerFixture("checker-is-enforced", { send: ({ roles }) => {
    const file = path.join(roles.actor, "package.json");
    const value = JSON.parse(fs.readFileSync(file));
    value.scripts.ci = "npm run test && npm run check";
    fs.writeFileSync(file, JSON.stringify(value));
  } });
  const result = await runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, ...outputFor(f) });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.counts.admittedGrades, 1);
  assert.equal(f.closes, 1);
  assert.equal(result.checks.length, 3);
});
for (const caseId of ["discussion-then-go", "packed-deliverable", "review-recovery-state", "capability-probe-authority"]) test(`fixed ${caseId} runs all declared turns and retains unresolved producer evidence as unavailable`, async () => {
  const f = await controllerFixture(caseId);
  const result = await runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, ...outputFor(f) });
  const observedFailure = ["capability-probe-authority", "discussion-then-go"].includes(caseId);
  assert.equal(result.status, observedFailure ? "product_failure" : "unavailable");
  if (!observedFailure) assert.equal(result.grade, null);
  assert.equal(f.closes, 1);
  if (caseId === "review-recovery-state") assert.equal(result.checkpoints.length, 3);
});
test("a native startup failure is retained without running held-out commands or rescuing a grade", async () => {
  const f = await controllerFixture("checker-is-enforced", { beforeSend: () => { throw new Error("actual native callback absent"); } });
  const result = await runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, ...outputFor(f) });
  assert.equal(result.status, "unavailable");
  assert.equal(result.checkpoints.length, 1);
  assert.equal(f.closes, 1);
});
test("fixture and ownership failures cannot silently leave native acquisition alive", async () => {
  const missing = await controllerFixture();
  missing.plan.gitSeeds = [];
  await assert.rejects(runFixedCase({ cell: missing.cell, plan: missing.plan, input: missing.input, ...outputFor(missing) }), { code: "NATIVE_SEED_UNMAPPED" });
  const mismatch = await controllerFixture();
  mismatch.plan.gitSeeds[0].baseCommit = "a".repeat(40);
  await assert.rejects(runFixedCase({ cell: mismatch.cell, plan: mismatch.plan, input: mismatch.input, ...outputFor(mismatch) }), { code: "NATIVE_SEED_MISMATCH" });
  const noClose = await controllerFixture();
  delete noClose.opened.close;
  await assert.rejects(runFixedCase({ cell: noClose.cell, plan: noClose.plan, input: noClose.input, ...outputFor(noClose) }), { code: "NATIVE_CALLBACK_UNMAPPED" });
  const fail = await controllerFixture("checker-is-enforced", { confinement: () => { throw new Error("No OS confinement"); }, close: () => { throw new Error("Close failed"); } });
  await assert.rejects(runFixedCase({ cell: fail.cell, plan: fail.plan, input: fail.input, ...outputFor(fail) }), error => error instanceof AggregateError && error.errors.length === 2);
  const cleanup = await controllerFixture("checker-is-enforced", { close: () => { throw new Error("Close failed"); } });
  await assert.rejects(runFixedCase({ cell: cleanup.cell, plan: cleanup.plan, input: cleanup.input, ...outputFor(cleanup) }), error => error instanceof AggregateError && error.errors.length === 1);
});
test("controller CLI publishes and inventories a real source-bound hold with no retry or hidden missing cells", async () => {
  const f = await controllerFixture();
  let output = "";
  const io = { stdout: { write: text => { output += text; } } };
  const result = await main(["run", "--plan", path.join(f.inputRoot, "plan.json"), "--output", path.join(f.root, "cli-run")], io, f.nativeInputs);
  assert.equal(result, 3);
  assert.equal(JSON.parse(output).attempts, 1);
  const root = path.join(f.root, "cli-run");
  const runSet = JSON.parse(fs.readFileSync(path.join(root, "run-set.json")));
  const journalRecords = fs.readFileSync(path.join(root, "attempt-journal.jsonl"), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
  const inventory = validateRunSetInventory({ runSet, expectedCells: f.expected, journalRecords, readArtifact: name => fs.readFileSync(path.join(root, name)) });
  assert.equal(inventory.inventoryComplete, false);
  assert.equal(runSet.unstartedCellIds.length, 11);
  assert.equal(runSet.attempts[0].status, "unavailable");
});
