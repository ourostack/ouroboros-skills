import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const legacyCases = [
  ["validate-ok", ["validate", "."]],
  ["fingerprint-ok", ["fingerprint", "evals/fixture.json", "."]],
  ["verify-ok", ["verify", "receipt.json", "."]],
  ["validate-stale", ["validate", "."]],
  ["validate-polarity", ["validate", "."]],
  ["fingerprint-empty", ["fingerprint", "evals/fixture.json", "."]],
  ["fingerprint-traversal", ["fingerprint", "evals/fixture.json", "."]],
  ["verify-source", ["verify", "receipt.json", "."]],
  ["verify-contract", ["verify", "receipt.json", "."]],
  ["verify-unknown-suite", ["verify", "receipt.json", "."]],
  ["verify-failed-check", ["verify", "receipt.json", "."]],
  ["verify-missing-check", ["verify", "receipt.json", "."]],
  ["verify-invalid-time", ["verify", "receipt.json", "."]],
  ["verify-missing-run", ["verify", "receipt.json", "."]],
  ["verify-invalid-shape", ["verify", "receipt.json", "."]],
  ["no-command", []],
  ["unknown-command", ["unknown"]],
  ["validate-extra", ["validate", ".", "extra"]],
  ["fingerprint-missing", ["fingerprint"]],
  ["verify-missing", ["verify"]],
  ["verify-extra", ["verify", "receipt.json", ".", "extra"]],
];

export function makeLegacyFixture(directory, variant) {
  mkdirSync(join(directory, "evals"), { recursive: true });
  const suite = {
    schemaVersion: 1,
    id: "fixture",
    description: "Fixed legacy fixture.",
    sources: ["source.txt"],
    reviewedSourceFingerprint: hash(`source.txt\n${hash("original\n")}\n`),
    requirements: [{ id: "required", description: "Required outcome." }],
    cases: [{
      id: "ordinary",
      description: "An ordinary fixed case.",
      prompt: "Perform the authorized local change.",
      checks: [
        { id: "positive", polarity: "must", evidenceType: "response", covers: ["required"], description: "Support the outcome." },
        { id: "negative", polarity: "must_not", evidenceType: "tool_call", covers: ["required"], description: "Do not exceed authority." },
      ],
    }],
  };
  const receipt = {
    schemaVersion: 1,
    suiteId: suite.id,
    sourceFingerprint: suite.reviewedSourceFingerprint,
    contractFingerprint: hash(JSON.stringify(suite)),
    run: { actor: "fixture", model: "fixture", runtimeRevision: "fixture", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z" },
    cases: [{ id: "ordinary", checks: [{ id: "positive", passed: true, evidence: "Observed." }, { id: "negative", passed: true, evidence: "Observed." }] }],
  };
  let source = "original\n";
  if (variant === "validate-stale") source = "changed\n";
  if (variant === "validate-polarity") suite.cases[0].checks.pop();
  if (variant === "fingerprint-empty") suite.sources = [];
  if (variant === "fingerprint-traversal") suite.sources = ["../outside"];
  if (variant === "verify-source") receipt.sourceFingerprint = "stale";
  if (variant === "verify-contract") receipt.contractFingerprint = "stale";
  if (variant === "verify-unknown-suite") receipt.suiteId = "unknown";
  if (variant === "verify-failed-check") receipt.cases[0].checks[0].passed = false;
  if (variant === "verify-missing-check") receipt.cases[0].checks.pop();
  if (variant === "verify-invalid-time") receipt.run.startedAt = "2026-02-30T00:00:00Z";
  if (variant === "verify-missing-run") delete receipt.run;
  if (variant === "verify-invalid-shape") receipt.cases = {};
  writeFileSync(join(directory, "source.txt"), source);
  writeFileSync(join(directory, "evals/fixture.json"), `${JSON.stringify(suite)}\n`);
  writeFileSync(join(directory, "receipt.json"), `${JSON.stringify(receipt)}\n`);
  return { suite, receipt };
}
