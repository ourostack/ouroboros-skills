import path from "node:path";
import dataset from "./cases/v2-alpha-v1/dataset.json" with { type: "json" };
import { canonicalJson, parseRawJson, readRawReference, readRegular, requireCondition } from "./core.mjs";
import { assessCheck } from "./checks.mjs";
import { readCommittedRun } from "./output.mjs";
import { prepareNativeAssessment } from "./native-assessment.mjs";
import { reportSchema } from "./native-protocol.mjs";
import { validateRuntimeQualification, verifyAssessmentEvidence } from "./native-runtime.mjs";

export function replayScoredCell({ root, cell, expected }) {
  requireCondition(cell.commitMarker !== null && cell.receipt !== null, "CELL_UNPUBLISHED", "Only a committed attempt can carry a result");
  const directory = path.join(root, path.dirname(cell.commitMarker.path));
  const committed = readCommittedRun(directory);
  const { receipt, inventory } = committed;
  const definition = dataset.cases.find(value => value.id === expected.caseId);
  requireCondition(definition && ["passed", "product_failure", "inconclusive"].includes(receipt.status), "CELL_UNSCORED", "Missing or unavailable cases cannot be relabelled as scores");
  const fixed = [];
  for (const check of definition.checks.filter(value => value.kind === "deterministic")) {
    const matches = inventory.files.filter(file => file.path.endsWith(`-${check.id}-observation.json`));
    requireCondition(matches.length === 1, "CHECK_EVIDENCE_MISSING", "Every deterministic criterion requires its actual unique controller observation");
    const observation = parseRawJson(readRegular(directory, matches[0].path).bytes);
    for (const ref of observation.rawRefs) readRawReference(ref, name => readRegular(directory, name).bytes);
    const replay = assessCheck({ definition: check.expectation, observation });
    requireCondition(["pass", "fail"].includes(replay.status), "CHECK_EVIDENCE_UNAVAILABLE", "An unavailable deterministic criterion cannot support a grade");
    fixed.push({ criterion: check.criterion, verdict: replay.status });
  }
  if (expected.executionKind === "deterministic") {
    const status = fixed.every(check => check.verdict === "pass") ? "passed" : "product_failure";
    requireCondition(receipt.status === status && receipt.grade === null, "DETERMINISTIC_RESULT_MISMATCH", "The deterministic outcome differs from its retained observations");
    return { status, grade: null, executionKind: "deterministic" };
  }
  const assessment = parseRawJson(readRegular(directory, "controller-assessment.json").bytes);
  requireCondition(assessment.caseId === expected.caseId && canonicalJson(assessment.criteria) === canonicalJson(definition.checks.map(check => check.criterion)) && canonicalJson(assessment.fixedVerdicts) === canonicalJson(fixed), "ASSESSMENT_RUBRIC_MISMATCH", "The judge must use the unchanged case and replayed deterministic verdicts");
  const plan = validateRuntimeQualification(parseRawJson(readRegular(directory, "controller-judge-plan.json").bytes));
  requireCondition(plan.model === expected.judge.model, "ASSESSMENT_MODEL_MISMATCH", "The actual judge must match the frozen model role");
  const prepared = prepareNativeAssessment({ ...assessment, evidenceRoot: directory }, reportSchema);
  const raw = readRegular(directory, "controller-judge.stdout").bytes.toString("utf8");
  requireCondition(raw.endsWith("\n"), "ASSESSMENT_CAPTURE_INCOMPLETE", "The captured native grading stream must be complete");
  const verified = verifyAssessmentEvidence(raw.trimEnd().split("\n").map(line => JSON.parse(line)), plan, prepared);
  requireCondition(canonicalJson(verified.result.grade) === canonicalJson(receipt.grade) && verified.result.status === receipt.status && canonicalJson(verified.result.counts) === canonicalJson(receipt.counts), "ASSESSMENT_RESULT_MISMATCH", "The case grade differs from native replay");
  return { status: receipt.status, grade: receipt.grade, executionKind: "subject_with_judge" };
}

export function compareScoredResults({ left, right, compatibility }) {
  const sides = [left, right].map(side => side.expectedCells.cells.map(expected => {
    const cell = side.cells.find(value => value.cellId === expected.id);
    try { return { cellId: expected.id, caseId: expected.caseId, ...replayScoredCell({ root: side.root, cell, expected }) }; }
    catch (error) { return { cellId: expected.id, caseId: expected.caseId, status: "unavailable", grade: null, reason: error.code ?? "SCORING_EVIDENCE_INVALID" }; }
  }));
  const missing = sides.flat().filter(cell => cell.status === "unavailable").length;
  const comparable = compatibility.compatible && left.inventoryComplete && right.inventoryComplete && missing === 0;
  return { schemaVersion: 1, status: comparable ? "compatible" : "not_comparable", assessment: "source_compatible_native_replay", scored: comparable, grade: null, compatibility, expectedCells: sides.flat().length, missing, left: { inventoryComplete: left.inventoryComplete, cells: sides[0] }, right: { inventoryComplete: right.inventoryComplete, cells: sides[1] } };
}
