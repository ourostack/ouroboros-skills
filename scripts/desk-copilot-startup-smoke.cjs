#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
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
const EXPECTED_PLATFORM = "darwin";
const EXPECTED_ARCH = "arm64";
const EXPECTED_NODE_ABI = "127";
const EXPECTED_MODEL = "claude-sonnet-5";
const EXPECTED_RUNTIME_TARGET = "darwin-arm64-node-127";
const EXPECTED_SENTINEL = "DESK_STARTUP_READY";
const DESK_INITIALIZATION_FAILURE = "Failed to start MCP client for desk: Error: failed to connect to MCP server \"desk\": failed to initialize MCP client: connection closed: initialize response";
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
const PROCESS_PHASES = Object.freeze([
  ["git_init", "gitInit"],
  ["marketplace_add", "marketplaceAdd"],
  ["plugin_install", "pluginInstall"],
  ["copilot_live", "copilotLive"],
]);
const SUPERVISION_LIMITS = Object.freeze({
  childDeadlineMs: 90_000,
  debugBytes: 8_388_608,
  debugPollMs: 250,
  killVerifyMs: 2_000,
  stderrBytes: 1_048_576,
  stdoutBytes: 1_048_576,
  termGraceMs: 2_000,
  workflowBudgetMs: 600_000,
});

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
    processOutputs: {
      copilot_live: {
        stderr: path.join(resolvedRawRoot, "copilot.stderr.log"),
        stdout: path.join(resolvedRawRoot, "copilot.jsonl"),
      },
      git_init: {
        stderr: path.join(resolvedRawRoot, "git-init.stderr.log"),
        stdout: path.join(resolvedRawRoot, "git-init.stdout.log"),
      },
      marketplace_add: {
        stderr: path.join(resolvedRawRoot, "marketplace-add.stderr.log"),
        stdout: path.join(resolvedRawRoot, "marketplace-add.stdout.log"),
      },
      plugin_install: {
        stderr: path.join(resolvedRawRoot, "plugin-install.stderr.log"),
        stdout: path.join(resolvedRawRoot, "plugin-install.stdout.log"),
      },
    },
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
    failure_codes: ["harness_incomplete"],
    phase: "initializing",
    processes: PROCESS_PHASES.map(([phase]) => blankProcess(phase)),
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
    expected: {
      deskRoot: paths.deskRoot,
      model: EXPECTED_MODEL,
      nodeAbi: EXPECTED_NODE_ABI,
      runtimeCacheRoot: paths.runtimeCacheRoot,
      runtimeTarget: EXPECTED_RUNTIME_TARGET,
      sentinel: EXPECTED_SENTINEL,
    },
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

function countOccurrences(content, value) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(value, offset);
    if (index < 0) {
      return count;
    }
    count += 1;
    offset = index + value.length;
  }
}

function isClassifiedIncidentMessage(message) {
  return message.includes("NativeMcpHostHandle has been destroyed") ||
    message.includes("Unknown MCP host state handle:") ||
    /\bENOMEM\b/.test(message) ||
    message.includes("JavaScript heap out of memory");
}

function isAllowedDebugError(message, startupSucceeded) {
  if (
    message === DESK_INITIALIZATION_FAILURE ||
    message === "Starting MCP client for desk with command: node and args: ./mcp/index.js" ||
    message === "Connecting MCP client for desk..." ||
    message === "Started MCP client for desk" ||
    message === "Starting remote MCP client for github-mcp-server with url: https://api.enterprise.githubcopilot.com/mcp/readonly" ||
    message === "Connecting MCP client for github-mcp-server..." ||
    message === "MCP server github-mcp-server provided instructions: The GitHub MCP Server provides tools to interact with GitHub platform." ||
    message === "Started MCP client for remote server github-mcp-server" ||
    message === "GitHub MCP server configured after authentication" ||
    message === "MCP connection for github-mcp-server closed"
  ) {
    return true;
  }
  if (
    /^MCP client for (?:desk|github-mcp-server) connected, took \d+ms$/.test(message) ||
    /^Failed to shut down shell processes: Error: unknown taskRegistry handle \d+$/.test(message)
  ) {
    return true;
  }
  return startupSucceeded === true && message === "MCP connection for desk closed";
}

function evaluateIncidentSignatures({ sources, startupSucceeded }) {
  if (!Array.isArray(sources)) {
    throw new Error("incident sources must be an array");
  }
  const failures = new Set();
  let maximumInitializationFailures = 0;
  for (const source of sources) {
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.content !== "string" ||
      typeof source.fileName !== "string" ||
      typeof source.source !== "string"
    ) {
      throw new Error("incident source is invalid");
    }
    const { content } = source;
    for (const match of content.matchAll(/Static context is using (\d+(?:\.\d+)?)% of available input tokens\./g)) {
      if (Number(match[1]) >= 100) {
        failures.add("static_context_overflow");
      }
    }
    maximumInitializationFailures = Math.max(
      maximumInitializationFailures,
      countOccurrences(content, DESK_INITIALIZATION_FAILURE),
    );
    if (content.includes("NativeMcpHostHandle has been destroyed")) {
      failures.add("mcp_host_handle_destroyed");
    }
    if (content.includes("Unknown MCP host state handle:")) {
      failures.add("mcp_host_state_handle_unknown");
    }
    if (/\bENOMEM\b/.test(content)) {
      failures.add("process_out_of_memory");
    }
    if (content.includes("JavaScript heap out of memory")) {
      failures.add("javascript_heap_out_of_memory");
    }
    if (source.source === "jsonl") {
      const parsed = parseJsonl(content);
      for (const event of parsed.events) {
        if (
          event.type === "warning" &&
          event?.data?.message !== EXPECTED_REMOTE_WARNING
        ) {
          failures.add("unexpected_warning_event");
        }
        if (event.type === "error") {
          failures.add("unexpected_error_event");
        }
      }
    }
    if (source.source === "debug_log") {
      for (const line of content.split("\n")) {
        const match = line.match(/\[ERROR\]\s+(.*)$/);
        if (!match) {
          continue;
        }
        const message = match[1].trim();
        if (
          !isClassifiedIncidentMessage(message) &&
          !isAllowedDebugError(message, startupSucceeded)
        ) {
          failures.add("unexpected_debug_error");
        }
      }
    }
  }
  if (maximumInitializationFailures >= 2) {
    failures.add("mcp_initialization_retry_storm");
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

async function runSupervisedSmoke(plan, suppliedDependencies = {}) {
  const limits = suppliedDependencies.limits || SUPERVISION_LIMITS;
  const fsOps = suppliedDependencies.fsOps || {
    ...fs,
    ...defaultSupervisionFsOps(),
  };
  const dependencies = {
    clock: suppliedDependencies.clock || { nowMs: () => Date.now() },
    fsOps,
    kill: suppliedDependencies.kill || ((pid, signal) => process.kill(pid, signal)),
    runtime: suppliedDependencies.runtime || {
      abi: process.versions.modules,
      arch: process.arch,
      platform: process.platform,
    },
    spawn: suppliedDependencies.spawn || childProcess.spawn,
    timers: suppliedDependencies.timers || {
      clearTimeout,
      setTimeout,
    },
  };
  const processes = PROCESS_PHASES.map(([phase]) => blankProcess(phase));
  const failures = new Set();
  const outputs = new Map();
  const debugSnapshot = { entries: null };

  if (!validateSupervisionLimits(limits)) {
    addFailure(failures, "supervision_limits_invalid");
  } else {
    const hostFailure = runtimeFailure(dependencies.runtime);
    if (hostFailure) {
      addFailure(failures, hostFailure);
    }
  }

  if (failures.size === 0) {
    for (const [index, [phase, commandName]] of PROCESS_PHASES.entries()) {
      const phaseFailures = await runProcessPhase({
        command: plan.commands[commandName],
        dependencies,
        limits,
        outputs,
        paths: plan.paths,
        phase,
        record: processes[index],
        debugSnapshot,
      });
      for (const code of phaseFailures) {
        addFailure(failures, code);
      }
      if (phaseFailures.length > 0) {
        break;
      }
    }
  }

  if (failures.size === 0) {
    const liveOutput = outputs.get("copilot_live");
    const validationInput = {
      exitCode: processes[3].exit_code,
      expected: plan.expected,
      jsonl: Buffer.concat(liveOutput.stdout.chunks).toString("utf8"),
      stderr: Buffer.concat(liveOutput.stderr.chunks).toString("utf8"),
    };
    try {
      const validator = suppliedDependencies.validateStartupResult || validateStartupResult;
      const validation = validator(validationInput);
      if (!validation || !Array.isArray(validation.failure_codes)) {
        addFailure(failures, "validation_failed");
      } else {
        for (const code of validation.failure_codes) {
          addFailure(failures, code);
        }
        if (!validation.ok && validation.failure_codes.length === 0) {
          addFailure(failures, "validation_failed");
        }
      }
    } catch {
      addFailure(failures, "validation_failed");
    }
  }

  const startupSucceeded = failures.size === 0;
  let sources = [];
  try {
    if (suppliedDependencies.collectArtifacts) {
      sources = suppliedDependencies.collectArtifacts({
        limits: {
          debugBytes: limits.debugBytes,
          stderrBytes: limits.stderrBytes,
          stdoutBytes: limits.stdoutBytes,
        },
        paths: plan.paths,
        processes: processes.map((record) => ({ ...record })),
      });
      if (!Array.isArray(sources)) {
        throw new Error("artifact collector did not return an array");
      }
    } else {
      sources = defaultArtifactSources({
        debugEntries: debugSnapshot.entries,
        fsOps,
        includeDebug: !failures.has("copilot_live_debug_limit_exceeded")
          && !failures.has("copilot_live_debug_monitor_failed"),
        limits,
        outputs,
        paths: plan.paths,
      });
    }
  } catch {
    sources = [];
    addFailure(failures, "artifact_collection_failed");
  }

  try {
    const evaluator = suppliedDependencies.evaluateIncidentSignatures || evaluateIncidentSignatures;
    const evaluation = evaluator({ sources, startupSucceeded });
    if (
      !evaluation ||
      typeof evaluation.ok !== "boolean" ||
      !Array.isArray(evaluation.failure_codes) ||
      evaluation.failure_codes.some((code) => typeof code !== "string" || code.length === 0) ||
      evaluation.ok !== (evaluation.failure_codes.length === 0)
    ) {
      addFailure(failures, "incident_signature_evaluation_failed");
    } else {
      for (const code of evaluation.failure_codes) {
        addFailure(failures, code);
      }
    }
  } catch {
    addFailure(failures, "incident_signature_evaluation_failed");
  }

  const retainDebug = failures.size > 0;
  const publicationSources = retainDebug
    ? sources
    : sources.filter((source) => source.source !== "debug_log");
  let summary = resultSummary(processes, failures);
  try {
    if (typeof fsOps.publishSummary === "function") {
      await fsOps.publishSummary(summary, { sources: publicationSources });
    } else {
      summary = writeSupervisionArtifacts({
        fsOps,
        paths: plan.paths,
        retainDebug,
        secrets: plan.commands.copilotLive.options.env,
        sources,
        summary,
      });
    }
  } catch {
    addFailure(failures, "summary_publication_failed");
    summary = resultSummary(processes, failures);
  }
  return summary;
}

async function runCli(argv) {
  const parsed = parseArgs(argv);
  const plan = buildSmokePlan(
    { ...parsed, env: process.env },
    { fsOps: fs },
  );
  const result = await runSupervisedSmoke(plan, {
    fsOps: {
      ...fs,
      ...defaultSupervisionFsOps(),
    },
  });
  return result.ok ? 0 : 1;
}

async function startCli({
  argv = process.argv.slice(2),
  isMain = require.main === module,
  run = runCli,
  setExitCode = (code) => {
    process.exitCode = code;
  },
  writeStderr = (text) => {
    process.stderr.write(text);
  },
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

function blankProcess(phase) {
  return {
    cleanup_failed: false,
    debug_bytes: 0,
    exit_code: null,
    outcome: "not_started",
    phase,
    signal: null,
    stderr_bytes: 0,
    stdout_bytes: 0,
    timed_out: false,
  };
}

function addFailure(failures, code) {
  failures.add(code);
}

function resultSummary(processes, failures) {
  const failureCodes = [...failures].sort();
  return {
    failure_codes: failureCodes,
    ok: failureCodes.length === 0,
    phase: "complete",
    processes: processes.map((record) => ({ ...record })),
    schema_version: 1,
  };
}

function validateSupervisionLimits(limits) {
  const required = Object.keys(SUPERVISION_LIMITS);
  for (const key of required) {
    if (
      !Object.prototype.hasOwnProperty.call(limits, key)
      || !Number.isSafeInteger(limits[key])
      || limits[key] <= 0
    ) {
      return false;
    }
  }
  const worstCaseMs = PROCESS_PHASES.length * (
    limits.childDeadlineMs
    + limits.termGraceMs
    + limits.killVerifyMs
  );
  return worstCaseMs < limits.workflowBudgetMs;
}

function runtimeFailure(runtime) {
  if (runtime.platform !== EXPECTED_PLATFORM) {
    return "host_platform_mismatch";
  }
  if (runtime.arch !== EXPECTED_ARCH) {
    return "host_arch_mismatch";
  }
  if (runtime.abi !== EXPECTED_NODE_ABI) {
    return "host_abi_mismatch";
  }
  return null;
}

function listRegularFiles(root) {
  const entries = [];

  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        entries.push({ kind: "symlink", path: target, size: 0 });
      } else if (entry.isDirectory()) {
        visit(target);
      } else if (entry.isFile()) {
        entries.push({ kind: "file", path: target, size: fs.statSync(target).size });
      }
    }
  }

  visit(root);
  return entries;
}

function readBoundedFile({ maxBytes, target }) {
  const descriptor = fs.openSync(target, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(descriptor, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
}

function defaultSupervisionFsOps() {
  return {
    listDebugEntries({ root }) {
      return listRegularFiles(root);
    },
    openOutput({ target }) {
      return fs.createWriteStream(target, { flags: "w", mode: 0o600 });
    },
    readBoundedFile,
  };
}

function boundedDebugBytes(entries, limit) {
  let total = 0;
  for (const entry of entries) {
    if (entry?.kind !== "file") {
      continue;
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error("debug entry size is invalid");
    }
    total = Math.min(limit + 1, total + entry.size);
  }
  return total;
}

function defaultArtifactSources({
  debugEntries,
  fsOps,
  includeDebug,
  limits,
  outputs,
  paths,
}) {
  const sources = [];
  for (const [phase] of PROCESS_PHASES) {
    const phaseOutput = outputs.get(phase);
    if (!phaseOutput) {
      continue;
    }
    for (const streamName of ["stdout", "stderr"]) {
      const content = Buffer.concat(phaseOutput[streamName].chunks);
      if (content.length === 0) {
        continue;
      }
      const live = phase === "copilot_live";
      sources.push({
        content: content.toString("utf8"),
        fileName: path.basename(paths.processOutputs[phase][streamName]),
        source: live
          ? (streamName === "stdout" ? "jsonl" : "stderr")
          : `${phase}_${streamName}`,
      });
    }
  }

  if (!includeDebug) {
    return sources;
  }
  const entries = debugEntries || fsOps.listDebugEntries({ root: paths.logRoot });
  const debugBytes = boundedDebugBytes(entries, limits.debugBytes);
  if (debugBytes > limits.debugBytes) {
    throw new Error("debug evidence exceeds collection limit");
  }
  for (const entry of entries) {
    if (entry?.kind !== "file") {
      continue;
    }
    const content = Buffer.from(fsOps.readBoundedFile({
      maxBytes: limits.debugBytes + 1,
      target: entry.path,
    }));
    if (content.length > limits.debugBytes) {
      throw new Error("debug evidence grew beyond collection limit");
    }
    sources.push({
      content: content.toString("utf8"),
      fileName: path.basename(entry.path),
      source: "debug_log",
    });
  }
  return sources;
}

function writeSupervisionArtifacts({
  fsOps,
  paths,
  retainDebug = true,
  secrets,
  sources,
  summary,
}) {
  const secretValues = activeSecrets(secrets);
  const summaryTemporary = `${paths.summaryPath}.tmp`;
  const artifactPlan = planSafeArtifacts({
    reservedFileNames: [
      path.basename(paths.summaryPath),
      path.basename(summaryTemporary),
    ],
    secrets,
    sources,
  });
  const failures = new Set([
    ...summary.failure_codes,
    ...artifactPlan.failure_codes,
  ]);
  let retainedArtifacts = retainDebug
    ? artifactPlan.retained
    : artifactPlan.retained.filter((artifact) => artifact.source !== "debug_log");
  let finalSummary = {
    ...summary,
    failure_codes: [...failures].sort(),
    ok: failures.size === 0,
    omitted_files: artifactPlan.omitted,
    retained_files: retainedArtifacts.map(({ bytes, file_name, source }) => ({
      bytes,
      file_name,
      source,
    })),
  };
  let summaryContent = serializeSummary(finalSummary);
  if (Buffer.byteLength(summaryContent) > MAX_SUMMARY_BYTES) {
    retainedArtifacts = [];
    finalSummary = {
      failure_codes: ["summary_metadata_invalid"],
      ok: false,
      omitted_files: [],
      phase: summary.phase,
      processes: summary.processes,
      retained_files: [],
      schema_version: summary.schema_version,
    };
    summaryContent = serializeSummary(finalSummary);
  }
  if (includesSecret(summaryContent, secretValues)) {
    throw new Error("unable to produce secret-free summary");
  }

  const temporaryFiles = [];
  try {
    for (const file of retainedArtifacts) {
      const destination = path.join(paths.safeRoot, file.file_name);
      const temporary = `${destination}.tmp`;
      temporaryFiles.push(temporary);
      fsOps.writeFileSync(temporary, file.content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      fsOps.chmodSync(temporary, 0o600);
      fsOps.renameSync(temporary, destination);
      temporaryFiles.splice(temporaryFiles.indexOf(temporary), 1);
    }

    temporaryFiles.push(summaryTemporary);
    fsOps.writeFileSync(summaryTemporary, summaryContent, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fsOps.chmodSync(summaryTemporary, 0o600);
    fsOps.renameSync(summaryTemporary, paths.summaryPath);
    temporaryFiles.splice(temporaryFiles.indexOf(summaryTemporary), 1);
    return finalSummary;
  } catch (error) {
    for (const temporary of temporaryFiles) {
      try {
        fsOps.rmSync(temporary, { force: true });
      } catch {
        // Preserve the publication error.
      }
    }
    throw error;
  }
}

function safeTimerClear(timers, handle, onFailure) {
  if (handle === null || handle === undefined) {
    return;
  }
  try {
    timers.clearTimeout(handle);
  } catch {
    onFailure();
  }
}

function validProcessGroupPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0;
}

async function runProcessPhase({
  command,
  debugSnapshot,
  dependencies,
  limits,
  outputs,
  paths,
  phase,
  record,
}) {
  const {
    clock,
    fsOps,
    kill,
    spawn,
    timers,
  } = dependencies;
  const failures = new Set();
  let startedAt;
  try {
    startedAt = clock.nowMs();
  } catch {
    addFailure(failures, `${phase}_clock_failed`);
    record.outcome = "supervision_failure";
    return [...failures];
  }
  if (!Number.isFinite(startedAt)) {
    addFailure(failures, `${phase}_clock_invalid`);
    record.outcome = "supervision_failure";
    return [...failures];
  }

  let child;
  try {
    child = spawn(command.command, command.args, {
      ...command.options,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    addFailure(failures, `${phase}_spawn_failed`);
    record.outcome = "supervision_failure";
    return [...failures];
  }
  if (!child || !validProcessGroupPid(child.pid)) {
    addFailure(failures, `${phase}_invalid_pid`);
    record.outcome = "supervision_failure";
    return [...failures];
  }

  return new Promise((resolve) => {
    const state = {
      accepting: true,
      childClosed: false,
      cleanupDone: false,
      cleanupStarted: false,
      closeWaiters: new Set(),
      deadlineHandle: null,
      debugPollHandle: null,
      primaryFailure: null,
      resolved: false,
      terminatingSignal: null,
    };
    const phaseOutput = {};
    outputs.set(phase, phaseOutput);

    function clearTrackedTimer(name) {
      const handle = state[name];
      state[name] = null;
      safeTimerClear(timers, handle, () => {
        addFailure(failures, `${phase}_timer_clear_failed`);
      });
    }

    function notifyChildClosed() {
      for (const waiter of [...state.closeWaiters]) {
        waiter();
      }
      state.closeWaiters.clear();
    }

    function waitForDelayOrClose(delayMs) {
      if (state.childClosed) {
        return Promise.resolve("closed");
      }
      return new Promise((waitResolve, waitReject) => {
        let handle = null;
        let settled = false;
        const finish = (value) => {
          if (settled) {
            return;
          }
          settled = true;
          state.closeWaiters.delete(onClose);
          waitResolve(value);
        };
        const onClose = () => {
          safeTimerClear(timers, handle, () => {
            addFailure(failures, `${phase}_timer_clear_failed`);
          });
          finish("closed");
        };
        state.closeWaiters.add(onClose);
        try {
          handle = timers.setTimeout(() => finish("timer"), delayMs);
        } catch (error) {
          state.closeWaiters.delete(onClose);
          settled = true;
          waitReject(error);
        }
      });
    }

    async function terminateProcessGroup() {
      state.cleanupStarted = true;
      const processGroup = -child.pid;
      try {
        kill(processGroup, "SIGTERM");
        state.terminatingSignal = "SIGTERM";
      } catch (error) {
        if (error?.code === "ESRCH") {
          state.cleanupDone = true;
          return;
        }
        record.cleanup_failed = true;
        addFailure(failures, `${phase}_cleanup_failed`);
        state.cleanupDone = true;
        return;
      }

      let graceResult;
      try {
        graceResult = await waitForDelayOrClose(limits.termGraceMs);
      } catch {
        record.cleanup_failed = true;
        addFailure(failures, `${phase}_cleanup_failed`);
        state.cleanupDone = true;
        return;
      }
      if (graceResult === "closed") {
        state.cleanupDone = true;
        return;
      }

      let groupGone = false;
      try {
        kill(processGroup, 0);
      } catch (error) {
        groupGone = error?.code === "ESRCH";
        if (!groupGone) {
          record.cleanup_failed = true;
        }
      }
      if (groupGone) {
        state.cleanupDone = true;
        return;
      }

      try {
        kill(processGroup, "SIGKILL");
      } catch (error) {
        if (error?.code === "ESRCH") {
          state.cleanupDone = true;
          return;
        }
        record.cleanup_failed = true;
      }

      try {
        await waitForDelayOrClose(limits.killVerifyMs);
      } catch {
        record.cleanup_failed = true;
        addFailure(failures, `${phase}_cleanup_failed`);
        state.cleanupDone = true;
        return;
      }
      if (!state.childClosed) {
        try {
          kill(processGroup, 0);
          record.cleanup_failed = true;
        } catch (error) {
          if (error?.code !== "ESRCH") {
            record.cleanup_failed = true;
          }
        }
      }
      if (record.cleanup_failed) {
        addFailure(failures, `${phase}_cleanup_failed`);
      }
      state.cleanupDone = true;
    }

    function outputSettled() {
      return Object.values(phaseOutput).every((output) => output.sinkSettled);
    }

    function closeOutput(output, destroy = false) {
      if (!output || output.sinkSettled) {
        return;
      }
      output.endRequested = true;
      try {
        if (destroy && typeof output.sink.destroy === "function") {
          output.sink.destroy();
        } else {
          output.sink.end();
        }
      } catch {
        if (!state.primaryFailure) {
          state.primaryFailure = `${phase}_${output.name}_close_failed`;
          addFailure(failures, state.primaryFailure);
          record.outcome = "supervision_failure";
        }
        if (typeof output.sink.destroy === "function") {
          try {
            output.sink.destroy();
          } catch {
            output.sinkSettled = true;
          }
        } else {
          output.sinkSettled = true;
        }
      }
    }

    function closeAllOutputs(destroy = false) {
      for (const output of Object.values(phaseOutput)) {
        closeOutput(output, destroy);
      }
    }

    function finalize() {
      if (state.resolved) {
        return;
      }
      if (state.primaryFailure) {
        const cleanupSettled = state.cleanupDone
          || (state.childClosed && !state.cleanupStarted);
        if (!cleanupSettled || !outputSettled()) {
          return;
        }
      } else if (!state.childClosed || !outputSettled()) {
        return;
      }

      clearTrackedTimer("deadlineHandle");
      clearTrackedTimer("debugPollHandle");
      if (!state.primaryFailure && failures.size === 0) {
        let finishedAt;
        try {
          finishedAt = clock.nowMs();
        } catch {
          addFailure(failures, `${phase}_clock_failed`);
          record.outcome = "supervision_failure";
        }
        if (finishedAt !== undefined) {
          if (!Number.isFinite(finishedAt)) {
            addFailure(failures, `${phase}_clock_invalid`);
            record.outcome = "supervision_failure";
          } else if (finishedAt < startedAt) {
            addFailure(failures, `${phase}_clock_regressed`);
            record.outcome = "supervision_failure";
          }
        }
      }
      state.resolved = true;
      resolve([...failures]);
    }

    function beginFailure(code, {
      destroyOutputs = false,
      outcome = "supervision_failure",
      timedOut = false,
    } = {}) {
      if (state.primaryFailure || state.resolved) {
        return;
      }
      state.primaryFailure = code;
      state.accepting = false;
      addFailure(failures, code);
      record.outcome = outcome;
      record.timed_out = timedOut;
      clearTrackedTimer("debugPollHandle");
      closeAllOutputs(destroyOutputs);
      if (!state.childClosed) {
        void terminateProcessGroup().then(finalize);
      } else {
        state.cleanupDone = true;
        finalize();
      }
    }

    function measureDebug({ enforceLimit = true } = {}) {
      const entries = fsOps.listDebugEntries({ root: paths.logRoot });
      debugSnapshot.entries = entries;
      record.debug_bytes = boundedDebugBytes(entries, limits.debugBytes);
      if (enforceLimit && record.debug_bytes > limits.debugBytes) {
        void beginFailure(`${phase}_debug_limit_exceeded`, {
          outcome: "debug_limit",
        });
        return false;
      }
      return true;
    }

    function scheduleDebugPoll() {
      if (phase !== "copilot_live" || state.childClosed || state.primaryFailure) {
        return;
      }
      try {
        state.debugPollHandle = timers.setTimeout(async () => {
          state.debugPollHandle = null;
          if (state.childClosed || state.primaryFailure || state.resolved) {
            return;
          }
          try {
            if (measureDebug()) {
              scheduleDebugPoll();
            }
          } catch {
            await beginFailure(`${phase}_debug_monitor_failed`);
          }
        }, limits.debugPollMs);
      } catch {
        void beginFailure(`${phase}_timer_failed`);
      }
    }

    function setupOutput(name) {
      const target = paths.processOutputs[phase][name];
      let sink;
      try {
        sink = fsOps.openOutput({ target });
      } catch {
        void beginFailure(`${phase}_${name}_destination_failed`);
        return;
      }
      const output = {
        chunks: [],
        endRequested: false,
        name,
        sink,
        sinkSettled: false,
      };
      phaseOutput[name] = output;
      const source = child[name];
      const cap = limits[`${name}Bytes`];

      const settleSink = () => {
        if (output.sinkSettled) {
          return;
        }
        output.sinkSettled = true;
        finalize();
      };
      sink.once("finish", settleSink);
      sink.once("close", settleSink);
      sink.on("error", () => {
        if (!state.primaryFailure) {
          void beginFailure(`${phase}_${name}_destination_failed`);
        }
      });
      source.on("error", () => {
        if (!state.primaryFailure) {
          void beginFailure(`${phase}_${name}_stream_failed`);
        }
      });
      source.on("data", (value) => {
        if (!state.accepting || state.primaryFailure) {
          return;
        }
        const chunk = Buffer.from(value);
        const priorBytes = record[`${name}_bytes`];
        const nextBytes = Math.min(cap + 1, priorBytes + chunk.length);
        const acceptedBytes = Math.max(0, Math.min(chunk.length, cap - priorBytes));
        record[`${name}_bytes`] = nextBytes;
        if (acceptedBytes > 0) {
          const accepted = chunk.subarray(0, acceptedBytes);
          try {
            const ready = sink.write(accepted);
            output.chunks.push(Buffer.from(accepted));
            if (!ready && typeof source.pause === "function") {
              source.pause();
              sink.once("drain", () => {
                if (state.accepting && !state.primaryFailure && typeof source.resume === "function") {
                  source.resume();
                }
              });
            }
          } catch {
            void beginFailure(`${phase}_${name}_write_failed`);
            return;
          }
        }
        if (nextBytes > cap) {
          void beginFailure(`${phase}_${name}_limit_exceeded`, {
            outcome: `${name}_limit`,
          });
        }
      });
      source.once("end", () => {
        if (!output.endRequested) {
          closeOutput(output);
        }
      });
    }

    child.once("error", () => {
      if (!state.primaryFailure) {
        void beginFailure(`${phase}_child_error`);
      }
    });
    child.once("close", (exitCode, signal) => {
      state.childClosed = true;
      record.exit_code = exitCode;
      if (
        !state.primaryFailure
        || state.primaryFailure === `${phase}_timeout`
        || state.primaryFailure === `${phase}_child_error`
      ) {
        record.signal = signal;
      }
      clearTrackedTimer("debugPollHandle");
      notifyChildClosed();
      if (phase === "copilot_live" && !state.primaryFailure) {
        try {
          measureDebug();
        } catch {
          void beginFailure(`${phase}_debug_monitor_failed`);
        }
      }
      if (!state.primaryFailure) {
        if (signal !== null && signal !== undefined) {
          state.primaryFailure = `${phase}_signal_termination`;
          addFailure(failures, state.primaryFailure);
          record.outcome = "signal_failure";
        } else if (exitCode !== 0) {
          state.primaryFailure = `${phase}_exit_nonzero`;
          addFailure(failures, state.primaryFailure);
          record.outcome = "exit_failure";
        } else {
          record.outcome = "succeeded";
        }
      }
      if (state.primaryFailure) {
        state.cleanupDone = true;
      }
      finalize();
    });

    setupOutput("stdout");
    setupOutput("stderr");
    if (state.primaryFailure) {
      return;
    }
    try {
      state.deadlineHandle = timers.setTimeout(async () => {
        state.deadlineHandle = null;
        if (state.resolved || state.primaryFailure) {
          return;
        }
        if (state.childClosed) {
          const unsettled = Object.values(phaseOutput).find((output) => !output.sinkSettled);
          await beginFailure(`${phase}_${unsettled.name}_close_timeout`, {
            destroyOutputs: true,
          });
          return;
        }
        await beginFailure(`${phase}_timeout`, {
          outcome: "timeout",
          timedOut: true,
        });
      }, limits.childDeadlineMs);
    } catch {
      void beginFailure(`${phase}_timer_failed`);
      return;
    }

    if (phase === "copilot_live") {
      try {
        if (measureDebug({ enforceLimit: false })) {
          scheduleDebugPoll();
        }
      } catch {
        void beginFailure(`${phase}_debug_monitor_failed`);
      }
    }
  });
}

module.exports = {
  STARTUP_PROMPT,
  SUPERVISION_LIMITS,
  buildSmokePlan,
  parseArgs,
  planSafeArtifacts,
  evaluateIncidentSignatures,
  runSupervisedSmoke,
  startCli,
  validateStartupResult,
  writeSafeArtifacts,
};

startCli();
