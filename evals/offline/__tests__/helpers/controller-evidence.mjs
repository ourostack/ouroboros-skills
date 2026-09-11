import { executeHeldOutCheck, heldOutChecks } from "../../check-executor.mjs";
import { observeSource, sourceObservations } from "../../source-observations.mjs";
import { useCheckerDiagnostics } from "./checker-diagnostics.mjs";

// Explicit synthetic assertion/route evidence tests the controller's downstream protocol only.
// Production has no trusted assertion producer and never returns these completion claims.
useCheckerDiagnostics();
heldOutChecks.assertAvailable = () => {};
heldOutChecks.execute = async options => {
  const result = await executeHeldOutCheck(options);
  if (result.reason !== "CHECK_TRUSTED_ASSERTIONS_REQUIRED") return result;
  const observation = { ...result.observation, availability: "observed", syntheticTestEvidence: true };
  if (options.checkId === "maintained-checker-invoked") observation.canaryExecuted = observation.gateExit === 37;
  if (["valid-still-green", "invalid-is-red"].includes(options.checkId)) {
    observation.checkerSourceVerified = true;
    observation.configurationWasPrivileged = true;
  }
  if (options.checkId === "external-consumer-works") observation.externalAssertionsComplete = observation.matrix.length === 3;
  return { ...result, status: "observed", observation };
};
sourceObservations.observe = options => {
  const result = observeSource(options);
  if (options.check.expectation.mode === "target_truth") return { ...result, challengeExecuted: result.challengeCandidate, availability: "observed", syntheticTestEvidence: true };
  if (options.check.expectation.mode === "trace_and_git_truth" && result.pipelineCandidates) return { ...result, pipeline: result.pipelineCandidates, availability: "observed", syntheticTestEvidence: true };
  return result;
};
