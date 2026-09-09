import assert from "node:assert/strict";
import test from "node:test";
import { validatePlan } from "../contracts.mjs";
import { validateRunSetInventory } from "../comparison.mjs";
import { sha256 } from "../core.mjs";
import { bytes, diskRunSet, planFixture } from "./helpers/run-set.mjs";
import { workRoot } from "./helpers/paths.mjs";

const root = workRoot("inventory-edges");
test("a plan can explicitly retain missing activation qualification without making it available", () => {
  const plan = planFixture();
  plan.activation.qualificationReceipt = null;
  assert.equal(validatePlan(plan).activation.qualificationReceipt, null);
});

test("a closed attempt whose publication produced no receipt remains explicitly incomplete", () => {
  const fixture = diskRunSet(root, { id: "closed-no-receipt", closed: false });
  const started = fixture.journalRecords[0];
  const status = "infrastructure_failure";
  fixture.journalRecords.push({ ...started, type: "attempt_close", status, sequence: 2, previousRecordSha256: sha256(bytes(started)) });
  fixture.runSet.attemptJournal = fixture.put("attempt-journal.jsonl", Buffer.concat(fixture.journalRecords.map(bytes)));
  fixture.runSet.attempts[0].status = status;
  fixture.runSet.closedAt = "2026-01-01T00:00:01Z";
  fixture.save();
  const result = validateRunSetInventory(fixture);
  assert.equal(result.inventoryComplete, false);
  assert.equal(result.cells[0].status, status);
  assert.equal(result.cells[0].receipt, null);
});
