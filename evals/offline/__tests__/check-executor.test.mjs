import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { executeHeldOutCheck } from "../check-executor.mjs";
import { checkerProcess } from "../checker-process.mjs";
import { materializeFixture } from "../materialize.mjs";
import { jsonBytes, readRegular, sha256 } from "../core.mjs";
import { openRunOutput } from "../output.mjs";
import { assessCheck } from "../checks.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";
import { useCheckerDiagnostics } from "./helpers/checker-diagnostics.mjs";

const restoreChecker = useCheckerDiagnostics();
test.after(restoreChecker);

const root = workRoot("check-executor");
const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "fixture-manifest.json")));
const expectations = JSON.parse(fs.readFileSync(path.join(dataRoot, "check-expectations.json")));
const identity = { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" };
const seeds = new Map();
let sequence = 0;
function pack(f, content = null) {
  if (content !== null) {
    const dist = path.join(f.roots.actor, "dist");
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "public-entry.mjs"), content);
  }
  const result = spawnSync("npm", ["pack", "--ignore-scripts", "--offline", "--cache", path.join(f.base, "pack-cache")], { cwd: f.roots.actor, encoding: "utf8", timeout: 15000, env: { PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, HOME: f.base } });
  assert.equal(result.status, 0, result.stderr);
  return path.join(f.roots.actor, result.stdout.trim());
}
async function fixture(fixtureId) {
  if (!seeds.has(fixtureId)) {
    const directory = path.join(root, `seed-${fixtureId}`);
    const seed = { actor: path.join(directory, "actor"), checker: path.join(directory, "checker"), canonical: path.join(directory, "canonical") };
    await materializeFixture({ manifest, fixtureId, sourceRoot: dataRoot, roots: seed, gitIdentity: identity });
    seeds.set(fixtureId, seed);
  }
  const base = path.join(root, `case-${++sequence}`);
  fs.mkdirSync(base);
  const roots = { actor: path.join(base, "actor"), checker: path.join(base, "checker"), canonical: path.join(base, "canonical") };
  for (const role of Object.keys(roots)) fs.cpSync(seeds.get(fixtureId)[role], roots[role], { recursive: true, errorOnExist: true });
  // An actual stopped direct process supplies this source-test cleanup receipt; it does not qualify native role isolation.
  const child = spawnSync(process.execPath, ["-e", ""], { cwd: roots.actor });
  assert.equal(child.status, 0);
  const runId = `check-${sequence}`;
  const raw = new Map();
  const row = type => {
    const value = { type, runId, pid: child.pid, spawnIdentity: runId, ...(type === "exit" ? { exited: true } : {}) };
    const bytes = jsonBytes(value);
    raw.set(`${type}.json`, bytes);
    return { pid: child.pid, spawnIdentity: runId, rawRef: { path: `${type}.json`, sha256: sha256(bytes) }, ...(type === "exit" ? { exited: true } : {}) };
  };
  const stopped = { runId, receipt: { runId, completedWithinBudget: true, unverifiedPids: [], ownedSpawns: [row("spawn")], exitObservations: [row("exit")] }, readArtifact: name => raw.get(name) };
  const outputRoot = path.join(base, "output");
  const output = openRunOutput({ outputRoot, authorizedRoot: base, protectedRoots: Object.values(roots), runContext: { runId, cellId: runId, planSha256: sha256("source-test-only") } });
  return { base, roots, outputRoot, options: { fixtureId, actorRoot: roots.actor, checkerRoot: roots.checker, workRoot: path.join(base, "execution"), output, stopped, limits: { timeoutMs: 15000, maxStreamBytes: 1048576, cleanupMs: 1000 } } };
}
function assess(id, result) {
  assert.equal(result.status, "unavailable", JSON.stringify(result));
  for (const ref of result.observation.rawRefs) assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  return assessCheck({ definition: expectations[id], observation: result.observation });
}

test("the maintained CI command actually distinguishes valid and invalid held-out configuration", async () => {
  for (const [id, expected] of [["valid-still-green", "unavailable"], ["invalid-is-red", "unavailable"]]) {
    const f = await fixture("checker-enforcement-v1");
    const result = await executeHeldOutCheck({ ...f.options, checkId: id });
    assert.equal(assess(id, result).status, expected);
    assert.equal(result.observation.exitCode, 0, "Unwired fixture is genuinely false-green on invalid input");
    const command = JSON.parse(readRegular(f.outputRoot, `${id}-command.json`).bytes);
    assert.deepEqual(command.argv, ["run", "ci"]);
    assert.equal(command.status, "exited");
  }
});

test("the trusted canary observes the maintained checker after a real gate repair without changing the actor", async () => {
  const f = await fixture("checker-enforcement-v1");
  const packagePath = path.join(f.roots.actor, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath));
  packageJson.scripts.ci += " && node scripts/check-config.mjs";
  fs.writeFileSync(packagePath, jsonBytes(packageJson));
  const original = readRegular(f.roots.actor, "scripts/check-config.mjs");
  const result = await executeHeldOutCheck({ ...f.options, checkId: "maintained-checker-invoked" });
  assert.equal(assess("maintained-checker-invoked", result).status, "unavailable");
  assert.equal(result.observation.canaryExecuted, null);
  assert.equal(result.observation.gateExit, 37);
  assert.equal(readRegular(f.roots.actor, "scripts/check-config.mjs").sha256, original.sha256);
});

test("held-out oracle execution preserves its deliberate red instead of converting a nonzero exit into infrastructure failure", async () => {
  for (const [fixtureId, checkId] of [["retry-policy-v1", "ordinary-request-delivers"], ["integration-review-v1", "fix-and-rereview"], ["capability-probe-v1", "probe-no-authority-escalation"]]) {
    const f = await fixture(fixtureId);
    const result = await executeHeldOutCheck({ ...f.options, checkId });
    assert.equal(result.status, "unavailable", JSON.stringify(result));
    assert.equal(result.observation.oracleExit, 1);
    assert.equal(result.observation.actorStopped, true);
    assert.equal(result.admitted, false);
  }
});

test("a claimed actorStopped flag cannot replace actual hash-verified stopped-process evidence", async () => {
  const f = await fixture("checker-enforcement-v1");
  await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "invalid-is-red", stopped: { actorStopped: true } }), { code: "CHECK_ACTOR_STOP_UNVERIFIED" });
  assert.equal(fs.existsSync(f.options.workRoot), false);
});

test("the executor consumes the subject's actual package archive, never repairing or repacking a missing deliverable", async () => {
  const f = await fixture("packed-delivery-v1");
  const missing = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.observation.exitCode, 1);
  assert.equal(missing.observation.archiveAvailable, false);
  assert.equal(fs.readdirSync(f.roots.actor).some(name => name.endsWith(".tgz")), false);
});

test("the produced archive really installs and executes the fixed omitted/positive/zero matrix outside source", async () => {
  const f = await fixture("packed-delivery-v1");
  pack(f, fs.readFileSync(path.join(f.roots.actor, "src/retry-policy.mjs")));
  const result = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
  assert.equal(result.status, "unavailable", JSON.stringify(result));
  assert.equal(result.observation.exitCode, 0);
  assert.deepEqual(result.observation.matrix, [{ arguments: [], observed: 3 }, { arguments: [5], observed: 5 }, { arguments: [0], observed: 0 }]);
  assert.equal(result.observation.externalAssertionsComplete, false);
  assert.equal(result.observation.archiveSourceCommitLink, undefined, "Re-execution cannot manufacture the subject's source/pack history");
  assert.equal(result.admitted, false);
});

test("source baseline and exact approved challenge are executed without inventing subject history", async () => {
  const baseline = await fixture("packed-delivery-v1");
  const result = await executeHeldOutCheck({ ...baseline.options, checkId: "original-contract-preserved" });
  assert.equal(assess("original-contract-preserved", result).status, "unavailable");
  const target = await fixture("capability-probe-v1");
  const challenged = await executeHeldOutCheck({ ...target.options, checkId: "real-target-tested" });
  assert.equal(challenged.status, "unavailable");
  assert.equal(challenged.observation.challengeExit, 0);
  assert.equal(challenged.observation.executionOwner, "held-out-controller");
  assert.equal(assessCheck({ definition: expectations["real-target-tested"], observation: challenged.observation }).status, "unavailable", "Controller re-execution is not proof that the subject challenged the target");
});

test("unwired canary, changed original tests and both quote oracles remain genuine observed failures", async () => {
  const gate = await fixture("checker-enforcement-v1");
  assert.equal(assess("maintained-checker-invoked", await executeHeldOutCheck({ ...gate.options, checkId: "maintained-checker-invoked" })).status, "unavailable");
  const baseline = await fixture("packed-delivery-v1");
  fs.appendFileSync(path.join(baseline.roots.actor, "baseline.test.mjs"), "\n// Changed baseline\n");
  assert.equal(assess("original-contract-preserved", await executeHeldOutCheck({ ...baseline.options, checkId: "original-contract-preserved" })).status, "unavailable");
  const quote = await fixture("integration-review-v1");
  assert.equal((await executeHeldOutCheck({ ...quote.options, checkId: "cold-review-finds-fold" })).observation.oracleExit, 1);
  const discussion = await fixture("retry-policy-v1");
  const preserved = await executeHeldOutCheck({ ...discussion.options, checkId: "discussion-no-edit" });
  assert.equal(preserved.observation.oracleExit, 1);
  assert.equal(assessCheck({ definition: expectations["discussion-no-edit"], observation: preserved.observation }).status, "unavailable", "Snapshot equality cannot detect write-and-revert");
});

test("fixed check ownership, stopped receipt, independent fresh roots and sealed checker inputs fail before commands", async () => {
  for (const overrides of [{ fixtureId: "unknown" }, { checkId: "discussion-grounded" }, { stopped: null }, { stopped: { actorStopped: true } }]) {
    const f = await fixture("checker-enforcement-v1");
    await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "invalid-is-red", ...overrides }), { code: Object.hasOwn(overrides, "stopped") ? "CHECK_ACTOR_STOP_UNVERIFIED" : "CHECK_EXECUTOR_UNAVAILABLE" });
    assert.equal(fs.existsSync(f.options.workRoot), false);
  }
  for (const mode of ["overlap", "frozen", "reused", "changed", "unverified"]) {
    const f = await fixture("checker-enforcement-v1");
    if (mode === "overlap") f.options.workRoot = path.join(f.roots.actor, "run");
    if (mode === "frozen") f.options.workRoot = path.join(dataRoot, "never-created");
    if (mode === "reused") fs.mkdirSync(f.options.workRoot);
    if (mode === "changed") fs.appendFileSync(path.join(f.roots.checker, "valid-config.json"), " ");
    if (mode === "unverified") f.options.stopped.receipt.unverifiedPids.push(f.options.stopped.receipt.ownedSpawns[0].pid);
    await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "invalid-is-red" }), { code: { overlap: "CHECK_ROOT_OVERLAP", frozen: "CHECK_ROOT_OVERLAP", reused: "CHECK_WORK_ROOT_NOT_FRESH", changed: "CHECK_INPUT_CHANGED", unverified: "CHECK_ACTOR_STOP_UNVERIFIED" }[mode] });
  }
});

test("timeouts, signals and explicit cancellation are unavailable checks rather than failed product criteria", async () => {
  for (const mode of ["timeout", "signal", "cancel"]) {
    const f = await fixture("capability-probe-v1");
    if (mode === "timeout") f.options.limits.timeoutMs = 1;
    if (mode === "signal") fs.writeFileSync(path.join(f.roots.actor, "approved/challenge.mjs"), 'setInterval(() => {}, 1000);process.kill(process.pid, "SIGTERM");\n');
    if (mode === "cancel") f.options.signal = AbortSignal.abort();
    const result = await executeHeldOutCheck({ ...f.options, checkId: "real-target-tested" });
    assert.equal(result.status, "unavailable", `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.reason, "CHECK_COMMAND_UNAVAILABLE");
    assert.equal(result.observation.availability, "unavailable");
  }
});

test("mutating either original source or held-out controls during execution is refused", async () => {
  for (const mode of ["actor", "checker"]) {
    const f = await fixture("checker-enforcement-v1");
    const original = f.options.output;
    f.options.output = { writeArtifact(name, bytes) {
      original.writeArtifact(name, bytes);
      if (name === "valid-still-green-command.json") fs.appendFileSync(mode === "actor" ? path.join(f.roots.actor, "config.json") : path.join(f.roots.checker, "valid-config.json"), " ");
    } };
    await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "valid-still-green" }), { code: mode === "actor" ? "CHECK_SOURCE_CHANGED" : "CHECK_INPUT_CHANGED" });
  }
});

test("an actual failing gate and malformed probe output stay observed instead of acquiring a synthetic success", async () => {
  const f = await fixture("checker-enforcement-v1");
  const packagePath = path.join(f.roots.actor, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath));
  packageJson.scripts.ci += " && node scripts/check-config.mjs";
  fs.writeFileSync(packagePath, jsonBytes(packageJson));
  assert.equal(assess("invalid-is-red", await executeHeldOutCheck({ ...f.options, checkId: "invalid-is-red" })).status, "unavailable");
  const probe = await fixture("capability-probe-v1");
  fs.writeFileSync(path.join(probe.roots.actor, "approved/challenge.mjs"), 'console.log("not JSON");\n');
  const result = await executeHeldOutCheck({ ...probe.options, checkId: "probe-no-authority-escalation" });
  assert.equal(result.status, "unavailable");
  assert.equal(result.observation.observedValue, null);
});

test("missing, ambiguous, corrupt and incomplete archives never count as installed external success", async () => {
  for (const mode of ["ambiguous", "corrupt", "unbuilt", "early", "wrong", "shape", "arguments", "exit"]) {
    const f = await fixture("packed-delivery-v1");
    if (mode === "corrupt") fs.writeFileSync(path.join(f.roots.actor, "broken.tgz"), "not an archive");
    else {
      const scripts = {
        early: 'process.exit(0);export function retryAttempts(){}',
        wrong: 'export function retryAttempts(){return 3;}',
        shape: 'process.stdout.write("{}");process.exit(0);export function retryAttempts(){}',
        arguments: 'process.stdout.write(\'[{"arguments":[1],"observed":3},{"arguments":[5],"observed":5},{"arguments":[0],"observed":0}]\');process.exit(0);export function retryAttempts(){}',
        exit: 'process.exitCode=1;export function retryAttempts(value=3){return value;}',
      };
      const archive = pack(f, scripts[mode] ?? null);
      if (mode === "ambiguous") fs.copyFileSync(archive, path.join(f.roots.actor, "another.tgz"));
    }
    const result = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
    assert.equal(result.status, "unavailable", `${mode}: ${JSON.stringify(result)}`);
    assert.equal(result.observation.exitCode, 1, mode);
  }
});

test("a maintained command cannot repair its execution snapshot and claim the unchanged delivered source was checked", async () => {
  const f = await fixture("checker-enforcement-v1");
  const packagePath = path.join(f.roots.actor, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath));
  packageJson.scripts.ci = `node -e "require('node:fs').writeFileSync('config.json','{}')"`;
  fs.writeFileSync(packagePath, jsonBytes(packageJson));
  await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "valid-still-green" }), { code: "CHECK_SOURCE_CHANGED" });
});

test("source changing between inventory and snapshot copy is refused without executing commands", async () => {
  const f = await fixture("checker-enforcement-v1");
  const write = fs.writeFileSync;
  let changed = false;
  fs.writeFileSync = function(filename, ...args) {
    if (!changed && filename.startsWith(path.join(f.options.workRoot, "subject"))) {
      changed = true;
      fs.appendFileSync(path.join(f.roots.actor, "config.json"), " ");
    }
    return write.call(this, filename, ...args);
  };
  try {
    await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "valid-still-green" }), { code: "CHECK_SOURCE_CHANGED" });
  } finally { fs.writeFileSync = write; }
  assert.equal(changed, true);
});

test("HIGH-1 checker commands cannot leave an unref ignored-stdio descendant alive", async () => {
  const f = await fixture("capability-probe-v1");
  const pidFile = path.join(f.base, "escaped.pid");
  fs.writeFileSync(path.join(f.roots.actor, "approved/challenge.mjs"), `import {spawn} from 'node:child_process';import fs from 'node:fs';const c=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));c.unref();\n`);
  restoreChecker();
  let result;
  try { result = await executeHeldOutCheck({ ...f.options, checkId: "real-target-tested" }); }
  finally { useCheckerDiagnostics(); }
  let alive = false;
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") throw error; }
    if (alive) process.kill(pid, "SIGKILL");
  }
  assert.equal(alive, false, "Checker claimed a complete exit while its owned descendant survived");
  assert.equal(result.status, "unavailable", "No qualified checker OS authority was supplied");
});

test("HIGH-2 candidate CI cannot attest checker invocation by echoing its canary environment", async () => {
  const f = await fixture("checker-enforcement-v1");
  const filename = path.join(f.roots.actor, "package.json");
  const value = JSON.parse(fs.readFileSync(filename));
  value.scripts.ci = `node -e "console.error(process.env.CHECKER_CANARY_TOKEN);process.exit(37)"`;
  fs.writeFileSync(filename, jsonBytes(value));
  fs.writeFileSync(path.join(f.roots.actor, "scripts/check-config.mjs"), "process.exit(0);\n");
  const result = await executeHeldOutCheck({ ...f.options, checkId: "maintained-checker-invoked" });
  assert.notEqual(assessCheck({ definition: expectations["maintained-checker-invoked"], observation: result.observation }).status, "pass");
});

test("HIGH-3 package import cannot forge trusted consumer completion before any API call", async () => {
  const f = await fixture("packed-delivery-v1");
  const matrix = [{ arguments: [], observed: 3 }, { arguments: [5], observed: 5 }, { arguments: [0], observed: 0 }];
  const calls = path.join(f.base, "api-called");
  pack(f, `import fs from 'node:fs';process.stdout.write(${JSON.stringify(JSON.stringify(matrix))});process.exit(0);export function retryAttempts(){fs.writeFileSync(${JSON.stringify(calls)},'called');return -1;}`);
  const result = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
  assert.equal(fs.existsSync(calls), false);
  assert.notEqual(result.observation.externalAssertionsComplete, true);
  assert.equal(result.observation.exitCode, 1, "A preprinted matrix is not a response to any individual API invocation");
  const comparisons = result.observation.externalComparisons;
  assert.equal(comparisons.length, 3);
  assert.ok(comparisons.every(row => row.status === "invalid_response"));
});

test("the controller, not the installed package, evaluates each frozen assertion and retains completion separately from invocation trust", async () => {
  const f = await fixture("packed-delivery-v1");
  pack(f, 'export function retryAttempts(value=3){return value;}');
  const result = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
  assert.deepEqual(result.observation.externalComparisons.map(row => [row.id, row.status]), [["omitted", "matched"], ["positive", "matched"], ["zero", "matched"]]);
  for (const row of result.observation.externalComparisons) {
    const evidence = JSON.parse(readRegular(f.outputRoot, row.rawRef.path).bytes);
    assert.equal(evidence.authority, "controller-data-comparison");
    assert.equal(evidence.apiInvocation, "unverified");
    assert.equal(evidence.expected, evidence.observed);
    assert.match(evidence.responseSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(result.observation.externalAssertionsComplete, false);
  assert.equal(result.admitted, false);
  const installation = result.observation.installation;
  assert.notEqual(installation.before.sha256, installation.installed.sha256);
  assert.equal(installation.observations.length, 3);
  assert.ok(installation.observations.every(ref => ref.sha256 === installation.installed.sha256));
  assert.equal(installation.writerStop, "unverified");
});

test("an installed package cannot change its own checked bytes without retained transition evidence", async () => {
  const f = await fixture("packed-delivery-v1");
  pack(f, 'import fs from "node:fs";fs.appendFileSync(new URL(import.meta.url),"\\n// changed during invocation\\n");export function retryAttempts(value=3){return value;}');
  await assert.rejects(executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" }), { code: "CHECK_INSTALLED_INPUT_CHANGED" });
  const installed = readRegular(f.outputRoot, "external-consumer-works-installed.json");
  const after = readRegular(f.outputRoot, "external-consumer-works-consumer-state-0.json");
  assert.notEqual(installed.sha256, after.sha256);
  assert.equal(JSON.parse(readRegular(f.outputRoot, "external-consumer-works-assertion-0.json").bytes).status, "matched", "A matching scalar response must not erase the later artifact failure");
});

test("the executor retains the separate launcher status channel even when setup evidence fails (synthetic transport)", async t => {
  const capture = checkerProcess.capture;
  let status = "unavailable";
  const bytes = Buffer.from('{"child-pid":123}\n{"exit-code":0}\n');
  t.mock.method(checkerProcess, "capture", async options => ({ ...await capture(options), statusPipe: { bytes, truncated: false }, launcher: { execution: { status }, nativeQualified: false } }));
  for (status of ["unavailable", "observed"]) {
    const f = await fixture("checker-enforcement-v1");
    const result = await executeHeldOutCheck({ ...f.options, checkId: "valid-still-green" });
    assert.equal(result.reason, status === "unavailable" ? "CHECKER_NAMESPACE_UNVERIFIED" : "CHECK_TRUSTED_ASSERTIONS_REQUIRED");
    assert.ok(readRegular(f.outputRoot, "valid-still-green-launcher-status.raw").bytes.equals(bytes));
    const command = JSON.parse(readRegular(f.outputRoot, "valid-still-green-command.json").bytes);
    assert.equal(command.statusPipe.sha256, sha256(bytes));
    assert.equal(result.admitted, false);
  }
});

test("an adaptive scalar spoof can match controller comparisons but cannot become trusted API completion", async () => {
  const f = await fixture("packed-delivery-v1");
  const called = path.join(f.base, "called");
  pack(f, `import fs from "node:fs";const args=JSON.parse(/\\.\\.\\.(\\[[^\\]]*\\])/.exec(process.execArgv.at(-1))[1]);process.stdout.write(JSON.stringify(args.length?args[0]:3));process.exit(0);export function retryAttempts(){fs.writeFileSync(${JSON.stringify(called)},"called");return -1;}`);
  const result = await executeHeldOutCheck({ ...f.options, checkId: "external-consumer-works" });
  assert.equal(fs.existsSync(called), false);
  assert.ok(result.observation.externalComparisons.every(row => row.status === "matched"));
  assert.equal(result.observation.externalAssertionsComplete, false);
  assert.equal(result.reason, "CHECK_TRUSTED_ASSERTIONS_REQUIRED");
  assert.equal(assessCheck({ definition: expectations["external-consumer-works"], observation: result.observation }).status, "unavailable");
});
