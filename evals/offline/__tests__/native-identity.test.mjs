import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { enterNativeRole, NATIVE_NODE_OPTIONS, NATIVE_ROLE_UID } from "../native-identity.mjs";
import { workRoot } from "./helpers/paths.mjs";

function fixture() {
  const calls = [];
  const state = { uid: 0, gid: 0, groups: [0] };
  const os = {
    platform: "linux", pid: 1234, env: { NODE_OPTIONS: NATIVE_NODE_OPTIONS },
    getuid: () => state.uid, getgid: () => state.gid, getgroups: () => state.groups,
    setgroups: value => { calls.push(["setgroups", value]); state.groups = value; },
    setgid: value => { calls.push(["setgid", value]); state.gid = value; },
    setuid: value => { calls.push(["setuid", value]); state.uid = value; },
  };
  const filesystem = {
    openSync: (...values) => { calls.push(["open", ...values]); return 7; },
    readFileSync: filename => { calls.push(["read", filename]); return "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n"; },
    writeFileSync: (fd, bytes) => { calls.push(["write", fd]); state.record = JSON.parse(bytes); },
    closeSync: fd => calls.push(["close", fd]),
  };
  return { calls, state, input: { observationPath: "/run/controller/native-role.json", os, filesystem } };
}

test("the already-executed Node process drops identity before loading the native CLI and records no environment", () => {
  const value = fixture();
  const result = enterNativeRole(value.input);
  assert.equal(result.transitioned, true);
  assert.equal(value.state.uid, NATIVE_ROLE_UID);
  assert.equal(value.state.gid, NATIVE_ROLE_UID);
  assert.deepEqual(value.state.groups, []);
  assert.deepEqual(value.calls.filter(call => call[0].startsWith("set")).map(call => call[0]), ["setgroups", "setgid", "setuid"]);
  assert.equal(value.calls[0][0], "open");
  assert.equal(value.calls.at(-1)[0], "close");
  assert.equal(value.state.record.pid, 1234);
  assert.equal(value.state.record.uid, NATIVE_ROLE_UID);
  assert.equal(value.state.record.capabilitiesEffective, "0000000000000000");
  assert.equal(Object.hasOwn(value.state.record, "env"), false);
});

test("same-role Node descendants neither regain privilege nor rewrite the controller observation", () => {
  const value = fixture();
  value.state.uid = NATIVE_ROLE_UID;
  assert.deepEqual(enterNativeRole(value.input), { transitioned: false });
  assert.deepEqual(value.calls, []);
});

for (const [name, change] of [
  ["wrong platform", value => { value.input.os.platform = "darwin"; }],
  ["unexpected uid", value => { value.state.uid = 1000; }],
  ["relative observation", value => { value.input.observationPath = "relative.json"; }],
  ["missing observation", value => { value.input.observationPath = undefined; }],
  ["missing inspector protection", value => { value.input.os.env.NODE_OPTIONS = "--import=/run/role-guard/native-role-entry.mjs"; }],
  ["failed identity transition", value => { value.input.os.setuid = () => {}; }],
  ["remaining capabilities", value => { value.input.filesystem.readFileSync = () => "NoNewPrivs:\t1\nCapEff:\t0000000000000001\n"; }],
  ["privilege regain permitted", value => { value.input.filesystem.readFileSync = () => "NoNewPrivs:\t0\nCapEff:\t0000000000000000\n"; }],
]) test(`native role refuses ${name} instead of certifying protection`, () => {
  const value = fixture();
  change(value);
  assert.throws(() => enterNativeRole(value.input), /native|role|privilege|observation|identity/i);
});

test("a transition error closes the pre-opened private observation without replacing the original error", () => {
  const value = fixture();
  const error = new Error("setuid failed");
  value.input.os.setuid = () => { throw error; };
  assert.throws(() => enterNativeRole(value.input), actual => actual === error);
  assert.deepEqual(value.calls.at(-1), ["close", 7]);
  assert.equal(value.calls.some(call => call[0] === "write"), false);
});

test("the real observation file is exclusive and contains only the completed scoped transition", () => {
  const value = fixture();
  delete value.input.filesystem;
  value.input.observationPath = path.join(workRoot("native-identity"), "identity.json");
  value.input.os.setuid = uid => { value.state.uid = uid; };
  value.input.filesystem = { ...fs, readFileSync: () => "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n" };
  enterNativeRole(value.input);
  assert.equal(fs.existsSync(value.input.observationPath), true);
  const record = JSON.parse(fs.readFileSync(value.input.observationPath));
  assert.equal(record.uid, NATIVE_ROLE_UID);
  assert.equal(fs.statSync(value.input.observationPath).mode & 0o777, 0o600);
  value.state.uid = 0;
  assert.throws(() => enterNativeRole(value.input), /exist/);
});
