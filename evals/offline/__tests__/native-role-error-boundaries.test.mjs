import assert from "node:assert/strict";
import test from "node:test";
import { enterNativeRole, inspectNativeRole, NATIVE_NODE_OPTIONS } from "../native-identity.mjs";

test("a successful protected-file open is not relabelled denied when closing the descriptor fails", () => {
  const result = inspectNativeRole({
    pid: 4321,
    os: { getuid: () => 65534, setuid: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); } },
    filesystem: {
      readFileSync: () => "Uid:\t65534\t65534\t65534\t65534\n",
      openSync: () => 9,
      closeSync: () => { throw Object.assign(new Error("close failed"), { code: "EACCES" }); },
      readlinkSync: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
    },
  });
  assert.match(result.environ, /^opened/);
  assert.match(result.memory, /^opened/);
});

test("both the primary transition error and private-descriptor cleanup error remain observable", () => {
  const primary = new Error("transition failed");
  const secondary = new Error("descriptor cleanup failed");
  assert.throws(() => enterNativeRole({
    observationPath: "/run/controller/identity.json",
    os: { platform: "linux", getuid: () => 0, env: { NODE_OPTIONS: NATIVE_NODE_OPTIONS }, setgroups: () => {}, setgid: () => {}, setuid: () => { throw primary; } },
    filesystem: { openSync: () => 9, closeSync: () => { throw secondary; } },
  }), error => error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === secondary);
});
