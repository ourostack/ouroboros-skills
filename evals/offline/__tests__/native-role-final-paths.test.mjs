import assert from "node:assert/strict";
import test from "node:test";
import { enterNativeRole, NATIVE_NODE_OPTIONS } from "../native-identity.mjs";
import { createProcessObserver } from "../native-protocol.mjs";

function input(groups, closeSync = () => {}) {
  let uid = 0;
  return {
    observationPath: "/run/controller/identity.json",
    os: { platform: "linux", pid: 1234, env: { NODE_OPTIONS: NATIVE_NODE_OPTIONS }, getuid: () => uid, getgid: () => 65534, getgroups: () => groups, setgroups: () => {}, setgid: () => {}, setuid: value => { uid = value; } },
    filesystem: { openSync: () => 9, readFileSync: () => "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n", writeFileSync: () => {}, closeSync },
  };
}
test("the primary group reported by Node is permitted, but a retained privileged group is not", () => {
  assert.equal(enterNativeRole(input([65534])).transitioned, true);
  assert.throws(() => enterNativeRole(input([65534, 0])), /identity/);
});
test("a descriptor-close failure after a successful transition remains a failure in its own right", () => {
  const error = new Error("close failed");
  assert.throws(() => enterNativeRole(input([65534], () => { throw error; })), actual => actual === error);
});
test("the standard process observer refuses an invalid probe PID before spawning any host command", () => {
  assert.throws(() => createProcessObserver().probe(0, 1), /PID/);
});
