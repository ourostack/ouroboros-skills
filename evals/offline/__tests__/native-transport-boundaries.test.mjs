import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { engine, plan, response, sentinel } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("the fixed route never pulls a missing image and bounds owned transport children with SIGKILL", async () => {
  const value = plan();
  const fake = engine(value, { execution: response("", 1) });
  await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-local-runtime-only"), "attempt"), execute: fake.execute });
  assert.deepEqual({ neverPull: fake.state.created.includes("--pull=never"), killSignals: [...new Set(fake.state.calls.map(call => call.settings.killSignal))] }, { neverPull: true, killSignals: ["SIGKILL"] });
});

test("a decoded transport string is refused instead of being relabelled as authoritative raw bytes", async () => {
  const value = plan();
  const fake = engine(value, { create: { status: 0, stdout: "b".repeat(64), stderr: "" } });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-string-not-raw"), "attempt"), execute: fake.execute });
  assert.equal(fake.state.calls.some(call => call.argv[0] === "start"), false);
  assert.equal(result.failure.code, "NATIVE_RAW_BYTES_REQUIRED");
  assert.equal(result.grade, null);
});

test("missing spawn streams remain absent bytes rather than invented transport output", async () => {
  const value = plan();
  const fake = engine(value, { create: { status: null, error: Object.assign(new Error("not found"), { code: "ENOENT" }) } });
  const execute = (...args) => {
    const result = fake.execute(...args);
    if (args[1][0] === "create") fake.state.created = null;
    return result;
  };
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-absent-streams"), "attempt"), execute });
  assert.equal(result.cleanup.absenceObserved, true);
  assert.equal(result.observations[0].stdout.bytes, 0);
  assert.equal(result.observations[0].stderr.bytes, 0);
});

test("thrown transport values are recorded without leaking a credential or assuming an Error object", async () => {
  for (const [index, failure] of ["controlled plain failure", `controlled ${sentinel} failure`, new Error(`controlled ${sentinel} failure`)].entries()) {
    const value = plan();
    const fake = engine(value);
    const execute = (command, argv, settings) => {
      if (command === "docker") throw failure;
      return fake.execute(command, argv, settings);
    };
    const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot(`native-thrown-values-${index}`), "attempt"), execute });
    assert.equal(result.failure.code, null);
    assert.equal(JSON.stringify(result).includes(sentinel), false);
    assert.equal(result.cleanup.evidenceAvailability, "unavailable");
  }
});

test("missing process metadata is stated as null rather than synthesized from a successful inspect", async () => {
  const value = plan();
  const fake = engine(value, { execution: response("", 1), inspect: container => {
    delete container.State.Pid;
    delete container.State.ExitCode;
    delete container.State.FinishedAt;
  } });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-missing-state"), "attempt"), execute: fake.execute });
  assert.equal(result.cleanup.observedPid, null);
  assert.equal(result.cleanup.exitCode, null);
  assert.equal(result.cleanup.finishedAt, null);
  assert.equal(result.cleanup.removed, true);
});

test("unknown cleanup ownership never replaces the primary work deadline", async () => {
  const value = plan();
  let inspections = 0;
  const fake = engine(value, {
    execution: { ...response("", null), error: Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }) },
    inspect: container => { if (++inspections > 1) container.Config.Labels["offline.run-id"] = "foreign-run"; },
  });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-timeout-foreign-cleanup"), "attempt"), execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.cleanupStatus, "unverified");
  assert.equal(fake.state.calls.some(call => call.argv[0] === "rm"), false);
});

test("a final write fault does not erase a work timeout or publish a completion marker", async () => {
  const value = plan();
  const outputRoot = path.join(workRoot("native-timeout-write-fault"), "attempt");
  const fake = engine(value, {
    execution: { ...response('{"partial":', null), error: Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }) },
    before: (_command, argv) => { if (argv[0] === "start") writeFileSync(path.join(outputRoot, "qualification.json"), "controlled competing write"); },
  });
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.publicationFailure.code, "EEXIST");
  assert.equal(existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});

test("credential-bearing cleanup capture is withheld while the earlier timeout remains primary", async () => {
  const value = plan();
  const fake = engine(value, { execution: { ...response("", null), error: Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }) } });
  let started = false;
  const execute = (command, argv, settings) => {
    const result = fake.execute(command, argv, settings);
    if (argv[0] === "start") started = true;
    else if (started) result.stderr = Buffer.from(sentinel);
    return result;
  };
  const outputRoot = path.join(workRoot("native-timeout-secret-cleanup"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.cleanup.evidenceAvailability, "unavailable");
  assert.equal(JSON.stringify(result).includes(sentinel), false);
  assert.equal(existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});
