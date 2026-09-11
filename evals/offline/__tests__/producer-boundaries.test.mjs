import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRunPlan } from "../producer.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { expectedFixture, planFixture } from "./helpers/run-set.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";

const root = workRoot("producer-boundaries");
let sequence = 0;
function input() {
  const source = path.join(root, `input-${++sequence}`);
  fs.mkdirSync(source);
  const plan = planFixture(`boundary-${sequence}`);
  const datasetBytes = fs.readFileSync(path.join(dataRoot, "dataset.json"));
  const dataset = JSON.parse(datasetBytes);
  plan.dataset = { id: dataset.id, version: dataset.version, sha256: sha256(datasetBytes) };
  plan.fixtureManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "fixture-manifest.json")));
  plan.checkerManifestSha256 = sha256(fs.readFileSync(path.join(dataRoot, "check-expectations.json")));
  const expected = { schemaVersion: 1, cells: dataset.cases.flatMap(definition => ["gpt-6-astra", "claude-opus-5"].map((model, index) => {
    const cell = expectedFixture(plan, definition.mode === "deterministic").cells[0];
    Object.assign(cell, { id: `${definition.id}-${index}`, caseId: definition.id });
    if (cell.subject) cell.subject.model = model;
    else cell.repetition = index + 1;
    return cell;
  })) };
  const filename = path.join(source, "input.json");
  const outputRoot = path.join(root, `output-${sequence}`);
  const save = () => {
    const bytes = jsonBytes(expected);
    fs.writeFileSync(path.join(source, "matrix.json"), bytes);
    plan.expectedCells = { path: "matrix.json", sha256: sha256(bytes) };
    fs.writeFileSync(filename, jsonBytes(plan));
  };
  save();
  return { filename, outputRoot, plan, expected, save, source };
}

for (const [name, change, code] of [
  ["wrong dataset version", f => { f.plan.dataset.version = "0.0.0"; }, "PRODUCER_CONTROL_MISMATCH"],
  ["wrong dataset bytes", f => { f.plan.dataset.sha256 = sha256("different"); }, "PRODUCER_CONTROL_MISMATCH"],
  ["foreign candidate", f => { f.expected.cells[0].candidateId = "other"; }, "RUN_SET_CANDIDATE_MISMATCH"],
]) test(`preflight refuses ${name} before output`, () => {
  const f = input();
  change(f);
  f.save();
  assert.throws(() => prepareRunPlan(f), { code });
  assert.equal(fs.existsSync(f.outputRoot), false);
});

for (const name of ["plan.json", "producer-status.json/child.json", "run-set.json", "attempt-journal.jsonl"]) test(`matrix cannot occupy reserved producer path ${name}`, () => {
  const f = input();
  const target = path.join(f.source, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(f.source, "matrix.json"), target);
  f.plan.expectedCells.path = name;
  fs.writeFileSync(f.filename, jsonBytes(f.plan));
  assert.throws(() => prepareRunPlan(f), { code: "PRODUCER_RESERVED_PATH" });
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test("output cannot overlap input or alias another root", () => {
  const f = input();
  assert.throws(() => prepareRunPlan({ ...f, outputRoot: path.join(f.source, "output") }), { code: "OUTPUT_ROOT_NOT_AUTHORIZED" });
  const alias = path.join(root, `alias-${sequence}`);
  fs.symlinkSync(f.source, alias);
  assert.throws(() => prepareRunPlan({ ...f, outputRoot: path.join(alias, "output") }), { code: "LINK_NOT_ALLOWED" });
});

test("failed output publication reports its actual root and does not invent model attempts", t => {
  const f = input();
  const write = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (filename, ...args) => {
    if (filename === path.join(f.outputRoot, "producer-status.json")) throw Object.assign(new Error("controlled disk failure"), { code: "ENOSPC" });
    return write(filename, ...args);
  });
  assert.throws(() => prepareRunPlan(f), error => {
    assert.equal(error.code, "OUTPUT_WRITE_FAILED");
    assert.equal(error.artifacts, f.outputRoot);
    assert.equal(error.exitCode, 3);
    assert.equal(error.cause.code, "ENOSPC");
    return true;
  });
  const partial = JSON.parse(fs.readFileSync(path.join(f.outputRoot, "run-set.json")));
  assert.equal(partial.state, "incomplete");
  assert.equal(partial.unstartedCellIds.length, 12);
  assert.deepEqual(partial.attempts, []);
  assert.equal(fs.existsSync(path.join(f.outputRoot, "COMMITTED.json")), false);
});
