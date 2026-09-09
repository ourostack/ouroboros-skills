import path from "node:path";
import { validateDatasetFiles } from "./dataset.mjs";
import { validatePlan } from "./contracts.mjs";
import { checkComparisonCompatibility, validateRunSetInventory } from "./comparison.mjs";
import { readCommittedRun } from "./output.mjs";
import { parseRawJson, readRegular, requireCondition, textBytes } from "./core.mjs";

const usage = "offline validate --dataset <dataset.json> --fixtures <fixture-manifest.json>\noffline compare --left <run-set.json> --right <run-set.json>\noffline run --plan <plan.json> --output <fresh-output-root>\n";
function argumentsFor(args, required) {
  requireCondition(args.length === required.length * 2, "INVALID_OFFLINE_ARGUMENTS", usage);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    requireCondition(required.includes(key) && !Object.hasOwn(values, key) && typeof args[index + 1] === "string" && args[index + 1].length > 0 && !args[index + 1].startsWith("--"), "INVALID_OFFLINE_ARGUMENTS", usage);
    values[key] = args[index + 1];
  }
  return values;
}
function bundle(filename) {
  const absolute = path.resolve(filename);
  const root = path.dirname(absolute);
  const readArtifact = name => readRegular(root, name).bytes;
  const runSet = parseRawJson(readArtifact(path.basename(absolute)));
  const expectedCells = parseRawJson(readArtifact(runSet.expectedCells.path));
  const journal = textBytes(readArtifact(runSet.attemptJournal.path));
  requireCondition(journal === "" || journal.endsWith("\n"), "INCOMPLETE_ATTEMPT_JOURNAL", "An attempt journal must retain every complete raw record");
  const journalRecords = journal === "" ? [] : journal.slice(0, -1).split("\n").map(line => JSON.parse(line));
  const inventory = validateRunSetInventory({ runSet, expectedCells, journalRecords, readArtifact });
  for (const attempt of runSet.attempts) if (attempt.commitMarker !== null) {
    const committed = readCommittedRun(path.join(root, path.dirname(attempt.commitMarker.path)));
    requireCondition(committed.receipt.planSha256 === runSet.plan.sha256, "RECEIPT_PLAN_MISMATCH", "A committed receipt must bind this exact frozen plan");
  }
  return { ...inventory, root, readArtifact };
}
export async function main(args, io = process) {
  const [command, ...rest] = args;
  if (command === "help" && rest.length === 0) {
    io.stdout.write(usage);
    return 0;
  }
  if (command === "validate") {
    const options = argumentsFor(rest, ["--dataset", "--fixtures"]);
    io.stdout.write(`${JSON.stringify(validateDatasetFiles({ datasetPath: options["--dataset"], fixtureManifestPath: options["--fixtures"] }))}\n`);
    return 0;
  }
  if (command === "compare") {
    const options = argumentsFor(rest, ["--left", "--right"]);
    const left = bundle(options["--left"]);
    const right = bundle(options["--right"]);
    let sourceProof;
    if (left.plan.comparison.dimension === "method") {
      try {
        const proof = side => ({ source: side.readArtifact("source-manifest.json"), nonMethod: side.readArtifact("non-method-source-manifest.json"), method: side.readArtifact(side.plan.candidate.method.payloadManifest.path) });
        sourceProof = { left: proof(left), right: proof(right) };
      } catch { /* Compatibility reports the absent method proof; no treatment is selected as a winner. */ }
    }
    const compatibility = left.plan.runSetId === right.plan.runSetId || left.plan.comparison.treatmentId === right.plan.comparison.treatmentId
      ? { compatible: false, reason: "DUPLICATE_COMPARISON_INPUT" }
      : checkComparisonCompatibility({ leftPlan: left.plan, rightPlan: right.plan, leftCells: left.expectedCells, rightCells: right.expectedCells, sourceProof });
    const compatible = left.inventoryComplete && right.inventoryComplete && compatibility.compatible;
    io.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: compatible ? "compatible" : "not_comparable", assessment: "inventory_and_compatibility_only", scored: false, grade: null, compatibility, left: { inventoryComplete: left.inventoryComplete, cells: left.cells }, right: { inventoryComplete: right.inventoryComplete, cells: right.cells } })}\n`);
    return compatible ? 0 : 2;
  }
  if (command === "run") {
    const options = argumentsFor(rest, ["--plan", "--output"]);
    const filename = path.resolve(options["--plan"]);
    validatePlan(parseRawJson(readRegular(path.dirname(filename), path.basename(filename)).bytes));
    throw Object.assign(new Error("Native source/agent activation, both-model terminal semantics and owned-runtime cleanup have not been qualified. No subject or judge was started."), { code: "NATIVE_QUALIFICATION_REQUIRED", exitCode: 3, status: "unavailable", artifacts: null });
  }
  requireCondition(false, "INVALID_OFFLINE_ARGUMENTS", usage);
}
