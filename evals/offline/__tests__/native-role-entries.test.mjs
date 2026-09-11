import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { enterNativeRole, prepareNativeRole, probeNativeRole, NATIVE_NODE_OPTIONS } from "../native-identity.mjs";

test("the actual preload entry records the transition, while an unprivileged descendant may omit its private path", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const environment = { NODE_OPTIONS: process.env.NODE_OPTIONS, OFFLINE_ROLE_OBSERVATIONS: process.env.OFFLINE_ROLE_OBSERVATIONS };
  let uid = 0;
  let gid = 0;
  let groups = [0];
  let record;
  const target = `/run/controller/role-observations/${process.pid}.json`;
  const originals = Object.fromEntries(["openSync", "writeFileSync", "closeSync", "readFileSync"].map(name => [name, fs[name]]));
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
    process.env.NODE_OPTIONS = NATIVE_NODE_OPTIONS;
    process.env.OFFLINE_ROLE_OBSERVATIONS = "/run/controller/role-observations";
    t.mock.method(process, "getuid", () => uid);
    t.mock.method(process, "getgid", () => gid);
    t.mock.method(process, "getgroups", () => groups);
    t.mock.method(process, "setuid", value => { uid = value; });
    t.mock.method(process, "setgid", value => { gid = value; });
    t.mock.method(process, "setgroups", value => { groups = value; });
    t.mock.method(fs, "openSync", (name, ...args) => name === target ? 9876 : originals.openSync(name, ...args));
    t.mock.method(fs, "writeFileSync", (fd, data, ...args) => fd === 9876 ? (record = JSON.parse(data)) : originals.writeFileSync(fd, data, ...args));
    t.mock.method(fs, "closeSync", fd => fd === 9876 ? undefined : originals.closeSync(fd));
    t.mock.method(fs, "readFileSync", (name, ...args) => name === "/proc/self/status" ? "NoNewPrivs:\t1\nCapEff:\t0000000000000000\n" : originals.readFileSync(name, ...args));
    await import("../native-role-entry.mjs?root-entry");
    assert.equal(record.uid, 65534);
    assert.equal(record.pid, process.pid);
    delete process.env.OFFLINE_ROLE_OBSERVATIONS;
    await import("../native-role-entry.mjs?child-entry");
    assert.equal(uid, 65534);
  } finally {
    Object.defineProperty(process, "platform", descriptor);
    for (const [key, value] of Object.entries(environment)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.mock.restoreAll();
  }
});

test("the real probe entry uses its declared PID and never reads protected file contents", async t => {
  const argv = process.argv;
  const originalRead = fs.readFileSync;
  const originalOpen = fs.openSync;
  const originalLink = fs.readlinkSync;
  const originalWrite = process.stdout.write;
  let captured;
  const denied = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
  try {
    process.argv = [process.execPath, "native-role-probe-entry.mjs", "4321"];
    t.mock.method(process, "getuid", () => 65534);
    t.mock.method(process, "setuid", () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); });
    t.mock.method(fs, "readFileSync", (name, ...args) => name === "/proc/4321/status" ? "Uid:\t65534\t65534\t65534\t65534\n" : originalRead(name, ...args));
    t.mock.method(fs, "openSync", (name, ...args) => typeof name === "string" && name.startsWith("/proc/4321/") ? denied() : originalOpen(name, ...args));
    t.mock.method(fs, "readlinkSync", (name, ...args) => name === "/proc/4321/fd/0" ? denied() : originalLink(name, ...args));
    t.mock.method(process.stdout, "write", function (value, ...args) {
      if (typeof value === "string" && value.startsWith('{"probeUid"')) { captured = JSON.parse(value); return true; }
      return originalWrite.call(this, value, ...args);
    });
    await import("../native-role-probe-entry.mjs?entry");
    assert.equal(captured.targetUid, 65534);
    assert.equal(captured.environ, "EACCES");
    assert.equal(captured.descriptor, "EACCES");
  } finally {
    process.argv = argv;
    t.mock.restoreAll();
  }
});

test("default preparation and probe adapters refuse before any uncontrolled host mutation", t => {
  const failure = new Error("isolated filesystem unavailable");
  t.mock.method(fs, "mkdirSync", () => { throw failure; });
  assert.throws(() => prepareNativeRole(), error => error === failure);
  assert.throws(() => probeNativeRole({ pid: 0, timeoutMs: 1 }), /PID/);
  assert.throws(() => enterNativeRole({ observationPath: undefined }), /native/i);
});
