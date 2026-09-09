import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { repository, dataRoot, workRoot } from "./helpers/paths.mjs";

const root = dataRoot;
const scratch = workRoot("contracts");
const repo = repository;
const load = (name) => import(pathToFileURL(join(repo, "evals/offline", name)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessionId = "judge-session";
const criteria = ["Frozen criterion A", "Frozen criterion B"];
const report = (status = "pass", verdicts = ["pass", "pass"]) => ({
  status, summary: "A supported fixed result.", reasoning: "The retained evidence supports the table.", observations: [],
  criteria: criteria.map((criterion, index) => ({ criterion, verdict: verdicts[index], evidence: "proof.txt:1" })),
});
const wrap = (event, boundSession = sessionId) => {
  const rawRecord = Buffer.from(`${JSON.stringify({ timestamp: "2026-09-04T00:00:00.000Z", ...event })}\n`);
  return { sessionId: boundSession, rawRecord, ref: { path: "sdk-events.jsonl", sessionId: boundSession, eventId: event.id, byteOffset: 0, byteLength: rawRecord.length, sha256: hash(rawRecord) } };
};
const start = (turnId = "supported-turn") => ({ id: "start", type: "assistant.turn_start", parentId: null, data: turnId === null ? {} : { turnId } });
const message = (id, calls, extra = {}) => ({ id, type: "assistant.message", parentId: "start", data: { messageId: id, turnId: "supported-turn", content: "", toolRequests: calls }, ...extra });
const idle = (data = { mode: "interactive", aborted: false }, extra = {}) => ({ id: "idle", type: "session.idle", parentId: null, data, ...extra });
const call = (toolCallId, arguments_ = report()) => ({ toolCallId, name: "report_result", arguments: arguments_ });
const normalize = async (events) => {
  const { normalizeJudgeObservations } = await load("admission.mjs");
  let offset = 0;
  const wrapped = events.map((event) => {
    const record = wrap(event);
    record.ref.byteOffset = offset;
    offset += record.ref.byteLength;
    return record;
  });
  return normalizeJudgeObservations({ sessionId, rootAgentId: null, expectedMode: "interactive", events: wrapped });
};

test("role materialization excludes held-out input from actor read AND write views and seeds real Git", async () => {
  const { materializeFixture, authorizeRolePath } = await load("materialize.mjs");
  const base = join(scratch, "materialize");
  mkdirSync(base, { recursive: true });
  const roots = { actor: join(base, "actor"), checker: join(base, "checker"), canonical: join(base, "canonical") };
  const identity = { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" };
  const result = await materializeFixture({
    manifest: JSON.parse(readFileSync(join(root, "fixture-manifest.json"))),
    fixtureId: "checker-enforcement-v1",
    sourceRoot: root,
    roots,
    actorEnvironment: { CONFIG_FILE: "/must-not-leak", CHECKER_CANARY_TOKEN: "must-not-leak", EVAL_SUBJECT_SNAPSHOT: "/must-not-leak" },
    gitIdentity: identity,
  });

  assert.equal(existsSync(join(roots.actor, "invalid-config.json")), false);
  assert.equal(existsSync(join(roots.actor, "checker-canary.mjs")), false);
  assert.equal(existsSync(join(roots.actor, "baseline.test.mjs")), true);
  for (const name of ["CONFIG_FILE", "CHECKER_CANARY_TOKEN", "EVAL_SUBJECT_SNAPSHOT"]) assert.equal(name in result.actorView.environment, false);
  for (const operation of ["read", "write"]) assert.throws(() => authorizeRolePath(result.actorView, join(roots.checker, "invalid-config.json"), operation));
  const actualBase = execFileSync("git", ["-C", roots.actor, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(result.gitSeed.baseCommit, actualBase);
  assert.equal(execFileSync("git", ["-C", roots.actor, "log", "-1", "--format=%cn|%ce"], { encoding: "utf8" }).trim(), "Ari Mendelow|ari@mendelow.me");
});

test("all fixed fixtures materialize their declared canonical-input role separately", async () => {
  const { materializeFixture } = await load("materialize.mjs");
  const manifest = JSON.parse(readFileSync(join(root, "fixture-manifest.json")));
  for (const fixture of manifest.fixtures) {
    const base = join(scratch, "all-roles", fixture.id);
    const roots = { actor: join(base, "actor"), checker: join(base, "checker"), canonical: join(base, "canonical") };
    let result;
    await assert.doesNotReject(async () => { result = await materializeFixture({ manifest, fixtureId: fixture.id, sourceRoot: root, roots, gitIdentity: { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" } }); });
    assert.equal(result.requiresAdmittedProducerBinding, fixture.requiresAdmittedProducerBinding);
    for (const file of fixture.files) {
      const roleRoot = { subject: roots.actor, held_out: roots.checker, canonical_fixture_input: roots.canonical }[file.role];
      assert.equal(hash(readFileSync(join(roleRoot, file.targetPath))), file.sha256);
    }
  }
});

test("child reports sharing a root call ID do not become root grades or conflicts", async () => {
  const result = await normalize([start(), message("root", [call("same")]), message("child", [call("same", report("fail", ["fail", "pass"]))], { agentId: "child-agent" }), idle()]);
  assert.equal(result.completeRootRequests.length, 1);
  assert.equal(result.excludedChildRequests.length, 1);
  assert.equal(result.conflictingCalls.length, 0);
});

test("one event with two complete root calls counts both; exact replay counts neither twice", async () => {
  const batch = message("batch", [call("one"), call("two")]);
  const result = await normalize([start(), batch, batch, idle()]);
  assert.equal(result.completeRootRequests.length, 2);
});

test("partial and unobserved arguments remain unavailable rather than presumed protocol failures", async () => {
  const partial = { id: "partial", type: "assistant.tool_call_delta", parentId: "start", data: { toolCallId: "partial-call", toolName: "report_result", inputDelta: '{"status":' } };
  const missing = message("missing", [{ toolCallId: "missing-call", name: "report_result" }]);
  const result = await normalize([start(), partial, missing, idle()]);
  assert.equal(result.completeRootRequests.length, 0);
  assert.equal(result.partialRootRequests.length, 1);
  assert.equal(result.unobservedRootRequests.length, 1);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.modelProtocolViolation, false);
});

test("complete null arguments are complete invalid input, not unobserved data", async () => {
  const result = await normalize([start(), message("null", [call("null-call", null)]), idle()]);
  assert.equal(result.completeRootRequests.length, 1);
  assert.equal(result.completeRootRequests[0].argumentsState, "complete");
});

test("missing supported turn IDs stay null rather than being invented", async () => {
  const event = message("one", [call("one")]);
  delete event.data.turnId;
  const result = await normalize([start(null), event, idle()]);
  assert.equal(result.completeRootRequests.length, 1, "a complete in-scope request must remain observable without a turn ID");
  assert.equal(result.completeRootRequests[0].turnId, null);
  assert.equal(result.completeRootRequests[0].scopeBasis, "observed-root-window");
});

test("conflicting complete payloads for a stable root call invalidate observation", async () => {
  const result = await normalize([start(), message("one", [call("one")]), message("changed", [call("one", report("fail", ["fail", "pass"]))]), idle()]);
  assert.equal(result.conflictingCalls.length, 1);
  assert.equal(result.admissionEligible, false);
});

test("unknown call metadata cannot demote an actually complete request to a partial one", async () => {
  const entry = { ...call("one"), partial: true };
  const result = await normalize([start(), message("one", [entry]), idle()]);
  assert.equal(result.completeRootRequests.length, 1);
});

test("event identity is scoped to the actual agent as well as the session", async () => {
  const result = await normalize([start(), message("same-event", [call("root")]), message("same-event", [call("child")], { agentId: "child" }), idle()]);
  assert.equal(result.completeRootRequests.length, 1);
  assert.equal(result.eventConflicts.length, 0);
});

for (const [name, ending] of [
  ["autopilot idle", idle({ mode: "autopilot", aborted: false })],
  ["child idle", idle({ mode: "interactive", aborted: false }, { agentId: "child" })],
  ["assistant idle", { ...idle(), type: "assistant.idle" }],
  ["unobserved idle semantics", idle({})],
  ["aborted root idle", idle({ mode: "interactive", aborted: true })],
]) {
  test(`${name} cannot substitute for successful qualified root idle`, async () => {
    const result = await normalize([start(), message("one", [call("one")]), ending]);
    assert.equal(result.rootIdle.eligible, false);
  });
}

for (const [name, value] of [
  ["fail with no failing criterion", report("fail")],
  ["investigate with no unclear criterion", report("investigate")],
  ["pass with a failed criterion", report("pass", ["fail", "pass"])],
  ["pass with an unclear criterion", report("pass", ["unclear", "pass"])],
  ["stringified criteria", { ...report(), criteria: JSON.stringify(report().criteria) }],
  ["blank text", { ...report(), summary: "   " }],
]) {
  test(`${name} receives strict failure rather than admission`, async () => {
    const { validateTerminalReport } = await load("admission.mjs");
    assert.equal(validateTerminalReport(value, { criteria, evidenceIndex: { files: ["proof.txt"] } }).ok, false);
  });
}

test("extra-rubric concerns remain visible without changing an all-pass fixed score", async () => {
  const { validateTerminalReport } = await load("admission.mjs");
  const value = { ...report(), observations: [{ kind: "suggestion", description: "An unrelated future concern." }] };
  const result = validateTerminalReport(value, { criteria, evidenceIndex: { files: ["proof.txt"] } });
  assert.equal(result.ok, true);
  assert.equal(result.value.status, "pass");
  assert.equal(result.value.unexpectedConcerns.length, 1);
});

test("mixed fail and unclear follows the stated rubric without suppressing the failed row", async () => {
  const { validateTerminalReport } = await load("admission.mjs");
  for (const status of ["fail", "investigate"]) {
    const result = validateTerminalReport(report(status, ["fail", "unclear"]), { criteria, evidenceIndex: { files: ["proof.txt"] } });
    assert.equal(result.ok, true);
    assert.equal(result.value.criteria[0].verdict, "fail");
  }
});

test("the production reader routes through maintained index validation but never the unbounded read helpers", async () => {
  const { createEvidenceReader } = await load("evidence.mjs");
  const maintained = await import("../vendor/gauntlet/src/context/scoped-read.ts");
  const directory = join(scratch, "reader");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "proof.txt"), "abcdef");
  let parsed = 0;
  let validated = 0;
  const gauntlet = {
    parseEvidenceIndex: (...args) => { parsed += 1; return maintained.parseEvidenceIndex(...args); },
    validateEvidenceIndex: (...args) => { validated += 1; return maintained.validateEvidenceIndex(...args); },
    readEvidenceFile: () => { throw new Error("UNADOPTED_UNBOUNDED_ROUTE"); },
    readWorkspaceFile: () => { throw new Error("UNADOPTED_UNBOUNDED_ROUTE"); },
  };
  const reader = createEvidenceReader({ root: directory, index: { files: ["proof.txt"] }, gauntlet });
  assert.deepEqual(reader.read("proof.txt", 0, 3), { text: "abc", totalCharacters: 6, nextOffset: 3 });
  assert.ok(parsed > 0);
  assert.ok(validated > 0);
});

test("successful installed assertions without an actual source-commit link remain unavailable", async () => {
  const { assessCheck } = await load("checks.mjs");
  const expectation = JSON.parse(readFileSync(join(root, "check-expectations.json")))["external-consumer-works"];
  const result = assessCheck({ definition: expectation, observation: {
    exitCode: 0,
    externalAssertionsComplete: true,
    matrix: [{ arguments: [], observed: 3 }, { arguments: [5], observed: 5 }, { arguments: [0], observed: 0 }],
    archiveSha256: hash("fixture archive"),
    sourceCommit: null,
    candidateGrade: false,
  } });
  assert.equal(result.status, "unavailable");
});

test("a bare boolean or PID without owned spawn/exit evidence is not cleanup proof", async () => {
  const { validateCleanupReceipt } = await load("copilot-runner.mjs");
  for (const receipt of [true, { complete: true }, { runId: "run", pid: 123, exited: true }]) {
    assert.equal(validateCleanupReceipt(receipt, { runId: "run" }).ok, false);
  }
});

test("the probe's expected red oracle can pass its preservation check but missing trace cannot", async () => {
  const { assessCheck } = await load("checks.mjs");
  const definition = JSON.parse(readFileSync(join(root, "check-expectations.json")))["probe-no-authority-escalation"];
  const observation = { oracleExit: 1, challengeExit: 0, observedValue: 3, target: "approved", targetVerified: true, sourceChanged: false, remoteOrDefaultMutation: false, traceCoverage: "complete", rawRefs: [{ path: "probe.raw", sha256: hash("probe") }] };
  assert.equal(assessCheck({ definition, observation }).status, "pass");
  assert.equal(assessCheck({ definition, observation: { ...observation, traceCoverage: "unavailable" } }).status, "unavailable");
  assert.equal(assessCheck({ definition, observation: { ...observation, target: "approved-copy" } }).status, "fail");
});

for (const dimension of ["model", "model_pair", "subject_model", "judge_model"]) {
  test(`${dimension} is unsupported in alpha instead of producing a ranking`, async () => {
    const { checkComparisonCompatibility } = await load("comparison.mjs");
    const result = checkComparisonCompatibility({ leftPlan: { comparison: { dimension } }, rightPlan: { comparison: { dimension } }, leftCells: { cells: [] }, rightCells: { cells: [] } });
    assert.equal(result.compatible, false);
    assert.equal(result.reason, "MODEL_COMPARISON_UNSUPPORTED_IN_ALPHA");
  });
}

test("lack of actual observed subject activation stays unavailable rather than inferred from requested names", async () => {
  const { validateActivationReceipt } = await load("copilot-runner.mjs");
  const requested = { subjectAgent: "configured-subject-agent", compositionSeam: "desk:superpowers-integration", requestedConfigurationSha256: hash("config") };
  assert.equal(validateActivationReceipt({ requested, observed: null }).availability, "unavailable");
  assert.equal(validateActivationReceipt({ requested, observed: { reconstructedFromProse: true } }).availability, "unavailable");
});

test("a same-session report before the root dispatch window is not a current root request", async () => {
  const result = await normalize([message("old", [call("old")]), start(), idle()]);
  assert.equal(result.completeRootRequests.length, 0);
  assert.equal(result.outOfScopeRequests.length, 1);
  assert.equal(result.admissionEligible, false);
  assert.equal(result.modelProtocolViolation, false);
});

test("a report carrying another supported turn ID cannot enter this root turn", async () => {
  const event = message("other-turn", [call("other")]);
  event.data.turnId = "another-turn";
  const result = await normalize([start(), event, idle()]);
  assert.equal(result.completeRootRequests.length, 0);
  assert.equal(result.outOfScopeRequests.length, 1);
  assert.equal(result.admissionEligible, false);
});

test("complete SDK arguments may follow partial or unobserved argument records", async () => {
  const partial = { id: "partial", type: "assistant.tool_call_delta", data: { toolCallId: "one", toolName: "report_result", inputDelta: "{}" } };
  const result = await normalize([start(), partial, message("complete", [call("one")]), idle()]);
  assert.equal(result.completeRootRequests.length, 1);
  assert.equal(result.partialRootRequests.length, 0);
});

test("corrupt raw observation and strict report boundary errors remain explicit", async () => {
  const { normalizeJudgeObservations, validateTerminalReport } = await load("admission.mjs");
  const raw = wrap(start());
  raw.ref.sha256 = "0".repeat(64);
  const observed = normalizeJudgeObservations({ sessionId, rootAgentId: null, expectedMode: "interactive", events: [raw] });
  assert.equal(observed.availability, "unavailable");
  assert.equal(observed.captureErrors.length, 1);
  const base = report();
  for (const value of [{ ...base, status: "invalid" }, { ...base, criteria: [] }, { ...base, observations: [{ kind: "bug", description: " " }] }, { ...base, criteria: base.criteria.map(row => ({ ...row, evidence: "not-indexed.txt:1" })) }]) assert.equal(validateTerminalReport(value, { criteria, evidenceIndex: { files: ["proof.txt"] } }).ok, false);
  assert.equal(validateTerminalReport(base).ok, false);
  assert.equal(validateTerminalReport(base, { criteria, evidenceIndex: { files: ["../outside"] } }).ok, false);
});

test("unidentified calls and out-of-root argument progress remain non-admissible observations", async () => {
  const unidentified = await normalize([start(), { id: "noise", type: "session.info" }, message("no-id", [call(null)]), idle()]);
  assert.equal(unidentified.admissionEligible, false);
  assert.equal(unidentified.completeRootRequests[0].toolCallId, null);
  const partial = { id: "old-partial", type: "assistant.tool_call_delta", data: { toolCallId: "old", toolName: "report_result", inputDelta: "{}" } };
  const outside = await normalize([partial, message("old-complete", [call("old")]), start(), idle()]);
  assert.equal(outside.outOfScopeRequests[0].argumentsState, "complete");
  assert.equal(outside.admissionEligible, false);
});

test("a named-root admission with the default clock cannot invent a completed dispatch", async () => {
  const { createReportAdmission } = await load("admission.mjs");
  const admission = createReportAdmission({ runId: "default-clock", sessionId, rootAgentId: "root-agent", expectedMode: "interactive", criteria, evidenceIndex: { files: ["proof.txt"] }, schemaSha256: hash("schema"), deadlineAt: Date.now() + 10000 });
  assert.equal(admission.finish({ endReason: "startup_failed" }).grade, null);
});

test("reused call IDs in distinct observed root turns remain two actual requests", async () => {
  const second = message("second-message", [call("reused")]);
  second.data.turnId = "second-turn";
  const secondStart = { ...start("second-turn"), id: "second-start" };
  const result = await normalize([start(), message("first-message", [call("reused")]), secondStart, second, idle()]);
  assert.equal(result.completeRootRequests.length, 2);
  assert.deepEqual(result.completeRootRequests.map(request => request.turnId), ["supported-turn", "second-turn"]);
});
