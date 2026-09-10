import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, exactKeys, jsonBytes, parseRawJson, readRegular, relativeName, requireCondition, sha256, textBytes } from "./core.mjs";
import { openRunOutput } from "./output.mjs";
import { normalizeJudgeObservations, reconcileJudgeHistory, validateTerminalReport } from "./admission.mjs";
import { validateCleanupReceipt } from "./copilot-runner.mjs";
import { reportSchema } from "./native-protocol.mjs";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceMembers = ["native-protocol.mjs", "core.mjs", "admission.mjs", "copilot-runner.mjs", "vendor/gauntlet/LICENSE", "vendor/gauntlet/src/agent/validators.ts", "vendor/gauntlet/src/context/scoped-read.ts", "vendor/gauntlet/src/types.ts"];
const captureBudget = { maxBytes: 50331648, maxFiles: 240, finalMetadataBytes: 16777216, finalMetadataFiles: 1 };
const fields = (value, names, label) => requireCondition(exactKeys(value, names), "INVALID_RUNTIME_QUALIFICATION", `${label} requires its exact fields`);
const boundedInteger = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
export function validateRuntimeQualification(plan) {
  fields(plan, ["schemaVersion", "kind", "id", "model", "reasoningEffort", "contextTier", "scenario", "runtime", "credentialProvider", "limits"], "Qualification plan");
  requireCondition(plan.schemaVersion === 1 && plan.kind === "offline_runtime_qualification" && typeof plan.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(plan.id), "INVALID_RUNTIME_QUALIFICATION", "Expected a versioned qualification identity");
  requireCondition(["gpt-6-astra", "claude-opus-5"].includes(plan.model) && plan.reasoningEffort === "high" && plan.contextTier === "default" && plan.scenario === "terminal-semantic-fail", "INVALID_RUNTIME_QUALIFICATION", "Only the declared unscored terminal control is supported");
  fields(plan.runtime, ["imageId", "platform", "nodeVersion", "cliVersion", "sdkVersion"], "Runtime");
  requireCondition(/^sha256:[a-f0-9]{64}$/.test(plan.runtime.imageId) && plan.runtime.platform === "linux/amd64" && plan.runtime.nodeVersion === "22.23.2" && plan.runtime.cliVersion === "1.0.84-1" && plan.runtime.sdkVersion === "1.0.13", "INVALID_RUNTIME_QUALIFICATION", "An explicit immutable pinned runtime is required");
  fields(plan.credentialProvider, ["kind", "hostname", "account"], "Named provider");
  requireCondition(plan.credentialProvider.kind === "gh-named-entitlement" && plan.credentialProvider.hostname === "github.com" && typeof plan.credentialProvider.account === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(plan.credentialProvider.account), "INVALID_RUNTIME_QUALIFICATION", "The initial controller must name its authorized GitHub entitlement");
  fields(plan.limits, ["startupSendWorkMs", "commandMs", "cleanupMs", "maxStreamBytes"], "Limits");
  requireCondition(boundedInteger(plan.limits.startupSendWorkMs, 1, 2147483647) && boundedInteger(plan.limits.commandMs, 1, plan.limits.startupSendWorkMs) && boundedInteger(plan.limits.cleanupMs, 3, 2147483647) && boundedInteger(plan.limits.maxStreamBytes, 1, 16777216), "INVALID_RUNTIME_QUALIFICATION", "Qualification requires finite work, command, cleanup and stream bounds");
  return plan;
}

// The archive contains only the fixed controller's complete source closure.
// The credential is a separate in-memory envelope field, never a file member.
const bootstrap = [
  'const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");',
  'if(process.version!=="v22.23.2"||process.platform!=="linux"||process.arch!=="x64")throw Error("RUNTIME_PLATFORM");',
  'if(JSON.parse(fs.readFileSync("/opt/copilot-v2/package/package.json")).version!=="1.0.84-1"||JSON.parse(fs.readFileSync("/opt/copilot-sdk-v2/node_modules/@github/copilot-sdk/package.json")).version!=="1.0.13")throw Error("RUNTIME_PACKAGES");',
  'const input=fs.readFileSync(0);if(input.length>1048576)throw Error("INPUT_LIMIT");',
  `const expected=${JSON.stringify(sourceMembers)};`,
  'const p=JSON.parse(input),f=p.files;if(!Array.isArray(f)||f.length!==expected.length||new Set(f.map(x=>x.path)).size!==expected.length)throw Error("ARCHIVE_MEMBERS");',
  'for(const x of f){if(!expected.includes(x.path))throw Error("ARCHIVE_MEMBERS");const b=Buffer.from(x.base64,"base64");if(b.length>524288||b.toString("base64")!==x.base64||crypto.createHash("sha256").update(b).digest("hex")!==x.sha256)throw Error("ARCHIVE_IDENTITY");',
  'const target=path.join("/run/controller",x.path);fs.mkdirSync(path.dirname(target),{recursive:true,mode:448});fs.writeFileSync(target,b,{flag:"wx",mode:384});}',
  'const sdk=require("/opt/copilot-sdk-v2/node_modules/@github/copilot-sdk/dist/cjs/index.js");',
  'import("file:///run/controller/native-protocol.mjs").then(async m=>{const r=await m.runTerminalProtocol({sdk,root:"/run/controller",model:p.model,token:p.credential,limits:p.limits});process.exitCode=r.ok?0:1;}).catch(()=>{process.stderr.write("NATIVE_PROTOCOL_FAILED\\n");process.exitCode=1;});',
].join("");

function observeProtocolEvidence(rows, plan) {
  const configurations = rows.filter(row => row.kind === "runtime-configuration");
  requireCondition(configurations.length === 1, "NATIVE_OBSERVATION_INCOMPLETE", "One observed configuration is required");
  const configuration = configurations[0];
  requireCondition(typeof configuration.runId === "string" && typeof configuration.sessionId === "string" && configuration.runtime?.version === plan.runtime.cliVersion && configuration.modelRequested === plan.model && configuration.reasoningEffortRequested === plan.reasoningEffort && configuration.contextTierRequested === plan.contextTier, "NATIVE_CONFIGURATION_MISMATCH", "Observed configuration does not match this control");
  const files = new Map();
  const sdk = [];
  const schema = [];
  const captureErrors = [];
  for (const row of rows.filter(row => row.kind === "raw-event" || row.kind === "artifact")) {
    try {
      const ref = row.ref;
      relativeName(ref.path);
      const raw = Buffer.from(row.base64, "base64");
      requireCondition(raw.toString("base64") === row.base64 && raw.length === ref.byteLength && sha256(raw) === ref.sha256, "NATIVE_RAW_REFERENCE_MISMATCH", "Raw control bytes differ from their reference");
      if (row.kind === "raw-event") {
        requireCondition(["sdk-events.jsonl", "schema-events.jsonl"].includes(ref.path) && ref.sessionId === configuration.sessionId, "NATIVE_STREAM_SCOPE_MISMATCH", "The raw stream is outside this control session");
        requireCondition(parseRawJson(raw).id === ref.eventId, "NATIVE_EVENT_ID_MISMATCH", "The schema or SDK event differs from its raw identity");
        const prior = files.get(ref.path) ?? Buffer.alloc(0);
        requireCondition(ref.byteOffset === prior.length && prior.length + raw.length <= 16777216, "NATIVE_STREAM_OFFSET_MISMATCH", "The raw stream has a gap, overlap or exceeded bound");
        files.set(ref.path, Buffer.concat([prior, raw]));
        (ref.path === "sdk-events.jsonl" ? sdk : schema).push({ sessionId: ref.sessionId, ref, rawRecord: raw });
      } else {
        requireCondition(!files.has(ref.path), "NATIVE_ARTIFACT_DUPLICATE", "The control repeats an immutable artifact");
        files.set(ref.path, raw);
      }
    } catch (error) { captureErrors.push(error); }
  }
  const observed = normalizeJudgeObservations({ sessionId: configuration.sessionId, rootAgentId: null, expectedMode: "interactive", events: sdk });
  const schemaIdentities = new Map();
  for (const record of schema) {
    const event = parseRawJson(record.rawRecord);
    const prior = schemaIdentities.get(event.id);
    if (prior && canonicalJson(prior.event) !== canonicalJson(event)) captureErrors.push(Object.assign(new Error("A schema event identity has conflicting payloads"), { code: "NATIVE_SCHEMA_EVENT_CONFLICT" }));
    else schemaIdentities.set(event.id, { ...record, event });
  }
  const schemaEvents = [...schemaIdentities.values()];
  const completions = [...new Map(sdk.map(record => [record.ref.eventId, { ...record, event: parseRawJson(record.rawRecord) }])).values()].filter(record => record.event.type === "tool.execution_complete" && !record.event.agentId);
  const attempts = observed.completeRootRequests.map(request => {
    const report = validateTerminalReport(request.arguments, { criteria: ["The approved zero-value API returns zero."], evidenceIndex: { files: ["checks/proof.txt"] } });
    const decisions = schemaEvents.filter(record => record.event.type === "report.schema_decision" && record.event.sessionId === configuration.sessionId && record.event.toolName === "report_result" && record.event.withinWorkWindow === true && record.event.toolCallId === request.toolCallId && record.event.origin === "handler" && record.event.decision === "accepted" && record.event.schemaSha256 === sha256(jsonBytes(reportSchema)) && record.event.argumentsSha256 === sha256(JSON.stringify(request.arguments)));
    const executions = completions.filter(record => record.event.data?.toolCallId === request.toolCallId);
    return { ...request, validatorAccepted: report.ok, schemaAcceptedHandlerCount: decisions.length, schemaEventRefs: decisions.map(record => record.ref), executionCompletionRefs: executions.map(record => record.ref), executionSucceeded: executions.some(record => record.event.data.success === true), executionFailed: executions.some(record => record.event.data.success === false) };
  });
  const counts = { observedRequests: attempts.length, schemaAcceptedHandlers: attempts.reduce((sum, attempt) => sum + attempt.schemaAcceptedHandlerCount, 0), validatorAcceptedReports: attempts.filter(attempt => attempt.validatorAccepted).length, admittedGrades: 0 };
  return { configuration, files, observed, attempts, counts, captureErrors };
}

export function verifyProtocolEvidence(rows, plan) {
  const captured = observeProtocolEvidence(rows, plan);
  const { configuration, files, observed, attempts } = captured;
  if (captured.captureErrors.length) throw captured.captureErrors[0];
  const terminals = rows.filter(row => row.kind === "probe-finished");
  requireCondition(terminals.length === 1, "NATIVE_OBSERVATION_INCOMPLETE", "One final control envelope is required");
  const terminal = terminals[0];
  requireCondition(terminal.runId === configuration.runId && terminal.sessionId === configuration.sessionId, "NATIVE_CONFIGURATION_MISMATCH", "The terminal envelope differs from the observed control");
  requireCondition(observed.admissionEligible && observed.completeRootRequests.length === 1, "NATIVE_ROOT_OBSERVATION_INCOMPLETE", "One complete, unambiguous root report and idle observation are required");
  const request = observed.completeRootRequests[0];
  const report = validateTerminalReport(request.arguments, { criteria: ["The approved zero-value API returns zero."], evidenceIndex: { files: ["checks/proof.txt"] } });
  requireCondition(report.ok && report.value.status === "fail", "NATIVE_CONTROL_REPORT_MISMATCH", "The observed report does not satisfy the fixed control");
  requireCondition(attempts[0].schemaAcceptedHandlerCount === 1 && attempts[0].executionCompletionRefs.length === 1 && attempts[0].executionSucceeded, "NATIVE_EXECUTION_UNAVAILABLE", "Schema dispatch and delivered success must match the actual root request");
  const history = parseRawJson(files.get("history-response.json"));
  requireCondition(Array.isArray(history), "NATIVE_HISTORY_UNAVAILABLE", "The actual SDK history response is required");
  requireCondition(reconcileJudgeHistory({ history, observed, sessionId: configuration.sessionId, rootAgentId: null, expectedMode: "interactive" }), "NATIVE_HISTORY_MISMATCH", "History and observed root attempts, windows or terminal state disagree");
  const cleanup = terminal.cleanup;
  requireCondition(cleanup?.complete === true && cleanup.errors.length === 0 && validateCleanupReceipt(cleanup.receipt, { runId: configuration.runId, readArtifact: name => files.get(name) }).ok, "NATIVE_CLEANUP_UNVERIFIED", "Hashed owned-process exits are required");
  const counts = { observedRequests: 1, schemaAcceptedHandlers: 1, validatorAcceptedReports: 1, admittedGrades: 0 };
  requireCondition(terminal.ok === true && terminal.grade === null && canonicalJson(terminal.counts) === canonicalJson(counts), "NATIVE_CONTROL_ENVELOPE_MISMATCH", "The final control disagrees with its observed evidence");
  return { counts, files, observation: observed };
}

export async function runRuntimeQualification({ plan, outputRoot, authorizedRoot = path.dirname(outputRoot), protectedRoots = [], env = process.env, execute = spawnSync, clock = Date.now, rawPlanBytes = jsonBytes(plan) }) {
  plan = structuredClone(validateRuntimeQualification(plan));
  requireCondition(jsonBytes(parseRawJson(rawPlanBytes)).equals(jsonBytes(plan)), "PLAN_BYTES_MISMATCH", "The supplied plan bytes differ from the validated plan");
  const source = sourceMembers.map(name => ({ path: name, ...readRegular(sourceRoot, name, 524288) }));
  const controller = source[0];
  const sourceManifest = source.map(file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes.length }));
  const dockerEnv = { ...env };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_GITHUB_TOKEN", "COPILOT_SDK_AUTH_TOKEN", "NODE_TEST_CONTEXT"]) delete dockerEnv[name];
  const runId = `${plan.id}-${randomUUID()}`;
  const containerName = `offline-${runId}`.toLowerCase();
  const startedAt = clock();
  const deadline = startedAt + plan.limits.startupSendWorkMs;
  const output = openRunOutput({
    outputRoot: path.resolve(outputRoot), authorizedRoot: path.resolve(authorizedRoot), protectedRoots,
    runContext: { runId, cellId: plan.id, planSha256: sha256(rawPlanBytes), containerName, controllerSha256: controller.sha256, sourceManifest, sourceManifestSha256: sha256(jsonBytes(sourceManifest)), hostControllerSha256: readRegular(sourceRoot, "native-runtime.mjs", 524288).sha256, bootstrapSha256: sha256(bootstrap), captureBudget },
    limits: { maxStreamBytes: plan.limits.maxStreamBytes, maxFileBytes: 16777216, maxTotalBytes: 134217728, maxFiles: 256 },
  });
  let token;
  let containerId;
  let sequence = 0;
  let captureFailed = false;
  let captureBytes = readRegular(outputRoot, "receipt.incomplete.json").bytes.length;
  const captureNames = new Set(["receipt.incomplete.json", "stdout.raw", "stderr.raw"]);
  const record = { schemaVersion: 1, runId, status: "incomplete", qualified: false, scored: false, grade: null, scenario: plan.scenario, modelRequested: plan.model, reasoningEffortRequested: plan.reasoningEffort, contextTierRequested: plan.contextTier, controllerSha256: controller.sha256, sourceManifest, provider: plan.credentialProvider, observations: [], counts: { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 }, attemptCoverage: "no_model_execution_observed" };
  function safeBytes(value) {
    requireCondition(Buffer.isBuffer(value) || value === undefined || value === null, "NATIVE_RAW_BYTES_REQUIRED", "Decoded transport strings cannot be relabelled as captured raw bytes");
    const bytes = value ?? Buffer.alloc(0);
    requireCondition(!token || !bytes.includes(Buffer.from(token)), "CREDENTIAL_DISCLOSURE_CAPTURE_WITHHELD", "Credential-bearing capture was withheld before persistence");
    return bytes;
  }
  function reserve(name, bytes, final) {
    requireCondition(captureBytes + bytes <= captureBudget.maxBytes + (final ? captureBudget.finalMetadataBytes : 0) && captureNames.size + Number(!captureNames.has(name)) <= captureBudget.maxFiles + (final ? captureBudget.finalMetadataFiles : 0), "NATIVE_CAPTURE_LIMIT", "Native capture exceeds its aggregate byte or file budget");
    captureBytes += bytes;
    captureNames.add(name);
  }
  function append(channel, bytes) {
    reserve(channel === "stdout" || channel === "stderr" ? `${channel}.raw` : `${channel}.jsonl`, Math.min(bytes.length, plan.limits.maxStreamBytes), false);
    output.appendRaw(channel, bytes);
  }
  function save(name, value, final = false) {
    const bytes = safeBytes(value);
    requireCondition(bytes.length <= 16777216, "NATIVE_CAPTURE_LIMIT", "Native capture exceeds the regular-file limit");
    reserve(name, bytes.length, final);
    if (final && captureFailed) writeFileSync(path.join(outputRoot, name), bytes, { flag: "wx", mode: 0o600 });
    else output.writeArtifact(name, bytes);
    return { path: name, sha256: sha256(bytes), bytes: bytes.length };
  }
  function run(command, argv, options) {
    const remaining = (options.cleanupDeadline ?? deadline) - clock();
    if (remaining <= 0) return { status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: Object.assign(new Error("Outer execution deadline"), { code: "ETIMEDOUT" }) };
    const { cleanupDeadline: ignored, ...extra } = options;
    return execute(command, argv, { shell: false, encoding: null, env: dockerEnv, maxBuffer: plan.limits.maxStreamBytes, killSignal: "SIGKILL", timeout: Math.max(1, Math.min(plan.limits.commandMs, remaining)), ...extra });
  }
  function observedDocker(argv, options = {}) {
    const result = run("docker", argv, options);
    const prefix = `${String(++sequence).padStart(2, "0")}-${argv[0]}`;
    const observation = { command: "docker", argv, status: result.status, signal: result.signal ?? null, errorCode: result.error?.code ?? null };
    try {
      observation.stdout = save(`${prefix}.stdout.raw`, result.stdout);
      observation.stderr = save(`${prefix}.stderr.raw`, result.stderr);
      record.observations.push(observation);
    } catch (error) {
      captureFailed = true;
      observation.captureFailure = detail(error);
      record.observations.push(observation);
      if (options.cleanupDeadline === undefined) throw error;
    }
    return result;
  }
  const detail = error => ({ code: typeof error?.code === "string" ? error.code : null, message: token && String(error?.message ?? error).includes(token) ? "Credential-bearing error withheld." : String(error?.message ?? error) });
  function parsedContainer(result) {
    if (result.status !== 0 || result.error) return null;
    const parsed = parseRawJson(safeBytes(result.stdout));
    requireCondition(Array.isArray(parsed) && parsed.length === 1, "CONTAINER_INSPECTION_SHAPE", "Expected one exact owned container");
    return parsed[0];
  }
  function owned(container) {
    return container && /^[/]?offline-/.test(container.Name) && container.Name.replace(/^\//, "") === containerName && container.Image === plan.runtime.imageId && container.Config?.Labels?.["offline.run-id"] === runId && container.Config?.Labels?.["offline.controller-sha256"] === controller.sha256;
  }
  try {
    const authEnv = { ...env };
    delete authEnv.GH_TOKEN;
    delete authEnv.GITHUB_TOKEN;
    const auth = run("gh", ["auth", "token", "--hostname", plan.credentialProvider.hostname, "--user", plan.credentialProvider.account], { env: authEnv, maxBuffer: 8192 });
    if (auth.status !== 0 || auth.error) {
      record.status = "credential_provider_failed";
      record.providerFailure = { status: auth.status, signal: auth.signal ?? null, code: auth.error?.code ?? null };
    } else {
      token = Buffer.from(auth.stdout).toString("utf8").trim();
      requireCondition(token.length > 20 && !/\s/.test(token), "CREDENTIAL_PROVIDER_VALUE_INVALID", "The named provider returned an unusable entitlement");
      const create = [
        "create", "--name", containerName, "--interactive", "--init", "--hostname", "offline-qualification", "--pull=never",
        "--label", `offline.run-id=${runId}`, "--label", `offline.controller-sha256=${controller.sha256}`,
        "--platform", plan.runtime.platform, "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "256", "--ulimit", "core=0",
        "--tmpfs", "/run:rw,exec,nosuid,nodev,mode=0755,size=512m",
        "--tmpfs", "/work:rw,exec,nosuid,nodev,mode=0755,size=128m",
        "--tmpfs", "/output:rw,nosuid,nodev,mode=0700,size=128m",
        "--entrypoint", "/usr/local/bin/node", plan.runtime.imageId, "-e", bootstrap,
      ];
      const created = observedDocker(create);
      requireCondition(created.status === 0 && !created.error, "CONTAINER_CREATE_FAILED", "Owned container creation did not complete");
      containerId = textBytes(safeBytes(created.stdout)).trim();
      requireCondition(/^[a-f0-9]{64}$/.test(containerId), "CONTAINER_ID_INVALID", "Docker did not return a complete container identity");
      const container = parsedContainer(observedDocker(["inspect", containerId]));
      requireCondition(owned(container) && container.Id === containerId, "CONTAINER_OWNERSHIP_UNVERIFIED", "The returned container does not match the predeclared owned invocation");
      requireCondition(container.HostConfig?.ReadonlyRootfs === true && container.HostConfig.CapDrop?.includes("ALL") && container.HostConfig.SecurityOpt?.some(value => value.includes("no-new-privileges")) && Array.isArray(container.Mounts) && container.Mounts.every(mount => mount.Type === "tmpfs"), "CONTAINER_BOUNDARY_MISMATCH", "The actual container does not satisfy the fixed no-host-mount boundary");
      const input = JSON.stringify({ credential: token, model: plan.model, limits: plan.limits, files: source.map(file => ({ path: file.path, sha256: file.sha256, base64: file.bytes.toString("base64") })) });
      const executed = run("docker", ["start", "--attach", "--interactive", containerId], { input, timeout: Math.max(1, deadline - clock()) });
      record.execution = { status: executed.status, signal: executed.signal ?? null, errorCode: executed.error?.code ?? null };
      record.attemptCoverage = "unavailable";
      record.status = executed.error?.code === "ETIMEDOUT" || clock() >= deadline ? "timed_out" : "protocol_observation_failed";
      let streamCaptureFailure;
      try {
        append("stdout", safeBytes(executed.stdout));
        append("stderr", safeBytes(executed.stderr));
      } catch (error) {
        captureFailed = true;
        streamCaptureFailure = error;
      }
      const retained = readRegular(outputRoot, "stdout.raw", plan.limits.maxStreamBytes);
      record.rawProtocolPrefix = { path: "stdout.raw", sha256: retained.sha256, bytes: retained.bytes.length };
      const rows = [];
      record.decodeErrors = [];
      for (let start = 0, index = 1; start < retained.bytes.length; index++) {
        const newline = retained.bytes.indexOf(10, start);
        const bytes = retained.bytes.subarray(start, newline === -1 ? retained.bytes.length : newline);
        start = newline === -1 ? retained.bytes.length : newline + 1;
        try {
          if (!textBytes(bytes).trim()) continue;
          const row = parseRawJson(bytes);
          requireCondition(row && typeof row.kind === "string", "NATIVE_RECORD_SHAPE", "A native record requires its declared kind");
          rows.push(row);
        } catch (error) { record.decodeErrors.push({ line: index, ...detail(error) }); }
      }
      if (rows.some(row => row.kind === "runtime-configuration")) {
        const captured = observeProtocolEvidence(rows, plan);
        record.counts = captured.counts;
        record.attempts = captured.attempts;
        record.captureErrors = captured.captureErrors.map(detail);
        record.attemptCoverage = "verified_observed_prefix";
        for (const [name, bytes] of streamCaptureFailure ? [] : captured.files) {
          if (name === "sdk-events.jsonl") append("sdk-events", bytes);
          else if (name === "schema-events.jsonl") append("schema-events", bytes);
          else save(name, bytes);
        }
      }
      if (streamCaptureFailure) throw streamCaptureFailure;
      if (executed.status === 0 && record.status !== "timed_out") {
        requireCondition(record.decodeErrors.length === 0, "NATIVE_RECORD_DECODE_FAILED", "The raw control stream is incomplete or malformed");
        const verified = verifyProtocolEvidence(rows, plan);
        record.counts = verified.counts;
        record.attemptCoverage = "complete_control_observation";
        record.status = "component_observed";
      }
      record.protocolObservation = rows.findLast(row => row.kind === "protocol-observation") ?? null;
    }
  } catch (error) {
    record.status = record.status === "incomplete" ? clock() >= deadline ? "timed_out" : "infrastructure_failure" : record.status;
    record.failure = detail(error);
  } finally {
    const cleanupStarted = clock();
    const cleanupDeadline = cleanupStarted + plan.limits.cleanupMs;
    const firstCleanupObservation = record.observations.length;
    const cleanup = { containerName, containerId: containerId ?? null, absenceObserved: false, exited: false, removed: false, ownershipVerified: false, evidenceAvailability: "unavailable" };
    record.cleanup = cleanup;
    if (record.status !== "credential_provider_failed") {
      try {
        const inspected = observedDocker(["inspect", containerId ?? containerName], { cleanupDeadline });
        if (inspected.status !== 0 && !inspected.error && /No such object|No such container/.test(textBytes(safeBytes(inspected.stderr)))) cleanup.absenceObserved = true;
        else {
          let container = parsedContainer(inspected);
          requireCondition(owned(container), "CLEANUP_OWNERSHIP_UNVERIFIED", "The exact pending name or ID did not prove ownership");
          cleanup.ownershipVerified = true;
          containerId = container.Id;
          cleanup.containerId = containerId;
          cleanup.observedPid = container.State?.Pid ?? null;
          if (container.State?.Running === true) {
            observedDocker(["kill", containerId], { cleanupDeadline });
            container = parsedContainer(observedDocker(["inspect", containerId], { cleanupDeadline }));
            requireCondition(owned(container), "CLEANUP_OWNERSHIP_UNVERIFIED", "Post-stop container identity differs");
          }
          cleanup.exited = container.State?.Running === false && ["exited", "created"].includes(container.State.Status);
          cleanup.exitCode = container.State?.ExitCode ?? null;
          cleanup.finishedAt = container.State?.FinishedAt ?? null;
          requireCondition(cleanup.exited, "CONTAINER_EXIT_UNVERIFIED", "Owned container exit was not observed");
          const removed = observedDocker(["rm", containerId], { cleanupDeadline });
          const absent = observedDocker(["inspect", containerId], { cleanupDeadline });
          cleanup.removed = removed.status === 0 && !removed.error && absent.status !== 0 && !absent.error && /No such object|No such container/.test(textBytes(safeBytes(absent.stderr)));
        }
      } catch (error) { cleanup.failure = detail(error); }
      const cleanupObservations = record.observations.slice(firstCleanupObservation);
      cleanup.evidenceAvailability = cleanupObservations.length > 0 && cleanupObservations.every(observation => !observation.captureFailure) ? "available" : "unavailable";
      cleanup.elapsedMs = clock() - cleanupStarted;
      if ((!cleanup.absenceObserved && (!cleanup.ownershipVerified || !cleanup.exited || !cleanup.removed)) || cleanup.elapsedMs > plan.limits.cleanupMs) {
        record.cleanupStatus = "unverified";
        if (record.status !== "timed_out") record.status = "cleanup_unverified";
      }
    }
    if (captureFailed && record.status !== "timed_out") record.status = "capture_incomplete";
    record.elapsedMs = clock() - startedAt;
    try {
      save("qualification.json", jsonBytes(record), true);
      if (!captureFailed) output.commit({ schemaVersion: 1, runId, status: record.status === "component_observed" ? "unavailable" : record.status === "timed_out" ? "timed_out" : "infrastructure_failure", grade: null, counts: record.counts, qualification: record });
    } catch (error) {
      if (record.status !== "timed_out") record.status = "publication_failed";
      record.publicationFailure = detail(error);
    }
  }
  return { ...record, artifacts: path.resolve(outputRoot), exitCode: record.status === "component_observed" ? 0 : 3 };
}
