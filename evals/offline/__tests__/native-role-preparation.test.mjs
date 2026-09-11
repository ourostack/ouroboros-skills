import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareNativeRole, NATIVE_NODE_OPTIONS, NATIVE_ROLE_UID } from "../native-identity.mjs";

test("role preparation leaves the controller private and creates only the declared writable runtime and readable guard", () => {
  const calls = [];
  const filesystem = Object.fromEntries(["mkdirSync", "chownSync", "copyFileSync", "chmodSync"].map(name => [name, (...args) => calls.push([name, ...args])]));
  const result = prepareNativeRole({ filesystem });
  assert.equal(result.root, "/work/native-runtime");
  assert.deepEqual(result.env, { NODE_OPTIONS: NATIVE_NODE_OPTIONS, OFFLINE_ROLE_OBSERVATIONS: "/run/controller/role-observations" });
  for (const directory of [result.root, ...["home", "state", "work", "runtime-work"].map(name => path.posix.join(result.root, name))]) {
    assert.equal(calls.some(([operation, target, options]) => operation === "mkdirSync" && target === directory && options.mode === 0o700 && !options.recursive), true);
    assert.equal(calls.some(([operation, target, uid, gid]) => operation === "chownSync" && target === directory && uid === NATIVE_ROLE_UID && gid === NATIVE_ROLE_UID), true);
  }
  assert.equal(calls.some(([operation, target]) => operation === "chownSync" && target.startsWith("/run/controller")), false);
  assert.equal(calls.some(([operation, target, options]) => operation === "mkdirSync" && target === "/run/controller/role-observations" && options.mode === 0o700), true);
  for (const name of ["native-identity.mjs", "native-role-entry.mjs"]) {
    const copy = calls.find(([operation, source, target]) => operation === "copyFileSync" && source.endsWith(`/${name}`) && target === `/run/role-guard/${name}`);
    assert.equal(Boolean(copy), true);
    assert.equal(copy[3], fs.constants.COPYFILE_EXCL);
    assert.equal(calls.some(([operation, target, mode]) => operation === "chmodSync" && target === `/run/role-guard/${name}` && mode === 0o444), true);
  }
});

test("a conflicting or unavailable role directory refuses preparation instead of reusing another runtime", () => {
  const error = Object.assign(new Error("exists"), { code: "EEXIST" });
  assert.throws(() => prepareNativeRole({ filesystem: { mkdirSync: () => { throw error; } } }), value => value === error);
});
