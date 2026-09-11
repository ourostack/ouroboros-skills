import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { captureConfinedChecker } from "../checker-process.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("checker namespace construction is fail-closed and never treats launcher output as native qualification", async t => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  t.after(() => { Object.defineProperty(process, "platform", platform); t.mock.restoreAll(); syncBuiltinESMExports(); });
  const root = workRoot("checker-process");
  const options = { executable: "/opt/node/bin/node", argv: ["-e", "candidate"], cwd: root, workRoot: root, subject: path.join(root, "subject"), checkerRoot: path.join(root, "checker"), env: { HOME: root, PATH: "/opt/node/bin:/usr/bin:/bin" }, limits: { timeoutMs: 1000, maxStreamBytes: 1024, cleanupMs: 100 } };
  Object.defineProperty(process, "platform", { value: "darwin" });
  await assert.rejects(captureConfinedChecker(options), { code: "CHECKER_OS_BOUNDARY_REQUIRED" });
  Object.defineProperty(process, "platform", { value: "linux" });
  const lstat = fs.lstatSync;
  let mode = "missing";
  t.mock.method(fs, "lstatSync", (filename, ...args) => {
    if (filename !== "/usr/bin/bwrap") return lstat(filename, ...args);
    if (mode === "missing" || mode === "denied") throw Object.assign(new Error("Test launcher fault"), { code: mode === "missing" ? "ENOENT" : "EACCES" });
    return { uid: mode === "owner" ? 99 : 0, mode: mode === "writable" ? 0o100777 : 0o100755, isFile: () => mode !== "link" };
  });
  await assert.rejects(captureConfinedChecker(options), { code: "CHECKER_OS_BOUNDARY_REQUIRED" });
  mode = "denied";
  await assert.rejects(captureConfinedChecker(options), { code: "EACCES" });
  for (mode of ["owner", "writable", "link"]) await assert.rejects(captureConfinedChecker(options), { code: "CHECKER_OS_BOUNDARY_REQUIRED" });
  mode = "valid";
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (filename, ...args) => filename === "/usr/bin/bwrap" ? Buffer.from("Synthetic binary identity, not native proof") : read(filename, ...args));
  const realpath = fs.realpathSync;
  let runtime = "/opt/node/bin/node";
  t.mock.method(fs, "realpathSync", (filename, ...args) => filename === process.execPath ? runtime : realpath(filename, ...args));
  const exists = fs.existsSync;
  t.mock.method(fs, "existsSync", filename => ["/opt/node", "/usr", "/bin", "/lib"].includes(filename) || exists(filename));
  runtime = "/bin/node";
  await assert.rejects(captureConfinedChecker(options), { code: "CHECKER_OS_BOUNDARY_REQUIRED" });
  runtime = "/opt/node/bin/node";
  await assert.rejects(captureConfinedChecker({ ...options, subject: "/usr/candidate" }), { code: "CHECKER_OS_BOUNDARY_REQUIRED" });
  let invocation;
  let statusBytes = "";
  let exitSignal = null;
  t.mock.method(childProcess, "spawn", (executable, argv, settings) => {
    invocation = { executable, argv, settings };
    const child = Object.assign(new EventEmitter(), { pid: 999999, stdout: new PassThrough(), stderr: new PassThrough(), stdio: [null, null, null, new PassThrough()] });
    queueMicrotask(() => {
      child.stdout.end("untrusted namespace-looking output");
      child.stdio[3].end(statusBytes);
      child.emit("close", 1, exitSignal);
    });
    return child;
  });
  syncBuiltinESMExports();
  const result = await captureConfinedChecker(options);
  assert.equal(result.exitCode, 1, "A possible setup failure is retained, not called a product failure");
  assert.equal(result.launcher.nativeQualified, false);
  assert.equal(invocation.executable, "/usr/bin/bwrap");
  assert.deepEqual(invocation.settings.env, { PATH: "/usr/bin:/bin" });
  assert.deepEqual(invocation.argv.slice(0, 13), ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--uid", "65534", "--gid", "65534", "--clearenv", "--json-status-fd", "3", "--ro-bind"]);
  assert.ok(invocation.argv.includes("--proc"));
  assert.ok(invocation.argv.includes("--ro-bind"));
  assert.deepEqual(invocation.argv.slice(-4), ["--", options.executable, "-e", "candidate"]);
  assert.ok(invocation.argv.includes("--json-status-fd"));
  assert.equal(invocation.settings.stdio[3], "pipe");
  assert.equal(result.launcher.execution.status, "unavailable", "stdout and wrapper exit cannot replace the private status pipe");
  statusBytes = '{"child-pid":123,"user-namespace":42}\n{"exit-code":1}\n';
  const observed = await captureConfinedChecker(options);
  assert.deepEqual(observed.launcher.execution, { status: "observed", childPid: 123, shellExitCode: 1, scope: "launcher-reported-initial-child-exit-only" });
  assert.equal(observed.statusPipe.bytes.toString(), statusBytes);
  assert.equal(observed.launcher.nativeQualified, false);
  for (statusBytes of [
    "not json\n",
    '{"exit-code":1}\n',
    '{"child-pid":123}\n',
    '{"child-pid":123}\n{"exit-code":0}\n',
    '{"child-pid":123}\n{"exit-code":1}',
    '{"child-pid":123}\n{"exit-code":1}\n{"exit-code":1}\n',
    '{"child-pid":999999}\n{"exit-code":1}\n',
    '{"child-pid":-1}\n{"exit-code":1}\n',
    'null\n{"exit-code":1}\n',
    '{"child-pid":123}\nnull\n',
    '{"child-pid":123}\n{"exit-code":-1}\n',
    '{"child-pid":123}\n{"exit-code":256}\n',
    '{"child-pid":123}\n{"exit-code":"1"}\n',
  ]) assert.equal((await captureConfinedChecker(options)).launcher.execution.status, "unavailable");
  exitSignal = "SIGKILL";
  assert.equal((await captureConfinedChecker(options)).launcher.execution.status, "unavailable");
  assert.equal((await captureConfinedChecker({ ...options, signal: AbortSignal.abort() })).launcher.execution.status, "unavailable");
});
