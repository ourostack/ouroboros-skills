import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { runTerminalProtocol } from "../native-protocol.mjs";
import { readCommittedRun } from "../output.mjs";
import { fixture } from "./helpers/native-sdk.mjs";
import { engine, plan, response, sentinel } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("the full fixed transport publishes observed control evidence with no admitted product grade", async () => {
  const control = fixture();
  await runTerminalProtocol(control.input);
  const value = plan();
  const fake = engine(value, { stdout: control.state.records.map(row => JSON.stringify(row)).join("\n") + "\n" });
  const outputRoot = path.join(workRoot("native-complete-transport"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "component_observed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.qualified, false);
  assert.equal(result.grade, null);
  assert.deepEqual(result.counts, { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 });
  const committed = readCommittedRun(outputRoot);
  assert.equal(committed.receipt.status, "unavailable");
  assert.equal(committed.receipt.grade, null);
  assert.ok(readFileSync(path.join(outputRoot, "sdk-events.jsonl")).length > 0);
  assert.equal(result.cleanup.removed, true);
});

test("a truncated native record cannot erase the observed outer timeout", async () => {
  const value = plan();
  const fake = engine(value, { execution: { ...response('{"unfinished":', null), error: Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }) } });
  const outputRoot = path.join(workRoot("native-truncated-timeout"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "timed_out");
  assert.equal(result.grade, null);
  assert.equal(readFileSync(path.join(outputRoot, "stdout.raw"), "utf8"), '{"unfinished":');
});

test("an outer deadline exhausted by initial acquisition starts no container and remains a timeout", async () => {
  const value = plan();
  let now = 0;
  const fake = engine(value, { before: command => { if (command === "gh") now = 2000; } });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-initial-deadline"), "attempt"), execute: fake.execute, clock: () => now });
  assert.equal(fake.state.calls.some(call => call.argv[0] === "create"), false);
  assert.equal(result.status, "timed_out");
  assert.equal(result.cleanup.absenceObserved, true);
});

test("owned running containers are killed, observed exited and removed without name-based process cleanup", async () => {
  const value = plan();
  const fake = engine(value, { running: true, execution: response("", 1) });
  const result = await runRuntimeQualification({ plan: value, outputRoot: path.join(workRoot("native-owned-kill"), "attempt"), execute: fake.execute });
  assert.equal(result.cleanup.ownershipVerified, true);
  assert.equal(result.cleanup.exited, true);
  assert.equal(result.cleanup.removed, true);
  assert.ok(fake.state.calls.some(call => call.argv[0] === "kill" && call.argv[1] === fake.state.id));
});

test("credential-bearing control output is withheld rather than normalized into persisted raw evidence", async () => {
  const value = plan();
  const fake = engine(value, { create: response(sentinel, 1) });
  const outputRoot = path.join(workRoot("native-capture-withheld"), "attempt");
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.notEqual(result.status, "component_observed");
  assert.equal(existsSync(path.join(outputRoot, "COMMITTED.json")), false);
  assert.equal(existsSync(path.join(outputRoot, "01-create.stdout.raw")), false);
});

test("a final artifact write fault preserves the original null-grade incomplete envelope", async () => {
  const value = plan();
  const outputRoot = path.join(workRoot("native-final-fault"), "attempt");
  const fake = engine(value, { auth: response("", 1), before: command => { if (command === "gh") writeFileSync(path.join(outputRoot, "qualification.json"), "controlled competing write"); } });
  const result = await runRuntimeQualification({ plan: value, outputRoot, execute: fake.execute });
  assert.equal(result.status, "publication_failed");
  assert.equal(JSON.parse(readFileSync(path.join(outputRoot, "receipt.incomplete.json"))).grade, null);
  assert.equal(existsSync(path.join(outputRoot, "COMMITTED.json")), false);
});
