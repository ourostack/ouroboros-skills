import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runFixedCase } from "../fixed-controller.mjs";
import { openRunOutput } from "../output.mjs";
import { completedControllerFixture } from "./helpers/completed-controller.mjs";

for (const caseId of ["discussion-then-go", "checker-is-enforced", "packed-deliverable", "review-recovery-state", "capability-probe-authority"]) test(`${caseId} source-only completion reaches real held-out execution and the grader protocol`, async () => {
  const f = await completedControllerFixture(caseId);
  const outputRoot = path.join(f.root, "completed-source-control");
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: { runId: "completed-source-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 }, limits: f.plan.limits });
  const result = await runFixedCase({ cell: f.cell, plan: f.plan, input: f.input, output, outputRoot });
  assert.equal(result.status, "passed", JSON.stringify({ status: result.status, checks: result.checks, failure: result.failure }));
});
