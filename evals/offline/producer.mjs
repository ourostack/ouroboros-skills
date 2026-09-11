import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAlphaExpectedCells, validatePlan } from "./contracts.mjs";
import { absoluteRoot, jsonBytes, overlaps, parseRawJson, pathIdentities, readRawReference, readRegular, relativeName, requireCondition, sha256 } from "./core.mjs";

const dataRoot = fileURLToPath(new URL("./cases/v2-alpha-v1/", import.meta.url));

// The denominator is frozen before any native prerequisite is attempted. This is not a model attempt or a grade.
export function prepareRunPlan({ filename, outputRoot }) {
  const inputRoot = path.dirname(filename);
  const rawPlan = readRegular(inputRoot, path.basename(filename)).bytes;
  const plan = validatePlan(parseRawJson(rawPlan));
  if (plan.dataset.id !== "engineering-v2-alpha") return null;
  const datasetBytes = readRegular(dataRoot, "dataset.json").bytes;
  const dataset = parseRawJson(datasetBytes);
  requireCondition(plan.dataset.version === dataset.version && plan.dataset.sha256 === sha256(datasetBytes) && plan.fixtureManifestSha256 === readRegular(dataRoot, "fixture-manifest.json").sha256 && plan.checkerManifestSha256 === readRegular(dataRoot, "check-expectations.json").sha256, "PRODUCER_CONTROL_MISMATCH", "The producer requires the unchanged fixed dataset, fixture manifest and checker contract");
  const rawExpected = readRawReference(plan.expectedCells, name => readRegular(inputRoot, name).bytes);
  const expected = validateAlphaExpectedCells(parseRawJson(rawExpected), dataset);
  requireCondition(expected.cells.every(cell => cell.candidateId === plan.candidate.id), "RUN_SET_CANDIDATE_MISMATCH", "Every fixed cell must belong to this candidate");
  const expectedPath = relativeName(plan.expectedCells.path);
  const reserved = ["plan.json", "attempt-journal.jsonl", "run-set.json", "producer-status.json"];
  requireCondition(reserved.every(name => expectedPath !== name && !expectedPath.startsWith(`${name}/`)), "PRODUCER_RESERVED_PATH", "The expected matrix cannot replace a producer-owned artifact");
  const root = absoluteRoot(outputRoot);
  requireCondition(!overlaps(root, inputRoot) && !overlaps(root, dataRoot), "OUTPUT_ROOT_NOT_AUTHORIZED", "Producer output must be separate from its frozen inputs");
  pathIdentities(path.dirname(root));
  pathIdentities(root, true);
  requireCondition(!fs.existsSync(root), "OUTPUT_ROOT_NOT_FRESH", "Producer output must be a fresh direct root");
  const timestamp = new Date().toISOString();
  const journal = Buffer.alloc(0);
  const runSet = {
    schemaVersion: 1, kind: "offline_run_set", runSetId: plan.runSetId, state: "incomplete",
    plan: { path: "plan.json", sha256: sha256(rawPlan) }, expectedCells: plan.expectedCells,
    attemptJournal: { path: "attempt-journal.jsonl", sha256: sha256(journal) },
    attempts: [], unstartedCellIds: expected.cells.map(cell => cell.id), createdAt: timestamp, closedAt: null,
  };
  fs.mkdirSync(root, { mode: 0o700 });
  try {
    for (const [name, bytes] of [["plan.json", rawPlan], [expectedPath, rawExpected], ["attempt-journal.jsonl", journal], ["run-set.json", jsonBytes(runSet)]]) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(root, name), bytes, { flag: "wx", mode: 0o600 });
    }
    const status = { schemaVersion: 1, status: "unavailable", reason: "native_producer_not_qualified", expectedCells: expected.cells.length, modelCallsStarted: 0, scored: false, grade: null };
    fs.writeFileSync(path.join(root, "producer-status.json"), jsonBytes(status), { flag: "wx", mode: 0o600 });
  } catch (cause) {
    throw Object.assign(new Error("Producer preparation did not publish completely; retain the partial output and frozen inputs."), { code: "OUTPUT_WRITE_FAILED", exitCode: 3, artifacts: root, cause });
  }
  return { plan, expected, runSet, root };
}
