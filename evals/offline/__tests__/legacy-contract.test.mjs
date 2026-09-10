import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { makeLegacyFixture } from "./helpers/legacy-fixture.mjs";
import { repository, workRoot } from "./helpers/paths.mjs";

const require = createRequire(import.meta.url);
const legacy = require(path.join(repository, "scripts/skill-evals.cjs"));
const base = workRoot("legacy-contract");
let number = 0;
function fixture() {
  const root = path.join(base, String(++number));
  const { suite, receipt } = makeLegacyFixture(root, "validate-ok");
  return { root, suite, receipt, save() {
    fs.writeFileSync(path.join(root, "evals/fixture.json"), JSON.stringify(this.suite));
    fs.writeFileSync(path.join(root, "receipt.json"), JSON.stringify(this.receipt));
  } };
}

test("unchanged legacy source and corpus loading error paths remain synchronous", () => {
  const item = fixture();
  for (const sources of [null, [], [""], ["source.txt", "source.txt"], [path.join(item.root, "source.txt")], ["absent"], [".."]]) assert.throws(() => legacy.sourceFingerprint(sources, item.root));
  fs.mkdirSync(path.join(item.root, "directory"));
  assert.throws(() => legacy.sourceFingerprint(["directory"], item.root));
  fs.writeFileSync(path.join(base, "outside"), "outside");
  fs.symlinkSync(path.join(base, "outside"), path.join(item.root, "link"));
  assert.throws(() => legacy.sourceFingerprint(["link"], item.root), /resolves outside/);
  fs.writeFileSync(path.join(item.root, "evals/fixture.json"), "{");
  assert.throws(() => legacy.validateRepo(item.root), /invalid JSON/);
  for (const mode of ["missing", "file", "empty"]) {
    const root = path.join(base, `no-corpus-${mode}`);
    fs.mkdirSync(root);
    if (mode === "file") fs.writeFileSync(path.join(root, "evals"), "not a directory");
    if (mode === "empty") fs.mkdirSync(path.join(root, "evals"));
    assert.throws(() => legacy.validateRepo(root));
  }
});

test("unchanged legacy suite validation rejects every malformed structural boundary", () => {
  const mutations = [
    x => { x.suite = null; },
    x => { x.suite.schemaVersion = 2; },
    x => { x.suite.id = ""; },
    x => { x.suite.description = ""; },
    x => { x.suite.sources = {}; },
    x => { x.suite.sources = []; },
    x => { x.suite.reviewedSourceFingerprint = "bad"; },
    x => { x.suite.requirements = {}; },
    x => { x.suite.requirements = []; },
    x => { x.suite.cases = {}; },
    x => { x.suite.cases = []; },
    x => { x.suite.requirements = [null]; },
    x => { x.suite.requirements[0].id = ""; },
    x => { x.suite.requirements[0].description = ""; },
    x => { x.suite.requirements.push({ ...x.suite.requirements[0] }); },
    x => { x.suite.cases = [null]; },
    x => { x.suite.cases[0].id = ""; },
    x => { x.suite.cases[0].description = ""; },
    x => { x.suite.cases[0].prompt = ""; },
    x => { x.suite.cases[0].checks = {}; },
    x => { x.suite.cases.push(structuredClone(x.suite.cases[0])); },
    x => { x.suite.cases[0].checks = [null]; },
    ...["id", "polarity", "evidenceType", "description"].map(field => x => { x.suite.cases[0].checks[0][field] = ""; }),
    x => { x.suite.cases[0].checks[0].covers = {}; },
    x => { x.suite.cases[0].checks[0].covers = []; },
    x => { x.suite.cases[0].checks[0].covers = [""]; },
    x => { x.suite.cases[0].checks[0].covers = ["required", "required"]; },
    x => { x.suite.cases[0].checks[0].covers = ["unknown"]; },
    x => { x.suite.cases[0].checks.push({ ...x.suite.cases[0].checks[0] }); },
    x => { x.suite.cases[0].checks.shift(); },
    x => { x.suite.requirements.push({ id: "uncovered", description: "Uncovered requirement." }); },
  ];
  for (const mutate of mutations) {
    const item = fixture();
    mutate(item);
    item.save();
    assert.throws(() => legacy.validateRepo(item.root));
  }
});

test("unchanged legacy corpus prevents all four forms of cross-suite identity reuse", () => {
  for (const duplicate of ["suite", "requirement", "case", "check"]) {
    const item = fixture();
    const second = structuredClone(item.suite);
    if (duplicate !== "suite") second.id = "second-suite";
    if (["case", "check"].includes(duplicate)) {
      second.requirements[0].id = "second-requirement";
      for (const check of second.cases[0].checks) check.covers = ["second-requirement"];
    }
    if (duplicate === "check") second.cases[0].id = "second-case";
    fs.writeFileSync(path.join(item.root, "evals/second.json"), JSON.stringify(second));
    assert.throws(() => legacy.validateRepo(item.root), new RegExp(`duplicate ${duplicate}`));
  }
});

test("unchanged legacy receipt validation retains malformed run, timestamp, case and check failures", () => {
  const mutations = [
    x => { x.receipt = null; },
    x => { x.receipt.schemaVersion = 2; },
    ...["suiteId", "sourceFingerprint", "contractFingerprint"].map(field => x => { x.receipt[field] = ""; }),
    ...["actor", "model", "runtimeRevision"].map(field => x => { x.receipt.run[field] = ""; }),
    x => { x.receipt.run.startedAt = null; },
    x => { x.receipt.run.startedAt = "not a timestamp"; },
    x => { x.receipt.run.startedAt = "2026-13-01T00:00:00Z"; },
    x => { x.receipt.run.completedAt = "2025-01-01T00:00:00Z"; },
    x => { x.receipt.cases = [null]; },
    x => { x.receipt.cases[0].id = ""; },
    x => { x.receipt.cases[0].checks = {}; },
    x => { x.receipt.cases.push(structuredClone(x.receipt.cases[0])); },
    x => { x.receipt.cases[0].id = "extra"; },
    x => { x.receipt.cases = []; },
    x => { x.receipt.cases[0].checks = [null]; },
    x => { x.receipt.cases[0].checks[0].id = ""; },
    x => { x.receipt.cases[0].checks[0].passed = "true"; },
    x => { x.receipt.cases[0].checks[0].evidence = ""; },
    x => { x.receipt.cases[0].checks[0].id = "extra"; },
    x => { x.receipt.cases[0].checks.push({ ...x.receipt.cases[0].checks[0] }); },
  ];
  for (const mutate of mutations) {
    const item = fixture();
    mutate(item);
    item.save();
    assert.throws(() => legacy.verifyReceipt("receipt.json", item.root));
  }
  const valid = fixture();
  valid.receipt.run.startedAt = "2026-01-01T00:00:00.5Z";
  valid.receipt.run.completedAt = "2026-01-01T00:00:00.500Z";
  valid.save();
  assert.equal(legacy.verifyReceipt("receipt.json", valid.root).suiteId, "fixture");
});

test("unchanged legacy library verification uses the caller's working directory when omitted", () => {
  const item = fixture();
  const original = process.cwd();
  try {
    process.chdir(item.root);
    assert.equal(legacy.verifyReceipt("receipt.json").suiteId, "fixture");
  } finally { process.chdir(original); }
});
