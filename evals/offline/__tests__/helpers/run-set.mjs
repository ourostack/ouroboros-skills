import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../../core.mjs";
import { openRunOutput } from "../../output.mjs";

export const bytes = value => Buffer.from(`${JSON.stringify(value)}\n`);
const hash = label => sha256(label);
const ref = name => ({ path: name, sha256: hash(name) });
export const limits = { startupSendWorkMs: 100, cleanup: { totalMs: 30, abortMs: 10, stopMs: 10 }, maxStreamBytes: 1024, maxFileBytes: 8192, maxTotalBytes: 65536, maxFiles: 32 };
export function planFixture(id = "fixture", dimension = "candidate") {
  return {
    schemaVersion: 1, kind: "offline_run_plan", runSetId: id, sourceHashScheme: "sha256/raw-bytes",
    comparison: { groupId: "group", dimension, treatmentId: id, policySha256: hash("policy") },
    candidate: { id: `${id}-candidate`, repository: "owner/approved-repository", sourceCommit: "a".repeat(40), sourceManifestSha256: hash("source"), nonMethodSourceManifestSha256: hash("non-method"), method: { id: "method", version: "1.0.0", payloadManifest: ref("method-manifest.json") }, installationReceiptSha256: hash("installation") },
    dataset: { id: "synthetic-fixture", version: "1.0.0", sha256: hash("dataset") },
    fixtureManifestSha256: hash("fixtures"), checkerManifestSha256: hash("checks"), admissionContractSha256: hash("admission"), toolingSourceManifestSha256: hash("tooling"),
    runtime: { nodeVersion: "v22.23.2", sdkVersion: "1.0.13", sdkLockSha256: hash("lock"), cliVersion: "1.0.84-1", cliSha256: hash("whole-release-archive"), qualificationReceiptSha256: hash("synthetic-only-not-native"), sessionMode: "interactive" },
    expectedCells: ref("expected-cells.json"), attemptPolicy: { maxAttemptsPerCell: 1, automaticRetry: false }, bindingSha256: hash("binding"),
    activation: { subjectAgent: "fixture", compositionSeam: "fixture-seam", requestedConfigurationSha256: hash("configuration"), qualificationReceipt: ref("synthetic-activation.json") },
    gitSeeds: [], limits: structuredClone(limits),
  };
}
export function expectedFixture(plan, deterministic = false) {
  const role = (model, invocationMode) => ({ provider: "copilot", model, reasoningEffort: "high", contextTier: "default", invocationMode, promptSha256: hash(`${invocationMode}-prompt`), runtimeOptionsSha256: hash(`${invocationMode}-options`) });
  return { schemaVersion: 1, cells: [{ id: "cell", caseId: "case", candidateId: plan.candidate.id, repetition: 1, executionKind: deterministic ? "deterministic" : "subject_with_judge", subject: deterministic ? null : role("gpt-6-astra", "native-subject"), judge: deterministic ? null : role("claude-opus-5", "empty-judge") }] };
}
export function seedFixture() {
  return { cellId: "cell", fixtureId: "fixture", subjectFilesManifestSha256: hash("subject"), baseCommit: "a".repeat(40), initialBranch: "fixture", identity: { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" }, seedReceipt: ref("seed.json") };
}
export function methodFixture(label) {
  const member = (name, value) => ({ path: name, mode: 0o644, bytes: Buffer.byteLength(value), sha256: hash(value) });
  const unchanged = member("application.txt", "same application");
  const changed = member("method.txt", label);
  const files = label === "after" ? [changed, member("added-method.txt", "new method")] : [changed, member("removed-method.txt", "old method")];
  return { source: bytes({ schemaVersion: 1, files: [unchanged, ...files] }), nonMethod: bytes({ schemaVersion: 1, files: [unchanged] }), method: bytes({ schemaVersion: 1, files }) };
}
export function bindMethod(plan, proof) {
  plan.candidate.sourceManifestSha256 = sha256(proof.source);
  plan.candidate.nonMethodSourceManifestSha256 = sha256(proof.nonMethod);
  plan.candidate.method.payloadManifest.sha256 = sha256(proof.method);
}
// These are synthetic publication/inventory controls, not native producer or model qualifications.
export function diskRunSet(parent, { id, dimension = "candidate", started = true, published = true, closed = true, status = "product_failure", deterministic = false, withSeed = false, method }) {
  const root = path.join(parent, id);
  fs.mkdirSync(root);
  const put = (name, value) => {
    const data = Buffer.isBuffer(value) ? value : bytes(value);
    fs.writeFileSync(path.join(root, name), data);
    return { path: name, sha256: sha256(data) };
  };
  const plan = planFixture(id, dimension);
  if (withSeed) plan.gitSeeds = [seedFixture()];
  if (method) {
    bindMethod(plan, method);
    put("source-manifest.json", method.source);
    put("non-method-source-manifest.json", method.nonMethod);
    put("method-manifest.json", method.method);
  }
  const expectedCells = expectedFixture(plan, deterministic);
  plan.expectedCells = put("expected-cells.json", expectedCells);
  const planRef = put("plan.json", plan);
  const journalRecords = [];
  const attempts = [];
  if (started) {
    const attemptId = `${id}-attempt`;
    const common = { schemaVersion: 1, runSetId: id, attemptId, cellId: "cell", timestamp: "2026-01-01T00:00:00Z" };
    const append = record => journalRecords.push({ ...common, ...record, sequence: journalRecords.length + 1, previousRecordSha256: journalRecords.length ? sha256(bytes(journalRecords.at(-1))) : null });
    append({ type: "attempt_start", status: null, receipt: null, commitMarker: null });
    let receiptRef = null;
    let markerRef = null;
    if (closed) {
      const semantic = { passed: "pass", product_failure: "fail", inconclusive: "investigate" }[status];
      const receipt = { schemaVersion: 1, runId: attemptId, cellId: "cell", caseId: "case", planSha256: planRef.sha256, status, grade: semantic ? { status: semantic } : null, counts: { observedRequests: semantic ? 1 : 0, schemaAcceptedHandlers: semantic ? 1 : 0, validatorAcceptedReports: semantic ? 1 : 0, admittedGrades: semantic ? 1 : 0 } };
      const output = openRunOutput({ outputRoot: path.join(root, "attempt"), authorizedRoot: root, protectedRoots: [path.join(root, "plan.json"), path.join(root, "expected-cells.json")], runContext: { runId: attemptId, cellId: "cell", planSha256: planRef.sha256 }, limits });
      if (published) {
        output.commit(receipt);
        markerRef = { path: "attempt/COMMITTED.json", sha256: sha256(fs.readFileSync(path.join(root, "attempt/COMMITTED.json"))) };
      } else fs.writeFileSync(path.join(root, "attempt/receipt.json"), bytes(receipt));
      receiptRef = { path: "attempt/receipt.json", sha256: sha256(fs.readFileSync(path.join(root, "attempt/receipt.json"))) };
      append({ type: "attempt_close", status, receipt: receiptRef, commitMarker: markerRef });
    }
    attempts.push({ attemptId, cellId: "cell", sequence: 1, status: closed ? status : "unavailable", receipt: receiptRef, commitMarker: markerRef });
  }
  const runSet = { schemaVersion: 1, kind: "offline_run_set", runSetId: id, state: started && closed && published ? "complete" : "incomplete", plan: planRef, expectedCells: plan.expectedCells, attemptJournal: put("attempt-journal.jsonl", Buffer.concat(journalRecords.map(bytes))), attempts, unstartedCellIds: started ? [] : ["cell"], createdAt: "2026-01-01T00:00:00Z", closedAt: closed ? "2026-01-01T00:00:01Z" : null };
  const save = () => put("run-set.json", runSet);
  save();
  return { root, plan, runSet, expectedCells, journalRecords, put, save, filename: path.join(root, "run-set.json"), readArtifact: name => fs.readFileSync(path.join(root, name)) };
}
