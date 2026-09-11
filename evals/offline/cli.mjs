import path from "node:path";
import { validateDatasetFiles } from "./dataset.mjs";
import { prepareRunPlan } from "./producer.mjs";
import { loadNativeInputs, runFixedController } from "./fixed-controller.mjs";
import { compareScoredResults } from "./scored-comparison.mjs";
import { checkComparisonCompatibility, validateRunSetInventory } from "./comparison.mjs";
import { readCommittedRun } from "./output.mjs";
import { parseRawJson, readRegular, requireCondition, textBytes } from "./core.mjs";

const usage = "offline validate --dataset <dataset.json> --fixtures <fixture-manifest.json>\noffline compare --left <run-set.json> --right <run-set.json>\noffline run --plan <plan.json> --output <fresh-output-root> [--native-inputs <source-bound-module.mjs>]\noffline qualify-runtime --plan <runtime-qualification.json> --output <fresh-output-root>\n";
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
export async function main(args, io = process, nativeInputs) {
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
    if (left.plan.dataset.id === "engineering-v2-alpha" && right.plan.dataset.id === "engineering-v2-alpha") {
      const result = compareScoredResults({ left, right, compatibility });
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return result.scored ? 0 : 2;
    }
    io.stdout.write(`${JSON.stringify({ schemaVersion: 1, status: compatible ? "compatible" : "not_comparable", assessment: "inventory_and_compatibility_only", scored: false, grade: null, compatibility, left: { inventoryComplete: left.inventoryComplete, cells: left.cells }, right: { inventoryComplete: right.inventoryComplete, cells: right.cells } })}\n`);
    return compatible ? 0 : 2;
  }
  if (command === "run") {
    const options = argumentsFor(rest, ["--plan", "--output", ...(rest.includes("--native-inputs") ? ["--native-inputs"] : [])]);
    const filename = path.resolve(options["--plan"]);
    const prepared = prepareRunPlan({ filename, outputRoot: path.resolve(options["--output"]) });
    try {
      if (options["--native-inputs"]) nativeInputs = await loadNativeInputs({ filename: options["--native-inputs"], prepared, inputRoot: path.dirname(filename) });
      const result = await runFixedController({ prepared, nativeInputs });
      io.stdout.write(`${JSON.stringify(result)}\n`);
      return result.exitCode;
    } catch (error) {
      if (error?.code === "NATIVE_QUALIFICATION_REQUIRED") Object.assign(error, { exitCode: 3, status: "unavailable", artifacts: prepared?.root ?? null });
      throw error;
    }
  }
  if (command === "qualify-runtime") {
    const options = argumentsFor(rest, ["--plan", "--output"]);
    const filename = path.resolve(options["--plan"]);
    const rawPlanBytes = readRegular(path.dirname(filename), path.basename(filename)).bytes;
    const { runRuntimeQualification } = await import("./native-runtime.mjs");
    const result = await runRuntimeQualification({
      plan: parseRawJson(rawPlanBytes), rawPlanBytes,
      outputRoot: path.resolve(options["--output"]),
      authorizedRoot: path.dirname(path.resolve(options["--output"])),
      protectedRoots: [path.dirname(filename)],
    });
    io.stdout.write(`${JSON.stringify(result)}\n`);
    return result.exitCode;
  }
  requireCondition(false, "INVALID_OFFLINE_ARGUMENTS", usage);
}
