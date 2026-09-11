import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateAlphaExpectedCells } from "../contracts.mjs";
import { expectedFixture, planFixture } from "./helpers/run-set.mjs";
import { dataRoot } from "./helpers/paths.mjs";

const dataset = JSON.parse(fs.readFileSync(path.join(dataRoot, "dataset.json")));
function matrix() {
  const plan = planFixture();
  const cells = dataset.cases.flatMap(definition => ["gpt-6-astra", "claude-opus-5"].map((model, index) => {
    const cell = expectedFixture(plan, definition.mode === "deterministic").cells[0];
    cell.id = `${definition.id}-${index + 1}`;
    cell.caseId = definition.id;
    if (cell.executionKind === "deterministic") cell.repetition = index + 1;
    else { cell.subject.model = model; cell.judge.model = model; }
    return cell;
  }));
  return { schemaVersion: 1, cells };
}

test("alpha requires all six fixed cases in both model-configuration strata", () => {
  const expected = matrix();
  assert.equal(expected.cells.length, 12);
  assert.equal(validateAlphaExpectedCells(expected, dataset), expected);
  assert.equal(expected.cells.filter(cell => cell.executionKind === "deterministic").length, 2);
});

for (const [name, change] of [
  ["missing cell", value => { value.cells.pop(); }],
  ["extra repetition", value => { value.cells[0].repetition = 2; }],
  ["unknown case", value => { value.cells[0].caseId = "not-in-frozen-suite"; }],
  ["missing Opus subject", value => { value.cells[1].subject.model = "gpt-6-astra"; }],
  ["third deterministic stratum", value => { value.cells.at(-1).repetition = 3; }],
  ["invented deterministic model role", value => {
    const role = structuredClone(value.cells[0]);
    Object.assign(value.cells.at(-1), { executionKind: "subject_with_judge", subject: role.subject, judge: role.judge });
  }],
]) test(`alpha refuses ${name} without shrinking or relabelling its denominator`, () => {
  const expected = matrix();
  change(expected);
  assert.throws(() => validateAlphaExpectedCells(expected, dataset), /alpha|Alpha|frozen|stratum|configuration/);
});

test("the independently frozen judge model is retained rather than inferred from the subject", () => {
  const expected = matrix();
  for (const cell of expected.cells) if (cell.judge) cell.judge.model = "claude-opus-5";
  assert.equal(validateAlphaExpectedCells(expected, dataset), expected);
});

test("alpha refuses a missing or partial fixed dataset instead of selecting convenient cases", () => {
  for (const value of [undefined, {}, { cases: [] }, { ...dataset, cases: dataset.cases.slice(1) }]) {
    assert.throws(() => validateAlphaExpectedCells(matrix(), value), /alpha|Alpha|six/);
  }
});
