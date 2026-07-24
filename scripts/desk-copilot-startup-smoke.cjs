#!/usr/bin/env node
"use strict";

const path = require("node:path");

const STARTUP_PROMPT = "This is an automated startup acceptance check. You must call the desk_status MCP tool exactly once. After the tool succeeds, reply with exactly DESK_STARTUP_READY and nothing else. Do not call any other tool.";
const PINNED_COPILOT_PREFIX = [
  "--yes",
  "-p",
  "node@22.23.1",
  "-p",
  "@github/copilot@1.0.72-0",
  "copilot",
  "--no-auto-update",
];
const ARGUMENT_FIELDS = new Map([
  ["--candidate-root", "candidateRoot"],
  ["--raw-root", "rawRoot"],
  ["--safe-root", "safeRoot"],
]);
const EXPECTED_REMOTE_WARNING = "could not load remote agents, no GitHub remote found";
const DEFAULT_ARTIFACT_LIMITS = Object.freeze({
  debug_log: 8 * 1024 * 1024,
  generated_diagnostics: 1024 * 1024,
  jsonl: 1024 * 1024,
  stderr: 1024 * 1024,
});
const DEFAULT_ARTIFACT_LIMIT = 1024 * 1024;
const MAX_ARTIFACT_FILE_NAME_BYTES = 128;
const MAX_ARTIFACT_SOURCE_BYTES = 64;
const MAX_SUMMARY_BYTES = 256 * 1024;
const SAFE_ARTIFACT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_ARTIFACT_SOURCE = /^[a-z][a-z0-9_]*$/;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const field = ARGUMENT_FIELDS.get(argument);
    if (!field) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    result[field] = value;
  }
  for (const [argument, field] of ARGUMENT_FIELDS) {
    if (result[field] === undefined) {
      throw new Error(`${argument} is required`);
    }
  }
  return result;
}

function requiredPath(value, label) {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  return path.resolve(value);
}

function pathsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return !leftToRight.startsWith("..") || !rightToLeft.startsWith("..");
}

function buildPaths({ candidateRoot, rawRoot, safeRoot }) {
  const resolvedCandidateRoot = requiredPath(candidateRoot, "candidateRoot");
  const resolvedRawRoot = requiredPath(rawRoot, "rawRoot");
  const resolvedSafeRoot = requiredPath(safeRoot, "safeRoot");
  if (pathsOverlap(resolvedRawRoot, resolvedSafeRoot)) {
    throw new Error("raw and safe roots must be separate non-overlapping directories");
  }
  if (
    pathsOverlap(resolvedCandidateRoot, resolvedRawRoot) ||
    pathsOverlap(resolvedCandidateRoot, resolvedSafeRoot)
  ) {
    throw new Error("candidate checkout and output roots must be separate non-overlapping directories");
  }
  return {
    candidateRoot: resolvedCandidateRoot,
    copilotHome: path.join(resolvedRawRoot, "copilot-home"),
    cwd: path.join(resolvedRawRoot, "workspace"),
    deskRoot: path.join(resolvedRawRoot, "desk"),
    homeRoot: path.join(resolvedRawRoot, "home"),
    jsonlPath: path.join(resolvedRawRoot, "copilot.jsonl"),
    logRoot: path.join(resolvedRawRoot, "copilot-logs"),
    rawRoot: resolvedRawRoot,
    runtimeCacheRoot: path.join(resolvedRawRoot, "runtime-cache"),
    safeRoot: resolvedSafeRoot,
    stderrPath: path.join(resolvedRawRoot, "copilot.stderr.log"),
    summaryPath: path.join(resolvedSafeRoot, "summary.json"),
    xdgCacheHome: path.join(resolvedRawRoot, "xdg", "cache"),
    xdgConfigHome: path.join(resolvedRawRoot, "xdg", "config"),
    xdgDataHome: path.join(resolvedRawRoot, "xdg", "data"),
  };
}

function validateCandidateRoot(candidateRoot, fsOps) {
  let candidateStat;
  try {
    candidateStat = fsOps.statSync(candidateRoot);
  } catch (error) {
    throw new Error(`candidate checkout is not a directory: ${candidateRoot}`, { cause: error });
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`candidate checkout is not a directory: ${candidateRoot}`);
  }
}

function hasSecret(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSecrets(env) {
  if (!hasSecret(env?.GITHUB_TOKEN) && !hasSecret(env?.GH_TOKEN)) {
    throw new Error("a non-empty GITHUB_TOKEN or GH_TOKEN is required");
  }
}

function createIsolatedRoots(paths, fsOps, secrets) {
  const directories = [
    paths.rawRoot,
    paths.safeRoot,
    paths.homeRoot,
    paths.copilotHome,
    paths.xdgConfigHome,
    paths.xdgCacheHome,
    paths.xdgDataHome,
    paths.deskRoot,
    paths.runtimeCacheRoot,
    paths.cwd,
    paths.logRoot,
  ];
  for (const directory of directories) {
    try {
      fsOps.mkdirSync(directory, { mode: 0o700, recursive: true });
    } catch (error) {
      throw new Error(`unable to create isolated root ${directory}: ${error.code}`, { cause: error });
    }
  }
  const initializingSummary = `${JSON.stringify({
    failure_codes: [],
    phase: "initializing",
    schema_version: 1,
  }, null, 2)}\n`;
  if (includesSecret(initializingSummary, activeSecrets(secrets))) {
    throw new Error("unable to produce secret-free initializing summary");
  }
  fsOps.writeFileSync(paths.summaryPath, initializingSummary, { encoding: "utf8", mode: 0o600 });
  fsOps.chmodSync(paths.summaryPath, 0o600);
}

function buildEnvironments(paths, env) {
  const live = {
    ...env,
    COPILOT_HOME: paths.copilotHome,
    DESK: paths.deskRoot,
    DESK_RUNTIME_CACHE_DIR: paths.runtimeCacheRoot,
    HOME: paths.homeRoot,
    XDG_CACHE_HOME: paths.xdgCacheHome,
    XDG_CONFIG_HOME: paths.xdgConfigHome,
    XDG_DATA_HOME: paths.xdgDataHome,
  };
  const setup = { ...live };
  delete setup.GH_TOKEN;
  delete setup.GITHUB_TOKEN;
  return { live, setup };
}

function command(commandName, args, cwd, env) {
  return {
    command: commandName,
    args,
    options: { cwd, env },
  };
}

function buildCommands(paths, environments) {
  return {
    copilotLive: command(
      "npx",
      [
        ...PINNED_COPILOT_PREFIX,
        "--agent=desk:worker",
        "--model=claude-sonnet-5",
        "--disable-builtin-mcps",
        "--available-tools=desk-desk_status",
        "--allow-all-tools",
        "--no-ask-user",
        "--no-remote",
        "--no-remote-export",
        "--secret-env-vars=GITHUB_TOKEN,GH_TOKEN",
        "--log-level=debug",
        `--log-dir=${paths.logRoot}`,
        "--output-format=json",
        "-p",
        STARTUP_PROMPT,
      ],
      paths.cwd,
      environments.live,
    ),
    gitInit: command(
      "git",
      ["init", "--initial-branch=main", "."],
      paths.cwd,
      environments.setup,
    ),
    marketplaceAdd: command(
      "npx",
      [...PINNED_COPILOT_PREFIX, "plugin", "marketplace", "add", paths.candidateRoot],
      paths.cwd,
      environments.setup,
    ),
    pluginInstall: command(
      "npx",
      [...PINNED_COPILOT_PREFIX, "plugin", "install", "desk@ouroboros-skills"],
      paths.cwd,
      environments.setup,
    ),
  };
}

function buildSmokePlan(input, { fsOps }) {
  const paths = buildPaths(input);
  validateCandidateRoot(paths.candidateRoot, fsOps);
  validateSecrets(input.env);
  createIsolatedRoots(paths, fsOps, input.env);
  const environments = buildEnvironments(paths, input.env);
  return {
    commands: buildCommands(paths, environments),
    environments,
    paths,
  };
}

function parseJsonl(jsonl) {
  const events = [];
  let malformed = false;
  for (const line of jsonl.split("\n")) {
    if (/^[\t\r ]*$/.test(line)) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (event === null || typeof event !== "object" || Array.isArray(event) ||
          typeof event.type !== "string" || event.type.length === 0) {
        malformed = true;
        continue;
      }
      events.push(event);
    } catch {
      malformed = true;
    }
  }
  return { events, malformed };
}

function trimAsciiWhitespace(value) {
  return value.replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "");
}

function addMcpFailures(events, failures) {
  const snapshots = events
    .filter((event) => event?.type === "session.mcp_servers_loaded")
    .map((event) => event.data);
  if (snapshots.length === 0) {
    failures.add("mcp_snapshot_missing");
    return;
  }
  const serializedSnapshots = snapshots.map((snapshot) => JSON.stringify(snapshot));
  if (snapshots.length < 2 || serializedSnapshots.some((snapshot) => snapshot !== serializedSnapshots[0])) {
    failures.add("mcp_snapshot_inconsistent");
  }
  for (const snapshot of snapshots) {
    const servers = Array.isArray(snapshot?.servers) ? snapshot.servers : [];
    const desks = servers.filter((server) => server?.name === "desk");
    const githubServers = servers.filter((server) => server?.name === "github-mcp-server");
    if (desks.length !== 1) {
      failures.add("desk_mcp_count_mismatch");
    }
    if (desks.length === 0 || desks.some((server) => server?.status !== "connected")) {
      failures.add("desk_mcp_not_connected");
    }
    if (
      desks.length === 0 ||
      desks.some((server) => server?.source !== "plugin" || server?.pluginName !== "desk")
    ) {
      failures.add("desk_mcp_not_plugin");
    }
    if (githubServers.length !== 1) {
      failures.add("github_mcp_count_mismatch");
    }
    if (
      githubServers.length === 0 ||
      githubServers.some((server) => server?.source !== "builtin" || server?.status !== "disabled")
    ) {
      failures.add("github_mcp_not_disabled");
    }
  }
}

function addModelFailures(events, expectedModel, failures) {
  const models = events
    .map((event) => event?.data?.model)
    .filter((model) => typeof model === "string" && model.length > 0);
  if (models.length === 0) {
    failures.add("model_missing");
  } else if (models.some((model) => model !== expectedModel)) {
    failures.add("model_mismatch");
  }
}

function addDiagnosticFailures(events, failures) {
  const diagnostics = events.filter((event) => event?.type === "session.custom_agents_updated");
  const valid = diagnostics.length > 0 && diagnostics.every((event) => {
    const errors = event?.data?.errors;
    const warnings = event?.data?.warnings;
    return Array.isArray(errors) &&
      errors.length === 0 &&
      Array.isArray(warnings) &&
      warnings.length === 1 &&
      warnings[0] === EXPECTED_REMOTE_WARNING;
  });
  if (!valid) {
    failures.add("unexpected_diagnostic");
  }
}

function addPayloadFailures(payload, expected, failures) {
  if (payload.status !== "ok") {
    failures.add("payload_status_not_ok");
  }
  if (payload.reason === "no_compatible_node") {
    failures.add("payload_reason_no_compatible_node");
  }
  if (payload.reason === "unsupported_target") {
    failures.add("payload_reason_unsupported_target");
  }
  if (payload.reason === "guarded_reexec_failure") {
    failures.add("payload_reason_guarded_reexec_failure");
  }
  const runtime = payload.runtime ?? {};
  if (runtime.loaded_from_source_mirror !== true) {
    failures.add("source_mirror_not_restored");
  }
  if ((runtime.target ?? runtime.current_target?.id) !== expected.runtimeTarget) {
    failures.add("runtime_target_mismatch");
  }
  if ((runtime.node?.abi ?? runtime.current_target?.node_abi) !== expected.nodeAbi) {
    failures.add("runtime_abi_mismatch");
  }
  if (payload.root?.path !== expected.deskRoot) {
    failures.add("desk_root_mismatch");
  }
  if ((runtime.runtime_cache_dir ?? runtime.runtime_cache_path) !== expected.runtimeCacheRoot) {
    failures.add("runtime_cache_root_mismatch");
  }
}

function addToolFailures(events, expected, failures) {
  const requests = events.flatMap((event, eventIndex) => {
    if (event?.type !== "assistant.message" || !Array.isArray(event?.data?.toolRequests)) {
      return [];
    }
    return event.data.toolRequests.map((request) => ({ eventIndex, request }));
  });
  const starts = events
    .map((event, eventIndex) => ({ event, eventIndex }))
    .filter(({ event }) => event?.type === "tool.execution_start");
  const completions = events
    .map((event, eventIndex) => ({ event, eventIndex }))
    .filter(({ event }) => event?.type === "tool.execution_complete");
  if (requests.length !== 1) {
    failures.add("tool_request_count_mismatch");
  }
  if (starts.length !== 1) {
    failures.add("tool_start_count_mismatch");
  }
  if (completions.length !== 1) {
    failures.add("tool_complete_count_mismatch");
  }

  const requestEntry = requests[0];
  const startEntry = starts[0];
  const completionEntry = completions[0];
  const request = requestEntry?.request;
  const start = startEntry?.event;
  const completion = completionEntry?.event;
  const callId = request?.toolCallId;
  if (
    (requestEntry && (
      request === null ||
      typeof request !== "object" ||
      request.name !== "desk-desk_status" ||
      typeof callId !== "string" ||
      callId.trim().length === 0
    )) ||
    (startEntry && (
      start.data?.mcpServerName !== "desk" ||
      start.data?.mcpToolName !== "desk_status" ||
      start.data?.toolName !== "desk-desk_status" ||
      typeof start.data?.toolCallId !== "string" ||
      start.data.toolCallId.trim().length === 0
    )) ||
    (completionEntry && (
      typeof completion.data?.toolCallId !== "string" ||
      completion.data.toolCallId.trim().length === 0
    )) ||
    (requestEntry && startEntry && callId !== start.data?.toolCallId) ||
    (requestEntry && completionEntry && callId !== completion.data?.toolCallId)
  ) {
    failures.add("tool_call_mismatch");
  }
  const sentinelIndex = events.findLastIndex(
    (event) => event?.type === "assistant.message" &&
      typeof event?.data?.content === "string" &&
      trimAsciiWhitespace(event.data.content).length > 0,
  );
  if (
    requestEntry &&
    startEntry &&
    completionEntry &&
    sentinelIndex >= 0 &&
    !(
      requestEntry.eventIndex < startEntry.eventIndex &&
      startEntry.eventIndex < completionEntry.eventIndex &&
      completionEntry.eventIndex < sentinelIndex
    )
  ) {
    failures.add("tool_event_order_invalid");
  }

  if (!completion) {
    return;
  }
  if (completion.data?.success !== true) {
    failures.add("tool_transport_failed");
  }
  let payload;
  try {
    payload = JSON.parse(completion.data?.result?.content);
  } catch {
    failures.add("tool_payload_invalid");
    return;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    failures.add("tool_payload_invalid");
    return;
  }
  addPayloadFailures(payload, expected, failures);
}

function addSentinelFailure(events, expectedSentinel, failures) {
  const responses = events
    .filter((event) => event?.type === "assistant.message" && typeof event?.data?.content === "string")
    .map((event) => event.data.content)
    .filter((content) => trimAsciiWhitespace(content).length > 0);
  if (
    responses.length === 0 ||
    trimAsciiWhitespace(responses[responses.length - 1]) !== expectedSentinel
  ) {
    failures.add("sentinel_mismatch");
  }
}

function validateStartupResult({ exitCode, expected, jsonl, stderr }) {
  const failures = new Set();
  const parsed = parseJsonl(jsonl);
  if (parsed.malformed) {
    failures.add("jsonl_malformed");
  }
  addMcpFailures(parsed.events, failures);
  addModelFailures(parsed.events, expected.model, failures);
  addDiagnosticFailures(parsed.events, failures);
  addToolFailures(parsed.events, expected, failures);
  addSentinelFailure(parsed.events, expected.sentinel, failures);
  if (exitCode !== 0) {
    failures.add("process_exit_nonzero");
  }
  if (stderr.length > 0) {
    failures.add("stderr_nonempty");
  }
  const failureCodes = [...failures].sort();
  return {
    failure_codes: failureCodes,
    ok: failureCodes.length === 0,
  };
}

function activeSecrets(secrets) {
  validateSecrets(secrets);
  return [secrets.GITHUB_TOKEN, secrets.GH_TOKEN].filter(hasSecret);
}

function includesSecret(value, secretValues) {
  return secretValues.some((secret) => value.includes(secret));
}

function isSafeArtifactFileName(value) {
  return typeof value === "string" &&
    Buffer.byteLength(value) <= MAX_ARTIFACT_FILE_NAME_BYTES &&
    SAFE_ARTIFACT_FILE_NAME.test(value);
}

function isSafeArtifactSource(value) {
  return typeof value === "string" &&
    Buffer.byteLength(value) <= MAX_ARTIFACT_SOURCE_BYTES &&
    SAFE_ARTIFACT_SOURCE.test(value);
}

function planSafeArtifacts({ limits = {}, reservedFileNames = [], secrets, sources }) {
  const retained = [];
  const omitted = [];
  const failures = new Set();
  const secretValues = activeSecrets(secrets);
  const limitsAreValid = limits !== null && typeof limits === "object" && !Array.isArray(limits);
  const reservedFileNameSet = new Set(reservedFileNames.map((fileName) => fileName.toLowerCase()));
  const fileNameCounts = new Map();
  for (const source of sources) {
    const fileNameKey = String(source.fileName).toLowerCase();
    fileNameCounts.set(fileNameKey, (fileNameCounts.get(fileNameKey) ?? 0) + 1);
  }
  for (const source of sources) {
    const bytes = Buffer.byteLength(source.content);
    const fileNameIsSafe = isSafeArtifactFileName(source.fileName);
    const fileNameKey = String(source.fileName).toLowerCase();
    const fileNameIsDuplicate = fileNameCounts.get(fileNameKey) > 1;
    const fileNameIsReserved = reservedFileNameSet.has(fileNameKey);
    const sourceIsSafe = isSafeArtifactSource(source.source);
    const fileNameContainsSecret = typeof source.fileName === "string" && includesSecret(source.fileName, secretValues);
    const sourceContainsSecret = typeof source.source === "string" && includesSecret(source.source, secretValues);
    const metadataContainsSecret = fileNameContainsSecret || sourceContainsSecret;
    const metadataIsInvalid = !fileNameIsSafe || fileNameIsDuplicate || fileNameIsReserved || !sourceIsSafe;
    const contentContainsSecret = includesSecret(source.content, secretValues);
    const containsSecret = contentContainsSecret || metadataContainsSecret;
    const hasExplicitLimit = limitsAreValid && Object.hasOwn(limits, source.source);
    const limit = hasExplicitLimit
      ? limits[source.source]
      : Object.hasOwn(DEFAULT_ARTIFACT_LIMITS, source.source)
        ? DEFAULT_ARTIFACT_LIMITS[source.source]
        : DEFAULT_ARTIFACT_LIMIT;
    const limitIsValid = limitsAreValid && Number.isSafeInteger(limit) && limit >= 0;
    const exceedsLimit = limitIsValid && bytes > limit;
    if (containsSecret || metadataIsInvalid || !limitIsValid || exceedsLimit) {
      if (containsSecret) {
        failures.add("secret_detected");
      }
      if (metadataContainsSecret || metadataIsInvalid) {
        failures.add("artifact_metadata_invalid");
      }
      if (!limitIsValid) {
        failures.add("artifact_limit_invalid");
      }
      if (exceedsLimit) {
        failures.add("artifact_size_limit_exceeded");
      }
      omitted.push({
        bytes,
        file_name: fileNameIsSafe && !fileNameContainsSecret ? source.fileName : "withheld",
        reason: containsSecret
          ? "secret_detected"
          : metadataIsInvalid
            ? "metadata_invalid"
            : !limitIsValid
              ? "limit_invalid"
              : "size_limit_exceeded",
        source: sourceIsSafe && !sourceContainsSecret ? source.source : "withheld",
      });
    } else {
      retained.push({
        bytes,
        content: source.content,
        file_name: source.fileName,
        source: source.source,
      });
    }
  }
  return {
    failure_codes: [...failures].sort(),
    omitted,
    retained,
  };
}

function normalizeProcessMetadata(processMetadata) {
  const allowedKeys = ["exit_code", "signal", "timed_out"];
  const keysAreValid = processMetadata !== null &&
    typeof processMetadata === "object" &&
    !Array.isArray(processMetadata) &&
    Object.keys(processMetadata).length === allowedKeys.length &&
    allowedKeys.every((key) => Object.hasOwn(processMetadata, key));
  const exitCodeIsValid = keysAreValid &&
    (processMetadata.exit_code === null ||
      (Number.isInteger(processMetadata.exit_code) &&
        processMetadata.exit_code >= 0 &&
        processMetadata.exit_code <= 255));
  const signalIsValid = keysAreValid &&
    (processMetadata.signal === null ||
      (typeof processMetadata.signal === "string" && /^SIG[A-Z0-9]{1,16}$/.test(processMetadata.signal)));
  const timedOutIsValid = keysAreValid && typeof processMetadata.timed_out === "boolean";
  return {
    invalid: !(keysAreValid && exitCodeIsValid && signalIsValid && timedOutIsValid),
    metadata: {
      exit_code: exitCodeIsValid ? processMetadata.exit_code : null,
      signal: signalIsValid ? processMetadata.signal : null,
      timed_out: timedOutIsValid ? processMetadata.timed_out : false,
    },
  };
}

function serializeSummary(summary) {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

function writeSafeArtifacts({
  fsOps,
  paths,
  processMetadata,
  secrets,
  sources,
  validation,
}) {
  const temporarySummaryPath = `${paths.summaryPath}.tmp`;
  const plan = planSafeArtifacts({
    reservedFileNames: [
      path.basename(paths.summaryPath),
      path.basename(temporarySummaryPath),
    ],
    secrets,
    sources,
  });
  const normalizedProcess = normalizeProcessMetadata(processMetadata);
  const failureCodes = new Set([...validation.failure_codes, ...plan.failure_codes]);
  if (normalizedProcess.invalid) {
    failureCodes.add("process_metadata_invalid");
  }
  let summary = {
    failure_codes: [...failureCodes].sort(),
    omitted_files: plan.omitted,
    phase: "complete",
    process: normalizedProcess.metadata,
    retained_files: plan.retained.map(({ bytes, file_name, source }) => ({
      bytes,
      file_name,
      source,
    })),
    schema_version: 1,
  };
  const secretValues = activeSecrets(secrets);
  let serializedSummary = serializeSummary(summary);
  if (includesSecret(serializedSummary, secretValues) || Buffer.byteLength(serializedSummary) > MAX_SUMMARY_BYTES) {
    summary = {
      failure_codes: [
        includesSecret(serializedSummary, secretValues) ? "secret_detected" : "summary_metadata_invalid",
      ],
      omitted_files: [],
      phase: "complete",
      process: normalizedProcess.metadata,
      retained_files: [],
      schema_version: 1,
    };
    serializedSummary = serializeSummary(summary);
  }
  if (includesSecret(serializedSummary, secretValues)) {
    throw new Error("unable to produce secret-free summary");
  }
  for (const artifact of summary.retained_files) {
    const plannedArtifact = plan.retained.find((entry) => entry.file_name === artifact.file_name);
    const artifactPath = path.join(paths.safeRoot, artifact.file_name);
    fsOps.writeFileSync(artifactPath, plannedArtifact.content, { encoding: "utf8", mode: 0o600 });
    fsOps.chmodSync(artifactPath, 0o600);
  }
  fsOps.writeFileSync(temporarySummaryPath, serializedSummary, { encoding: "utf8", mode: 0o600 });
  fsOps.chmodSync(temporarySummaryPath, 0o600);
  fsOps.renameSync(temporarySummaryPath, paths.summaryPath);
  return summary;
}

async function startCli({
  argv,
  isMain,
  run,
  setExitCode,
  writeStderr,
} = {}) {
  if (!isMain) {
    return null;
  }
  try {
    const code = await run(argv);
    setExitCode(code);
    return code;
  } catch (error) {
    writeStderr(`desk-copilot-startup-smoke: ${error.message}\n`);
    setExitCode(1);
    return 1;
  }
}

module.exports = {
  STARTUP_PROMPT,
  buildSmokePlan,
  parseArgs,
  planSafeArtifacts,
  startCli,
  validateStartupResult,
  writeSafeArtifacts,
};

startCli();
