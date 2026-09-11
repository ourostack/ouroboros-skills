import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import dataset from "../cases/v2-alpha-v1/dataset.json" with { type: "json" };
import manifest from "../cases/v2-alpha-v1/fixture-manifest.json" with { type: "json" };
import { jsonBytes, listRegularFiles, sha256 } from "../core.mjs";
import { materializeFixture } from "../materialize.mjs";
import { observeAuthority, observePackagePipeline, observeSource } from "../source-observations.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";

const retain = (path, value) => ({ path, sha256: sha256(jsonBytes(value)) });
const trace = () => ({ executions: [], mutations: [], operations: [], processes: [], rawRefs: [], traceCoverage: "complete" });
function pipeline(commands, exitCode = 0) {
  return { ...trace(), executions: commands.map((argv, index) => ({ timestamp: index, pid: index + 1, executionId: `${index + 1}:1`, outcome: { kind: "exited", exitCode }, args: `${JSON.stringify(argv[0] === "npm" ? "/usr/bin/npm" : argv[0] === "node" ? process.execPath : "/bin/tool")}, ${JSON.stringify(argv)}, 0x0`, result: "0" })), processes: commands.map((_, index) => ({ pid: index + 1, exitCode })) };
}
const consumer = 'import { retryAttempts } from "packed-delivery-fixture"; console.log(retryAttempts(), retryAttempts(5), retryAttempts(0));';
test("HIGH-4 outside-root and denied mutation attempts cannot be clean authority negatives", () => {
  for (const [call, args, result] of [
    ["unlink", '"/other-repo/source"', "0"],
    ["openat", 'AT_FDCWD, "/fixture/source", O_WRONLY|O_TRUNC', "-1 EACCES"],
  ]) {
    const observed = observeAuthority({ root: "/fixture", trace: { operations: [{ call, args, result, pid: 1, timestamp: 1 }] } });
    assert.ok(observed.sourceWrite || observed.authorityWrite || observed.unresolved, JSON.stringify(observed));
  }
});
test("HIGH-5 execve operand cannot be replaced by npm or node argv impersonation", () => {
  const commands = [["npm", "run", "build"], ["npm", "pack"], ["npm", "install", "artifact.tgz"], ["/bin/node", "-e", consumer]];
  const forged = pipeline(commands);
  for (const event of forged.executions) event.args = event.args.replace(/^"[^"]*"/, '"/bin/echo"');
  assert.notEqual(observePackagePipeline({ trace: forged, retain }).pipeline?.length, 4);
  assert.equal(observePackagePipeline({ trace: forged, retain }).pipelineCandidates.length, 0);
});
test("a replaced npm image cannot borrow its replacement's successful PID exit", () => {
  const observed = pipeline([["npm", "pack"]]);
  observed.executions[0].executionId = "1:1";
  observed.executions[0].outcome = { kind: "replaced", timestamp: 2, replacement: "1:2" };
  assert.deepEqual(observePackagePipeline({ trace: observed, retain }), {});
  delete observed.executions[0].outcome;
  assert.deepEqual(observePackagePipeline({ trace: observed, retain }), {});
});
test("pipeline observations require actual successful execution and terminal records, not command keywords", () => {
  const commands = [["npm", "run", "build"], ["npm", "pack"], ["npm", "install", "--offline", "artifact.tgz"], ["node", "--input-type=module", "-e", consumer]];
  assert.deepEqual(observePackagePipeline({ retain }), {});
  const diagnostic = observePackagePipeline({ trace: pipeline(commands), retain });
  assert.deepEqual(diagnostic.pipelineCandidates.map(value => value.step), ["build", "pack", "install", "consumer"]);
  assert.equal(diagnostic.pipeline, undefined);
  assert.equal(diagnostic.availability, "unavailable");
  assert.deepEqual(observePackagePipeline({ trace: pipeline(commands, null), retain }), {});
  for (const argv of [["node", "consumer.mjs"], ["node", "-e", "console.log('consumer')"]]) assert.deepEqual(observePackagePipeline({ trace: pipeline([argv]), retain }), {});
  const extra = pipeline([["npm", "run", "test"], ["npm", "install", "not-an-archive"], ["git", "status"], ["node", "unknown.mjs"], ...commands]);
  extra.executions.push({ timestamp: -1, result: "-1 ENOENT", args: "not executable" }, { timestamp: -2, result: "0", args: "not decoded" });
  assert.equal(observePackagePipeline({ trace: extra, retain }).pipelineCandidates.length, 4);
  assert.deepEqual(observePackagePipeline({ trace: { ...trace(), executions: [{ result: "0", args: "not decoded" }] }, retain }), {});
});

let sequence = 0;
async function fixtureFor(caseId = "packed-deliverable") {
  const root = workRoot(`source-observation-${++sequence}`);
  const definition = dataset.cases.find(value => value.id === caseId);
  const fixture = await materializeFixture({ manifest, fixtureId: definition.fixture, sourceRoot: dataRoot, roots: Object.fromEntries(["actor", "checker", "canonical"].map(role => [role, path.join(root, role)])), gitIdentity: { authorName: "Fixture", authorEmail: "fixture@example.invalid", committerName: "Fixture", committerEmail: "fixture@example.invalid" } });
  const sourceBefore = listRegularFiles(fixture.actorView.root);
  const args = { fixture, sourceBefore, reviews: [], checkpoints: [], trace: trace(), retain };
  const observe = (mode, extra = {}) => observeSource({ ...args, ...extra, check: { id: mode, expectation: { mode, target: "fixture", checkpoint: "discussion", targetRelativePath: "target.mjs" } } });
  return { root, actor: fixture.actorView.root, args, observe };
}
test("source observations use committed bytes and reject unsupported or mismatched archive provenance", async () => {
  const f = await fixtureFor();
  assert.equal(f.observe("installed_public_matrix").archiveSourceCommitLink, undefined);
  const stage = path.join(f.root, "stage");
  const pkg = path.join(stage, "package");
  fs.mkdirSync(pkg, { recursive: true });
  const source = fs.readFileSync(path.join(f.actor, "src/retry-policy.mjs"));
  const description = fs.readFileSync(path.join(f.actor, "package.json"));
  const entry = JSON.parse(description).exports.slice(2);
  fs.mkdirSync(path.dirname(path.join(pkg, entry)), { recursive: true });
  fs.writeFileSync(path.join(pkg, entry), source);
  fs.writeFileSync(path.join(pkg, "package.json"), description);
  const archive = path.join(f.actor, "result.tgz");
  const pack = () => execFileSync("tar", ["-czf", archive, "-C", stage, "package"], { timeout: 10000 });
  pack();
  assert.ok(f.observe("installed_public_matrix").archiveSourceCommitLink);
  fs.writeFileSync(path.join(f.actor, "unexpected"), "not generated");
  assert.equal(f.observe("installed_public_matrix").commitVerified, false);
  fs.unlinkSync(path.join(f.actor, "unexpected"));
  for (const exports of [{ import: "./dist/index.mjs" }, "node:fs"]) {
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ exports }));
    pack();
    assert.equal(f.observe("installed_public_matrix").archiveSourceCommitLink, undefined);
  }
  fs.writeFileSync(path.join(pkg, "package.json"), description);
  fs.appendFileSync(path.join(pkg, entry), "\n// changed\n");
  pack();
  assert.equal(f.observe("installed_public_matrix").archiveSourceCommitLink, undefined);
  fs.writeFileSync(path.join(pkg, entry), source);
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ ...JSON.parse(description), version: "99.0.0" }));
  pack();
  assert.equal(f.observe("installed_public_matrix").archiveSourceCommitLink, undefined);
  fs.copyFileSync(archive, path.join(f.actor, "other.tgz"));
  assert.equal(f.observe("installed_public_matrix").archiveSourceCommitLink, undefined);
});
test("review and canonical facts are extracted from actual retained controller records", async () => {
  const f = await fixtureFor();
  const rawRef = retain("review.json", {});
  const record = (turnIndex, value, resultType = "success") => ({ turnIndex, sessionId: "subject", rawRef, result: { resultType, textResultForLlm: JSON.stringify(value) } });
  f.args.reviews = [
    record(0, { dependencyFailureObserved: true, completion: "not-complete" }, "failure"),
    record(1, { sha: "a".repeat(40), findings: ["finding"], reviewerSessionId: "reviewer" }),
    record(2, { sha: "b".repeat(40), admitted: true, reviewerSessionId: "rereviewer" }),
    { turnIndex: 5, result: { textResultForLlm: "not-json" } },
  ];
  assert.equal(f.observe("expected_dependency_failure").reviewOutcome, "unavailable");
  assert.equal(f.observe("independent_review_truth").reviewerObserved, true);
  assert.equal(f.observe("repair_and_rereview").rereviewVerdict, "clean");
  const restart = { task: { track: "track", slug: "task" } };
  assert.equal(f.observe("canonical_identity_truth", { restart, checkpoints: [{ sessionId: "old" }, { sessionId: "new" }] }).freshSessionObserved, true);
  assert.equal(f.observe("canonical_identity_truth", { restart, checkpoints: [{ sessionId: "same" }, { sessionId: "same" }] }).freshSessionObserved, false);
  assert.equal(f.observe("repair_and_rereview", { reviews: [record(2, { admitted: true, reviewerSessionId: "subject" })] }).reviewerDistinct, false);
  assert.equal(f.observe("expected_dependency_failure", { reviews: [] }).reviewOutcome, "unknown");
});
test("source challenges and preservation keep observed writes and authority attempts separate from final bytes", async () => {
  const f = await fixtureFor();
  f.args.fixture.writeProbe = { filename: path.join(f.actor, "probe"), rawRef: retain("probe.json", {}) };
  f.args.fixture.writableTargetVerified = true;
  assert.throws(() => f.observe("preserve_counterexample", { trace: null }), { code: "TRACE_UNAVAILABLE" });
  assert.throws(() => f.observe("target_truth", { trace: null }), { code: "TRACE_UNAVAILABLE" });
  f.args.trace.operations = f.args.trace.mutations;
  for (const args of ['"/other"', `"${f.actor}/.git/index"`, `"${f.actor}/probe"`]) f.args.trace.mutations.push({ call: "unlink", args, result: "0", succeeded: true });
  f.args.trace.mutations.push({ call: "unlink", args: `"${f.actor}/source"`, result: "-1 EACCES", succeeded: false });
  assert.equal(f.observe("preserve_counterexample").sourceChanged, true);
  assert.equal(f.observe("preserve_counterexample").availability, "unavailable", "A probe pathname alone does not authorize arbitrary future operations on it");
  f.args.trace.mutations.push({ call: "unlink", args: `"${f.actor}/source"`, result: "0", succeeded: true }, { call: "unlink", args: `"${f.actor}/.git/config"`, result: "0", succeeded: true });
  f.args.trace.executions.push({ args: '"git", ["git", "push"], 0x0', result: "-1 EPERM" });
  assert.equal(f.observe("preserve_counterexample").sourceChanged, true);
  assert.equal(f.observe("preserve_counterexample").remoteOrDefaultMutation, true);
  assert.equal(f.observe("target_truth").challengeCandidate, false);
  f.args.trace.executions.push({ args: '"node", ["node", "target.mjs"], 0x0', result: "0" });
  assert.equal(f.observe("target_truth").challengeCandidate, true);
  assert.equal(f.observe("target_truth").challengeExecuted, undefined);
  assert.equal(f.observe("target_truth").availability, "unavailable");
  assert.equal(f.observe("semantic_truth").sourceChanged, false);
});
test("FD writes use actual opens, duplication and process lineage; uncertain authority never becomes a clean negative", () => {
  const root = "/fixture";
  const run = operations => observeAuthority({ trace: { operations: operations.map(([call, args, result, pid = 1], timestamp) => ({ call, args, result, pid, timestamp })) }, root, probe: "/fixture/probe" });
  assert.throws(() => observeAuthority({ trace: {}, root }), { code: "TRACE_AUTHORITY_UNAVAILABLE" });
  assert.deepEqual(run([["write", "0x1, 0xab, 0x2", "0x2"]]), { sourceWrite: false, authorityWrite: false, unresolved: false });
  assert.deepEqual(run([["openat", 'AT_FDCWD, "source", O_WRONLY', "4</fixture/source>"]]), { sourceWrite: true, authorityWrite: false, unresolved: false });
  assert.equal(run([["openat", 'AT_FDCWD, "source", O_WRONLY', "4</fixture/source>"], ["write", "0x4, 0xab, 0x2", "0x2"]]).sourceWrite, true);
  assert.equal(run([["openat", 'AT_FDCWD, "source", O_WRONLY', "4</fixture/source>"], ["write", "0x4, 0xab, 0x2", "0"]]).sourceWrite, true);
  assert.equal(run([["write", "0x9, 0xab, 0x2", "0x2"]]).unresolved, true);
  assert.equal(run([["unlink", '"relative"', "0"]]).unresolved, true);
  assert.equal(run([["unlink", "0x123", "0"]]).unresolved, true);
  assert.equal(run([["openat", '0, "file", O_TRUNC', "4"]]).unresolved, true);
  assert.equal(run([["creat", '"/fixture/source", 0600', "4</fixture/source>"]]).sourceWrite, true);
  assert.equal(run([["openat", '0, "file", O_TRUNC', "4</fixture/source>"]]).sourceWrite, true);
  const opened = ["openat", '0, "file", O_RDONLY', "4</fixture/source>"];
  for (const call of ["dup", "dup2", "dup3", "fcntl"]) {
    assert.equal(run([opened, [call, "4, F_DUPFD, 8", "8"], ["ftruncate", "8, 0", "0"]]).sourceWrite, true);
  }
  for (const flags of ["SIGCHLD", "CLONE_FILES"]) assert.equal(run([opened, ["clone", `flags=${flags}`, "2"], ["ftruncate", "4, 0", "0", 2]]).sourceWrite, true);
  for (const close of [["close", "4", "0"], ["close_range", "3, 99, 0", "0"], ["execve", '"/bin/node", ["node"], 0x0', "0"]]) assert.equal(run([opened, close, ["ftruncate", "4, 0", "0"]]).unresolved, true);
  for (const call of ["socket", "accept", "accept4"]) assert.equal(run([[call, "0, 0, 0", "4"], ["write", "4, 0xab, 1", "1"]]).unresolved, true);
  for (const call of ["pipe", "pipe2", "socketpair"]) assert.equal(run([[call, "[4, 5], 0", "0"], ["write", "5, 0xab, 1", "1"]]).unresolved, false);
  assert.throws(() => run([["pipe", "0x123", "0"]]), { code: "TRACE_AUTHORITY_UNAVAILABLE" });
  assert.equal(run([["connect", "4, 0x123, 10", "0"]]).unresolved, true);
  assert.equal(run([["sendto", "0x4, 0x123, 0xa, 0, 0x456, 0x10", "0xa"]]).unresolved, true);
  assert.equal(run([["connect", "4, 0x123, 10", "-1 EPERM"]]).unresolved, true);
});

test("authority tracks denied operations without changing descriptor ownership and never exempts arbitrary canonical paths", () => {
  const run = operations => observeAuthority({ root: "/fixture", probe: "/fixture/probe", trace: { operations: operations.map(([call, args, result], timestamp) => ({ call, args, result, timestamp, pid: 1 })) } });
  const opened = ["open", '"/other-repo/source", O_RDONLY', "4</other-repo/source>"];
  for (const operation of [
    ["close", "4", "-1 EINTR"], ["close_range", "4, 9", "-1 EPERM"], ["dup2", "1, 4", "-1 EPERM"], ["execve", '"/bin/tool", [], 0x0', "-1 ENOENT"],
  ]) assert.equal(run([opened, operation, ["write", "4, 0, 1", "-1 EACCES"]]).authorityWrite, true);
  for (const filename of ["/fixture", "/fixture/.git", "/fixture/.git/index", "/fixture/../other-repo/source", "/canonical/task.md"]) {
    const result = run([["unlink", JSON.stringify(filename), "-1 EACCES"]]);
    assert.ok(result.sourceWrite || result.authorityWrite);
  }
  assert.equal(run([["openat", 'AT_FDCWD, "/fixture/source", O_TRUNC', "-1 EACCES"]]).sourceWrite, true);
  assert.equal(run([["openat", 'AT_FDCWD, "unresolved", O_TRUNC', "-1 EACCES"]]).unresolved, true);
  assert.equal(run([["openat", "AT_FDCWD, 0x123, O_TRUNC", "-1 EFAULT"]]).unresolved, true);
  assert.equal(run([["openat", 'AT_FDCWD, "/fixture/probe", O_WRONLY', "4</fixture/probe>"]]).unresolved, true);
  assert.equal(run([["new_unknown_mutation", "0, 0", "-1 EPERM"]]).unresolved, true);
  assert.equal(run([["stat", '"/fixture/source"', "0"]]).unresolved, false);
  for (const call of ["clone", "socket", "pipe"]) assert.equal(run([[call, "0, 0", "-1 EPERM"]]).unresolved, false);
  assert.equal(run([["fcntl", "4, F_SETFD, FD_CLOEXEC", "0"]]).unresolved, true);
});

test("even recognized actual executable paths lack trusted exec-byte, cwd and artifact route bindings", () => {
  const programs = [
    [process.execPath, ["node", "/usr/lib/node_modules/npm/bin/npm-cli.js", "pack"]],
    ["/usr/local/bin/npm", ["npm", "pack"]],
    ["/usr/bin/node", ["node", "-e", consumer]],
    ["/bin/node", ["node", "-e", consumer]],
  ];
  for (const [executable, argv] of programs) {
    const trace_ = pipeline([argv]);
    trace_.executions[0].args = `${JSON.stringify(executable)}, ${JSON.stringify(argv)}, 0x0`;
    const observed = observePackagePipeline({ trace: trace_, retain });
    assert.equal(observed.pipelineCandidates.length, 1);
    assert.equal(observed.pipeline, undefined);
    assert.equal(observed.availability, "unavailable");
  }
  for (const args of ['"/bin/node", {}, 0x0', '"/bin/node", [7], 0x0', '"relative/node", ["node"], 0x0']) {
    assert.deepEqual(observePackagePipeline({ trace: { ...trace(), executions: [{ args, result: "0" }] }, retain }), {});
  }
});
