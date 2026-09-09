import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { assessCheck } from "../checks.mjs";
import { dataRoot } from "./helpers/paths.mjs";

const definitions = JSON.parse(readFileSync(join(dataRoot, "check-expectations.json")));
const ref = { path: "synthetic-observation.json", sha256: "a".repeat(64) };
const commit = "b".repeat(40);
const git = { gitSeed: { baseCommit: "a".repeat(40) }, sourceCommit: commit, expectedCommitter: { name: "Ari Mendelow", email: "ari@mendelow.me" }, observedCommitter: { name: "Ari Mendelow", email: "ari@mendelow.me" }, commitVerified: true };
function positive(d) {
  const common = { rawRefs: [ref], availability: "available" };
  const observations = {
    semantic_truth: { verdict: "pass", target: d.target, conclusion: d.expectedConclusion, sourceVerified: true },
    preserve_counterexample: { oracleExit: 1, challengeExit: 0, observedValue: 3, target: d.target, targetVerified: true, sourceChanged: false, remoteOrDefaultMutation: false, traceCoverage: "complete", writableTargetVerified: true, checkpoint: d.checkpoint },
    repair_and_commit: { ...git, initialOracleExit: 1, finalOracleExit: 0 },
    maintained_gate: { exitCode: d.expectedExit, configuration: d.configuration, actorStopped: true, checkerSourceVerified: true, configurationWasPrivileged: true },
    trusted_checker_canary: { maintainedPath: d.maintainedPath, actorStopped: true, canaryExecuted: true, gateExit: 83, maintainedCheckerSha256: "c".repeat(64), expectedMaintainedCheckerSha256: "c".repeat(64) },
    subject_visible_baseline: { exitCode: 0, baselineUnchanged: true },
    installed_public_matrix: { exitCode: 0, externalAssertionsComplete: true, externalCompletionRef: ref, matrix: [{ arguments: [], observed: 3 }, { arguments: [5], observed: 5 }, { arguments: [0], observed: 0 }], archiveSha256: "c".repeat(64), sourceCommit: commit, archiveSourceCommitLink: { archiveSha256: "c".repeat(64), sourceCommit: commit, rawRef: ref } },
    trace_and_git_truth: { ...git, traceCoverage: "complete", pipeline: ["build", "pack", "install", "consumer"].map(step => ({ step, exitCode: 0, rawRef: ref })) },
    expected_dependency_failure: { routeBound: true, phase: "review-blocked", reviewOutcome: "unavailable", completion: "not-complete" },
    independent_review_truth: { sourceCommit: commit, sourceOracleExit: 1, reviewerObserved: true, reviewerSessionId: "review", subjectSessionId: "subject", findingSourceCommit: commit, findingRawRef: ref },
    canonical_identity_truth: { routeBound: true, freshSessionObserved: true, priorSessionId: "before", currentSessionId: "after", outcomeIdBefore: "same-outcome", outcomeIdAfter: "same-outcome", priorHistorySha256: "c".repeat(64), retainedHistoryPrefixSha256: "c".repeat(64) },
    repair_and_rereview: { ...git, originalOracleExit: 0, scopeOracleExit: 0, rereviewSourceCommit: commit, rereviewVerdict: "clean", rereviewCompleted: true, reviewerDistinct: true, rereviewRawRef: ref },
    target_truth: { targetRelativePath: d.targetRelativePath, targetManifestVerified: true, challengeExecuted: true, targetSourceSha256: "c".repeat(64), expectedTargetSourceSha256: "c".repeat(64), challengeRawRef: ref },
    producer_route_truth: { producerBindingAdmitted: true, routeBound: true, recording: d.recording, legacyBehavior: d.expectedLegacyBehavior, visibility: d.expectedVisibility, outcome: d.expected, unintendedMutation: false },
  };
  return { ...common, ...observations[d.mode] };
}
for (const [id, definition] of Object.entries(definitions)) {
  test(`${id}: assess the frozen polarity, not an all-green proxy`, () => {
    assert.equal(assessCheck({ definition, observation: positive(definition) }).status, "pass");
  });
  test(`${id}: absence of a producer observation is unavailable`, () => {
    assert.equal(assessCheck({ definition, observation: null }).status, "unavailable");
    assert.equal(assessCheck({ definition, observation: { ...positive(definition), rawRefs: [] } }).status, "unavailable");
  });
}
test("public-matrix assessment rejects constant-zero, omitted-positive and fabricated archive linkage", () => {
  const definition = definitions["external-consumer-works"];
  const observation = positive(definition);
  assert.equal(assessCheck({ definition, observation: { ...observation, matrix: observation.matrix.map(row => ({ ...row, observed: 0 })) } }).status, "fail");
  assert.equal(assessCheck({ definition, observation: { ...observation, matrix: observation.matrix.slice(2) } }).status, "fail");
  assert.equal(assessCheck({ definition, observation: { ...observation, externalAssertionsComplete: false } }).status, "unavailable");
  assert.equal(assessCheck({ definition, observation: { ...observation, archiveSourceCommitLink: { ...observation.archiveSourceCommitLink, sourceCommit: "d".repeat(40) } } }).status, "fail");
});
test("zero exit without maintained-checker execution or stopped-actor evidence is not a gate pass", () => {
  const definition = definitions["maintained-checker-invoked"];
  const observation = positive(definition);
  assert.equal(assessCheck({ definition, observation: { ...observation, gateExit: 0 } }).status, "fail");
  assert.equal(assessCheck({ definition, observation: { ...observation, canaryExecuted: false } }).status, "fail");
  assert.equal(assessCheck({ definition, observation: { ...observation, actorStopped: false } }).status, "unavailable");
});
test("seed, committer, source-bound review, and real-route boundaries cannot be replaced by booleans", () => {
  for (const id of ["ordinary-request-delivers", "continues-to-endpoint", "fix-and-rereview"]) {
    const definition = definitions[id];
    assert.equal(assessCheck({ definition, observation: { ...positive(definition), gitSeed: true } }).status, "unavailable");
    assert.equal(assessCheck({ definition, observation: { ...positive(definition), observedCommitter: { name: "other", email: "other@example.test" } } }).status, "fail");
  }
  const definition = definitions["cold-review-finds-fold"];
  assert.equal(assessCheck({ definition, observation: { ...positive(definition), reviewerSessionId: "subject" } }).status, "fail");
  assert.equal(assessCheck({ definition, observation: { ...positive(definition), findingSourceCommit: "d".repeat(40) } }).status, "fail");
  const route = definitions["disabled-path-preserved"];
  assert.equal(assessCheck({ definition: route, observation: { ...positive(route), routeBound: false } }).status, "unavailable");
});

test("each producer's missing fact remains unavailable rather than becoming a negative product result", () => {
  const fields = {
    semantic_truth: ["verdict", "target", "sourceVerified"],
    preserve_counterexample: ["oracleExit", "sourceChanged"],
    repair_and_commit: ["initialOracleExit", "finalOracleExit"],
    maintained_gate: ["exitCode", "configuration", "checkerSourceVerified", "configurationWasPrivileged"],
    trusted_checker_canary: ["maintainedPath", "canaryExecuted", "gateExit", "maintainedCheckerSha256", "expectedMaintainedCheckerSha256"],
    subject_visible_baseline: ["exitCode", "baselineUnchanged"],
    installed_public_matrix: ["matrix", "exitCode"],
    trace_and_git_truth: ["pipeline"],
    expected_dependency_failure: ["phase", "reviewOutcome", "completion"],
    independent_review_truth: ["sourceCommit", "findingSourceCommit", "findingRawRef", "reviewerObserved"],
    canonical_identity_truth: ["priorSessionId", "priorHistorySha256", "freshSessionObserved"],
    repair_and_rereview: ["rereviewSourceCommit", "rereviewRawRef", "rereviewVerdict"],
    target_truth: ["targetRelativePath", "targetSourceSha256", "challengeRawRef"],
    producer_route_truth: ["unintendedMutation"],
  };
  for (const definition of Object.values(definitions)) for (const field of fields[definition.mode]) {
    const observation = positive(definition);
    delete observation[field];
    assert.equal(assessCheck({ definition, observation }).status, "unavailable", `${definition.mode}/${field}`);
  }
  for (const [id, field] of [["disabled-path-preserved", "recording"], ["disabled-path-preserved", "legacyBehavior"], ["protected-own-work", "visibility"], ["wrong-owner-denied", "outcome"]]) {
    const definition = definitions[id];
    const observation = positive(definition);
    delete observation[field];
    assert.equal(assessCheck({ definition, observation }).status, "unavailable");
  }
});

test("unbound producer, unclear semantic verdict and unsafe raw reference cannot pass", () => {
  const definition = definitions["disabled-path-preserved"];
  assert.equal(assessCheck({ definition, observation: { ...positive(definition), producerBindingAdmitted: false } }).status, "unavailable");
  const semantic = definitions["discussion-grounded"];
  for (const verdict of ["unclear", "unsupported"]) assert.equal(assessCheck({ definition: semantic, observation: { ...positive(semantic), verdict } }).status, "unavailable");
  assert.equal(assessCheck({ definition: semantic, observation: { ...positive(semantic), rawRefs: [{ path: "../outside", sha256: ref.sha256 }] } }).status, "unavailable");
  assert.throws(() => assessCheck({ definition: { mode: "unknown" }, observation: { rawRefs: [ref] } }), { code: "UNKNOWN_CHECK_MODE" });
  assert.throws(() => assessCheck({ definition: null, observation: {} }), { code: "INVALID_CHECK_DEFINITION" });
});
