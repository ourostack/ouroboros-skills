import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { bytes, diskRunSet, methodFixture, planFixture } from "./helpers/run-set.mjs";
import { dataRoot, repository, workRoot } from "./helpers/paths.mjs";

const root = workRoot("cli-consumer");
const cli = path.join(repository, "scripts/skill-evals.cjs");
const preload = path.join(repository, "evals/offline/__tests__/helpers/deny-sdk-preload.mjs");
const run = args => spawnSync(process.execPath, ["--import", preload, cli, "offline", ...args], { cwd: repository, encoding: "utf8", timeout: 15000 });

test("the shipping CLI reports static help, typed invalid invocations and a truthful native hold", () => {
  assert.match(run(["help"]).stdout, /offline compare/);
  for (const args of [[], ["help", "extra"], ["validate"], ["validate", "--dataset", "x", "--dataset", "y"], ["validate", "--dataset", "--bad", "--fixtures", "x"], ["compare", "--left", "x"], ["run", "--plan", "x"]]) {
    const result = run(args);
    assert.equal(result.status, 4, result.stderr);
    assert.equal(JSON.parse(result.stderr).kind, "offline_error");
  }
  const filename = path.join(root, "plan.json");
  fs.writeFileSync(filename, bytes(planFixture()));
  const output = path.join(root, "must-not-exist");
  const held = run(["run", "--plan", filename, "--output", output]);
  assert.equal(held.status, 3, held.stderr);
  assert.equal(JSON.parse(held.stderr).status, "unavailable");
  assert.equal(JSON.parse(held.stderr).code, "NATIVE_QUALIFICATION_REQUIRED");
  assert.equal(fs.existsSync(output), false);
});

test("the actual CLI compares complete sealed inventories without calling them scored evaluations", () => {
  const left = diskRunSet(root, { id: "complete-left", withSeed: true });
  const right = diskRunSet(root, { id: "complete-right", status: "passed", withSeed: true });
  const result = run(["compare", "--left", left.filename, "--right", right.filename]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "compatible");
  assert.equal(output.scored, false);
  assert.equal(output.grade, null);
  assert.equal(output.left.cells[0].status, "product_failure");
  assert.equal(output.right.cells[0].status, "passed");
  assert.equal("winner" in output, false);
});

test("the actual CLI retains unpublished, pending and unstarted cells as not comparable", () => {
  const complete = diskRunSet(root, { id: "complete-control", deterministic: true });
  for (const options of [{ id: "unpublished", published: false, deterministic: true }, { id: "pending", closed: false, deterministic: true }, { id: "unstarted", started: false, deterministic: true }]) {
    const incomplete = diskRunSet(root, options);
    const result = run(["compare", "--left", complete.filename, "--right", incomplete.filename]);
    assert.equal(result.status, 2, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.right.inventoryComplete, false);
    assert.equal(output.right.cells.length, 1);
  }
});

test("method comparison consumes source, non-method and method raw-byte manifests", () => {
  const left = diskRunSet(root, { id: "method-left", dimension: "method", method: methodFixture("before") });
  const right = diskRunSet(root, { id: "method-right", dimension: "method", method: methodFixture("after") });
  const result = run(["compare", "--left", left.filename, "--right", right.filename]);
  assert.equal(result.status, 0, result.stderr);
  fs.unlinkSync(path.join(right.root, "source-manifest.json"));
  const missing = run(["compare", "--left", left.filename, "--right", right.filename]);
  assert.equal(missing.status, 2, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).compatibility.reason, "METHOD_SOURCE_PROOF_REQUIRED");
});

test("a complete run set cannot be compared to the same retained attempt again", () => {
  const fixture = diskRunSet(root, { id: "duplicate-input" });
  const result = run(["compare", "--left", fixture.filename, "--right", fixture.filename]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).compatibility.reason, "DUPLICATE_COMPARISON_INPUT");
});

test("a newly sealed plan cannot re-label a receipt produced against an older plan", () => {
  const left = diskRunSet(root, { id: "stale-plan-left" });
  const right = diskRunSet(root, { id: "stale-plan-right" });
  left.plan.candidate.sourceCommit = "c".repeat(40);
  left.runSet.plan = left.put("plan.json", left.plan);
  left.save();
  const result = run(["compare", "--left", left.filename, "--right", right.filename]);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(JSON.parse(result.stderr).code, "RECEIPT_PLAN_MISMATCH");
});

test("CLI input errors never bypass dataset and raw journal validation", () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(dataRoot, "dataset.json")));
  dataset.cases[0].fixture = "unbound-fixture";
  const filename = path.join(root, "bad-dataset.json");
  fs.writeFileSync(filename, bytes(dataset));
  assert.equal(run(["validate", "--dataset", filename, "--fixtures", path.join(dataRoot, "fixture-manifest.json")]).status, 4);
  const left = diskRunSet(root, { id: "bad-journal-left" });
  const right = diskRunSet(root, { id: "bad-journal-right" });
  fs.appendFileSync(path.join(left.root, "attempt-journal.jsonl"), "partial");
  assert.equal(run(["compare", "--left", left.filename, "--right", right.filename]).status, 4);
});
