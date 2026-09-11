import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { captureBoundedCommand } from "../output.mjs";
import { workRoot } from "./helpers/paths.mjs";

const root = workRoot("command-capture");
const options = source => ({ executable: process.execPath, argv: ["-e", source], cwd: root, env: {}, limits: { maxStreamBytes: 32, timeoutMs: 1000, cleanupMs: 300 } });

test("a real command preserves binary streams, explicit environment and a nonzero semantic exit", async () => {
  const result = await captureBoundedCommand({ ...options("process.stdout.write(Buffer.from([255,0,128]));process.stderr.write(process.env.CAPTURE_VALUE);process.exitCode=7"), env: { CAPTURE_VALUE: "explicit" } });
  assert.equal(result.status, "exited");
  assert.equal(result.exitCode, 7);
  assert.deepEqual(result.stdout.bytes, Buffer.from([255, 0, 128]));
  assert.equal(result.stderr.bytes.toString(), "explicit");
  assert.equal(result.cleanup.ownedSpawns.length, 1);
  assert.equal(result.cleanup.exitObservations[0].spawnIdentity, result.cleanup.ownedSpawns[0].spawnIdentity);
  assert.deepEqual(result.cleanup.unverifiedPids, []);
  assert.equal(result.cleanup.scope, "captured-direct-child-only");
});

test("missing executable is a structured infrastructure failure without invented process ownership", async () => {
  const result = await captureBoundedCommand({ ...options(""), executable: path.join(root, "missing") });
  assert.equal(result.failure.code, "ENOENT");
  assert.equal(result.status, "infrastructure_failure");
  assert.equal(result.exitCode, null);
  assert.deepEqual(result.cleanup.ownedSpawns, []);
});

test("the outer deadline bounds its own child without assuming completed startup", async () => {
  const result = await captureBoundedCommand({ ...options("setInterval(()=>{},1000)"), limits: { maxStreamBytes: 32, timeoutMs: 400, cleanupMs: 300 } });
  assert.equal(result.status, "timed_out");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.stdout.bytes.length, 0);
  assert.equal(result.cleanup.exitObservations.length, 1);
});

test("a real signal-resistant child is force-stopped only after its readiness is observed", async () => {
  const ready = path.join(root, "resistant-child-ready");
  const controller = new AbortController();
  let observedPid;
  const watcher = fs.watch(root, (_event, filename) => {
    if (filename !== path.basename(ready) || !fs.existsSync(ready)) return;
    observedPid = Number(fs.readFileSync(ready, "utf8"));
    controller.abort();
  });
  let result;
  try {
    const source = `const fs=require("node:fs");process.on("SIGTERM",()=>{});fs.writeFileSync(${JSON.stringify(`${ready}.pending`)},String(process.pid));fs.renameSync(${JSON.stringify(`${ready}.pending`)},${JSON.stringify(ready)});setInterval(()=>{},1000);`;
    result = await captureBoundedCommand({ ...options(source), signal: controller.signal, limits: { maxStreamBytes: 32, timeoutMs: 10000, cleanupMs: 300 } });
  } finally { watcher.close(); }
  assert.equal(result.status, "cancelled");
  assert.equal(result.signal, "SIGKILL");
  assert.ok(Number.isSafeInteger(observedPid) && observedPid > 0);
  assert.equal(result.cleanup.ownedSpawns[0].pid, observedPid);
  assert.equal(result.cleanup.exitObservations.length, 1);
});

test("overflow retains bounded raw prefixes on both streams and a visible failure", async () => {
  const result = await captureBoundedCommand(options('process.on("SIGTERM",()=>{});const send=()=>{process.stdout.write("x".repeat(4096));process.stderr.write("y".repeat(4096))};send();setInterval(send,10)'));
  assert.equal(result.failure.code, "COMMAND_OUTPUT_OVERFLOW");
  assert.equal(result.stdout.bytes.length, 32);
  assert.equal(result.stderr.bytes.length, 32);
  assert.equal(result.stdout.truncated, true);
  assert.equal(result.stderr.truncated, true);
});

test("the owning command cancellation is distinct from an SDK invocation's normal finally-abort", async () => {
  const before = new AbortController();
  before.abort();
  const unstarted = await captureBoundedCommand({ ...options(""), signal: before.signal });
  assert.equal(unstarted.status, "cancelled");
  assert.deepEqual(unstarted.cleanup.ownedSpawns, []);
  const during = new AbortController();
  const running = captureBoundedCommand({ ...options("setInterval(()=>{},1000)"), signal: during.signal });
  setTimeout(() => during.abort(), 100);
  assert.equal((await running).status, "cancelled");
});

test("command construction rejects malformed argv, environment and limits without starting a child", async () => {
  const valid = options("");
  for (const delta of [{ statusPipe: "true" }, { argv: "shell string" }, { env: null }, { env: { value: 1 } }, { argv: ["nul\0argument"] }, { limits: { maxStreamBytes: 0, timeoutMs: 1 } }, { limits: { maxStreamBytes: 1, timeoutMs: 1, cleanupMs: 0 } }]) await assert.rejects(() => captureBoundedCommand({ ...valid, ...delta }));
});

test("real host transport captures FD 3 separately and bounds its overflow without claiming native isolation", async () => {
  const captured = await captureBoundedCommand({ ...options('require("node:fs").writeSync(3,"private");process.stdout.write("forged status");'), statusPipe: true });
  assert.equal(captured.statusPipe.bytes.toString(), "private");
  assert.equal(captured.stdout.bytes.toString(), "forged status");
  assert.equal(captured.statusPipe.truncated, false);
  const overflow = await captureBoundedCommand({ ...options('require("node:fs").writeSync(3,"x".repeat(4096));setInterval(()=>{},1000);'), statusPipe: true });
  assert.equal(overflow.failure.code, "COMMAND_OUTPUT_OVERFLOW");
  assert.equal(overflow.statusPipe.bytes.length, 32);
  assert.equal(overflow.statusPipe.truncated, true);
  const cancelled = await captureBoundedCommand({ ...options(""), statusPipe: true, signal: AbortSignal.abort() });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.statusPipe.bytes.length, 0);
});

function syntheticChild() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.signals = [];
  child.kill = signal => { child.signals.push(signal); return true; };
  return child;
}

test("an unverified synthetic direct-child exit cannot outlive the finite cleanup budget", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const child = syntheticChild();
  child.stdio = [null, child.stdout, child.stderr, new PassThrough()];
  const original = childProcess.spawn;
  childProcess.spawn = () => child;
  syncBuiltinESMExports();
  try {
    const pending = captureBoundedCommand({ ...options(""), statusPipe: true, limits: { maxStreamBytes: 32, timeoutMs: 10, cleanupMs: 20 } });
    t.mock.timers.tick(10);
    t.mock.timers.tick(10);
    t.mock.timers.tick(10);
    const result = await pending;
    assert.equal(result.status, "timed_out");
    assert.equal(result.elapsedMs, 30);
    assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
    assert.deepEqual(result.cleanup.unverifiedPids, [child.pid]);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stdio[3].destroyed, true);
    child.stdout.emit("data", Buffer.from("late"));
    assert.equal(result.stdout.bytes.length, 0);
    child.emit("close", 0, null);
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
});

test("an error raised during timeout cleanup does not erase the original timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const child = syntheticChild();
  const original = childProcess.spawn;
  childProcess.spawn = () => child;
  syncBuiltinESMExports();
  try {
    const pending = captureBoundedCommand({ ...options(""), limits: { maxStreamBytes: 32, timeoutMs: 10, cleanupMs: 20 } });
    t.mock.timers.tick(10);
    child.emit("error", Object.assign(new Error("cleanup transport failure"), { code: "EIO" }));
    const result = await pending;
    assert.equal(result.status, "timed_out");
    assert.equal(result.failure.code, "COMMAND_TIMEOUT");
    assert.equal(result.errors[0].code, "EIO");
    assert.deepEqual(result.cleanup.unverifiedPids, [child.pid]);
  } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
});

test("a launcher status transport error fails capture and still bounds owned-child cleanup", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const child = syntheticChild();
  child.stdio = [null, child.stdout, child.stderr, new PassThrough()];
  t.mock.method(childProcess, "spawn", () => child);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const pending = captureBoundedCommand({ ...options(""), statusPipe: true });
  child.stdio[3].emit("error", Object.assign(new Error("source-test status transport failure"), { code: "EIO" }));
  t.mock.timers.tick(300);
  const result = await pending;
  assert.equal(result.failure.code, "COMMAND_STREAM_FAILED");
  assert.equal(result.errors[0].channel, "statusPipe");
  assert.deepEqual(result.cleanup.unverifiedPids, [child.pid]);
  child.stdout.emit("error", new Error("late stream error"));
  assert.equal(result.errors.length, 1);
});
