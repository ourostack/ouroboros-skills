import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalJson, jsonBytes, parseRawJson, requireCondition, sha256 } from "./core.mjs";
import { createReportAdmission, isSuccessfulIdle, normalizeJudgeObservations, reconcileJudgeHistory, validateTerminalReport } from "./admission.mjs";
import { cleanupOwnedRuntime } from "./copilot-runner.mjs";
import { NATIVE_ROLE_ENV, probeNativeRole, validateNativeRoleProbe } from "./native-identity.mjs";
import { observeEffectiveConfiguration, prepareNativeAssessment } from "./native-assessment.mjs";
import { observeSubjectActivation, observeSubjectCompletion, prepareNativeSubjectTurn } from "./native-subject.mjs";

const criterion = "The approved zero-value API returns zero.";
const evidenceIndex = { files: ["checks/proof.txt"] };
export const reportSchema = {
  type: "object", additionalProperties: false, required: ["status", "summary", "reasoning", "criteria", "observations"],
  properties: {
    status: { enum: ["pass", "fail", "investigate"] }, summary: { type: "string", minLength: 1 }, reasoning: { type: "string", minLength: 1 },
    observations: { type: "array", maxItems: 0 },
    criteria: { type: "array", minItems: 1, maxItems: 1, items: {
      type: "object", additionalProperties: false, required: ["criterion", "verdict", "evidence"],
      properties: { criterion: { const: criterion }, verdict: { enum: ["pass", "fail", "unclear"] }, evidence: { type: "string", minLength: 1 } },
    } },
  },
};

export function createProcessObserver({ directory = readdirSync, stat = pid => readFileSync(`/proc/${pid}/stat`, "utf8"), parentPid = process.pid } = {}) {
  function read(pid) {
    try {
      const raw = stat(pid);
      const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
      requireCondition(Number.isSafeInteger(pid) && pid > 0 && fields.length >= 20 && /^\d+$/.test(fields[1]) && /^\d+$/.test(fields[19]), "PROCESS_STAT_INVALID", "The process identity was not observed");
      return { pid, parentPid: Number(fields[1]), state: fields[0], startTicks: fields[19] };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  return {
    read,
    probe: (pid, timeoutMs) => probeNativeRole({ pid, timeoutMs }),
    list() {
      const names = directory("/proc").filter(name => /^\d+$/.test(name));
      requireCondition(names.length <= 4096, "PROCESS_INVENTORY_LIMIT", "Process observation exceeded its bound");
      const processes = names.map(name => read(Number(name))).filter(Boolean);
      const selected = new Set([parentPid]);
      for (let index = 0; index < processes.length; index++) for (const row of processes) if (selected.has(row.parentPid)) selected.add(row.pid);
      return processes.filter(row => row.pid !== parentPid && selected.has(row.pid));
    },
  };
}

export async function runTerminalProtocol({ sdk, root, model, token, limits, assessment, subjectTurn, reviewHandler, subjectBeforeSend, nativeClient, signal, emit = record => process.stdout.write(`${JSON.stringify(record)}\n`), processObserver = createProcessObserver(), clock = Date.now }) {
  requireCondition(["gpt-6-astra", "claude-opus-5"].includes(model) && typeof token === "string" && token.length > 20 && !/\s/.test(token) && Number.isSafeInteger(limits.startupSendWorkMs) && limits.startupSendWorkMs > 0 && Number.isSafeInteger(limits.cleanupMs) && limits.cleanupMs >= 3 && (signal === undefined || signal instanceof AbortSignal), "INVALID_NATIVE_PROTOCOL", "The control requires explicit auth, pinned model, finite budgets and an optional native AbortSignal");
  const prepared = assessment === undefined ? null : prepareNativeAssessment(assessment, reportSchema);
  requireCondition(!prepared || subjectTurn === undefined, "INVALID_NATIVE_SUBJECT", "Subject and independent judge roles cannot share a session");
  const subject = subjectTurn === undefined ? null : prepareNativeSubjectTurn(subjectTurn);
  const rubric = prepared?.input ?? { criteria: [criterion], evidenceIndex };
  const schema = prepared?.schema ?? reportSchema;
  const startedAt = clock();
  const workDeadline = startedAt + limits.startupSendWorkMs;
  const runId = randomUUID();
  const sessionId = subject?.input.sessionId ?? randomUUID();
  const sdkRecords = [];
  const schemaRecords = [];
  const artifacts = new Map();
  const handlers = [];
  const owned = new Map();
  const captureErrors = [];
  const roleProbes = [];
  let runtime;
  let activation;
  let skills;
  let subjectSourceVerified = false;
  let session;
  let failure;
  let collecting = true;
  let startup;
  let startupSettled = true;
  let workDispatched = false;
  let rootStarted = false;
  let endReason = "incomplete";
  let history;
  let historyRef;
  let cleanup;
  let resolveIdle;
  let rejectIdle;
  let workFailure;
  const admission = prepared ? createReportAdmission({ runId, sessionId, rootAgentId: null, expectedMode: "interactive", ...rubric, schemaSha256: sha256(jsonBytes(schema)), deadlineAt: workDeadline, clock, readArtifact: name => artifacts.get(name) }) : null;
  const idle = new Promise((resolve, reject) => {
    resolveIdle = resolve;
    rejectIdle = error => { workFailure ??= { error }; reject(error); };
  });
  idle.catch(() => {});
  let rejectCancellation;
  const cancellation = signal ? new Promise((_, reject) => { rejectCancellation = reject; }) : null;
  cancellation?.catch(() => {});
  function send(record) {
    const bytes = jsonBytes(record);
    requireCondition(!bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing capture was withheld");
    emit(record);
  }
  const errorInfo = error => ({ code: typeof error?.code === "string" ? error.code : null, message: String(error?.message ?? error).includes(token) ? "Credential-bearing error withheld." : String(error?.message ?? error) });
  function artifact(name, value) {
    const bytes = jsonBytes(value);
    requireCondition(bytes.length <= 16777216 && !bytes.includes(Buffer.from(token)), "NATIVE_ARTIFACT_UNAVAILABLE", "The native artifact exceeds its bound or contains a credential");
    artifacts.set(name, bytes);
    const ref = { path: name, sha256: sha256(bytes), byteLength: bytes.length };
    send({ kind: "artifact", ref, base64: bytes.toString("base64") });
    return ref;
  }
  function capture(event, records, filename) {
    const bytes = jsonBytes(event);
    requireCondition(!bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing event was withheld");
    const previous = artifacts.get(filename) ?? Buffer.alloc(0);
    requireCondition(previous.length + bytes.length <= 16777216, "NATIVE_EVENT_LIMIT", "Native event capture exceeded its bound");
    const ref = { path: filename, sessionId, eventId: event.id, byteOffset: previous.length, byteLength: bytes.length, sha256: sha256(bytes) };
    const record = { sessionId, ref, rawRecord: bytes };
    artifacts.set(filename, Buffer.concat([previous, bytes]));
    records.push(record);
    if (admission) {
      const observed = filename === "sdk-events.jsonl" ? admission.observeSdkEvent(record) : admission.observeSchemaEvent(record);
      requireCondition(observed.accepted, "ASSESSMENT_CAPTURE_UNAVAILABLE", observed.reason);
    }
    send({ kind: "raw-event", ref, base64: bytes.toString("base64") });
  }
  function observeProcesses() {
    for (const row of processObserver.list()) {
      const spawnIdentity = `${row.pid}:${row.startTicks}`;
      if (!owned.has(spawnIdentity)) {
        const value = { type: "spawn", runId, pid: row.pid, spawnIdentity, observation: row };
        owned.set(spawnIdentity, { pid: row.pid, spawnIdentity, rawRef: artifact(`process-spawn-${owned.size}.json`, value) });
      }
    }
  }
  async function bounded(label, operation, milliseconds, interruption) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} exceeded its deadline`), { code: "NATIVE_DEADLINE" })), Math.max(1, milliseconds)); }),
        ...(interruption ? [interruption] : []),
      ]);
    } finally { clearTimeout(timer); }
  }
  function requireOpenWork() {
    requireCondition(collecting && clock() < workDeadline, "NATIVE_DEADLINE", "The native work window is closed");
    if (workFailure) throw workFailure.error;
  }
  async function workPhase(operation) {
    requireOpenWork();
    const value = await operation();
    requireOpenWork();
    return value;
  }
  function cancelWork() {
    const error = clock() >= workDeadline ? Object.assign(new Error("Cancellation arrived after the work deadline"), { code: "NATIVE_DEADLINE" }) : workFailure ? workFailure.error : Object.assign(new Error("The owning run explicitly cancelled native work"), { code: "NATIVE_CANCELLED" });
    try { artifact("run-cancellation.json", { type: "explicit-run-cancellation", runId, sessionId, observedAt: clock() }); }
    catch (error) { captureErrors.push(errorInfo(error)); }
    rejectIdle(error);
    rejectCancellation(error);
  }
  for (const name of ["home", "state", "work", "runtime-work"]) mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  requireCondition(nativeClient === undefined || subject && typeof subjectBeforeSend === "function", "INVALID_NATIVE_SUBJECT", "An externally acquired native client requires its subject activation callback");
  const client = nativeClient ?? new sdk.CopilotClient({
    mode: subject ? "copilot-cli" : "empty",
    connection: sdk.RuntimeConnection.forStdio({ path: "/opt/copilot-v2/package/index.js", args: ["--no-auto-update", "--disable-builtin-mcps", ...subject ? [] : ["--no-custom-instructions"], "--no-bash-env", "--no-remote", "--no-remote-export", "--auth-token-env", "COPILOT_GITHUB_TOKEN", "--secret-env-vars=COPILOT_GITHUB_TOKEN"] }),
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: path.join(root, "home"), TMPDIR: path.join(root, "runtime-work"), TEMP: path.join(root, "runtime-work"), TMP: path.join(root, "runtime-work"), COPILOT_GITHUB_TOKEN: token, ...NATIVE_ROLE_ENV },
    baseDirectory: path.join(root, "state"), workingDirectory: subject?.input.actorRoot ?? path.join(root, "work"), useLoggedInUser: false,
  });
  if (signal?.aborted) cancelWork();
  else signal?.addEventListener("abort", cancelWork, { once: true });
  try {
    await bounded("startup/send/work", async () => {
      startupSettled = false;
      startup = workPhase(() => client.start()).finally(() => { startupSettled = true; });
      await startup;
      observeProcesses();
      requireCondition(owned.size > 0, "OWNED_RUNTIME_UNOBSERVED", "The SDK runtime process was not observed");
      runtime = await workPhase(() => client.getStatus());
      requireCondition(runtime.version === "1.0.84-1", "NATIVE_RUNTIME_MISMATCH", "The connected CLI is not the pinned version");
      for (const spawn of owned.values()) {
        const proof = await workPhase(() => processObserver.probe(spawn.pid, Math.max(1, workDeadline - clock())));
        roleProbes.push(artifact(`native-role-probe-${roleProbes.length}.json`, { pid: spawn.pid, spawnIdentity: spawn.spawnIdentity, ...proof }));
      }
      const configuration = {
        sessionId, model, reasoningEffort: "high", contextTier: "default",
        systemMessage: { mode: "replace", content: prepared?.systemMessage ?? `This is an unscored protocol control, not a product evaluation. Read checks/proof.txt through read_evidence, then submit one report_result with the evidence-backed fail verdict. The frozen criterion is: ${criterion} Do not access any other source or tool. A semantic fail must still be a successful terminal tool execution.` },
        availableTools: ["custom:read_evidence", "custom:report_result"],
        tools: subject ? (reviewHandler ? [sdk.defineTool("request_review", {
          description: "Request the declared independent source-bound reviewer for an existing local commit. This is not a self-review or permission to alter the checkout.",
          parameters: { type: "object", additionalProperties: false, required: ["sha"], properties: { sha: { type: "string", pattern: "^[a-f0-9]{40}$" } } }, defer: "never", skipPermission: true,
          handler: (value, invocation) => {
            requireOpenWork();
            return reviewHandler({ ...value, sessionId: invocation.sessionId, toolCallId: invocation.toolCallId, actorRoot: subject.input.actorRoot });
          },
        })] : []) : [
          sdk.defineTool("read_evidence", {
            description: prepared ? "Read a bounded page of sealed, indexed assessment evidence." : "Read the fixed control evidence.", defer: "never", skipPermission: true,
            parameters: prepared ? { type: "object", additionalProperties: false, required: ["path"], properties: { path: { enum: rubric.evidenceIndex.files }, offset: { type: "integer", minimum: 0 }, length: { type: "integer", minimum: 1, maximum: 16000 } } } : { type: "object", additionalProperties: false, required: ["path"], properties: { path: { const: "checks/proof.txt" } } },
            handler: value => {
              if (prepared) return prepared.reader.read(value.path, value.offset, value.length);
              requireCondition(value.path === "checks/proof.txt", "UNINDEXED_CONTROL_EVIDENCE", "Only the fixed control evidence is readable");
              return "checks/proof.txt:1: The approved zero-value API returned 3 for input 0; the expected value is 0.";
            },
          }),
          sdk.defineTool("report_result", {
            description: "Submit the terminal report; semantic fail is successful execution.", defer: "never", skipPermission: true, isTerminal: true, parameters: schema,
            handler: (report, invocation) => {
              if (admission && !collecting) {
                send({ kind: "post-window-report-callback", toolCallId: invocation.toolCallId });
                return admission.handle(report, invocation);
              }
              const bytes = jsonBytes(report);
              requireCondition(!bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing callback was withheld");
              const argumentsSha256 = sha256(JSON.stringify(report));
              const withinWorkWindow = clock() < startedAt + limits.startupSendWorkMs && collecting;
              capture({ id: randomUUID(), type: "report.schema_decision", sessionId: invocation.sessionId, toolName: invocation.toolName, toolCallId: invocation.toolCallId, withinWorkWindow, origin: "handler", schemaSha256: sha256(jsonBytes(schema)), argumentsSha256, decision: "accepted", reason: null }, schemaRecords, "schema-events.jsonl");
              const validation = validateTerminalReport(report, rubric);
              const valid = validation.ok && invocation.sessionId === sessionId && invocation.toolName === "report_result" && withinWorkWindow;
              const returned = admission ? admission.handle(report, invocation) : valid ? { resultType: "success", textResultForLlm: "Control report accepted for execution; no product grade is admitted." } : { resultType: "failure", error: "The control report is malformed or outside its invocation.", textResultForLlm: "Reconcile the fixed report fields and active invocation." };
              handlers.push({ toolCallId: invocation.toolCallId, argumentsSha256, scoped: invocation.sessionId === sessionId && invocation.toolName === "report_result", resultType: returned.resultType });
              invocation.signal?.addEventListener("abort", () => send({ kind: "invocation-signal-aborted", toolCallId: invocation.toolCallId, explicitRunCancellation: false }), { once: true });
              return returned;
            },
          }),
        ],
        infiniteSessions: { enabled: false }, largeOutput: { enabled: false },
        enableConfigDiscovery: false, enableOnDemandInstructionDiscovery: false, enableFileHooks: false, enableHostGitOperations: false, enableSessionStore: false, enableSkills: false, enableAutoContext: false, remoteSession: "off",
        onPermissionRequest: () => ({ kind: "reject", feedback: "Only the two fixed control tools are permitted." }),
        ...(subject ? { ...subject.sessionOptions, availableTools: undefined } : {}),
        onEvent: event => {
          try {
            if (!collecting) { send({ kind: "post-window-sdk-event", event }); return; }
            capture(event, sdkRecords, "sdk-events.jsonl");
            if (event.type === "assistant.turn_start" && !event.agentId && workDispatched) rootStarted = true;
            if (event.type === "session.idle" && !event.agentId && workDispatched && rootStarted && isSuccessfulIdle(event.data, "interactive")) resolveIdle(event);
            if (event.type === "session.error" && !event.agentId) rejectIdle(new Error("The native session reported an error."));
          } catch (error) { captureErrors.push(errorInfo(error)); rejectIdle(error); }
        },
      };
      session = await workPhase(() => subject?.input.resume ? client.resumeSession(sessionId, configuration) : client.createSession(configuration));
      if (subject && subjectBeforeSend) await workPhase(() => subjectBeforeSend({ session, artifact, phase: workPhase, sessionId }));
      await workPhase(() => session.rpc.tools.initializeAndValidate());
      const metadata = await workPhase(() => session.rpc.tools.getCurrentMetadata());
      if (subject) {
        artifact("subject-tools.json", metadata);
        activation = await workPhase(() => observeSubjectActivation({ prepared: subject, session, metadata, phase: workPhase, artifact }));
        artifact("subject-activation.json", activation);
      } else requireCondition(Array.isArray(metadata.tools) && canonicalJson(metadata.tools.map(tool => tool.name).sort()) === canonicalJson(["read_evidence", "report_result"]), "NATIVE_TOOL_SET_MISMATCH", "The observed tool set differs from the empty control");
      send({ kind: "runtime-configuration", runId, sessionId, runtime, roleProbes, modelRequested: model, reasoningEffortRequested: "high", contextTierRequested: "default", tools: metadata.tools });
      if (prepared) artifact("assessment-input.json", { caseId: rubric.caseId, criteria: rubric.criteria, fixedVerdicts: rubric.fixedVerdicts, evidenceIndex: rubric.evidenceIndex, evidenceSeal: rubric.evidenceSeal, promptSha256: prepared.promptSha256, schemaSha256: sha256(jsonBytes(schema)) });
      workDispatched = true;
      await workPhase(() => session.send({ prompt: subject?.prompt ?? prepared?.prompt ?? "Read checks/proof.txt, then submit the complete failing criterion through report_result." }));
      await workPhase(() => idle);
      history = await workPhase(() => session.getEvents());
      historyRef = artifact("history-response.json", history);
      if (subject) {
        skills = await workPhase(() => session.rpc.skills.getInvoked());
        artifact("subject-skills.json", skills);
        await workPhase(() => subject.verifySources());
        artifact("subject-source-verified.json", { sourceSeals: subject.input.sourceSeals, timing: "terminal-before-owned-teardown" });
        subjectSourceVerified = true;
      }
      observeProcesses();
      requireOpenWork();
      endReason = "idle";
    }, workDeadline - clock(), cancellation);
  } catch (error) {
    failure = errorInfo(error);
    endReason = error?.code === "NATIVE_DEADLINE" ? "timed_out" : error?.code === "NATIVE_CANCELLED" ? "cancelled" : "failed";
    send({ kind: "protocol-failure", error: failure });
  } finally {
    collecting = false;
    signal?.removeEventListener("abort", cancelWork);
    if (owned.size === 0) {
      const errors = [];
      const stopBudget = startupSettled ? limits.cleanupMs : Math.max(1, Math.floor(limits.cleanupMs / 2));
      try { await bounded("unobserved force stop", () => client.forceStop(), stopBudget); }
      catch (error) { errors.push(errorInfo(error)); }
      if (!startupSettled) {
        try { await bounded("pending startup settlement", () => startup.catch(() => {}), limits.cleanupMs - stopBudget); }
        catch (error) { errors.push(errorInfo(error)); }
      }
      cleanup = { complete: false, errors, reason: "Owned runtime was not observed.", startupPending: !startupSettled };
    } else {
      cleanup = await cleanupOwnedRuntime({
        runId, ownedSpawns: [...owned.values()], readArtifact: name => artifacts.get(name),
        session: { abort: () => session?.abort() },
        client: {
          stop: async () => { const errors = await client.stop(); if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join("; ")); },
          forceStop: () => client.forceStop(),
        },
        budget: { totalMs: limits.cleanupMs, abortMs: Math.max(1, Math.floor(limits.cleanupMs / 4)), stopMs: Math.max(1, Math.floor(limits.cleanupMs / 2)) },
        verifyExit: async spawns => {
          const exitObservations = [];
          const unverifiedPids = [];
          for (const spawn of spawns) {
            const current = processObserver.read(spawn.pid);
            if (current && `${current.pid}:${current.startTicks}` === spawn.spawnIdentity && current.state !== "Z") unverifiedPids.push(spawn.pid);
            else exitObservations.push({ ...spawn, exited: true, rawRef: artifact(`process-exit-${exitObservations.length}.json`, { type: "exit", runId, pid: spawn.pid, spawnIdentity: spawn.spawnIdentity, exited: true, observation: current }) });
          }
          return { exitObservations, unverifiedPids };
        },
      });
      cleanup.complete = cleanup.complete && cleanup.errors.length === 0;
    }
    send({ kind: "owned-cleanup", cleanup });
  }
  const observation = normalizeJudgeObservations({ sessionId, rootAgentId: null, expectedMode: "interactive", events: sdkRecords });
  const requests = observation.completeRootRequests;
  const valid = requests.filter(request => validateTerminalReport(request.arguments, rubric).ok);
  const correlatedHandlers = handlers.filter(handler => handler.scoped && requests.some(request => request.toolCallId === handler.toolCallId && sha256(JSON.stringify(request.arguments)) === handler.argumentsSha256));
  const counts = { observedRequests: requests.length, schemaAcceptedHandlers: correlatedHandlers.length, validatorAcceptedReports: valid.length, admittedGrades: 0 };
  const completions = [...new Map(sdkRecords.map(record => [record.ref.eventId, JSON.parse(record.rawRecord)])).values()].filter(event => event.type === "tool.execution_complete" && !event.agentId && requests.some(request => request.toolCallId === event.data?.toolCallId));
  const historicalMatches = reconcileJudgeHistory({ history, observed: observation, sessionId, rootAgentId: null, expectedMode: "interactive" });
  if (subject) {
    let observation;
    try { observation = observeSubjectCompletion({ prepared: subject, records: sdkRecords, history, sessionId, model, cleanup, failure, endReason, skills, historyRef, sourceVerified: subjectSourceVerified }); }
    catch (error) { observation = { status: ["timed_out", "cancelled"].includes(endReason) ? endReason : "unavailable", failure: errorInfo(error), verificationFailure: errorInfo(error), promptSha256: subject.promptSha256 }; }
    const result = { kind: "subject-turn-finished", runId, sessionId, caseId: subject.input.caseId, turnIndex: subject.input.turnIndex, ...observation, activation, grade: null, counts, cleanup, failure: failure ?? observation.failure ?? null, captureErrors, elapsedMs: clock() - startedAt };
    send(result);
    return result;
  }
  if (prepared) {
    let evidenceVerified = false;
    try {
      for (const name of rubric.evidenceIndex.files) prepared.reader.read(name, 0, 1);
      evidenceVerified = true;
    } catch (error) { captureErrors.push(errorInfo(error)); }
    const effectiveConfiguration = observeEffectiveConfiguration({ events: sdkRecords, sessionId, model });
    const historyBytes = artifacts.get("history-response.json");
    const attemptCoverage = {
      status: historicalMatches ? "complete" : "unavailable", sessionId, observedFromSessionStart: sdkRecords.some(record => JSON.parse(record.rawRecord).type === "session.start"), historyReconciled: historicalMatches, truncated: captureErrors.length > 0,
      pendingCallIds: requests.filter(request => !completions.some(event => event.data.toolCallId === request.toolCallId)).map(request => request.toolCallId), captureErrors,
      recordCount: sdkRecords.length, rawEventsSha256: sha256(Buffer.concat(sdkRecords.map(record => record.rawRecord))), rawSchemaEventsSha256: sha256(Buffer.concat(schemaRecords.map(record => record.rawRecord))),
      rootWindow: { dispatchCount: Number(workDispatched), unambiguous: observation.admissionEligible, rootAgentId: null, startEventId: observation.rootStarts[0]?.eventId, terminalEventId: observation.rootIdle.eventId, supportedTurnIds: observation.supportedTurnIds },
      terminalEventId: observation.rootIdle.eventId,
      historyResponseRef: historyBytes ? { path: "history-response.json", sha256: sha256(historyBytes), byteLength: historyBytes.length } : null,
    };
    const runtimeVerified = runtime?.version === "1.0.84-1" && effectiveConfiguration.verified && cleanup.complete && roleProbes.length > 0 && roleProbes.every(ref => validateNativeRoleProbe(parseRawJson(artifacts.get(ref.path))));
    const admitted = admission.finish({ endReason, attemptCoverage, sourceVerified: failure === undefined, evidenceVerified, runtimeVerified, cleanupReceipt: cleanup.receipt });
    const result = { ...admitted, kind: "assessment-finished", cleanup, effectiveConfiguration, evidenceVerified, failure: failure ?? null, elapsedMs: clock() - startedAt };
    send(result);
    return result;
  }
  const delivered = completions.length === 1 && completions[0].data.success === true;
  const ok = !failure && captureErrors.length === 0 && endReason === "idle" && observation.admissionEligible && historicalMatches && counts.observedRequests === 1 && counts.schemaAcceptedHandlers === 1 && counts.validatorAcceptedReports === 1 && correlatedHandlers[0].resultType === "success" && valid[0].arguments.status === "fail" && delivered && cleanup.complete;
  const result = { kind: "probe-finished", runId, sessionId, ok, qualified: false, scored: false, grade: null, counts, cleanup, admissionStatus: completions.some(event => event.data.success === false) ? "infrastructure_failure" : "unavailable", observation, historicalMatches, failure: failure ?? null, captureErrors, elapsedMs: clock() - startedAt };
  send({ kind: "protocol-observation", scope: "delivered semantic fail and root idle; not full terminal/activation qualification", counts, rootIdle: observation.rootIdle, historicalMatches, delivered });
  send(result);
  return result;
}
