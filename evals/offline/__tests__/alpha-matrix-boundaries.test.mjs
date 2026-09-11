import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateAlphaExpectedCells } from "../contracts.mjs";
import { expectedFixture, planFixture } from "./helpers/run-set.mjs";
import { dataRoot } from "./helpers/paths.mjs";

test("a deterministic substitution cannot satisfy a missing subject configuration", () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(dataRoot, "dataset.json")));
  const plan = planFixture();
  const expected = { schemaVersion: 1, cells: dataset.cases.flatMap(definition => ["gpt-6-astra", "claude-opus-5"].map((model, index) => {
    const cell = expectedFixture(plan, definition.mode === "deterministic").cells[0];
    Object.assign(cell, { id: `${definition.id}-${index}`, caseId: definition.id, repetition: definition.mode === "deterministic" ? index + 1 : 1 });
    if (cell.subject) cell.subject.model = model;
    return cell;
  })) };
  Object.assign(expected.cells[0], { executionKind: "deterministic", subject: null, judge: null });
  assert.throws(() => validateAlphaExpectedCells(expected, dataset), /configuration/);
});
