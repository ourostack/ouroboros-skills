import assert from "node:assert/strict";
import test from "node:test";
import { createProcessObserver, runTerminalProtocol } from "../native-protocol.mjs";
import { fixture, validReport } from "./helpers/native-sdk.mjs";

test("the producer itself refuses a replayed history report under a different root window", async () => {
  const history = [
    { id: "wrong-window", type: "assistant.turn_start", data: { turnId: "supported-turn" } },
    { id: "request", type: "assistant.message", data: { turnId: "supported-turn", toolRequests: [{ toolCallId: "report", name: "report_result", arguments: validReport() }] } },
  ];
  const control = fixture({ history });
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, false);
  assert.equal(result.historicalMatches, false);
});

test("process observation follows actual parent lineage and preserves start identity across PID reuse", () => {
  const stat = (pid, parent, ticks = "12345") => {
    const fields = Array(20).fill("0");
    fields[0] = "S"; fields[1] = String(parent); fields[19] = ticks;
    return `${pid} (runtime worker) ${fields.join(" ")}`;
  };
  const rows = new Map([[11, stat(11, 10)], [12, stat(12, 11)], [99, stat(99, 1)]]);
  const observer = createProcessObserver({
    parentPid: 10, directory: () => ["self", "11", "12", "99", "13"],
    stat: pid => { if (!rows.has(pid)) throw Object.assign(new Error("gone"), { code: "ENOENT" }); return rows.get(pid); },
  });
  assert.deepEqual(observer.list().map(row => row.pid), [11, 12]);
  assert.equal(observer.read(12).startTicks, "12345");
  rows.set(12, stat(12, 1, "67890"));
  assert.equal(observer.read(12).startTicks, "67890");
  assert.equal(observer.read(13), null);
  assert.throws(() => createProcessObserver({ directory: () => Array(4097).fill("1") }).list(), { code: "PROCESS_INVENTORY_LIMIT" });
  assert.throws(() => createProcessObserver({ stat: () => "invalid" }).read(1), { code: "PROCESS_STAT_INVALID" });
  assert.throws(() => createProcessObserver({ stat: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } }).read(1), { code: "EACCES" });
});

test("missing runtime, wrong version and wrong tools do not make successful native controls", async () => {
  for (const options of [
    { startError: new Error("not started") },
    { version: "1.0.84-3" },
    { tools: [{ name: "shell" }] },
    { report: { ...validReport(), summary: "" } },
  ]) {
    const control = fixture(options);
    const result = await runTerminalProtocol(control.input);
    assert.equal(result.ok, false);
    assert.equal(result.grade, null);
  }
});

test("a root that exits to a different parent remains unverified while its original start identity still lives", async () => {
  const control = fixture();
  control.input.processObserver.read = () => ({ pid: 4242, parentPid: 1, state: "S", startTicks: "12345" });
  const result = await runTerminalProtocol(control.input);
  assert.equal(result.ok, false);
  assert.equal(result.cleanup.complete, false);
  assert.deepEqual(result.cleanup.receipt.unverifiedPids, [4242]);
});

test("reused PID identity and exited zombie state are distinguished from a live owned process", async () => {
  for (const current of [
    { pid: 4242, parentPid: 1, state: "S", startTicks: "new-start" },
    { pid: 4242, parentPid: 1, state: "Z", startTicks: "12345" },
  ]) {
    const control = fixture();
    control.input.processObserver.read = () => current;
    const result = await runTerminalProtocol(control.input);
    assert.equal(result.cleanup.complete, true);
  }
});

test("the real read and permission callbacks preserve the empty-judge boundary", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const read = control.state.session.tools.find(tool => tool.name === "read_evidence").handler;
  assert.match(read({ path: "checks/proof.txt" }), /returned 3/);
  assert.throws(() => read({ path: "credentials" }), { code: "UNINDEXED_CONTROL_EVIDENCE" });
  assert.equal(control.state.session.onPermissionRequest({ kind: "shell" }).kind, "reject");
});
