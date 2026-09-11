import assert from "node:assert/strict";
import test from "node:test";
import { inspectNativeRole, NATIVE_ROLE_UID } from "../native-identity.mjs";

function fixture(open = false) {
  const calls = [];
  return {
    calls,
    input: {
      pid: 4321, os: { getuid: () => NATIVE_ROLE_UID, setuid: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); } },
      filesystem: {
        readFileSync: filename => { calls.push(["read", filename]); return `Uid:\t${NATIVE_ROLE_UID}\t${NATIVE_ROLE_UID}\t${NATIVE_ROLE_UID}\t${NATIVE_ROLE_UID}\n`; },
        openSync: filename => { calls.push(["open", filename]); if (open) return 9; throw Object.assign(new Error("denied"), { code: "EACCES" }); },
        closeSync: fd => calls.push(["close", fd]),
        readlinkSync: filename => { calls.push(["link", filename]); if (open) return "pipe:[123]"; throw Object.assign(new Error("denied"), { code: "EACCES" }); },
      },
    },
  };
}
test("the inspection reads public UID metadata but only attempts opens and readlink on protected state", () => {
  const value = fixture();
  const result = inspectNativeRole(value.input);
  assert.deepEqual(result, { probeUid: NATIVE_ROLE_UID, targetUid: NATIVE_ROLE_UID, environ: "EACCES", memory: "EACCES", descriptor: "EACCES", rootRegain: "EPERM" });
  assert.deepEqual(value.calls.filter(call => call[0] === "read"), [["read", "/proc/4321/status"]]);
});
test("a readable counterexample is retained without reading or printing its credential bytes", () => {
  const value = fixture(true);
  const result = inspectNativeRole(value.input);
  assert.equal(result.environ, "opened");
  assert.equal(result.memory, "opened");
  assert.equal(result.descriptor, "readable");
  assert.equal(value.calls.filter(call => call[0] === "close").length, 2);
  assert.equal(value.calls.filter(call => call[0] === "read").length, 1);
});
test("mixed UID state, privilege regain and a missing target cannot prove a same-UID denial", () => {
  const value = fixture();
  value.input.filesystem.readFileSync = () => "Uid:\t65534\t0\t0\t0\n";
  value.input.os.setuid = () => {};
  const result = inspectNativeRole(value.input);
  assert.equal(result.targetUid, null);
  assert.equal(result.rootRegain, "succeeded");
  value.input.filesystem.readFileSync = () => { throw Object.assign(new Error("target gone"), { code: "ENOENT" }); };
  assert.throws(() => inspectNativeRole(value.input), /target gone/);
  assert.throws(() => inspectNativeRole({ ...value.input, pid: -1 }), /PID/);
});
