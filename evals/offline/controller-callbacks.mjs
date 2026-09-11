import fs from "node:fs";
import path from "node:path";
import { canonicalJson, listRegularFiles, readRegular, requireCondition, sha256 } from "./core.mjs";
import { observeEffectiveConfiguration } from "./native-assessment.mjs";

export function requireCallbacks(callbacks) {
  for (const [group, names] of Object.entries({ canonical: ["create", "update", "archive"], private: ["ledger", "feedback"] })) {
    for (const name of names) requireCondition(typeof callbacks?.[group]?.[name] === "function", "NATIVE_CALLBACK_UNMAPPED", `The live native callback ${group}.${name} is required`);
  }
  return callbacks;
}

export function nativeValue(result) {
  requireCondition(result?.resultType === "success", "NATIVE_OPERATION_FAILED", "The native operation did not return success; inspect its retained raw result");
  return JSON.parse(result.textResultForLlm);
}

// The caller supplies the installed producer, not a store implementation or serialized verdict.
export async function runPrivateOperations({ callbacks, taskRef, request, requestedBy, operatorGo, commitment, arbitraryStore, privateRoot, privateUid, gitRoots, retain, legacy }) {
  requireCallbacks(callbacks);
  requireCondition(typeof legacy === "function" && typeof retain === "function" && operatorGo && commitment && typeof taskRef?.track === "string" && typeof taskRef?.slug === "string" && typeof privateRoot === "string" && Number.isSafeInteger(privateUid) && Array.isArray(gitRoots) && gitRoots.length > 0, "NATIVE_CALLBACK_UNMAPPED", "Private controls require the actual legacy call, native protected destination/UID, Git roots, raw retention, and canonical commitment/go inputs");
  requireCondition(!fs.existsSync(arbitraryStore), "PRIVATE_CONTROL_PATH_EXISTS", "The arbitrary-store negative must not target pre-existing data");
  const refs = [];
  const owned = new Set();
  let sequence = 0;
  const snapshots = {};
  function snapshot(label) {
    const files = listRegularFiles(privateRoot);
    const directory = fs.lstatSync(privateRoot);
    const value = { files, uid: directory.uid, mode: directory.mode & 0o777, git: gitRoots.map(root => ({ root, files: listRegularFiles(root) })) };
    refs.push(retain(`private-${label}.json`, value));
    snapshots[label] = value;
    return value;
  }
  async function call(input, expected = "success") {
    const result = await callbacks.private.ledger(input);
    if (input.action === "intake" && result?.resultType === "success") {
      const item = nativeValue(result);
      requireCondition(typeof item.work_item_id === "string" && item.work_item_id.length > 0, "PRIVATE_ID_UNOBSERVED", "Intake must return its actual work item identity");
      owned.add(item.work_item_id);
    }
    refs.push(retain(`private-${++sequence}.json`, { input, result }));
    requireCondition(result?.resultType === expected, "PRIVATE_ROUTE_UNEXPECTED_RESULT", `The real ${input.action} route did not return ${expected}`);
    return expected === "success" ? nativeValue(result) : result;
  }
  const create = async text => {
    const result = await call({ action: "intake", request: text, requested_by: requestedBy });
    return result.work_item_id;
  };
  const initial = await call({ action: "report" });
  requireCondition(typeof initial.recording?.enabled === "boolean", "PRIVATE_STATE_UNOBSERVED", "The real report must expose the original recording switch");
  let failure;
  let failed = false;
  let target;
  let boundToDestination = false;
  let linkedToCanonical = false;
  let noGitPayload = false;
  try {
    await call({ action: "set_recording", enabled: false, reason: "Fixed disabled-route control" });
    const disabled = snapshot("disabled");
    await call({ action: "intake", request, requested_by: requestedBy }, "failure");
    const legacyResult = await legacy();
    refs.push(retain("private-legacy.json", legacyResult));
    nativeValue(legacyResult);
    requireCondition(canonicalJson(disabled.files) === canonicalJson(snapshot("after-legacy").files), "PRIVATE_DISABLED_MUTATION", "The disabled legacy route changed protected recording bytes");
    await call({ action: "set_recording", enabled: true, reason: "Fixed own-work control" });
    target = await create(request);
    const sentinel = await create("Unrelated synthetic sentinel; preserve this record while changing the target.");
    await call({ action: "commit", work_item_id: target, ...commitment, operator_go: operatorGo, task_ref: taskRef });
    const before = await call({ action: "inspect", work_item_id: target });
    const stored = snapshot("enabled");
    boundToDestination = stored.files.some(file => readRegular(privateRoot, file.path).bytes.includes(Buffer.from(target)));
    const boundTask = before.work_item.commitment?.task_ref;
    linkedToCanonical = boundTask?.track === taskRef.track && boundTask?.slug === taskRef.slug && stored.git.at(-1).files.some(file => file.path === boundTask.path);
    noGitPayload = stored.git.every(tree => tree.files.every(file => !readRegular(tree.root, file.path).bytes.includes(Buffer.from(target))));
    const other = await call({ action: "inspect", work_item_id: sentinel });
    const negativeBefore = snapshot("before-negatives");
    for (const extra of [{ person: "not-the-bound-owner" }, { namespace: "not-the-bound-namespace" }, { state_dir: arbitraryStore }]) {
      await call({ action: "inspect", work_item_id: target, ...extra }, "failure");
    }
    const afterNegatives = await call({ action: "inspect", work_item_id: target });
    requireCondition(canonicalJson(before) === canonicalJson(afterNegatives) && canonicalJson(negativeBefore.files) === canonicalJson(snapshot("after-negatives").files) && !fs.existsSync(arbitraryStore), "PRIVATE_PARTIAL_MUTATION", "An authority negative changed protected state or created an arbitrary store");
    const corrected = `${request} (corrected synthetic wording)`;
    await call({ action: "correct", work_item_id: target, field: "request", value: corrected, expected_revision: before.work_item.revision, reason: "Fixed correction control" });
    const readback = await call({ action: "inspect", work_item_id: target });
    requireCondition(readback.work_item.request === corrected, "PRIVATE_READBACK_MISMATCH", "The real corrected record did not read back");
    await call({ action: "delete", work_item_id: target, confirm: true });
    owned.delete(target);
    await call({ action: "inspect", work_item_id: target }, "failure");
    requireCondition(canonicalJson(other) === canonicalJson(await call({ action: "inspect", work_item_id: sentinel })), "PRIVATE_PARTIAL_MUTATION", "Target correction/deletion changed the unrelated record");
  } catch (error) { failure = error; failed = true; }
  const cleanupErrors = [];
  for (const work_item_id of owned) {
    try { await call({ action: "delete", work_item_id, confirm: true }); }
    catch (error) { cleanupErrors.push(error); }
  }
  try { await call({ action: "set_recording", enabled: initial.recording.enabled, reason: "Restore the observed original recording switch" }); }
  catch (error) { cleanupErrors.push(error); }
  if (cleanupErrors.length) throw new AggregateError([...(failed ? [failure] : []), ...cleanupErrors], "Private operations or owned cleanup failed");
  if (failed) throw failure;
  const protectedStore = snapshots.enabled.uid === privateUid && snapshots.enabled.mode === 0o700 && snapshots.enabled.files.every(file => (file.mode & 0o077) === 0);
  const common = { rawRefs: refs, routeBound: boundToDestination, producerBindingAdmitted: false, unintendedMutation: false };
  return {
    admitted: false, grade: null, rawRefs: refs, availability: "observed", protectedStore, boundToDestination, noGitPayload,
    observations: {
      "disabled-path-preserved": { ...common, recording: "disabled", legacyBehavior: "preserved" },
      "protected-own-work": { ...common, recording: "enabled", visibility: protectedStore && linkedToCanonical && noGitPayload ? "operator-private-only" : "unavailable" },
      "wrong-owner-denied": { ...common, outcome: "reject-without-partial-mutation" },
      "inspect-correct-delete": { ...common, outcome: "intended-record-only" },
    },
    limitation: "Binding admission and complete outward-authority trace are required separately; these RPC/filesystem observations are not native admission.",
  };
}

export function createCanonicalController({ callbacks, task, scenario, readCanonical, retain }) {
  requireCallbacks(callbacks);
  requireCondition(typeof readCanonical === "function" && typeof retain === "function", "NATIVE_CALLBACK_UNMAPPED", "Canonical control requires actual destination readback and raw retention");
  let prior;
  let sequence = 0;
  const read = async () => {
    const bytes = await readCanonical();
    requireCondition(Buffer.isBuffer(bytes), "CANONICAL_READBACK_UNAVAILABLE", "Canonical readback must retain actual destination bytes");
    retain(`canonical-${++sequence}.json`, { task, base64: bytes.toString("base64"), sha256: sha256(bytes) });
    return bytes;
  };
  const update = async body => {
    const result = await callbacks.canonical.update({ ...task, body_append: body });
    retain(`canonical-operation-${++sequence}.json`, result);
    nativeValue(result);
    prior = await read();
  };
  return {
    async seed() {
      const result = await callbacks.canonical.create({ ...task, title: scenario.outcome, status: "doing", body: `${scenario.outcome}\n\n${scenario.initialAuthority}\n\nEndpoint: ${scenario.deliveryEndpoint}` });
      retain("canonical-seed.json", result);
      nativeValue(result);
      prior = await read();
    },
    async reviewFailure(result) {
      requireCondition(result?.resultType === "failure", "CANONICAL_REVIEW_NOT_FAILURE", "Only the actual failed dependency may be recorded as blocked review");
      await update(`Independent review unavailable; not completion.\n\n${JSON.stringify(result)}`);
    },
    async restart(priorSessionId, currentSessionId) {
      requireCondition(priorSessionId !== currentSessionId, "CANONICAL_RESTART_NOT_FRESH", "A restart requires a genuinely new native session identity");
      const bytes = await read();
      requireCondition(Buffer.isBuffer(prior) && bytes.equals(prior), "CANONICAL_HISTORY_CHANGED", "The canonical identity/history changed across the stopped-session boundary");
      return { priorSessionId, currentSessionId, priorHistorySha256: sha256(prior), retainedHistoryPrefixSha256: sha256(bytes), task };
    },
    scope: () => update(`Agreed scope revision (distinct from the original defect): ${scenario.laterScopeRevision}`),
    checkpoint: async () => { prior = await read(); return prior; },
  };
}

// These are the existing reviewer policy exports. No CLI substitute or clean fallback is accepted.
export function observeReviewerEvents({ directory, model, retain }) {
  const state = path.join(directory, "home", ".copilot", "session-state");
  const candidates = listRegularFiles(state).filter(file => file.path.endsWith("/events.jsonl"));
  const observed = [];
  for (const file of candidates) {
    const bytes = readRegular(state, file.path).bytes;
    const events = bytes.toString("utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    const start = events.find(event => event.type === "session.start");
    if (!start) continue;
    const sessionId = start.data.sessionId;
    const rawRef = retain(`review-session-${sessionId}.json`, { base64: bytes.toString("base64"), sha256: file.sha256 });
    const records = events.map(event => ({ sessionId, rawRecord: Buffer.from(JSON.stringify(event)), ref: { ...rawRef, eventId: event.id } }));
    const effective = observeEffectiveConfiguration({ events: records, sessionId, model });
    if (effective.verified && events.some(event => event.type === "assistant.message" && !event.agentId && typeof event.data.content === "string" && event.data.content.trim())) observed.push({ agent: "copilot", authObserved: true, reviewerSessionId: sessionId, effectiveConfiguration: effective, rawRef });
  }
  requireCondition(observed.length === 1, "REVIEW_AUTH_UNOBSERVED", "Exactly one actual reviewer session must show the selected model/effort and completed root model output; token acquisition is insufficient");
  return observed[0];
}

export function createReviewHandler({ reviewer, runtimePolicy, handoff, runtime, model, parentDir, deadlineMs, stopped, assertConfinement, retain, observeRun = value => observeReviewerEvents({ ...value, model, retain }) }) {
  const names = ["prepareReviewTarget", "materializeScopedEntry", "materializeReviewerEnv", "buildContainedEnv", "spawnReviewChild", "runBounded", "admitReview", "assertCopilotOnlyEffective"];
  for (const name of names) requireCondition(typeof reviewer?.[name] === "function", "NATIVE_CALLBACK_UNMAPPED", `The installed reviewer must export ${name}`);
  requireCondition(typeof runtimePolicy?.resolveRuntime === "function" && typeof runtimePolicy?.assertReviewerIdentity === "function", "NATIVE_CALLBACK_UNMAPPED", "The installed runtime identity policy is required");
  requireCondition(handoff?.reviewer && typeof stopped === "function" && typeof assertConfinement === "function" && typeof observeRun === "function" && typeof retain === "function", "NATIVE_CALLBACK_UNMAPPED", "Review requires the initial-controller handoff, stopped-writer check, OS confinement, actual backend/auth observation and retention");
  for (const name of ["spawnFn", "psFn"]) requireCondition(typeof runtime?.[name] === "function", "NATIVE_CALLBACK_UNMAPPED", `The admitted reviewer OS role must supply the existing ${name} boundary`);
  const resolved = runtimePolicy.resolveRuntime(runtime);
  const binary = fs.readFileSync(resolved.roborevBin);
  requireCondition(runtimePolicy.assertReviewerIdentity({ sourceSha: runtime.sourceSha, binarySha256: sha256(binary) }, runtime.binaryReceipt).ok, "REVIEW_BINARY_UNBOUND", "The actual reviewer binary must match the selected build receipt");
  const dependencyRoot = fs.mkdtempSync(path.join(parentDir, "reviewer-dependency-"));
  const command = path.join(dependencyRoot, "reviewer");
  let restored = false;
  const review = async ({ sha, sessionId, toolCallId, actorRoot, dependencyAvailable = true }) => {
    requireCondition(dependencyAvailable || !restored, "REVIEW_DEPENDENCY_CONTROL_REUSED", "A restored reviewer cannot be relabelled as the original unavailable dependency");
    if (dependencyAvailable && !restored) {
      fs.writeFileSync(command, binary, { flag: "wx", mode: 0o500 });
      restored = true;
    }
    if (restored) requireCondition(sha256(fs.readFileSync(command)) === sha256(binary), "REVIEW_BINARY_CHANGED", "The scoped reviewer binary changed after restoration");
    const directory = fs.mkdtempSync(path.join(parentDir, "review-"));
    const target = reviewer.prepareReviewTarget({ sourceRepo: actorRoot, sha, model, parentDir: directory, env: { PATH: runtime.path } });
    requireCondition(!fs.existsSync(path.join(target.checkout.path, ".roborev.toml")), "REVIEW_CONFIG_UNMAPPED", "A repository-effective reviewer configuration requires an explicit supported parser; it is not silently ignored");
    requireCondition(reviewer.assertCopilotOnlyEffective({ effectiveAgent: target.argv[target.argv.indexOf("--agent") + 1], backupAgent: null }).ok, "REVIEW_BACKEND_UNBOUND", "The isolated no-config reviewer must explicitly select Copilot");
    const scope = path.join(directory, "entry");
    fs.mkdirSync(scope, { mode: 0o700 });
    const entry = reviewer.materializeScopedEntry({ dir: scope, node: runtime.node, cli: runtime.copilotEntry, effort: "high" });
    const env = reviewer.buildContainedEnv({ home: path.join(directory, "home"), pathDir: entry.dir, reviewerEnv: reviewer.materializeReviewerEnv({ reviewer: handoff.reviewer }), baseEnv: { PATH: runtime.path, TERM: "dumb", CI: "1" } });
    await assertConfinement({ directory, target, entry, command, env });
    const runner = reviewer.spawnReviewChild({ command, args: target.argv, env, cwd: target.checkout.path, spawnFn: runtime.spawnFn, psFn: runtime.psFn });
    let result;
    let failure;
    let failed = false;
    try { result = await reviewer.runBounded({ deadlineMs, run: runner.run, killTree: runner.killTree, sweep: runner.sweep, refused: () => runner.refused }); }
    catch (error) { failure = error; failed = true; }
    const output = runner.output();
    const stderr = runner.errorOutput();
    const credential = env.COPILOT_GITHUB_TOKEN;
    requireCondition(typeof credential !== "string" || credential.length === 0 || ![output, stderr, Buffer.from(String(failure))].some(bytes => bytes.includes(Buffer.from(credential))), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing reviewer capture was withheld");
    const rawRef = retain(`${toolCallId}-review.json`, { sha, sessionId, toolCallId, command, argv: target.argv, outputBase64: output.toString("base64"), stderrBase64: stderr.toString("base64"), result, failure: failed ? { code: failure?.code, message: failure?.message, cleanupError: failure?.cleanupError } : null, drainedFully: runner.drainedFully });
    if (!dependencyAvailable && failure?.code === "ENOENT") return { resultType: "failure", error: "The declared reviewer executable is unavailable.", textResultForLlm: JSON.stringify({ dependencyFailureObserved: true, completion: "not-complete", sha, rawRef }) };
    if (failed) throw failure;
    requireCondition(result.admitted && !result.cleanupError && !result.timedOut && result.survived.length === 0 && result.unverified.length === 0 && runner.drainedFully && result.result.code === 0 && result.result.signal === null, "REVIEW_EXECUTION_UNAVAILABLE", "The real reviewer failed, timed out, or retained writers; artifacts and checkout are preserved");
    const observed = await observeRun({ runner, result, target, entry, output, stderr, directory });
    const record = { ...observed, argv: target.argv, sha, outputSha256: sha256(output), outputBytes: output.length };
    const admitted = reviewer.admitReview({ expected: { argv: target.argv, sha }, exitCode: result.result.code, output, record });
    retain(`${toolCallId}-admission.json`, { record, admitted, rawRef });
    return { resultType: admitted.admitted ? "success" : "failure", textResultForLlm: JSON.stringify({ ...admitted, sha, rawRef, reviewerSessionId: observed.reviewerSessionId }), ...(!admitted.admitted ? { error: admitted.reason } : {}) };
  };
  return async request => {
    const release = await stopped(request);
    requireCondition(typeof release === "function", "REVIEW_WRITER_HOLD_UNMAPPED", "A verified writer hold must supply its owned release operation so the sole builder can resume");
    let failed = false;
    let failure;
    try { return await review(request); }
    catch (error) { failed = true; failure = error; throw error; }
    finally {
      try { await release(); }
      catch (error) { throw new AggregateError([...(failed ? [failure] : []), error], "Reviewer writer-hold release failed"); }
    }
  };
}
