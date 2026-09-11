import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readWriterTrace } from "../writer-trace.mjs";
import { runFixedCase } from "../fixed-controller.mjs";
import { heldOutChecks } from "../check-executor.mjs";
import { openRunOutput } from "../output.mjs";
import { sha256 } from "../core.mjs";
import { controllerFixture } from "./helpers/controller-fixture.mjs";
import { privateControllerFixture } from "./helpers/private-controller.mjs";
import { workRoot } from "./helpers/paths.mjs";

const root = workRoot("writer-stop");
const retain = (path, bytes) => ({ path, sha256: sha256(bytes) });
function incompleteDescendant(directory) {
  fs.writeFileSync(path.join(directory, "syscalls.4242"), '1.0 execve("/native", ["native"], 0x0) = 0\n2.0 fork() = 4243\n3.0 +++ exited with 0 +++\n');
  fs.writeFileSync(path.join(directory, "syscalls.4243"), "2.1 exit_group(0) = ?\n");
}
function caseInput(f) {
  const outputRoot = path.join(f.root, "writer-stop-output");
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: { runId: "writer-stop-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 }, limits: f.plan.limits });
  return { cell: f.cell, plan: f.plan, input: f.input, output, outputRoot, bindingAdmitted: true };
}

for (const call of ["exit", "exit_group"]) for (const role of ["root", "descendant"]) test(`${call} request without a terminal record cannot prove the ${role} stopped`, () => {
  const directory = path.join(root, `${call}-${role}`);
  fs.mkdirSync(directory);
  const rootEnd = role === "root" ? `3.0 ${call}(0) = ?` : "3.0 +++ exited with 0 +++";
  fs.writeFileSync(path.join(directory, "syscalls.4242"), `1.0 execve("/native", ["native"], 0x0) = 0\n2.0 fork() = 4243\n${rootEnd}\n`);
  fs.writeFileSync(path.join(directory, "syscalls.4243"), role === "descendant" ? `2.1 ${call}(0) = ?\n` : "2.1 +++ exited with 0 +++\n");
  const observed = readWriterTrace({ directory, retain, ownedSpawns: [{ pid: 4242 }] });
  assert.equal(observed.traceCoverage, "unavailable");
  const unfinished = observed.processes.find(row => row.pid === (role === "root" ? 4242 : 4243));
  assert.equal(unfinished.exited, false);
  assert.equal(unfinished.exitCode, null);
});

test("a process killed after its exit request cannot inherit the requested successful exit code", () => {
  const directory = path.join(root, "signal-after-request");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "syscalls.4242"), '1.0 execve("/native", ["native"], 0x0) = 0\n2.0 exit_group(0) = ?\n2.1 +++ killed by SIGKILL +++\n');
  const observed = readWriterTrace({ directory, retain, ownedSpawns: [{ pid: 4242 }] });
  assert.equal(observed.traceCoverage, "complete");
  assert.equal(observed.processes[0].exited, true);
  assert.equal(observed.processes[0].exitCode, null);
  assert.equal(observed.executions[0].outcome.kind, "signaled");
});

test("the subject controller refuses incomplete descendant termination before held-out execution (synthetic transport)", async t => {
  const f = await controllerFixture();
  incompleteDescendant(f.opened.traceDirectories[0]);
  let commands = 0;
  t.mock.method(heldOutChecks, "execute", async () => { commands++; throw new Error("Held-out execution must not begin."); });
  await assert.rejects(runFixedCase(caseInput(f)), { code: "TRACE_UNAVAILABLE" });
  assert.equal(commands, 0);
  assert.equal(f.closes, 1);
});

test("the private controller cannot publish a passing negative from an exit-request-only descendant (synthetic transport)", async () => {
  const f = await privateControllerFixture();
  incompleteDescendant(f.opened.traceDirectories[0]);
  const result = await runFixedCase(caseInput(f));
  assert.equal(result.status, "unavailable");
  assert.equal(result.grade, null);
  assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
  assert.ok(result.checks.every(([, value]) => value.status === "unavailable"));
});
