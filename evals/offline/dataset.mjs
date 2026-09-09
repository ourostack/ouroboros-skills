import path from "node:path";
import { exactKeys, hashString, nonblank, parseRawJson, plainObject, readRegular, relativeName, requireCondition } from "./core.mjs";

const roles = ["subject", "held_out", "canonical_fixture_input"];
const modes = ["semantic_truth", "preserve_counterexample", "repair_and_commit", "maintained_gate", "trusted_checker_canary", "subject_visible_baseline", "installed_public_matrix", "trace_and_git_truth", "expected_dependency_failure", "independent_review_truth", "canonical_identity_truth", "repair_and_rereview", "target_truth", "producer_route_truth"];
function uniqueIds(values, label) {
  requireCondition(Array.isArray(values) && values.length > 0 && values.length <= 256 && values.every(value => plainObject(value) && nonblank(value.id)) && new Set(values.map(value => value.id)).size === values.length, "INVALID_DATASET_IDS", `${label} require a nonempty, bounded list of unique identities`);
}
function readJsonFile(filename) {
  const absolute = path.resolve(filename);
  const member = readRegular(path.dirname(absolute), path.basename(absolute));
  return { value: parseRawJson(member.bytes), sha256: member.sha256, root: path.dirname(absolute) };
}
export function validateDatasetFiles({ datasetPath, fixtureManifestPath }) {
  const source = readJsonFile(datasetPath);
  const manifestSource = readJsonFile(fixtureManifestPath);
  const dataset = source.value;
  const manifest = manifestSource.value;
  requireCondition(exactKeys(dataset, ["schemaVersion", "id", "version", "description", "fixture", "requirements", "cases"]) && dataset.schemaVersion === 1 && ["id", "version", "description", "fixture"].every(key => nonblank(dataset[key])) && Array.isArray(dataset.requirements) && dataset.requirements.length > 0 && dataset.requirements.every(nonblank) && new Set(dataset.requirements).size === dataset.requirements.length, "INVALID_DATASET", "Expected a fixed versioned dataset and its requirement inventory");
  requireCondition(exactKeys(manifest, ["schemaVersion", "id", "version", "fixtures"]) && manifest.schemaVersion === 1 && nonblank(manifest.id) && nonblank(manifest.version) && dataset.fixture === manifest.id, "INVALID_FIXTURE_MANIFEST", "Dataset must name the actual versioned fixture manifest");
  uniqueIds(dataset.cases, "Cases");
  uniqueIds(manifest.fixtures, "Fixtures");
  let totalFiles = 0;
  const fixtures = manifest.fixtures.map(fixture => {
    requireCondition(exactKeys(fixture, ["id", "requiresAdmittedProducerBinding", "files"]) && typeof fixture.requiresAdmittedProducerBinding === "boolean" && Array.isArray(fixture.files) && fixture.files.length <= 4096 && (fixture.files.length > 0 || fixture.requiresAdmittedProducerBinding), "INVALID_FIXTURE", "A fixture declares its files and real-producer requirement; empty fixtures need a producer binding");
    const destinations = new Set();
    for (const file of fixture.files) {
      requireCondition(exactKeys(file, ["role", "sourcePath", "targetPath", "sha256"]) && roles.includes(file.role) && hashString(file.sha256), "INVALID_FIXTURE_FILE", "Every fixture file requires a role, source, destination and raw-byte hash");
      relativeName(file.sourcePath);
      relativeName(file.targetPath);
      const destination = `${file.role}:${file.targetPath}`;
      requireCondition(!file.targetPath.split("/").includes(".git") && !destinations.has(destination), "INVALID_FIXTURE_DESTINATION", "Fixture destinations cannot overlap Git metadata or repeat a role path");
      destinations.add(destination);
      requireCondition(readRegular(manifestSource.root, file.sourcePath).sha256 === file.sha256, "FIXTURE_HASH_MISMATCH", "Fixture source bytes differ from the frozen file inventory");
      totalFiles += 1;
      requireCondition(totalFiles <= 4096, "FIXTURE_INVENTORY_LIMIT", "The fixture inventory exceeds its file bound");
    }
    return {
      id: fixture.id,
      subjectFiles: fixture.files.filter(file => file.role === "subject").length,
      heldOutFiles: fixture.files.filter(file => file.role === "held_out").length,
      canonicalInputFiles: fixture.files.filter(file => file.role === "canonical_fixture_input").length,
      requiresAdmittedProducerBinding: fixture.requiresAdmittedProducerBinding,
    };
  });
  for (const entry of dataset.cases) {
    requireCondition(exactKeys(entry, ["id", "mode", "fixture", "checks"], ["turns"]) && ["subject", "deterministic"].includes(entry.mode) && manifest.fixtures.some(fixture => fixture.id === entry.fixture), "INVALID_CASE", "Each case names a known fixture and execution mode");
    const turns = entry.turns ?? [];
    if (entry.mode === "subject") uniqueIds(turns, "Case turns");
    else requireCondition(Array.isArray(turns) && turns.length === 0, "DETERMINISTIC_CASE_HAS_TURNS", "Deterministic producer checks do not invent model turns");
    for (const turn of turns) requireCondition(exactKeys(turn, ["id", "prompt", "checkpoint"], ["restartBefore"]) && nonblank(turn.prompt) && turn.checkpoint === "after-idle" && (turn.restartBefore === undefined || typeof turn.restartBefore === "boolean"), "INVALID_CASE_TURN", "Turns retain their actual prompt, checkpoint and optional fresh-session request");
    uniqueIds(entry.checks, "Case checks");
    for (const check of entry.checks) {
      requireCondition(exactKeys(check, ["id", "kind", "criterion", "expectation"], ["oracle"]) && ["semantic", "deterministic"].includes(check.kind) && nonblank(check.criterion) && plainObject(check.expectation) && modes.includes(check.expectation.mode) && (check.kind === "semantic" ? check.expectation.mode === "semantic_truth" : nonblank(check.oracle)), "INVALID_CASE_CHECK", "Checks require their fixed rubric, explicit polarity and actual oracle or semantic role");
      if (check.expectation.requiresAdmittedProducerBinding || check.expectation.requiresRealRoute) requireCondition(manifest.fixtures.find(fixture => fixture.id === entry.fixture).requiresAdmittedProducerBinding, "MISSING_PRODUCER_DECLARATION", "A real-route check cannot omit its fixture producer-binding requirement");
    }
  }
  return {
    schemaVersion: 1, status: "validated", behavior: "unverified",
    dataset: { id: dataset.id, version: dataset.version, sha256: source.sha256, cases: dataset.cases.length },
    fixtures,
    execution: { assessment: "not_performed", requiresAdmittedNativeBinding: true },
  };
}
