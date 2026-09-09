import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { jsonBytes, sha256 } from "../core.mjs";
import { fixture } from "./helpers/native-sdk.mjs";
import { engine, plan, response } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("artifact count is bounded before new files are written and capture failure does not skip owned cleanup", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const value = plan();
  value.limits.startupSendWorkMs = 10000;
  value.limits.cleanupMs = 3000;
  const bytes = jsonBytes({ fixture: true });
  const extras = Array.from({ length: 260 }, (_, index) => ({ kind: "artifact", ref: { path: `extra-${index}.json`, sha256: sha256(bytes), byteLength: bytes.length }, base64: bytes.toString("base64") }));
  control.state.records.splice(-1, 0, ...extras);
  const fake = engine(value, { running: true, stdout: control.state.records.map(row => JSON.stringify(row)).join("\n") + "\n" });
  const outputRoot = path.join(workRoot("native-file-budget"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.ok(fs.readdirSync(outputRoot).length <= 256, "The fixed inventory cap must apply before publication, not after excessive writes.");
  assert.equal(result.failure.code, "NATIVE_CAPTURE_LIMIT");
  assert.equal(fake.state.removed, true);
  assert.equal(result.cleanup.evidenceAvailability, "unavailable");
  assert.equal(fs.existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});

test("individually bounded captures also have an aggregate pre-write budget", async t => {
  const value = plan();
  value.limits.maxStreamBytes = 16777216;
  value.limits.startupSendWorkMs = 10000;
  value.limits.cleanupMs = 3000;
  const outputRoot = path.join(workRoot("native-byte-budget"), "attempt");
  const large = Buffer.alloc(16777216, "x");
  const fake = engine(value, { running: true, execution: { ...response("", 1), stderr: large } });
  const execute = (command, argv, settings) => {
    const result = fake.execute(command, argv, settings);
    if (command === "docker" && argv[0] !== "start") result.stderr = large;
    return result;
  };
  const realWrite = fs.writeFileSync;
  const realAppend = fs.appendFileSync;
  // The I/O fixture observes requested writes without allocating large test files.
  for (const [name, real] of [["writeFileSync", realWrite], ["appendFileSync", realAppend]]) t.mock.method(fs, name, (filename, bytes, options) => {
    if (String(filename).startsWith(outputRoot) && Buffer.isBuffer(bytes) && bytes.length >= large.length) return;
    return real(filename, bytes, options);
  });
  syncBuiltinESMExports();
  try {
    const result = await runRuntimeQualification({ plan: value, outputRoot, execute });
    assert.equal(result.failure?.code, "NATIVE_CAPTURE_LIMIT");
    assert.equal(fake.state.removed, true);
    assert.equal(result.grade, null);
    assert.equal(fs.existsSync(path.join(outputRoot, "COMMITTED.json")), false);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});
