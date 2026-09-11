import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runFixedCase } from "../fixed-controller.mjs";
import { openRunOutput } from "../output.mjs";
import { privateControllerFixture } from "./helpers/private-controller.mjs";

function options(f, bindingAdmitted = false) {
  const outputRoot = path.join(f.root, "private-output");
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: { runId: "private-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 }, limits: f.plan.limits });
  return { cell: f.cell, plan: f.plan, input: f.input, outputRoot, output, bindingAdmitted };
}
test("deterministic native-protocol source controls never admit model counts or infer producer binding", async () => {
  for (const binding of [false, true]) {
    const f = await privateControllerFixture();
    const result = await runFixedCase(options(f, binding));
    assert.equal(result.status, binding ? "passed" : "unavailable");
    assert.deepEqual(result.counts, { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
    assert.equal(result.grade, null);
    assert.equal(f.p.state.items.size, 0);
  }
});
test("deterministic observation keeps wrong protection, missing exits and network uncertainty distinct", async () => {
  for (const kind of ["protection", "missing-exit", "connect", "sendto"]) {
    const f = await privateControllerFixture();
    if (kind === "protection") f.opened.privateOperations.privateUid++;
    const filename = path.join(f.opened.traceDirectories[0], "syscalls.4242");
    if (kind === "missing-exit") fs.writeFileSync(filename, '1.0 execve("/native", ["native"], 0x0) = 0\n');
    if (kind === "connect") fs.appendFileSync(filename, "3.0 connect(4, 0x0, 1) = -1 EPERM\n");
    if (kind === "sendto") fs.appendFileSync(filename, "3.0 sendto(0x4, 0x123, 0xa, 0, 0x456, 0x10) = 0xa\n");
    const result = await runFixedCase(options(f, true));
    assert.equal(result.status, kind === "protection" ? "product_failure" : "unavailable");
  }
});
test("private admission requires the owned stopped receipt and withholds credential bytes", async () => {
  for (const kind of ["missing", "invalid", "credential", "empty-credential", "absent-protocol"]) {
    const f = await privateControllerFixture();
    if (kind === "missing") f.opened.close = async () => undefined;
    if (kind === "invalid") f.stopped.receipt.completedWithinBudget = false;
    if (kind === "credential") f.opened.protocol.token = "forbidden-source-token";
    if (kind === "empty-credential") f.opened.protocol.token = "";
    if (kind === "absent-protocol") delete f.opened.protocol;
    if (kind === "credential") fs.appendFileSync(path.join(f.opened.traceDirectories[0], "syscalls.4242"), '3.0 execve("/forbidden-source-token", ["native"], 0x0) = -1 ENOENT\n');
    const input = options(f, true);
    if (kind === "absent-protocol") assert.equal((await runFixedCase(input)).status, "passed");
    else await assert.rejects(runFixedCase(input), { code: ["missing", "invalid"].includes(kind) ? "PRIVATE_STOP_UNVERIFIED" : "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD" });
  }
});
