import assert from "node:assert/strict";
import test from "node:test";
import { probeNativeRole, NATIVE_ROLE_UID } from "../native-identity.mjs";

const observation = () => ({ probeUid: NATIVE_ROLE_UID, targetUid: NATIVE_ROLE_UID, environ: "EACCES", memory: "EACCES", descriptor: "EACCES", rootRegain: "EPERM" });
function fixture() {
  const value = { calls: [] };
  value.input = { pid: 4321, timeoutMs: 500, execute: (...args) => { value.calls.push(args); return { status: 0, stdout: Buffer.from(JSON.stringify(observation())), stderr: Buffer.alloc(0) }; } };
  return value;
}

test("the live native probe uses only an exact target PID and a credential-free same-UID child", () => {
  const value = fixture();
  const result = probeNativeRole(value.input);
  assert.equal(result.protected, true);
  assert.deepEqual(result.observation, observation());
  assert.equal(value.calls.length, 1);
  const [command, argv, options] = value.calls[0];
  assert.equal(command, "/usr/bin/setpriv");
  assert.deepEqual(argv.slice(0, 5), ["--reuid=65534", "--regid=65534", "--clear-groups", "--no-new-privs", process.execPath]);
  assert.equal(argv.at(-1), "4321");
  assert.deepEqual(Object.keys(options.env).sort(), ["HOME", "PATH"]);
  assert.equal(options.timeout, 500);
  assert.equal(options.shell, false);
  assert.equal(options.encoding, null);
});

for (const [name, change] of [
  ["bad PID", value => { value.input.pid = 0; }],
  ["bad timeout", value => { value.input.timeoutMs = 0; }],
  ["wrong subject UID", value => { value.result.targetUid = 0; }],
  ["wrong probe UID", value => { value.result.probeUid = 0; }],
  ["readable environment", value => { value.result.environ = "opened"; }],
  ["readable memory", value => { value.result.memory = "opened"; }],
  ["readable descriptor", value => { value.result.descriptor = "readable"; }],
  ["vanished process", value => { value.result.environ = "ENOENT"; }],
  ["regained privilege", value => { value.result.rootRegain = "succeeded"; }],
]) test(`the native probe refuses ${name} without reading any credential bytes`, () => {
  const value = fixture();
  value.result = observation();
  value.input.execute = () => ({ status: 0, stdout: Buffer.from(JSON.stringify(value.result)), stderr: Buffer.alloc(0) });
  change(value);
  assert.throws(() => probeNativeRole(value.input), /native|role|PID|timeout|process/i);
});

test("probe failure, timeout, malformed capture and decoded-only output stay unavailable", () => {
  for (const response of [
    { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    { status: null, error: { code: "ETIMEDOUT" }, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    { status: 0, stdout: Buffer.from("{broken"), stderr: Buffer.alloc(0) },
    { status: 0, stdout: JSON.stringify(observation()), stderr: Buffer.alloc(0) },
  ]) assert.throws(() => probeNativeRole({ pid: 4321, timeoutMs: 500, execute: () => response }));
});
