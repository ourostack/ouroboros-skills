import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkCriteriaConsistency, parseReportCriteria, parseReportResult, salvageReportResult, validateToolArgs } from "../vendor/gauntlet/src/agent/validators.ts";
import { parseEvidenceIndex, readEvidenceFile, readWorkspaceFile, validateEvidenceIndex } from "../vendor/gauntlet/src/context/scoped-read.ts";
import { RESULT_SCHEMA_VERSION, snapshotRunConfig } from "../vendor/gauntlet/src/types.ts";
import { validateTerminalReport } from "../admission.mjs";
import { createEvidenceReader } from "../evidence.mjs";
import { workRoot } from "./helpers/paths.mjs";

const report = { status: "pass", summary: "Supported result.", reasoning: "Retained source.", observations: [] };
const criterion = { criterion: "Frozen criterion", verdict: "pass", evidence: "proof.txt:1" };
const context = { criteria: [criterion.criterion], evidenceIndex: { files: ["proof.txt"] } };
const observation = { kind: "bug", description: "A concrete finding." };

test("maintained report parser: actual accepted and rejected boundaries", () => {
  for (const value of [null, undefined, [], "string", 3]) assert.equal(parseReportResult(value).ok, false);
  for (const delta of [{ status: undefined }, { status: "other" }, { summary: 1 }, { reasoning: null }]) assert.equal(parseReportResult({ ...report, ...delta }).ok, false);
  for (const observations of [undefined, null, [], [observation], JSON.stringify([observation])]) assert.equal(parseReportResult({ ...report, observations }).ok, true);
  for (const observations of ["not json", "{}", {}, [null], [[]], [{ kind: 1, description: "x" }], [{ kind: "unknown", description: "x" }], [{ kind: "bug", description: 1 }]]) assert.equal(parseReportResult({ ...report, observations }).ok, false);
  for (const kind of ["bug", "ux", "typo", "suggestion", "a11y", "performance"]) assert.equal(parseReportResult({ ...report, observations: [{ ...observation, kind }] }).ok, true);
});

test("unadopted salvage characterization is not production report admission", () => {
  for (const value of [null, [], { ...report, status: false }, { ...report, reasoning: 2 }]) assert.equal(salvageReportResult(value).ok, false);
  for (const observations of [undefined, null, []]) assert.deepEqual(salvageReportResult({ ...report, observations }).value.dropped, []);
  for (const observations of ["bad json", "{}", true]) assert.equal(salvageReportResult({ ...report, observations }).value.dropped[0].index, -1);
  const value = { ...report, observations: [observation, { kind: "unknown", description: "x" }] };
  const result = salvageReportResult(value);
  assert.equal(result.value.observations.length, 1);
  assert.equal(result.value.dropped[0].index, 1);
  assert.equal(validateTerminalReport({ ...value, criteria: [criterion] }, context).ok, false);
});

test("maintained criterion and consistency parsing retains its actual permissiveness", () => {
  assert.deepEqual(parseReportCriteria("ignored without a rubric", []).value, []);
  for (const value of [undefined, null, [], true, "broken json", "{}", [null], [[]], [{ ...criterion, criterion: 1 }], [{ ...criterion, verdict: 1 }], [{ ...criterion, verdict: "other" }], [{ ...criterion, evidence: 1 }], [{ ...criterion, evidence: " " }]]) assert.equal(parseReportCriteria(value, context.criteria).ok, false);
  assert.equal(parseReportCriteria(JSON.stringify([criterion]), context.criteria).ok, true);
  assert.equal(parseReportCriteria([{ ...criterion, criterion: "restated differently" }], context.criteria).ok, true);
  assert.equal(checkCriteriaConsistency("pass", [criterion]).ok, true);
  assert.equal(checkCriteriaConsistency("pass", [{ ...criterion, verdict: "unclear" }]).ok, false);
  assert.equal(checkCriteriaConsistency("fail", [criterion]).ok, true);
  for (const value of [
    { ...report, criteria: JSON.stringify([criterion]) },
    { ...report, criteria: [{ ...criterion, criterion: "restated differently" }] },
    { ...report, criteria: [criterion], status: "fail" },
    { ...report, criteria: [criterion], observations: JSON.stringify([observation]) },
    { ...report, criteria: [criterion], summary: " " },
    { ...report, criteria: [criterion], unknown: true },
  ]) assert.equal(validateTerminalReport(value, context).ok, false);
});

test("unadopted schema-helper characterization covers unsupported and permissive declarations", () => {
  for (const value of [null, [], false]) assert.equal(validateToolArgs("tool", value, {}).ok, false);
  assert.equal(validateToolArgs("tool", {}, { type: "array" }).ok, true);
  assert.equal(validateToolArgs("tool", {}, {}).ok, true);
  assert.equal(validateToolArgs("tool", {}, { type: "object", properties: [] }).ok, true);
  assert.equal(validateToolArgs("tool", {}, { required: "not an array", properties: {} }).ok, true);
  assert.equal(validateToolArgs("tool", { name: "x" }, { required: [1, "name"], properties: {} }).ok, true);
  for (const value of [{}, { name: null }, { name: undefined }]) assert.equal(validateToolArgs("tool", value, { required: ["name"] }).ok, false);
  assert.equal(validateToolArgs("tool", {}, { properties: { name: { type: "string" } } }).ok, true);
  assert.equal(validateToolArgs("tool", { name: null, other: undefined }, { properties: { name: { type: "string" }, other: { type: "number" } } }).ok, true);
  const values = [["string", "x", 1], ["number", 1, "x"], ["boolean", true, "x"], ["array", [], {}], ["object", {}, []]];
  for (const [type, valid, invalid] of values) {
    const schema = { properties: { value: { type } } };
    assert.equal(validateToolArgs("tool", { value: valid }, schema).ok, true);
    assert.equal(validateToolArgs("tool", { value: invalid }, schema).ok, false);
  }
  assert.equal(validateToolArgs("tool", { value: "x" }, { properties: { value: { type: "unsupported" } } }).ok, true);
  assert.equal(validateToolArgs("tool", { value: "x" }, { properties: { value: { type: 1 } } }).ok, true);
  assert.equal(validateToolArgs("tool", { value: "x" }, { properties: { value: { enum: ["x"] } } }).ok, true);
  assert.equal(validateToolArgs("tool", { value: "y" }, { properties: { value: { enum: ["x"] } } }).ok, false);
  assert.equal(validateToolArgs("tool", { extra: "accepted" }, { additionalProperties: false }).ok, true);
  assert.equal(validateTerminalReport({ ...report, criteria: [criterion], extra: "not admitted" }, context).ok, false);
});

const base = workRoot("vendor");
const root = path.join(base, "evidence");
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, "proof.txt"), "abcdef");
fs.writeFileSync(path.join(base, "outside.txt"), "owned outside fixture");
fs.mkdirSync(path.join(root, "directory"));
fs.symlinkSync(path.join(root, "proof.txt"), path.join(root, "link.txt"));
const index = { files: ["proof.txt"] };

test("maintained index validation is adopted; its unbounded readers are only characterized", () => {
  for (const value of [null, [], {}, { files: {} }, { files: [1] }]) assert.throws(() => parseEvidenceIndex(value));
  assert.deepEqual(parseEvidenceIndex({ files: ["proof.txt"], ignored: true }), index);
  assert.doesNotThrow(() => validateEvidenceIndex(root, index));
  for (const filename of ["", path.join(root, "proof.txt"), "./proof.txt", ".", "..", "../outside.txt"]) assert.throws(() => validateEvidenceIndex(root, { files: [filename] }));
  assert.throws(() => validateEvidenceIndex(root, { files: ["proof.txt", "proof.txt"] }));
  assert.throws(() => validateEvidenceIndex(root, { files: ["link.txt"] }));
  assert.throws(() => readWorkspaceFile(root, path.join(root, "proof.txt")));
  assert.throws(() => readWorkspaceFile(root, "../outside.txt"));
  assert.throws(() => readWorkspaceFile(root, ".."));
  assert.throws(() => readWorkspaceFile(root, "directory"));
  assert.equal(readWorkspaceFile(root, "proof.txt"), "abcdef");
  assert.equal(readWorkspaceFile(root, "link.txt"), "abcdef");
  assert.equal(readEvidenceFile(root, index, "proof.txt"), "abcdef");
  assert.throws(() => readEvidenceFile(root, index, "missing.txt"));
  assert.throws(() => readEvidenceFile(root, index, "../outside.txt"));
  assert.throws(() => createEvidenceReader({ root, index: { files: ["link.txt"] } }));
  assert.deepEqual(createEvidenceReader({ root, index }).read("proof.txt", 0, 2), { text: "ab", totalCharacters: 6, nextOffset: 2 });
});

test("unadopted platform conditional characterization does not claim Windows qualification", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { ...descriptor, value: "win32" });
    assert.equal(readWorkspaceFile(root, "proof.txt"), "abcdef");
    assert.equal(readEvidenceFile(root, index, "proof.txt"), "abcdef");
  } finally { Object.defineProperty(process, "platform", descriptor); }
});

test("unadopted Gauntlet run-config helpers remain distinct from Copilot usage and receipts", () => {
  assert.equal(RESULT_SCHEMA_VERSION, 5);
  const config = { target: "fixture", model: "fixture-only", adapter: "cli", budgetMs: 100 };
  assert.equal(snapshotRunConfig(config, undefined).chrome, undefined);
  assert.deepEqual(snapshotRunConfig({ ...config, chrome: { host: "localhost", port: 1 } }, { width: 80, height: 24 }), { ...config, chrome: "localhost:1", viewport: { width: 80, height: 24 } });
});
