import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../core.mjs";
import { bytes, expectedFixture, planFixture } from "./helpers/run-set.mjs";
import { dataRoot, repository, workRoot } from "./helpers/paths.mjs";

const root = workRoot("producer-cli");
const datasetBytes = fs.readFileSync(path.join(dataRoot, "dataset.json"));
const dataset = JSON.parse(datasetBytes);
const run = args => spawnSync(process.execPath, [path.join(repository, "scripts/skill-evals.cjs"), "offline", ...args], { encoding: "utf8", timeout: 15000 });

function input(name) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  const plan = planFixture(name);
  plan.dataset = { id: dataset.id, version: dataset.version, sha256: sha256(datasetBytes) };
  plan.fixtureManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "fixture-manifest.json")));
  plan.checkerManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "check-expectations.json")));
  const expected = { schemaVersion: 1, cells: dataset.cases.flatMap(definition => ["gpt-6-astra", "claude-opus-5"].map((model, index) => {
    const cell = expectedFixture(plan, definition.mode === "deterministic").cells[0];
    cell.id = `${definition.id}-${index + 1}`;
    cell.caseId = definition.id;
    if (cell.subject) { cell.subject.model = model; cell.judge.model = model; }
    else cell.repetition = index + 1;
    return cell;
  })) };
  fs.writeFileSync(path.join(directory, "expected-cells.json"), bytes(expected));
  plan.expectedCells = { path: "expected-cells.json", sha256: sha256(bytes(expected)) };
  fs.writeFileSync(path.join(directory, "plan.json"), bytes(plan));
  return { directory, plan, expected, planPath: path.join(directory, "plan.json"), output: path.join(root, `${name}-output`) };
}

test("the shipped alpha run preserves the frozen twelve-cell denominator before native prerequisites", () => {
  const fixture = input("missing-installation");
  const result = run(["run", "--plan", fixture.planPath, "--output", fixture.output]);
  assert.equal(result.status, 3, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.code, "NATIVE_QUALIFICATION_REQUIRED");
  assert.equal(error.artifacts, fixture.output);
  const runSet = JSON.parse(fs.readFileSync(path.join(fixture.output, "run-set.json")));
  assert.equal(runSet.state, "incomplete");
  assert.deepEqual(runSet.unstartedCellIds, fixture.expected.cells.map(cell => cell.id));
  assert.deepEqual(runSet.attempts, []);
  assert.deepEqual(fs.readFileSync(path.join(fixture.output, "plan.json")), bytes(fixture.plan));
  assert.deepEqual(fs.readFileSync(path.join(fixture.output, "expected-cells.json")), bytes(fixture.expected));
  assert.equal(fs.readFileSync(path.join(fixture.output, "attempt-journal.jsonl"), "utf8"), "");
  const pending = JSON.parse(fs.readFileSync(path.join(fixture.output, "producer-status.json")));
  assert.equal(pending.expectedCells, 12);
  assert.equal(pending.modelCallsStarted, 0);
  assert.equal(pending.grade, null);
  assert.equal(pending.scored, false);
  assert.equal(pending.status, "unavailable");
  const again = run(["run", "--plan", fixture.planPath, "--output", fixture.output]);
  assert.equal(again.status, 4, again.stderr);
  assert.equal(JSON.parse(again.stderr).code, "OUTPUT_ROOT_NOT_FRESH");
});

test("a partial alpha plan is rejected before output rather than reducing the denominator", () => {
  const fixture = input("partial-matrix");
  fixture.expected.cells.pop();
  fs.writeFileSync(path.join(fixture.directory, "expected-cells.json"), bytes(fixture.expected));
  fixture.plan.expectedCells.sha256 = sha256(bytes(fixture.expected));
  fs.writeFileSync(fixture.planPath, bytes(fixture.plan));
  const result = run(["run", "--plan", fixture.planPath, "--output", fixture.output]);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(JSON.parse(result.stderr).code, "INCOMPLETE_ALPHA_MATRIX");
  assert.equal(fs.existsSync(fixture.output), false);
});

test("a stale alpha fixture or checker control is rejected before native launch", () => {
  for (const field of ["fixtureManifestSha256", "checkerManifestSha256"]) {
    const fixture = input(`stale-${field}`);
    fixture.plan[field] = sha256("different frozen control");
    fs.writeFileSync(fixture.planPath, bytes(fixture.plan));
    const result = run(["run", "--plan", fixture.planPath, "--output", fixture.output]);
    assert.equal(result.status, 4, result.stderr);
    assert.equal(JSON.parse(result.stderr).code, "PRODUCER_CONTROL_MISMATCH");
    assert.equal(fs.existsSync(fixture.output), false);
  }
});

test("two pending alpha run sets compare with twelve missing cells on each side", () => {
  const left = input("pending-left");
  const right = input("pending-right");
  for (const fixture of [left, right]) assert.equal(run(["run", "--plan", fixture.planPath, "--output", fixture.output]).status, 3);
  const result = run(["compare", "--left", path.join(left.output, "run-set.json"), "--right", path.join(right.output, "run-set.json")]);
  assert.equal(result.status, 2, result.stderr);
  const comparison = JSON.parse(result.stdout);
  assert.equal(comparison.scored, false);
  assert.equal(comparison.left.cells.length, 12);
  assert.equal(comparison.right.cells.length, 12);
  assert.ok(comparison.left.cells.every(cell => cell.status === "unavailable"));
  assert.ok(comparison.right.cells.every(cell => cell.status === "unavailable"));
});
