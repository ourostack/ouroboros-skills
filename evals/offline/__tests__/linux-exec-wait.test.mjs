import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { arch, constants, release, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("./helpers/inert-exec-wait.c", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function requireObserved(value, signals) {
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.platform, "linux");
  assert.equal(value.qualified, false);
  assert.equal(value.status, "observed");
  assert.equal(value.failure, null);
  assert.ok(Number.isSafeInteger(value.tracerPid) && value.tracerPid > 0);
  assert.ok(Number.isSafeInteger(value.childPid) && value.childPid > 0 && value.childPid !== value.tracerPid);
  assert.equal(value.initialWait, (signals.SIGSTOP << 8) | 0x7f);
  assert.equal(value.execWait, (4 << 16) | (signals.SIGTRAP << 8) | 0x7f);
  assert.equal(value.exitStopWait, (6 << 16) | (signals.SIGTRAP << 8) | 0x7f);
  assert.equal(value.finalWait, 0, "Only an actual final zero-exit wait satisfies this inert control");
  assert.equal(value.waitCount, 4);
  assert.equal(value.continues, 3);
  assert.equal(value.cleanupComplete, true);
  assert.equal(value.cleanupAttempted, false);
  assert.equal(value.cleanupSignalErrno, 0);
  assert.equal(value.cancelSignal, 0);
  assert.equal(value.parent.tracerPid, 0);
  assert.equal(value.child.tracerPid, value.tracerPid);
  for (const kind of ["uid", "gid"]) {
    for (const context of [value.parent, value.child]) assert.ok(Array.isArray(context[kind]) && context[kind].length === 4 && context[kind].every(id => Number.isSafeInteger(id) && id >= 0));
    assert.deepEqual(value.child[kind], value.parent[kind]);
  }
  assert.match(value.parent.userNamespace, /^user:\[\d+\]$/);
  assert.equal(value.child.userNamespace, value.parent.userNamespace);
  assert.ok(typeof value.parent.uidMap === "string" && value.parent.uidMap.trim().length > 0);
  for (const line of value.parent.uidMap.trim().split("\n")) assert.match(line, /^\s*\d+\s+\d+\s+\d+\s*$/);
  assert.equal(value.child.uidMap, value.parent.uidMap);
  for (const field of ["device", "inode"]) {
    assert.match(value.executable.tracer[field], /^\d+$/);
    assert.equal(value.executable.child[field], value.executable.tracer[field]);
  }
}

function runFixture(t) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "offline-exec-wait-"));
  const binary = path.join(directory, "inert-exec-wait");
  const env = { PATH: process.env.PATH, LC_ALL: "C", TMPDIR: directory };
  let removable = true;
  try {
    const sourceSha256 = digest(fs.readFileSync(source));
    const compiler = spawnSync("cc", ["--version"], { env, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
    assert.equal(compiler.status, 0, `Existing cc is required: ${compiler.error?.message ?? compiler.stderr}`);
    assert.equal(compiler.error, undefined);
    assert.equal(compiler.signal, null);
    removable = false;
    const build = spawnSync("cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", source, "-o", binary], { env, encoding: "utf8", timeout: 30000, maxBuffer: 65536 });
    removable = build.status !== null;
    assert.equal(build.status, 0, `Fixture compilation failed: ${build.error?.message ?? build.stderr}`);
    assert.equal(build.error, undefined);
    assert.equal(build.signal, null);
    const binarySha256 = digest(fs.readFileSync(binary));
    removable = false;
    const result = spawnSync(binary, [], { env, encoding: "utf8", timeout: 15000, killSignal: "SIGTERM", maxBuffer: 65536 });
    const context = Object.fromEntries(["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_JOB", "RUNNER_OS", "RUNNER_ARCH", "ImageOS", "ImageVersion"].map(name => [name, process.env[name] ?? null]));
    const metadata = { kind: "inert-exec-wait", sourceSha256, binarySha256, compiler: compiler.stdout.trim(), node: process.version, architecture: arch(), kernel: release(), context, processStatus: result.status, processSignal: result.signal, processError: result.error?.code ?? null };
    let evidence;
    try { evidence = JSON.parse(result.stdout); }
    catch (error) {
      t.diagnostic(JSON.stringify({ ...metadata, stdout: result.stdout, stderr: result.stderr, evidence: null }));
      throw error;
    }
    removable = result.status !== null && result.signal === null && evidence?.cleanupComplete === true;
    t.diagnostic(JSON.stringify({ ...metadata, evidence }));
    assert.equal(digest(fs.readFileSync(binary)), binarySha256, "The compiled fixture changed during the diagnostic");
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    return { result, evidence };
  } finally {
    if (removable) fs.rmSync(directory, { recursive: true });
    else t.diagnostic(JSON.stringify({ preservedArtifacts: directory, reason: "Process or child cleanup is unverified; do not treat this run as capability evidence" }));
  }
}

test("Linux owns one inert tracee through exec stop, continuation and actual final wait", { skip: process.platform !== "linux" && "Linux kernel capability is not exercised on this host", timeout: 60000 }, t => {
  const { result, evidence } = runFixture(t);
  assert.equal(result.status, 0, JSON.stringify(evidence));
  requireObserved(evidence, constants.signals);
});

test("non-Linux fixture explicitly refuses instead of supplying a host-direct fallback", { skip: process.platform !== "darwin", timeout: 60000 }, t => {
  const { result, evidence } = runFixture(t);
  assert.equal(result.status, 77);
  assert.deepEqual(evidence, { schemaVersion: 1, platform: "unsupported", status: "refused", qualified: false, cleanupComplete: true, childPid: null, failure: "linux_required" });
});

test("synthetic receipt-shape controls reject refusal, timeout, signal death and incomplete waits", () => {
  const context = { uid: [1001, 1001, 1001, 1001], gid: [1001, 1001, 1001, 1001], tracerPid: 0, userNamespace: "user:[42]", uidMap: "0 0 4294967295\n" };
  const value = {
    schemaVersion: 1, platform: "linux", status: "observed", qualified: false, failure: null,
    tracerPid: 100, childPid: 101, initialWait: (19 << 8) | 0x7f, execWait: (4 << 16) | (5 << 8) | 0x7f,
    exitStopWait: (6 << 16) | (5 << 8) | 0x7f, finalWait: 0, waitCount: 4, continues: 3,
    cleanupComplete: true, cleanupAttempted: false, cleanupSignalErrno: 0, cancelSignal: 0, parent: context, child: { ...structuredClone(context), tracerPid: 100 },
    executable: { tracer: { device: "7", inode: "9" }, child: { device: "7", inode: "9" } },
  };
  const signals = { SIGSTOP: 19, SIGTRAP: 5 };
  requireObserved(value, signals);
  for (const change of [
    row => { row.status = "refused"; }, row => { row.status = "timed_out"; }, row => { row.status = "cancelled"; },
    row => { row.finalWait = null; }, row => { row.finalWait = 9; }, row => { row.execWait = null; },
    row => { row.finalWait = row.exitStopWait; }, row => { row.waitCount = 5; }, row => { row.cleanupComplete = false; },
    row => { row.child.tracerPid = 999; }, row => { row.child.userNamespace = "user:[43]"; },
    row => { row.child.uidMap = "0 1001 1\n"; }, row => { row.executable.child.inode = "10"; },
    row => { row.cancelSignal = 15; }, row => { row.cleanupSignalErrno = 1; },
  ]) {
    const changed = structuredClone(value);
    change(changed);
    assert.throws(() => requireObserved(changed, signals));
  }
});
