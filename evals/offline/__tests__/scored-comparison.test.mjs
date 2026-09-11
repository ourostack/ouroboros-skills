import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { compareScoredResults, replayScoredCell } from "../scored-comparison.mjs";
import { runFixedCase } from "../fixed-controller.mjs";
import { openRunOutput } from "../output.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { controllerFixture } from "./helpers/controller-fixture.mjs";
import { privateControllerFixture } from "./helpers/private-controller.mjs";

let sequence = 0;
async function produce(deterministic = false) {
  const f = deterministic ? await privateControllerFixture() : await controllerFixture("checker-is-enforced", { send: ({ roles }) => {
    const filename = path.join(roles.actor, "package.json");
    const value = JSON.parse(fs.readFileSync(filename));
    value.scripts.ci = "npm run test && npm run check";
    fs.writeFileSync(filename, JSON.stringify(value));
  } });
  const outputRoot = path.join(f.root, "produced");
  const context = { runId: "comparison-source-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 };
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: context, limits: f.plan.limits });
  const result = await runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, output, outputRoot, bindingAdmitted: true });
  assert.equal(result.status, "passed");
  const files = new Map(fs.readdirSync(outputRoot).map(name => [name, fs.readFileSync(path.join(outputRoot, name))]));
  const receipt = { ...context, schemaVersion: 1, ...result, caseId: f.cell.caseId };
  function publication(change = () => {}) {
    const root = path.join(f.root, `replay-${++sequence}`);
    const artifacts = new Map(files);
    const value = structuredClone(receipt);
    change(artifacts, value);
    const out = openRunOutput({ outputRoot: root, authorizedRoot: f.root, protectedRoots: [], runContext: context, limits: f.plan.limits });
    for (const [name, bytes] of artifacts) {
      if (name === "receipt.incomplete.json") continue;
      if (name === "stdout.raw" || name === "stderr.raw") out.appendRaw(name.slice(0, -4), bytes);
      else out.writeArtifact(name, bytes);
    }
    out.commit(value);
    const cell = { cellId: f.cell.id, commitMarker: { path: `${path.basename(root)}/COMMITTED.json`, sha256: sha256(fs.readFileSync(path.join(root, "COMMITTED.json"))) }, receipt: { path: `${path.basename(root)}/receipt.json`, sha256: sha256(fs.readFileSync(path.join(root, "receipt.json"))) } };
    return { root: f.root, cell, expected: f.cell };
  }
  return { publication };
}
const edit = (files, name, change) => {
  const value = JSON.parse(files.get(name));
  change(value);
  files.set(name, jsonBytes(value));
};
test("comparison replays native grading evidence and refuses altered rubrics, models, streams and counts", async () => {
  const f = await produce();
  assert.equal(replayScoredCell(f.publication()).status, "passed");
  for (const [change, code] of [
    [(files, receipt) => { receipt.status = "unavailable"; receipt.grade = null; receipt.counts.admittedGrades = 0; }, "CELL_UNSCORED"],
    [files => { files.delete([...files.keys()].find(name => name.endsWith("-valid-still-green-observation.json"))); }, "CHECK_EVIDENCE_MISSING"],
    [files => { const name = [...files.keys()].find(name => name.endsWith("-valid-still-green-observation.json")); edit(files, name, value => { value.availability = "unavailable"; }); }, "CHECK_EVIDENCE_UNAVAILABLE"],
    [files => edit(files, "controller-assessment.json", value => { value.caseId = "other"; }), "ASSESSMENT_RUBRIC_MISMATCH"],
    [files => edit(files, "controller-assessment.json", value => { value.criteria = []; }), "ASSESSMENT_RUBRIC_MISMATCH"],
    [files => edit(files, "controller-assessment.json", value => { value.fixedVerdicts = []; }), "ASSESSMENT_RUBRIC_MISMATCH"],
    [files => edit(files, "controller-judge-plan.json", value => { value.model = "claude-opus-5"; }), "ASSESSMENT_MODEL_MISMATCH"],
    [files => { files.set("controller-judge.stdout", files.get("controller-judge.stdout").subarray(0, -1)); }, "ASSESSMENT_CAPTURE_INCOMPLETE"],
    [(files, receipt) => { receipt.grade.summary = "not the actual native report"; }, "ASSESSMENT_RESULT_MISMATCH"],
    [(files, receipt) => { receipt.status = "product_failure"; }, "OUTPUT_WRITE_FAILED"],
    [(files, receipt) => { receipt.counts.observedRequests++; }, "ASSESSMENT_RESULT_MISMATCH"],
  ]) assert.throws(() => replayScoredCell(f.publication(change)), { code });
  const missingCase = f.publication();
  missingCase.expected = { ...missingCase.expected, caseId: "absent" };
  assert.throws(() => replayScoredCell(missingCase), { code: "CELL_UNSCORED" });
  const unpublished = f.publication();
  unpublished.cell.receipt = null;
  assert.throws(() => replayScoredCell(unpublished), { code: "CELL_UNPUBLISHED" });
  const side = value => ({ root: value.root, inventoryComplete: true, expectedCells: { cells: [value.expected] }, cells: [value.cell] });
  const left = side(f.publication());
  const right = side(f.publication());
  const result = compareScoredResults({ left, right, compatibility: { compatible: true } });
  assert.equal(result.scored, true);
  assert.equal(result.missing, 0);
  assert.equal(result.grade, null);
  for (const sides of [{ left: { ...left, inventoryComplete: false }, right }, { left, right: { ...right, inventoryComplete: false } }, { left, right: { ...right, cells: [] } }]) assert.equal(compareScoredResults({ ...sides, compatibility: { compatible: true } }).scored, false);
});
test("deterministic cells replay their exact observations with null grades and a full missing denominator", async () => {
  const f = await produce(true);
  assert.deepEqual(replayScoredCell(f.publication()), { status: "passed", grade: null, executionKind: "deterministic" });
  const failing = f.publication((files, receipt) => {
    const name = [...files.keys()].find(name => name.endsWith("-protected-own-work-observation.json"));
    edit(files, name, value => { value.visibility = "not-private"; });
    receipt.status = "product_failure";
  });
  assert.equal(replayScoredCell(failing).status, "product_failure");
  assert.throws(() => replayScoredCell(f.publication((files, receipt) => { receipt.status = "product_failure"; })), { code: "DETERMINISTIC_RESULT_MISMATCH" });
  assert.throws(() => f.publication((files, receipt) => { receipt.grade = { status: "pass" }; }), { code: "OUTPUT_WRITE_FAILED" });
});
