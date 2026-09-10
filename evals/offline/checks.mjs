import { hashString, nonblank, plainObject, relativeName, requireCondition } from "./core.mjs";

const commitHash = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const unavailable = reason => ({ status: "unavailable", reason, basis: "supplied-observations" });
const assessed = passed => ({ status: passed ? "pass" : "fail", basis: "supplied-observations" });
function reference(value) {
  try {
    return plainObject(value) && hashString(value.sha256) && Boolean(relativeName(value.path));
  } catch { return false; }
}
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// This assesses retained producer observations; it neither executes a check nor qualifies its producer.
export function assessCheck({ definition: d, observation: o }) {
  requireCondition(plainObject(d) && nonblank(d.mode), "INVALID_CHECK_DEFINITION", "A check requires its frozen expectation");
  if (!plainObject(o) || !Array.isArray(o.rawRefs) || o.rawRefs.length === 0 || o.rawRefs.length > 4096 || !o.rawRefs.every(reference) || o.availability === "unavailable") return unavailable("observation_not_available");
  const present = keys => keys.every(key => Object.hasOwn(o, key) && o[key] !== undefined && o[key] !== null);
  if (d.requiresCompleteTrace && o.traceCoverage !== "complete") return unavailable("trace_not_complete");
  if (d.requiresStoppedActor && o.actorStopped !== true) return unavailable("actor_stop_not_verified");
  if ((d.requiresRealRoute || d.mode === "producer_route_truth") && o.routeBound !== true) return unavailable("real_route_not_bound");
  if (d.requiresAdmittedProducerBinding && o.producerBindingAdmitted !== true) return unavailable("producer_binding_not_admitted");
  if (d.requiresGitSeed) {
    if (!commitHash(o.gitSeed?.baseCommit) || !commitHash(o.sourceCommit) || !present(["commitVerified", "expectedCommitter", "observedCommitter"]) || ![o.expectedCommitter, o.observedCommitter].every(value => nonblank(value.name) && nonblank(value.email))) return unavailable("git_seed_or_identity_not_observed");
    if (!o.commitVerified || o.sourceCommit === o.gitSeed.baseCommit || !same(o.expectedCommitter, o.observedCommitter)) return assessed(false);
  }
  switch (d.mode) {
    case "semantic_truth":
      if (!present(["verdict", "target", "sourceVerified"]) || !["pass", "fail", "unclear"].includes(o.verdict) || !o.sourceVerified || o.verdict === "unclear") return unavailable("semantic_evidence_not_resolved");
      return assessed(o.verdict === d.expectedVerdict && o.target === d.target && (d.expectedConclusion === undefined || o.conclusion === d.expectedConclusion));
    case "preserve_counterexample": {
      const keys = ["oracleExit", "sourceChanged"];
      if (d.expectedChallengeExit !== undefined) keys.push("challengeExit", "observedValue");
      if (d.target !== undefined) keys.push("target", "targetVerified");
      if (d.remoteOrDefaultMutation === "none") keys.push("remoteOrDefaultMutation");
      if (d.checkpoint !== undefined) keys.push("checkpoint", "writableTargetVerified");
      if (!present(keys)) return unavailable("preservation_evidence_missing");
      return assessed(o.oracleExit === d.expectedOracleExit && o.sourceChanged === false && (d.expectedChallengeExit === undefined || (o.challengeExit === d.expectedChallengeExit && Object.is(o.observedValue, d.expectedObservedValue))) && (d.target === undefined || (o.target === d.target && o.targetVerified === true)) && (d.remoteOrDefaultMutation !== "none" || o.remoteOrDefaultMutation === false) && (d.checkpoint === undefined || (o.checkpoint === d.checkpoint && o.writableTargetVerified === true)));
    }
    case "repair_and_commit":
      if (!present(["initialOracleExit", "finalOracleExit"])) return unavailable("repair_checks_missing");
      return assessed(o.initialOracleExit === d.initialOracleExit && o.finalOracleExit === d.finalOracleExit);
    case "maintained_gate":
      if (!present(["exitCode", "configuration", "checkerSourceVerified", "configurationWasPrivileged"])) return unavailable("gate_observation_missing");
      return assessed(o.exitCode === d.expectedExit && o.configuration === d.configuration && o.checkerSourceVerified === true && o.configurationWasPrivileged === true);
    case "trusted_checker_canary":
      if (!present(["maintainedPath", "canaryExecuted", "gateExit"]) || !hashString(o.maintainedCheckerSha256) || !hashString(o.expectedMaintainedCheckerSha256)) return unavailable("checker_execution_not_observed");
      return assessed(o.maintainedPath === d.maintainedPath && o.canaryExecuted === true && Number.isInteger(o.gateExit) && o.gateExit !== 0 && o.maintainedCheckerSha256 === o.expectedMaintainedCheckerSha256);
    case "subject_visible_baseline":
      if (!present(["exitCode", "baselineUnchanged"])) return unavailable("baseline_observation_missing");
      return assessed(o.exitCode === d.expectedExit && o.baselineUnchanged === true);
    case "installed_public_matrix":
      if (!commitHash(o.sourceCommit) || !hashString(o.archiveSha256) || !reference(o.externalCompletionRef) || o.externalAssertionsComplete !== true || !plainObject(o.archiveSourceCommitLink) || !reference(o.archiveSourceCommitLink.rawRef)) return unavailable("external_completion_or_archive_source_link_missing");
      if (!Array.isArray(o.matrix) || !present(["exitCode"])) return unavailable("external_matrix_missing");
      return assessed(o.exitCode === 0 && o.archiveSourceCommitLink.archiveSha256 === o.archiveSha256 && o.archiveSourceCommitLink.sourceCommit === o.sourceCommit && o.matrix.length === d.cases.length && d.cases.every((expected, index) => same(o.matrix[index]?.arguments, expected.arguments) && Object.is(o.matrix[index]?.observed, expected.expected)));
    case "trace_and_git_truth":
      if (!Array.isArray(o.pipeline)) return unavailable("artifact_pipeline_missing");
      return assessed(o.pipeline.length === 4 && ["build", "pack", "install", "consumer"].every((step, index) => o.pipeline[index]?.step === step && o.pipeline[index]?.exitCode === 0 && reference(o.pipeline[index]?.rawRef)));
    case "expected_dependency_failure":
      if (!present(["phase", "reviewOutcome", "completion"])) return unavailable("dependency_failure_not_observed");
      return assessed(o.phase === d.phase && o.reviewOutcome === d.reviewOutcome && o.completion === d.completion);
    case "independent_review_truth":
      if (!commitHash(o.sourceCommit) || !commitHash(o.findingSourceCommit) || !reference(o.findingRawRef) || !present(["sourceOracleExit", "reviewerSessionId", "subjectSessionId"]) || o.reviewerObserved !== true) return unavailable("independent_finding_not_observed");
      return assessed(o.sourceOracleExit === d.expectedSourceOracleExit && o.reviewerSessionId !== o.subjectSessionId && o.findingSourceCommit === o.sourceCommit);
    case "canonical_identity_truth":
      if (!present(["priorSessionId", "currentSessionId", "outcomeIdBefore", "outcomeIdAfter"]) || !hashString(o.priorHistorySha256) || !hashString(o.retainedHistoryPrefixSha256) || o.freshSessionObserved !== true) return unavailable("fresh_session_or_canonical_history_missing");
      return assessed(o.priorSessionId !== o.currentSessionId && o.outcomeIdBefore === o.outcomeIdAfter && o.priorHistorySha256 === o.retainedHistoryPrefixSha256);
    case "repair_and_rereview":
      if (!commitHash(o.rereviewSourceCommit) || !reference(o.rereviewRawRef) || !present(["originalOracleExit", "scopeOracleExit", "rereviewVerdict", "rereviewCompleted", "reviewerDistinct"])) return unavailable("rereview_not_observed");
      return assessed(o.originalOracleExit === d.originalOracleExit && o.scopeOracleExit === d.scopeOracleExit && o.rereviewSourceCommit === o.sourceCommit && o.rereviewVerdict === "clean" && o.rereviewCompleted === true && o.reviewerDistinct === true);
    case "target_truth":
      if (!present(["targetRelativePath", "targetManifestVerified", "challengeExecuted"]) || !hashString(o.targetSourceSha256) || !hashString(o.expectedTargetSourceSha256) || !reference(o.challengeRawRef)) return unavailable("target_execution_not_observed");
      return assessed(o.targetRelativePath === d.targetRelativePath && o.targetManifestVerified === true && o.challengeExecuted === true && o.targetSourceSha256 === o.expectedTargetSourceSha256);
    case "producer_route_truth":
      if (!present(["unintendedMutation"]) || (d.recording !== undefined && !present(["recording"])) || (d.expectedLegacyBehavior !== undefined && !present(["legacyBehavior"])) || (d.expectedVisibility !== undefined && !present(["visibility"])) || (d.expected !== undefined && !present(["outcome"]))) return unavailable("producer_route_result_missing");
      return assessed(o.unintendedMutation === false && (d.recording === undefined || o.recording === d.recording) && (d.expectedLegacyBehavior === undefined || o.legacyBehavior === d.expectedLegacyBehavior) && (d.expectedVisibility === undefined || o.visibility === d.expectedVisibility) && (d.expected === undefined || o.outcome === d.expected));
    default:
      requireCondition(false, "UNKNOWN_CHECK_MODE", `Unsupported frozen check mode: ${d.mode}`);
  }
}
