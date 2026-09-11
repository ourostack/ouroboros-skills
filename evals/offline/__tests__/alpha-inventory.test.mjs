import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateRunSetInventory } from "../comparison.mjs";
import { sha256 } from "../core.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";
import { diskRunSet } from "./helpers/run-set.mjs";

test("the actual run-set consumer cannot bless a selected subset as complete Alpha coverage", () => {
  const value = diskRunSet(workRoot("alpha-inventory"), { id: "alpha-subset", started: false, published: false, closed: false });
  const data = fs.readFileSync(path.join(dataRoot, "dataset.json"));
  const dataset = JSON.parse(data);
  value.plan.dataset = { id: dataset.id, version: dataset.version, sha256: sha256(data) };
  value.runSet.plan = value.put("plan.json", value.plan);
  value.save();
  assert.throws(() => validateRunSetInventory({ runSet: value.runSet, expectedCells: value.expectedCells, journalRecords: value.journalRecords, readArtifact: value.readArtifact }), /twelve|configuration|Alpha/);
});
