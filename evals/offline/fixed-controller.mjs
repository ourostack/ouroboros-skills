import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import dataset from "./cases/v2-alpha-v1/dataset.json" with { type: "json" };
import manifest from "./cases/v2-alpha-v1/fixture-manifest.json" with { type: "json" };
import { canonicalJson, jsonBytes, listRegularFiles, parseRawJson, readRawReference, readRegular, requireCondition, sha256 } from "./core.mjs";
import { heldOutChecks } from "./check-executor.mjs";
import { assessCheck } from "./checks.mjs";
import { materializeFixture } from "./materialize.mjs";
import { runTerminalProtocol } from "./native-protocol.mjs";
import { runRuntimeQualification } from "./native-runtime.mjs";
import { createCanonicalController, requireCallbacks, runPrivateOperations } from "./controller-callbacks.mjs";
import { openRunOutput, readCommittedRun } from "./output.mjs";
import { readWriterTrace } from "./writer-trace.mjs";
import { sourceObservations } from "./source-observations.mjs";
import { validateAlphaExpectedCells } from "./contracts.mjs";
import { validateCleanupReceipt } from "./copilot-runner.mjs";
import { observeSubjectActivation, prepareNativeSubjectTurn } from "./native-subject.mjs";

const sourceRoot = fileURLToPath(new URL("./cases/v2-alpha-v1/", import.meta.url));
const commandChecks = new Set(["discussion-no-edit", "ordinary-request-delivers", "valid-still-green", "invalid-is-red", "maintained-checker-invoked", "original-contract-preserved", "external-consumer-works", "cold-review-finds-fold", "fix-and-rereview", "real-target-tested", "probe-no-authority-escalation"]);
const zeroCounts = () => ({ observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 });
const unavailable = () => ({ status: "unavailable", grade: null, counts: zeroCounts() });
const journalBytes = record => Buffer.from(`${JSON.stringify(record)}\n`);
const safeFailure = error => ({ code: /^[A-Z0-9_]{1,80}$/.test(error?.code) ? error.code : null, message: "The native controller phase failed. Inspect retained phase artifacts; untrusted exception text is not persisted because it can contain credentials." });
const immutable = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
};

export async function loadNativeInputs({ filename, prepared, inputRoot }) {
  const absolute = path.resolve(filename);
  const inventory = parseRawJson(readRawReference({ path: "tooling-source-manifest.json", sha256: prepared.plan.toolingSourceManifestSha256 }, name => readRegular(inputRoot, name).bytes));
  const relative = path.relative(inputRoot, absolute);
  const member = readRegular(inputRoot, relative);
  requireCondition(inventory.files.some(file => file.path === relative && file.sha256 === member.sha256), "NATIVE_INPUT_SOURCE_UNBOUND", "The executable native-input module must belong to the frozen tooling source manifest");
  return (await import(pathToFileURL(absolute).href)).nativeInputs;
}

export function requireNativeInputs(prepared, inputs) {
  requireCondition(prepared && inputs && typeof inputs.assertAllocation === "function" && typeof inputs.assertSourceAndRuntime === "function", "NATIVE_QUALIFICATION_REQUIRED", "Actual allocation and source/runtime admission functions are required before native acquisition");
  validateAlphaExpectedCells(prepared.expected, dataset);
  requireCondition(inputs.cells instanceof Map && inputs.cells.size === prepared.expected.cells.length, "NATIVE_CALLBACK_UNMAPPED", "Every fixed cell requires its actual native inputs; subsets are not a campaign");
  for (const cell of prepared.expected.cells) {
    const input = inputs.cells.get(cell.id);
    for (const name of ["open", "assertConfinement", "readCanonical", "withPermission", "createDeskCallbacks"]) requireCondition(typeof input?.[name] === "function", "NATIVE_CALLBACK_UNMAPPED", `${cell.id} requires ${name}`);
    if (cell.executionKind === "subject_with_judge") {
      for (const name of ["subjectBeforeSend", "reviewHandler"]) requireCondition(typeof input[name] === "function", "NATIVE_CALLBACK_UNMAPPED", `${cell.id} requires ${name}`);
    }
  }
}

// open() supplies live runTerminalProtocol arguments and OS-owned roots, never a case result.
export async function runFixedCase({ cell, plan, input, output, outputRoot, bindingAdmitted = false }) {
  const definition = dataset.cases.find(value => value.id === cell.caseId);
  if (definition.mode !== "deterministic") heldOutChecks.assertAvailable();
  const seed = plan.gitSeeds.find(value => value.cellId === cell.id);
  requireCondition(seed, "NATIVE_SEED_UNMAPPED", "Every native fixture requires its frozen Git seed and configured identity");
  const fixture = await materializeFixture({ manifest, fixtureId: definition.fixture, sourceRoot, roots: input.roots, gitIdentity: seed.identity });
  requireCondition(fixture.gitSeed.baseCommit === seed.baseCommit, "NATIVE_SEED_MISMATCH", "Materialized source differs from the predeclared Git seed");
  const opened = await input.open({ cell, plan, fixture });
  requireCondition(typeof opened?.close === "function", "NATIVE_CALLBACK_UNMAPPED", "The owning native acquisition must supply bounded close before use");
  let failure;
  let failed = false;
  let result;
  let stopped;
  const owners = new Set([opened]);
  const reopen = async options => {
    const next = await input.open({ cell, plan, fixture, ...options });
    requireCondition(typeof next?.close === "function", "NATIVE_CALLBACK_UNMAPPED", "Every native reacquisition requires its owned close operation");
    owners.add(next);
    await input.assertConfinement({ opened: next, fixture, cell, plan });
    return next;
  };
  try {
    await input.assertConfinement({ opened, fixture, cell, plan });
    result = await executeCase({ cell, plan, input, output, outputRoot, definition, fixture, opened, reopen });
  } catch (error) { failure = error; failed = true; throw error; }
  finally {
    const errors = [];
    for (const owner of owners) {
      try { stopped = await owner.close(); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw Object.assign(new AggregateError([...(failed ? [failure] : []), ...errors], "Native ownership cleanup failed; no grade can be admitted"), { observedCounts: { ...(result?.counts ?? failure?.observedCounts ?? zeroCounts()), admittedGrades: 0 } });
  }
  if (definition.mode !== "deterministic") return result;
  requireCondition(stopped && validateCleanupReceipt(stopped.receipt, { runId: stopped.runId, readArtifact: stopped.readArtifact }).ok, "PRIVATE_STOP_UNVERIFIED", "Private route admission requires the same actual stopped-writer receipt as held-out execution");
  const retain = (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
    const token = opened.protocol?.token;
    requireCondition(typeof token !== "string" || !bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing controller capture was withheld");
    output.writeArtifact(name, bytes);
    return { path: name, sha256: sha256(bytes) };
  };
  const trace = readWriterTrace({ directory: opened.traceDirectories[0], retain, ownedSpawns: stopped.receipt.ownedSpawns });
  retain("private-trace.json", trace);
  const checks = definition.checks.map(check => {
    const observation = {
      ...result.privateOperations.observations[check.id], producerBindingAdmitted: bindingAdmitted,
      rawRefs: [...result.privateOperations.rawRefs, ...trace.rawRefs],
      availability: trace.traceCoverage === "complete" && !trace.operations.some(event => ["connect", "bind", "sendto", "sendmsg", "sendmmsg", "mount", "umount2", "ptrace", "process_vm_writev"].includes(event.call)) ? "observed" : "unavailable",
    };
    retain(`private-${check.id}-observation.json`, observation);
    return [check.id, assessCheck({ definition: check.expectation, observation })];
  });
  return { ...unavailable(), status: checks.some(([, value]) => value.status === "unavailable") ? "unavailable" : checks.every(([, value]) => value.status === "pass") ? "passed" : "product_failure", checks };
}

async function executeCase({ cell, plan, input, output, outputRoot, definition, fixture, opened, reopen }) {
  let sequence = 0;
  const retain = (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
    const token = opened.protocol?.token;
    requireCondition(typeof token !== "string" || !bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing controller capture was withheld");
    const filename = `${++sequence}-${name}`;
    output.writeArtifact(filename, bytes);
    return { path: filename, sha256: sha256(bytes) };
  };
  retain("fixture.json", fixture);
  let active;
  const callbacks = Object.fromEntries(Object.entries({ canonical: ["create", "update", "archive"], private: ["ledger", "feedback"] }).map(([group, names]) => [group, Object.fromEntries(names.map(name => [name, value => active[group][name](value)]))]));
  let canonical;
  const checkpoints = [];
  const checks = new Map();
  const reviews = [];
  const sourceBefore = listRegularFiles(fixture.actorView.root);
  let previousSessionId;
  let sessionId = randomUUID();
  let restart;
  let initialOracleExit;
  let lastTrace;
  if (definition.mode === "deterministic") {
    active = requireCallbacks(await input.createDeskCallbacks({ session: opened.session, expectedAgent: opened.subjectTurn.agent, withPermission: input.withPermission }));
    const operations = await runPrivateOperations({ ...opened.privateOperations, gitRoots: [fixture.actorView.root, fixture.canonicalView.root], callbacks, retain, legacy: opened.legacy });
    retain("private-operations.json", operations);
    // RPC CRUD is not OS protection, absence of Git publication, or a disabled-store delta.
    return { ...unavailable(), privateOperations: operations };
  } else {
    for (const [turnIndex, turn] of definition.turns.entries()) {
      if (turn.restartBefore) { previousSessionId = sessionId; sessionId = randomUUID(); }
      if (turnIndex > 0) opened = await reopen({ turnIndex, sessionId, resume: !turn.restartBefore });
      const records = [];
      const files = new Map();
      const subjectTurn = { ...opened.subjectTurn, schemaVersion: 1, caseId: cell.caseId, turnIndex, sessionId, resume: turnIndex > 0 && !turn.restartBefore, actorRoot: fixture.actorView.root, canonicalRoot: fixture.canonicalView.root };
      const current = await runTerminalProtocol({
        ...opened.protocol, model: cell.subject.model,
        limits: { startupSendWorkMs: plan.limits.startupSendWorkMs, cleanupMs: plan.limits.cleanup.totalMs },
        subjectTurn,
        reviewHandler: async request => {
          const result = await input.reviewHandler({ ...request, turnIndex, dependencyAvailable: turn.id !== "review-blocked" });
          const rawRef = retain(`review-${turnIndex}.json`, { request, result });
          reviews.push({ ...request, turnIndex, result, rawRef });
          if (turn.id === "review-blocked") await canonical.reviewFailure(result);
          return result;
        },
        subjectBeforeSend: async context => {
          await input.subjectBeforeSend(context);
          await context.phase(() => context.session.rpc.tools.initializeAndValidate());
          const metadata = await context.phase(() => context.session.rpc.tools.getCurrentMetadata());
          await observeSubjectActivation({ prepared: prepareNativeSubjectTurn(subjectTurn), session: context.session, metadata, phase: context.phase, artifact: (name, value) => context.artifact(`preoperation-${name}`, value) });
          if (turnIndex === 0) {
            const filename = path.join(fixture.actorView.root, `.controller-write-probe-${randomUUID()}`);
            const marker = randomUUID();
            const script = `const fs=require("node:fs");const p=${JSON.stringify(filename)};fs.writeFileSync(p,${JSON.stringify(marker)},{flag:"wx",mode:384});try{process.stdout.write(fs.readFileSync(p))}finally{fs.unlinkSync(p)}`;
            const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
            const arguments_ = { command: `${quote(process.execPath)} -e ${quote(script)}`, description: "Check the authorized fixture writer and remove only its probe" };
            const result = await context.phase(() => context.session.rpc.tools.execute({ name: "bash", arguments: arguments_ }));
            const rawRef = retain("writable-target.json", { arguments: arguments_, result });
            fixture.writeProbe = { filename, rawRef };
            fixture.writableTargetVerified = result.resultType === "success" && result.textResultForLlm.includes(marker) && !fs.existsSync(filename);
            requireCondition(fixture.writableTargetVerified, "SUBJECT_TARGET_NOT_WRITABLE", "The real subject tool did not complete its positive write/read/remove probe");
          }
          active = requireCallbacks(await input.createDeskCallbacks({ session: context.session, expectedAgent: opened.subjectTurn.agent, withPermission: input.withPermission }));
          if (cell.caseId === "review-recovery-state") {
            if (!canonical) {
              canonical = createCanonicalController({ callbacks, task: opened.task, scenario: parseRawJson(readRegular(fixture.canonicalView.root, "scenario.json").bytes), readCanonical: () => input.readCanonical({ opened }), retain });
              await canonical.seed();
            }
            if (turn.restartBefore) restart = await canonical.restart(previousSessionId, sessionId);
            if (turn.id === "fix-and-scope") await canonical.scope();
          }
        },
        emit: record => {
          records.push(record);
          if (record.kind === "artifact") files.set(record.ref.path, Buffer.from(record.base64, "base64"));
        },
      });
      retain(`turn-${turnIndex}.json`, records);
      checkpoints.push(current);
      if (current.status !== "observed") return { ...unavailable(), status: ["timed_out", "cancelled"].includes(current.status) ? current.status : "unavailable", checkpoints };
      const trace = readWriterTrace({ directory: opened.traceDirectories[turnIndex], retain, ownedSpawns: current.cleanup.receipt.ownedSpawns });
      lastTrace = trace;
      retain(`trace-${turnIndex}.json`, trace);
      requireCondition(trace.traceCoverage === "complete", "TRACE_UNAVAILABLE", "Incomplete OS writer lineage cannot authorize held-out execution or native admission");
      const stopped = { runId: current.runId, receipt: current.cleanup.receipt, readArtifact: name => files.get(name) };
      const applicable = definition.checks.filter(check => commandChecks.has(check.id) && (check.id === "discussion-no-edit" ? turn.id === "discussion" : check.id === "cold-review-finds-fold" ? turn.id === "resume-review" : turnIndex === definition.turns.length - 1));
      for (const check of applicable) {
        const executed = await heldOutChecks.execute({ fixtureId: definition.fixture, checkId: check.id, actorRoot: fixture.actorView.root, checkerRoot: fixture.checkerView.root, workRoot: path.join(opened.checkRoot, `${turnIndex}-${check.id}`), output, stopped, limits: { timeoutMs: plan.limits.startupSendWorkMs, cleanupMs: plan.limits.cleanup.totalMs, maxStreamBytes: plan.limits.maxStreamBytes } });
        const additional = sourceObservations.observe({ check, fixture, trace, restart, sourceBefore, reviews, checkpoints, retain });
        // Command exits and raw references belong to the maintained executor, never the adapter.
        const observation = { ...additional, ...executed.observation, availability: additional.availability === "unavailable" ? "unavailable" : executed.observation.availability, traceCoverage: trace.traceCoverage, rawRefs: [...additional.rawRefs, ...executed.observation.rawRefs, ...trace.rawRefs] };
        if (check.id === "discussion-no-edit") initialOracleExit = executed.observation.oracleExit;
        if (check.id === "ordinary-request-delivers") {
          observation.initialOracleExit = initialOracleExit;
          observation.finalOracleExit = executed.observation.baselineExit === 0 && executed.observation.baselineUnchanged ? executed.observation.oracleExit : 1;
        }
        if (check.id === "cold-review-finds-fold") observation.sourceOracleExit = executed.observation.oracleExit;
        checks.set(check.id, assessCheck({ definition: check.expectation, observation }));
        retain(`${check.id}-observation.json`, observation);
      }
      if (cell.caseId === "review-recovery-state") {
        // The next turn rereads the actual canonical file before it resumes or adds scope.
        const bytes = await canonical.checkpoint();
        retain(`canonical-stopped-${turnIndex}.json`, { base64: bytes.toString("base64") });
      }
    }
    for (const check of definition.checks.filter(check => check.kind === "deterministic" && !checks.has(check.id))) {
      const observation = sourceObservations.observe({ check, fixture, trace: lastTrace, checkpoints, restart, sourceBefore, reviews, retain });
      retain(`${check.id}-observation.json`, observation);
      checks.set(check.id, assessCheck({ definition: check.expectation, observation }));
    }
  }
  retain("deterministic-checks.json", [...checks]);
  if ([...checks.values()].some(check => check.status === "unavailable")) return { ...unavailable(), checks: [...checks], checkpoints };
  const evidenceSeal = listRegularFiles(outputRoot).filter(file => file.path !== "receipt.incomplete.json").map(({ path, sha256 }) => ({ path, sha256 }));
  const assessment = { caseId: cell.caseId, criteria: definition.checks.map(check => check.criterion), fixedVerdicts: definition.checks.filter(check => check.kind === "deterministic").map(check => ({ criterion: check.criterion, verdict: checks.get(check.id).status })), evidenceRoot: outputRoot, evidenceIndex: { files: evidenceSeal.map(file => file.path) }, evidenceSeal };
  output.writeArtifact("controller-assessment.json", jsonBytes(assessment));
  output.writeArtifact("controller-judge-plan.json", jsonBytes({ ...opened.judge.plan, model: cell.judge.model }));
  const judge = await runRuntimeQualification({ ...opened.judge, plan: { ...opened.judge.plan, model: cell.judge.model }, assessment });
  try {
    retain("judge-return.json", judge);
    const published = readCommittedRun(judge.artifacts);
    requireCondition(canonicalJson(published.receipt.grade) === canonicalJson(judge.grade), "JUDGE_PUBLICATION_MISMATCH", "The returned grade differs from its committed native admission");
    retain("judge.json", { artifacts: judge.artifacts, marker: published.marker, receipt: published.receipt });
    output.writeArtifact("controller-judge.stdout", readRegular(judge.artifacts, "stdout.raw").bytes);
    return { status: published.receipt.status, grade: published.receipt.grade, counts: published.receipt.counts, checks: [...checks], checkpoints };
  }
  catch (error) {
    return { ...unavailable(), status: ["timed_out", "cancelled"].includes(judge.status) ? judge.status : "unavailable", counts: { ...judge.counts, admittedGrades: 0 }, failure: safeFailure(error), judgeArtifacts: judge.artifacts };
  }
}

export async function runFixedController({ prepared, nativeInputs }) {
  requireNativeInputs(prepared, nativeInputs);
  heldOutChecks.assertAvailable();
  const plan = immutable(structuredClone(prepared.plan));
  const expected = immutable(structuredClone(prepared.expected));
  const cells = new Map(nativeInputs.cells);
  // These consume the externally owned approval/allocation. No quota, timeout or test receipt substitutes for it.
  await nativeInputs.assertAllocation({ plan, expected });
  await nativeInputs.assertSourceAndRuntime({ plan, expected });
  const { root, runSet } = prepared;
  const journal = [];
  const publish = () => {
    const bytes = Buffer.concat(journal.map(journalBytes));
    fs.writeFileSync(path.join(root, "attempt-journal.jsonl"), bytes, { mode: 0o600 });
    runSet.attemptJournal.sha256 = sha256(bytes);
    fs.writeFileSync(path.join(root, "run-set.json"), jsonBytes(runSet), { mode: 0o600 });
  };
  for (const cell of expected.cells) {
    const attemptId = randomUUID();
    const common = { schemaVersion: 1, runSetId: plan.runSetId, attemptId, cellId: cell.id, timestamp: new Date().toISOString() };
    const append = record => journal.push({ ...common, ...record, sequence: journal.length + 1, previousRecordSha256: journal.length ? sha256(journalBytes(journal.at(-1))) : null });
    append({ type: "attempt_start", status: null, receipt: null, commitMarker: null });
    const attempt = { attemptId, cellId: cell.id, sequence: 1, status: "unavailable", receipt: null, commitMarker: null };
    runSet.attempts.push(attempt);
    runSet.unstartedCellIds = runSet.unstartedCellIds.filter(id => id !== cell.id);
    publish();
    const outputRoot = path.join(root, attemptId);
    let result;
    try {
      const output = openRunOutput({ outputRoot, authorizedRoot: root, protectedRoots: [sourceRoot], runContext: { runId: attemptId, cellId: cell.id, planSha256: runSet.plan.sha256, executionKind: cell.executionKind }, limits: plan.limits });
      try { result = await runFixedCase({ cell, plan, input: cells.get(cell.id), output, outputRoot, bindingAdmitted: true }); }
      catch (error) {
        result = { ...unavailable(), counts: error?.observedCounts ?? zeroCounts(), failure: safeFailure(error) };
        output.writeArtifact("controller-failure.json", jsonBytes(result.failure));
      }
      const committed = output.commit({ ...result, schemaVersion: 1, runId: attemptId, caseId: cell.caseId });
      attempt.status = result.status;
      attempt.receipt = { path: `${attemptId}/receipt.json`, sha256: committed.receiptSha256 };
      attempt.commitMarker = { path: `${attemptId}/COMMITTED.json`, sha256: readRegular(outputRoot, "COMMITTED.json").sha256 };
    } catch (error) {
      result = { ...unavailable(), failure: safeFailure(error) };
    }
    append({ type: "attempt_close", status: attempt.status, receipt: attempt.receipt, commitMarker: attempt.commitMarker, timestamp: new Date().toISOString() });
    publish();
    // A runtime/cleanup/publication failure is not permission to start further model calls.
    if (!["passed", "product_failure", "inconclusive"].includes(result.status)) break;
  }
  runSet.state = runSet.unstartedCellIds.length === 0 && runSet.attempts.every(attempt => attempt.commitMarker !== null) ? "complete" : "incomplete";
  runSet.closedAt = new Date().toISOString();
  publish();
  const status = { schemaVersion: 1, status: runSet.state, expectedCells: expected.cells.length, attempts: runSet.attempts.length, unstarted: runSet.unstartedCellIds.length, scored: false, grade: null };
  fs.writeFileSync(path.join(root, "producer-status.json"), jsonBytes(status), { mode: 0o600 });
  return { ...status, artifacts: root, exitCode: runSet.state !== "complete" || runSet.attempts.some(attempt => !["passed", "product_failure", "inconclusive"].includes(attempt.status)) ? 3 : runSet.attempts.some(attempt => attempt.status === "product_failure") ? 1 : runSet.attempts.some(attempt => attempt.status === "inconclusive") ? 2 : 0 };
}
