import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runFixedCase } from "../fixed-controller.mjs";
import { openRunOutput } from "../output.mjs";
import { completedControllerFixture } from "./helpers/completed-controller.mjs";
import { controllerFixture } from "./helpers/controller-fixture.mjs";

function input(f) {
  const outputRoot = path.join(f.root, "failure-control");
  const output = openRunOutput({ outputRoot, authorizedRoot: f.root, protectedRoots: [], runContext: { runId: "failure-control", cellId: f.cell.id, executionKind: f.cell.executionKind, planSha256: f.prepared.runSet.plan.sha256 }, limits: f.plan.limits });
  return { cell: f.cell, plan: f.plan, input: f.input, output, outputRoot };
}
test("native deadline and null startup failures cannot dispatch or acquire a grade", async () => {
  for (const error of [Object.assign(new Error("source deadline control"), { code: "NATIVE_DEADLINE" }), null, undefined]) {
    const f = await controllerFixture("checker-is-enforced", { beforeSend: () => { throw error; } });
    const result = await runFixedCase(input(f));
    assert.equal(result.status, error?.code === "NATIVE_DEADLINE" ? "timed_out" : "unavailable");
    assert.equal(result.grade, null);
  }
});
test("grader provider failure, deadline and post-grade capture failure remain separate and preserve observed requests", async () => {
  for (const kind of ["provider", "deadline", "capture", "deadline-capture"]) {
    const f = await completedControllerFixture("checker-is-enforced");
    const execute = f.opened.judge.execute;
    f.opened.judge.execute = (command, args, settings) => {
      if (kind === "provider" && command === "gh") return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("Source-only provider refusal.") };
      if (kind.startsWith("deadline") && args[0] === "start") return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: { code: "ETIMEDOUT" } };
      return execute(command, args, settings);
    };
    const options = input(f);
    if (kind.endsWith("capture")) {
      const output = options.output;
      options.output = { ...output, writeArtifact: (name, bytes) => {
        if (kind === "capture" && name === "controller-judge.stdout" || kind === "deadline-capture" && name.endsWith("judge-return.json")) throw new Error("Source-only capture failure");
        return output.writeArtifact(name, bytes);
      } };
    }
    const result = await runFixedCase(options);
    assert.equal(result.status, kind.startsWith("deadline") ? "timed_out" : kind === "provider" ? "infrastructure_failure" : "unavailable");
    assert.equal(result.counts.observedRequests, kind === "capture" ? 1 : 0);
    assert.equal(result.counts.admittedGrades, 0);
    assert.equal(result.grade, null);
  }
});
test("unresolved actual network authority is unavailable, not a successful source-preservation negative", async () => {
  const f = await completedControllerFixture("capability-probe-authority");
  const client = f.opened.protocol.nativeClient;
  const stop = client.stop.bind(client);
  client.stop = async () => {
    const result = await stop();
    fs.appendFileSync(path.join(f.opened.traceDirectories[0], "syscalls.4242"), "4.0 connect(4, 0x123, 10) = 0\n");
    return result;
  };
  const result = await runFixedCase(input(f));
  assert.equal(result.status, "unavailable");
  assert.equal(result.checks.find(([id]) => id === "probe-no-authority-escalation")[1].status, "unavailable");
});
test("post-grade ownership failure preserves requests while withholding the grade", async () => {
  const f = await completedControllerFixture("checker-is-enforced");
  f.opened.close = async () => { throw new Error("Owned close failed"); };
  await assert.rejects(runFixedCase(input(f)), error => error instanceof AggregateError && error.observedCounts.observedRequests === 1 && error.observedCounts.admittedGrades === 0);
});
test("changed baseline bytes cannot pass ordinary delivery even if the oracle is repaired", async () => {
  const f = await completedControllerFixture("discussion-then-go");
  let turn = 0;
  f.input.subjectBeforeSend = async () => { if (turn++ === 1) fs.appendFileSync(path.join(f.input.roots.actor, "baseline.test.mjs"), "\n// changed original test\n"); };
  const result = await runFixedCase(input(f));
  assert.equal(result.status, "product_failure");
  assert.equal(result.checks.find(([id]) => id === "ordinary-request-delivers")[1].status, "fail");
});
test("source seals are reverified while live managed roots still exist, before their owned teardown", async () => {
  const f = await completedControllerFixture("checker-is-enforced");
  const client = f.opened.protocol.nativeClient;
  const stop = client.stop.bind(client);
  client.stop = async () => {
    const result = await stop();
    fs.unlinkSync(path.join(f.opened.subjectTurn.pluginDirectories[0], "worker.md"));
    return result;
  };
  assert.equal((await runFixedCase(input(f))).status, "passed");
});
test("each resumed or restarted acquisition receives its own confinement check and final owned close", async () => {
  const f = await completedControllerFixture("review-recovery-state");
  const opened = [];
  const confined = [];
  const closed = [];
  f.input.open = async args => {
    const owner = { ...f.opened, close: async () => { closed.push(owner); } };
    opened.push({ owner, args });
    return owner;
  };
  f.input.assertConfinement = async ({ opened }) => { confined.push(opened); };
  assert.equal((await runFixedCase(input(f))).status, "passed");
  assert.equal(opened.length, 3);
  assert.equal(opened[1].args.resume, false);
  assert.equal(opened[2].args.resume, true);
  assert.deepEqual(closed, confined);
});
