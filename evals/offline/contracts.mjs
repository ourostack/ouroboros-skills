import { exactKeys, hashString, nonblank, relativeName, requireCondition } from "./core.mjs";

const id = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const text = (value, maximum) => nonblank(value) && value.length <= maximum;
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const commit = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function object(value, keys, label) {
  requireCondition(exactKeys(value, keys), "INVALID_CONTRACT", `${label} requires exactly its frozen fields`);
}
export function validateReference(value) {
  object(value, ["path", "sha256"], "Artifact reference");
  requireCondition(text(value.path, 1024) && hashString(value.sha256), "INVALID_CONTRACT_REFERENCE", "Reference requires a bounded path and raw-byte SHA-256");
  relativeName(value.path);
}
export function validatePlan(plan) {
  object(plan, ["schemaVersion", "kind", "runSetId", "sourceHashScheme", "comparison", "candidate", "dataset", "fixtureManifestSha256", "checkerManifestSha256", "admissionContractSha256", "toolingSourceManifestSha256", "runtime", "expectedCells", "attemptPolicy", "bindingSha256", "activation", "gitSeeds", "limits"], "Run plan");
  requireCondition(plan.schemaVersion === 1 && plan.kind === "offline_run_plan" && id(plan.runSetId) && plan.sourceHashScheme === "sha256/raw-bytes", "INVALID_PLAN_IDENTITY", "Run plans require a versioned identity and raw-byte source hashes");
  object(plan.comparison, ["groupId", "dimension", "treatmentId", "policySha256"], "Comparison policy");
  requireCondition(id(plan.comparison.groupId) && id(plan.comparison.treatmentId) && ["candidate", "method"].includes(plan.comparison.dimension) && hashString(plan.comparison.policySha256), "INVALID_COMPARISON_POLICY", "Alpha compares a frozen candidate or method treatment");
  const candidate = plan.candidate;
  object(candidate, ["id", "repository", "sourceCommit", "sourceManifestSha256", "nonMethodSourceManifestSha256", "method", "installationReceiptSha256"], "Candidate");
  requireCondition(id(candidate.id) && text(candidate.repository, 1024) && commit(candidate.sourceCommit) && ["sourceManifestSha256", "nonMethodSourceManifestSha256", "installationReceiptSha256"].every(key => hashString(candidate[key])), "INVALID_CANDIDATE", "Candidate must retain its repository, commit and raw source/installation closure");
  object(candidate.method, ["id", "version", "payloadManifest"], "Method");
  requireCondition(id(candidate.method.id) && text(candidate.method.version, 128), "INVALID_METHOD", "Method identity and version are required");
  validateReference(candidate.method.payloadManifest);
  object(plan.dataset, ["id", "version", "sha256"], "Dataset binding");
  requireCondition(id(plan.dataset.id) && text(plan.dataset.version, 128) && hashString(plan.dataset.sha256) && ["fixtureManifestSha256", "checkerManifestSha256", "admissionContractSha256", "toolingSourceManifestSha256", "bindingSha256"].every(key => hashString(plan[key])), "INVALID_PLAN_BINDINGS", "Dataset, fixtures, checks, admission, tools and native binding require fixed hashes");
  object(plan.runtime, ["nodeVersion", "sdkVersion", "sdkLockSha256", "cliVersion", "cliSha256", "qualificationReceiptSha256", "sessionMode"], "Runtime");
  requireCondition(text(plan.runtime.nodeVersion, 64) && plan.runtime.sdkVersion === "1.0.13" && plan.runtime.cliVersion === "1.0.84-1" && plan.runtime.sessionMode === "interactive" && ["sdkLockSha256", "cliSha256", "qualificationReceiptSha256"].every(key => hashString(plan.runtime[key])), "INVALID_RUNTIME_BINDING", "Runtime versions, mode and qualification must match the pinned alpha contract");
  validateReference(plan.expectedCells);
  object(plan.attemptPolicy, ["maxAttemptsPerCell", "automaticRetry"], "Attempt policy");
  requireCondition(plan.attemptPolicy.maxAttemptsPerCell === 1 && plan.attemptPolicy.automaticRetry === false, "INVALID_ATTEMPT_POLICY", "Alpha retains one predeclared attempt per cell without automatic retry");
  object(plan.activation, ["subjectAgent", "compositionSeam", "requestedConfigurationSha256", "qualificationReceipt"], "Activation request");
  requireCondition(text(plan.activation.subjectAgent, 256) && text(plan.activation.compositionSeam, 256) && hashString(plan.activation.requestedConfigurationSha256), "INVALID_ACTIVATION_REQUEST", "Activation must name its actual subject agent, seam and configuration");
  if (plan.activation.qualificationReceipt !== null) validateReference(plan.activation.qualificationReceipt);
  requireCondition(Array.isArray(plan.gitSeeds) && plan.gitSeeds.length <= 100000, "INVALID_GIT_SEEDS", "Expected a bounded per-cell Git seed inventory");
  const seeded = new Set();
  for (const seed of plan.gitSeeds) {
    object(seed, ["cellId", "fixtureId", "subjectFilesManifestSha256", "baseCommit", "initialBranch", "identity", "seedReceipt"], "Git seed");
    requireCondition(id(seed.cellId) && id(seed.fixtureId) && hashString(seed.subjectFilesManifestSha256) && commit(seed.baseCommit) && text(seed.initialBranch, 256) && !seeded.has(seed.cellId), "INVALID_GIT_SEED", "Git seeds must bind a unique cell, fixture and local base");
    seeded.add(seed.cellId);
    object(seed.identity, ["authorName", "authorEmail", "committerName", "committerEmail"], "Git identity");
    requireCondition(Object.values(seed.identity).every(value => text(value, 256)), "INVALID_GIT_IDENTITY", "Expected configured author and committer identity");
    validateReference(seed.seedReceipt);
  }
  object(plan.limits, ["startupSendWorkMs", "cleanup", "maxStreamBytes", "maxFileBytes", "maxTotalBytes", "maxFiles"], "Run limits");
  const limits = plan.limits;
  requireCondition(integer(limits.startupSendWorkMs, 1, 2147483647) && integer(limits.maxStreamBytes, 1, 16777216) && integer(limits.maxFileBytes, 1, 16777216) && limits.maxStreamBytes <= limits.maxFileBytes && integer(limits.maxTotalBytes, 1, 1073741824) && integer(limits.maxFiles, 1, 4096), "INVALID_RUN_LIMITS", "Run and artifact limits must be finite and bounded");
  object(limits.cleanup, ["totalMs", "abortMs", "stopMs"], "Cleanup budget");
  requireCondition(integer(limits.cleanup.totalMs, 3, 2147483647) && integer(limits.cleanup.abortMs, 1, 2147483647) && integer(limits.cleanup.stopMs, 1, 2147483647) && limits.cleanup.abortMs + limits.cleanup.stopMs < limits.cleanup.totalMs, "INVALID_CLEANUP_LIMITS", "The total cleanup budget must also contain force-stop and exit verification");
  return plan;
}
function validateRole(role, invocationMode) {
  object(role, ["provider", "model", "reasoningEffort", "contextTier", "invocationMode", "promptSha256", "runtimeOptionsSha256"], "Role configuration");
  requireCondition(role.provider === "copilot" && ["gpt-6-astra", "claude-opus-5"].includes(role.model) && role.reasoningEffort === "high" && role.contextTier === "default" && role.invocationMode === invocationMode && hashString(role.promptSha256) && hashString(role.runtimeOptionsSha256), "INVALID_ROLE_CONFIGURATION", "Both complete roles must use the pinned Copilot alpha configuration");
}
export function logicalCellKey(cell) {
  const role = value => value === null ? null : [value.provider, value.model, value.reasoningEffort, value.contextTier, value.invocationMode, value.promptSha256, value.runtimeOptionsSha256];
  return JSON.stringify([cell.caseId, cell.repetition, cell.executionKind, role(cell.subject), role(cell.judge)]);
}
export function validateExpectedCells(expected) {
  object(expected, ["schemaVersion", "cells"], "Expected-cell inventory");
  requireCondition(expected.schemaVersion === 1 && Array.isArray(expected.cells) && expected.cells.length > 0 && expected.cells.length <= 256, "INVALID_EXPECTED_CELLS", "Expected cells must be a bounded, nonempty frozen matrix");
  const ids = new Set();
  const logical = new Set();
  for (const cell of expected.cells) {
    object(cell, ["id", "caseId", "candidateId", "repetition", "executionKind", "subject", "judge"], "Expected cell");
    requireCondition(id(cell.id) && id(cell.caseId) && id(cell.candidateId) && integer(cell.repetition, 1, 256) && ["subject_with_judge", "deterministic"].includes(cell.executionKind), "INVALID_CELL", "Cell identity, repetition and execution kind are required");
    if (cell.executionKind === "deterministic") requireCondition(cell.subject === null && cell.judge === null, "INVALID_DETERMINISTIC_ROLES", "Deterministic cells cannot pretend to have model roles");
    else {
      validateRole(cell.subject, "native-subject");
      validateRole(cell.judge, "empty-judge");
    }
    const key = logicalCellKey(cell);
    requireCondition(!ids.has(cell.id) && !logical.has(key), "DUPLICATE_EXPECTED_CELL", "Expected cell IDs and complete logical cells must be unique");
    ids.add(cell.id);
    logical.add(key);
  }
  return expected;
}

export function validateAlphaExpectedCells(expected, dataset) {
  validateExpectedCells(expected);
  requireCondition(Array.isArray(dataset?.cases) && dataset.cases.length === 6, "INVALID_ALPHA_DATASET", "Alpha requires the complete six-case frozen dataset");
  const models = ["gpt-6-astra", "claude-opus-5"];
  requireCondition(expected.cells.length === dataset.cases.length * models.length, "INCOMPLETE_ALPHA_MATRIX", "Alpha requires twelve cells per stack, not a selected subset");
  for (const definition of dataset.cases) {
    const cells = expected.cells.filter(cell => cell.caseId === definition.id);
    requireCondition(cells.length === models.length, "INCOMPLETE_ALPHA_MATRIX", "Every frozen alpha case requires both configuration strata");
    if (definition.mode === "deterministic") {
      requireCondition(cells.every(cell => cell.executionKind === "deterministic") && cells.map(cell => cell.repetition).sort().join(",") === "1,2", "INVALID_ALPHA_CONFIGURATION", "The deterministic case has one no-model execution per declared configuration stratum");
    } else {
      requireCondition(cells.every(cell => cell.executionKind === "subject_with_judge" && cell.repetition === 1) && models.every(model => cells.filter(cell => cell.subject.model === model).length === 1), "INVALID_ALPHA_CONFIGURATION", "Each subject case requires exactly one Astra and one Opus configuration");
    }
  }
  return expected;
}
