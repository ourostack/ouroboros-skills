import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { canonicalJson, jsonBytes, requireCondition, sha256 } from "./core.mjs";
import { normalizeJudgeObservations, reconcileJudgeHistory, validateTerminalReport } from "./admission.mjs";
import { cleanupOwnedRuntime } from "./copilot-runner.mjs";

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

export async function runTerminalProtocol({ sdk, root, model, token, limits, emit = record => process.stdout.write(`${JSON.stringify(record)}\n`), processObserver = createProcessObserver(), clock = Date.now }) {
  requireCondition(["gpt-6-astra", "claude-opus-5"].includes(model) && typeof token === "string" && token.length > 20 && !/\s/.test(token) && Number.isSafeInteger(limits.startupSendWorkMs) && limits.startupSendWorkMs > 0 && Number.isSafeInteger(limits.cleanupMs) && limits.cleanupMs >= 3, "INVALID_NATIVE_PROTOCOL", "The control requires explicit auth, pinned model and finite budgets");
  const startedAt = clock();
  const runId = randomUUID();
  const sessionId = randomUUID();
  const sdkRecords = [];
  const schemaRecords = [];
  const artifacts = new Map();
  const handlers = [];
  const owned = new Map();
  const captureErrors = [];
  let session;
  let failure;
  let collecting = true;
  let workDispatched = false;
  let rootStarted = false;
  let endReason = "incomplete";
  let history;
  let cleanup;
  let resolveIdle;
  let rejectIdle;
  const idle = new Promise((resolve, reject) => { resolveIdle = resolve; rejectIdle = reject; });
  idle.catch(() => {});
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
  async function bounded(label, operation, milliseconds) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} exceeded its deadline`), { code: "NATIVE_DEADLINE" })), Math.max(1, milliseconds)); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  for (const name of ["home", "state", "work", "runtime-work"]) mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  const client = new sdk.CopilotClient({
    mode: "empty",
    connection: sdk.RuntimeConnection.forStdio({ path: "/opt/copilot-v2/package/index.js", args: ["--no-auto-update", "--disable-builtin-mcps", "--no-custom-instructions", "--no-bash-env", "--no-remote", "--no-remote-export", "--secret-env-vars=COPILOT_GITHUB_TOKEN"] }),
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: path.join(root, "home"), TMPDIR: path.join(root, "runtime-work"), TEMP: path.join(root, "runtime-work"), TMP: path.join(root, "runtime-work"), COPILOT_GITHUB_TOKEN: token },
    baseDirectory: path.join(root, "state"), workingDirectory: path.join(root, "work"), useLoggedInUser: false,
  });
  try {
    await bounded("startup/send/work", async () => {
      await client.start();
      observeProcesses();
      requireCondition(owned.size > 0, "OWNED_RUNTIME_UNOBSERVED", "The SDK runtime process was not observed");
      const runtime = await client.getStatus();
      requireCondition(runtime.version === "1.0.84-1", "NATIVE_RUNTIME_MISMATCH", "The connected CLI is not the pinned version");
      session = await client.createSession({
        sessionId, model, reasoningEffort: "high", contextTier: "default",
        systemMessage: { mode: "replace", content: `This is an unscored protocol control, not a product evaluation. Read checks/proof.txt through read_evidence, then submit one report_result with the evidence-backed fail verdict. The frozen criterion is: ${criterion} Do not access any other source or tool. A semantic fail must still be a successful terminal tool execution.` },
        availableTools: ["custom:read_evidence", "custom:report_result"],
        tools: [
          sdk.defineTool("read_evidence", {
            description: "Read the fixed control evidence.", defer: "never", skipPermission: true,
            parameters: { type: "object", additionalProperties: false, required: ["path"], properties: { path: { const: "checks/proof.txt" } } },
            handler: value => {
              requireCondition(value.path === "checks/proof.txt", "UNINDEXED_CONTROL_EVIDENCE", "Only the fixed control evidence is readable");
              return "checks/proof.txt:1: The approved zero-value API returned 3 for input 0; the expected value is 0.";
            },
          }),
          sdk.defineTool("report_result", {
            description: "Submit the control report; semantic fail is successful execution.", defer: "never", skipPermission: true, isTerminal: true, parameters: reportSchema,
            handler: (report, invocation) => {
              const bytes = jsonBytes(report);
              requireCondition(!bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing callback was withheld");
              const argumentsSha256 = sha256(JSON.stringify(report));
              const withinWorkWindow = clock() < startedAt + limits.startupSendWorkMs && collecting;
              capture({ id: randomUUID(), type: "report.schema_decision", sessionId: invocation.sessionId, toolName: invocation.toolName, toolCallId: invocation.toolCallId, withinWorkWindow, origin: "handler", schemaSha256: sha256(jsonBytes(reportSchema)), argumentsSha256, decision: "accepted", reason: null }, schemaRecords, "schema-events.jsonl");
              const validation = validateTerminalReport(report, { criteria: [criterion], evidenceIndex });
              const valid = validation.ok && invocation.sessionId === sessionId && invocation.toolName === "report_result" && withinWorkWindow;
              const returned = valid ? { resultType: "success", textResultForLlm: "Control report accepted for execution; no product grade is admitted." } : { resultType: "failure", error: "The control report is malformed or outside its invocation.", textResultForLlm: "Reconcile the fixed report fields and active invocation." };
              handlers.push({ toolCallId: invocation.toolCallId, argumentsSha256, scoped: invocation.sessionId === sessionId && invocation.toolName === "report_result", resultType: returned.resultType });
              invocation.signal?.addEventListener("abort", () => send({ kind: "invocation-signal-aborted", toolCallId: invocation.toolCallId, explicitRunCancellation: false }), { once: true });
              return returned;
            },
          }),
        ],
        infiniteSessions: { enabled: false }, largeOutput: { enabled: false },
        enableConfigDiscovery: false, enableOnDemandInstructionDiscovery: false, enableFileHooks: false, enableHostGitOperations: false, enableSessionStore: false, enableSkills: false, enableAutoContext: false, remoteSession: "off",
        onPermissionRequest: () => ({ kind: "reject", feedback: "Only the two fixed control tools are permitted." }),
        onEvent: event => {
          try {
            if (!collecting) { send({ kind: "post-window-sdk-event", event }); return; }
            capture(event, sdkRecords, "sdk-events.jsonl");
            if (event.type === "assistant.turn_start" && !event.agentId && workDispatched) rootStarted = true;
            if (event.type === "session.idle" && !event.agentId && workDispatched && rootStarted && event.data?.mode === "interactive" && event.data.aborted === false) resolveIdle(event);
            if (event.type === "session.error" && !event.agentId) rejectIdle(new Error("The native session reported an error."));
          } catch (error) { captureErrors.push(errorInfo(error)); rejectIdle(error); }
        },
      });
      await session.rpc.tools.initializeAndValidate();
      const metadata = await session.rpc.tools.getCurrentMetadata();
      requireCondition(Array.isArray(metadata.tools) && canonicalJson(metadata.tools.map(tool => tool.name).sort()) === canonicalJson(["read_evidence", "report_result"]), "NATIVE_TOOL_SET_MISMATCH", "The observed tool set differs from the empty control");
      send({ kind: "runtime-configuration", runId, sessionId, runtime, modelRequested: model, reasoningEffortRequested: "high", contextTierRequested: "default", tools: metadata.tools });
      workDispatched = true;
      await session.send({ prompt: "Read checks/proof.txt, then submit the complete failing criterion through report_result." });
      await idle;
      history = await session.getEvents();
      artifact("history-response.json", history);
      observeProcesses();
      endReason = "idle";
    }, limits.startupSendWorkMs);
  } catch (error) {
    failure = errorInfo(error);
    endReason = error?.code === "NATIVE_DEADLINE" ? "timed_out" : "failed";
    send({ kind: "protocol-failure", error: failure });
  } finally {
    collecting = false;
    if (owned.size === 0) {
      const errors = [];
      try { await bounded("unobserved force stop", () => client.forceStop(), limits.cleanupMs); }
      catch (error) { errors.push(errorInfo(error)); }
      cleanup = { complete: false, errors, reason: "Owned runtime was not observed." };
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
  const valid = requests.filter(request => validateTerminalReport(request.arguments, { criteria: [criterion], evidenceIndex }).ok);
  const correlatedHandlers = handlers.filter(handler => handler.scoped && requests.some(request => request.toolCallId === handler.toolCallId && sha256(JSON.stringify(request.arguments)) === handler.argumentsSha256));
  const counts = { observedRequests: requests.length, schemaAcceptedHandlers: correlatedHandlers.length, validatorAcceptedReports: valid.length, admittedGrades: 0 };
  const completions = [...new Map(sdkRecords.map(record => [record.ref.eventId, JSON.parse(record.rawRecord)])).values()].filter(event => event.type === "tool.execution_complete" && !event.agentId && requests.some(request => request.toolCallId === event.data?.toolCallId));
  const historicalMatches = reconcileJudgeHistory({ history, observed: observation, sessionId, rootAgentId: null, expectedMode: "interactive" });
  const delivered = completions.length === 1 && completions[0].data.success === true;
  const ok = !failure && captureErrors.length === 0 && endReason === "idle" && observation.admissionEligible && historicalMatches && counts.observedRequests === 1 && counts.schemaAcceptedHandlers === 1 && counts.validatorAcceptedReports === 1 && correlatedHandlers[0].resultType === "success" && valid[0].arguments.status === "fail" && delivered && cleanup.complete;
  const result = { kind: "probe-finished", runId, sessionId, ok, qualified: false, scored: false, grade: null, counts, cleanup, admissionStatus: completions.some(event => event.data.success === false) ? "infrastructure_failure" : "unavailable", observation, historicalMatches, failure: failure ?? null, captureErrors, elapsedMs: clock() - startedAt };
  send({ kind: "protocol-observation", scope: "delivered semantic fail and root idle; not full terminal/activation qualification", counts, rootIdle: observation.rootIdle, historicalMatches, delivered });
  send(result);
  return result;
}
