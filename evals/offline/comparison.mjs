import path from "node:path";
import alphaDataset from "./cases/v2-alpha-v1/dataset.json" with { type: "json" };
import { canonicalJson, exactKeys, hashString, nonblank, parseRawJson, plainObject, readRawReference, relativeName, requireCondition, sha256 } from "./core.mjs";
import { logicalCellKey, validateAlphaExpectedCells, validateExpectedCells, validatePlan, validateReference } from "./contracts.mjs";

const serialized = value => Buffer.from(`${JSON.stringify(value)}\n`);
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const statuses = ["passed", "product_failure", "inconclusive", "protocol_failure", "infrastructure_failure", "timed_out", "cancelled", "unavailable"];
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const modelDimensions = ["model", "model_pair", "subject_model", "judge_model"];
function readJson(ref, readArtifact) {
  validateReference(ref);
  return parseRawJson(readRawReference(ref, readArtifact));
}
function relativeReference(parent, ref) {
  validateReference(ref);
  return { path: path.posix.join(path.posix.dirname(parent.path), ref.path), sha256: ref.sha256 };
}
export function validateRunSetInventory({ runSet, expectedCells, journalRecords, readArtifact }) {
  requireCondition(exactKeys(runSet, ["schemaVersion", "kind", "runSetId", "state", "plan", "expectedCells", "attemptJournal", "attempts", "unstartedCellIds", "createdAt", "closedAt"]) && runSet.schemaVersion === 1 && runSet.kind === "offline_run_set" && nonblank(runSet.runSetId) && ["complete", "incomplete"].includes(runSet.state) && date(runSet.createdAt) && (runSet.closedAt === null || date(runSet.closedAt)), "INVALID_RUN_SET", "Expected a closed versioned run-set envelope");
  const plan = validatePlan(readJson(runSet.plan, readArtifact));
  const expected = validateExpectedCells(readJson(runSet.expectedCells, readArtifact));
  if (plan.dataset.id === alphaDataset.id) validateAlphaExpectedCells(expected, alphaDataset);
  requireCondition(plan.runSetId === runSet.runSetId && same(plan.expectedCells, runSet.expectedCells) && same(expected, expectedCells), "RUN_SET_BINDING_MISMATCH", "Run plan and decoded expected cells differ from their frozen references");
  requireCondition(expected.cells.every(cell => cell.candidateId === plan.candidate.id) && plan.gitSeeds.every(seed => expected.cells.some(cell => cell.id === seed.cellId)), "RUN_SET_CANDIDATE_MISMATCH", "Every cell and seed must belong to this candidate and expected matrix");
  validateReference(runSet.attemptJournal);
  const journalBytes = readRawReference(runSet.attemptJournal, readArtifact);
  requireCondition(Array.isArray(journalRecords) && journalRecords.length <= 512 && Buffer.concat(journalRecords.map(serialized)).equals(journalBytes), "JOURNAL_BYTES_MISMATCH", "All actual journal records and their original serialization must be retained");
  const starts = new Map();
  const closes = new Map();
  for (const [index, record] of journalRecords.entries()) {
    requireCondition(exactKeys(record, ["schemaVersion", "runSetId", "attemptId", "cellId", "timestamp", "type", "status", "receipt", "commitMarker", "sequence", "previousRecordSha256"]) && record.schemaVersion === 1 && record.runSetId === runSet.runSetId && nonblank(record.attemptId) && expected.cells.some(cell => cell.id === record.cellId) && date(record.timestamp) && record.sequence === index + 1 && record.previousRecordSha256 === (index === 0 ? null : sha256(serialized(journalRecords[index - 1]))), "INVALID_ATTEMPT_JOURNAL", "Attempt journal identity, ordering or hash chain is invalid");
    if (record.type === "attempt_start") {
      requireCondition(!starts.has(record.attemptId) && record.status === null && record.receipt === null && record.commitMarker === null, "INVALID_ATTEMPT_START", "An attempt is started exactly once before it has a result");
      starts.set(record.attemptId, record);
    } else {
      requireCondition(record.type === "attempt_close" && starts.get(record.attemptId)?.cellId === record.cellId && !closes.has(record.attemptId) && statuses.includes(record.status), "INVALID_ATTEMPT_CLOSE", "An attempt closes at most once after its matching start");
      if (record.receipt !== null) validateReference(record.receipt);
      if (record.commitMarker !== null) validateReference(record.commitMarker);
      closes.set(record.attemptId, record);
    }
  }
  requireCondition(Array.isArray(runSet.attempts) && runSet.attempts.length === starts.size && runSet.attempts.length <= expected.cells.length && Array.isArray(runSet.unstartedCellIds), "INCOMPLETE_ATTEMPT_INVENTORY", "Every started attempt must be retained without retries or hidden rows");
  const attempts = new Map();
  const receipts = new Set();
  for (const attempt of runSet.attempts) {
    requireCondition(exactKeys(attempt, ["attemptId", "cellId", "sequence", "status", "receipt", "commitMarker"]) && nonblank(attempt.attemptId) && attempt.sequence === 1 && starts.get(attempt.attemptId)?.cellId === attempt.cellId && !attempts.has(attempt.cellId) && statuses.includes(attempt.status), "INVALID_ATTEMPT_INVENTORY", "One predeclared attempt per cell must match the observed start");
    const closed = closes.get(attempt.attemptId);
    requireCondition(closed ? closed.status === attempt.status && same(closed.receipt, attempt.receipt) && same(closed.commitMarker, attempt.commitMarker) : attempt.status === "unavailable" && attempt.receipt === null && attempt.commitMarker === null, "ATTEMPT_CLOSE_MISMATCH", "Attempt inventory must retain the actual closure, including unpublished failures");
    let receipt = null;
    if (attempt.receipt !== null) {
      requireCondition(!receipts.has(attempt.receipt.path), "DUPLICATE_ATTEMPT_RECEIPT", "A receipt cannot represent more than one attempt");
      receipts.add(attempt.receipt.path);
      receipt = readJson(attempt.receipt, readArtifact);
      const cell = expected.cells.find(entry => entry.id === attempt.cellId);
      requireCondition(receipt.schemaVersion === 1 && receipt.runId === attempt.attemptId && receipt.cellId === attempt.cellId && receipt.caseId === cell.caseId && receipt.status === attempt.status, "ATTEMPT_RECEIPT_MISMATCH", "Receipt identity or status differs from its expected attempt");
      requireCondition(receipt.executionKind === cell.executionKind, "RECEIPT_EXECUTION_KIND_MISMATCH", "Receipt grading route differs from its frozen expected cell");
      if (Object.hasOwn(receipt, "planSha256")) requireCondition(receipt.planSha256 === runSet.plan.sha256, "RECEIPT_PLAN_MISMATCH", "A receipt cannot be reassigned to a different frozen plan");
    }
    if (attempt.commitMarker !== null) {
      requireCondition(receipt !== null, "COMMIT_WITHOUT_RECEIPT", "Publication requires a retained receipt");
      const marker = readJson(attempt.commitMarker, readArtifact);
      requireCondition(marker.schemaVersion === 1 && marker.kind === "offline_commit" && marker.runId === attempt.attemptId && same(relativeReference(attempt.commitMarker, marker.receipt), attempt.receipt), "ATTEMPT_MARKER_MISMATCH", "Attempt marker does not bind its actual receipt");
      const inventory = readJson(relativeReference(attempt.commitMarker, marker.inventory), readArtifact);
      requireCondition(inventory.schemaVersion === 1 && Array.isArray(inventory.files) && inventory.files.length > 0 && inventory.files.length <= plan.limits.maxFiles && new Set(inventory.files.map(member => member.path)).size === inventory.files.length, "INVALID_ATTEMPT_FILE_INVENTORY", "A committed attempt requires a complete unique file inventory");
      let totalBytes = 0;
      let receiptListed = false;
      for (const member of inventory.files) {
        requireCondition(exactKeys(member, ["path", "mode", "bytes", "sha256"]) && Number.isInteger(member.mode) && member.mode >= 0 && member.mode <= 0o777 && Number.isSafeInteger(member.bytes) && member.bytes >= 0 && member.bytes <= plan.limits.maxFileBytes && hashString(member.sha256), "INVALID_ATTEMPT_MEMBER", "Inventory members require bounded raw hashes, sizes and modes");
        const ref = relativeReference(attempt.commitMarker, { path: member.path, sha256: member.sha256 });
        const data = readRawReference(ref, readArtifact);
        requireCondition(data.length === member.bytes, "ATTEMPT_MEMBER_SIZE_MISMATCH", "Inventory member byte count differs from its sealed artifact");
        totalBytes += data.length;
        if (same(ref, attempt.receipt)) receiptListed = true;
      }
      requireCondition(receiptListed && totalBytes <= plan.limits.maxTotalBytes, "ATTEMPT_INVENTORY_INCOMPLETE", "Inventory must include its receipt and remain within total bounds");
    }
    attempts.set(attempt.cellId, { ...attempt, receiptValue: receipt });
  }
  const unstarted = expected.cells.filter(cell => !attempts.has(cell.id)).map(cell => cell.id).sort();
  requireCondition(same([...runSet.unstartedCellIds].sort(), unstarted), "UNSTARTED_CELL_MISMATCH", "Every unstarted cell must remain explicit");
  const allPublished = unstarted.length === 0 && [...attempts.values()].every(attempt => attempt.receipt !== null && attempt.commitMarker !== null && closes.has(attempt.attemptId));
  requireCondition(runSet.state !== "complete" || (allPublished && runSet.closedAt !== null), "FALSE_COMPLETE_RUN_SET", "An incomplete or unpublished run set cannot be labelled complete");
  const cells = expected.cells.map(cell => ({ cellId: cell.id, caseId: cell.caseId, ...(attempts.get(cell.id) ?? { attemptId: null, status: "unavailable", receipt: null, commitMarker: null }) }));
  return { inventoryComplete: runSet.state === "complete" && allPublished, cells, plan, expectedCells: expected, qualification: "inventory-only", candidateGrade: false };
}
function sourceManifest(bytes, expectedSha256) {
  requireCondition(Buffer.isBuffer(bytes) && sha256(bytes) === expectedSha256, "METHOD_PROOF_HASH_MISMATCH", "Method comparison requires actual raw source and method manifest bytes");
  const value = parseRawJson(bytes);
  requireCondition(exactKeys(value, ["schemaVersion", "files"]) && value.schemaVersion === 1 && Array.isArray(value.files) && value.files.length <= 4096, "INVALID_SOURCE_MANIFEST", "Expected a bounded source file manifest");
  const files = new Map();
  for (const file of value.files) {
    requireCondition(exactKeys(file, ["path", "mode", "bytes", "sha256"]) && Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777 && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && hashString(file.sha256) && !files.has(file.path), "INVALID_SOURCE_MEMBER", "Source members must be unique regular-file identities");
    relativeName(file.path);
    files.set(file.path, file);
  }
  return files;
}
function methodChangeConfined(left, right, proof) {
  requireCondition(plainObject(proof), "METHOD_SOURCE_PROOF_REQUIRED", "Method comparison needs raw source, method and non-method inventories for both candidates");
  const sides = [left, right].map((plan, index) => {
    const data = index === 0 ? proof.left : proof.right;
    const source = sourceManifest(data?.source, plan.candidate.sourceManifestSha256);
    const method = sourceManifest(data?.method, plan.candidate.method.payloadManifest.sha256);
    const nonMethod = sourceManifest(data?.nonMethod, plan.candidate.nonMethodSourceManifestSha256);
    requireCondition(method.size > 0 && [...method].every(([name, entry]) => same(entry, source.get(name))) && [...source].every(([name, entry]) => method.has(name) ? !nonMethod.has(name) : same(entry, nonMethod.get(name))) && nonMethod.size + method.size === source.size, "METHOD_MANIFEST_PARTITION_MISMATCH", "Declared method and non-method inventories must partition the actual source");
    return { source, method };
  });
  const names = new Set([...sides[0].source.keys(), ...sides[1].source.keys()]);
  return [...names].every(name => same(sides[0].source.get(name), sides[1].source.get(name)) || sides[0].method.has(name) || sides[1].method.has(name));
}
export function checkComparisonCompatibility({ leftPlan, rightPlan, leftCells, rightCells, sourceProof }) {
  const dimension = leftPlan?.comparison?.dimension;
  if (modelDimensions.includes(dimension) || modelDimensions.includes(rightPlan?.comparison?.dimension)) return { compatible: false, reason: "MODEL_COMPARISON_UNSUPPORTED_IN_ALPHA" };
  try {
    validatePlan(leftPlan);
    validatePlan(rightPlan);
    validateExpectedCells(leftCells);
    validateExpectedCells(rightCells);
    requireCondition(dimension === rightPlan.comparison.dimension && leftPlan.comparison.groupId === rightPlan.comparison.groupId && leftPlan.comparison.policySha256 === rightPlan.comparison.policySha256 && leftPlan.candidate.repository === rightPlan.candidate.repository, "COMPARISON_AUTHORITY_MISMATCH", "Treatments must share the frozen comparison and repository authority");
    const invariantFields = ["sourceHashScheme", "dataset", "fixtureManifestSha256", "checkerManifestSha256", "admissionContractSha256", "toolingSourceManifestSha256", "runtime", "attemptPolicy", "bindingSha256", "activation", "limits"];
    const differences = invariantFields.filter(field => !same(leftPlan[field], rightPlan[field]));
    requireCondition(differences.length === 0, "COMPARISON_INVARIANT_MISMATCH", `Incompatible frozen fields: ${differences.join(", ")}`);
    requireCondition(leftCells.cells.every(cell => cell.candidateId === leftPlan.candidate.id) && rightCells.cells.every(cell => cell.candidateId === rightPlan.candidate.id), "COMPARISON_CELL_CANDIDATE_MISMATCH", "Expected cells must belong to their respective candidates");
    const leftKeys = leftCells.cells.map(logicalCellKey).sort();
    const rightKeys = rightCells.cells.map(logicalCellKey).sort();
    requireCondition(same(leftKeys, rightKeys), "ROLE_OR_CELL_CONFIGURATION_MISMATCH", "Case, repetition and both complete role configurations must match");
    if (dimension === "method") {
      requireCondition(leftPlan.candidate.nonMethodSourceManifestSha256 === rightPlan.candidate.nonMethodSourceManifestSha256, "NON_METHOD_SOURCE_CHANGED", "Method comparison cannot change non-method source");
      requireCondition(methodChangeConfined(leftPlan, rightPlan, sourceProof), "CHANGE_OUTSIDE_METHOD_PAYLOAD", "A changed source path is outside the frozen method payload");
    }
    return { compatible: true, dimension, pairedCells: leftKeys.length, qualification: "compatibility-only" };
  } catch (error) { return { compatible: false, reason: error.code, detail: error.message }; }
}
