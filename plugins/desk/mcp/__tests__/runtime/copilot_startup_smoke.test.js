import { strict as assert } from "node:assert"
import * as path from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const require = createRequire(import.meta.url)
const scriptPath = path.join(repoRoot, "scripts", "desk-copilot-startup-smoke.cjs")

const STARTUP_PROMPT = "This is an automated startup acceptance check. You must call the desk_status MCP tool exactly once. After the tool succeeds, reply with exactly DESK_STARTUP_READY and nothing else. Do not call any other tool."
const PINNED_COPILOT_PREFIX = [
  "--yes",
  "-p",
  "node@22.23.1",
  "-p",
  "@github/copilot@1.0.72-0",
  "copilot",
  "--no-auto-update",
]
const EXPECTED_REMOTE_WARNING = "could not load remote agents, no GitHub remote found"
const PINNED_MODEL = "claude-sonnet-5"
const PINNED_RUNTIME_TARGET = "darwin-arm64-node-127"
const PINNED_NODE_ABI = "127"

function missingProductionModule(error) {
  const emptyCommand = { command: "", args: [], options: { cwd: "", env: {} } }
  return {
    __loadError: error,
    STARTUP_PROMPT: "",
    buildSmokePlan() {
      return {
        commands: {
          copilotLive: emptyCommand,
          gitInit: emptyCommand,
          marketplaceAdd: emptyCommand,
          pluginInstall: emptyCommand,
        },
        environments: { live: {}, setup: {} },
        paths: {},
      }
    },
    parseArgs() {
      return {}
    },
    planSafeArtifacts() {
      return {}
    },
    async startCli() {},
    validateStartupResult() {
      return {}
    },
    writeSafeArtifacts() {
      return {}
    },
  }
}

function loadProductionModule() {
  try {
    return require(scriptPath)
  } catch (error) {
    if (error?.code !== "MODULE_NOT_FOUND" || !String(error.message).includes("desk-copilot-startup-smoke.cjs")) {
      throw error
    }
    return missingProductionModule(error)
  }
}

function createFakeFs({ candidateRoot, failMkdirAt = null, candidateIsDirectory = true } = {}) {
  const directories = new Set(candidateRoot ? [path.resolve(candidateRoot)] : [])
  const files = new Map()
  const operations = []

  return {
    directories,
    files,
    operations,
    fsOps: {
      statSync(target) {
        const resolved = path.resolve(target)
        operations.push({ operation: "stat", target: resolved })
        if (!directories.has(resolved)) {
          const error = new Error(`ENOENT: ${resolved}`)
          error.code = "ENOENT"
          throw error
        }
        return { isDirectory: () => candidateIsDirectory }
      },
      mkdirSync(target, options) {
        const resolved = path.resolve(target)
        operations.push({ operation: "mkdir", options, target: resolved })
        if (failMkdirAt && resolved === path.resolve(failMkdirAt)) {
          const error = new Error(`EACCES: ${resolved}`)
          error.code = "EACCES"
          throw error
        }
        directories.add(resolved)
      },
      writeFileSync(target, content, options) {
        const resolved = path.resolve(target)
        operations.push({ content: String(content), operation: "write", options, target: resolved })
        files.set(resolved, String(content))
      },
      renameSync(source, destination) {
        const resolvedSource = path.resolve(source)
        const resolvedDestination = path.resolve(destination)
        operations.push({ destination: resolvedDestination, operation: "rename", source: resolvedSource })
        if (!files.has(resolvedSource)) {
          const error = new Error(`ENOENT: ${resolvedSource}`)
          error.code = "ENOENT"
          throw error
        }
        files.set(resolvedDestination, files.get(resolvedSource))
        files.delete(resolvedSource)
      },
      chmodSync(target, mode) {
        operations.push({ mode, operation: "chmod", target: path.resolve(target) })
      },
    },
  }
}

function fixture() {
  const candidateRoot = "/repo/candidate checkout"
  const rawRoot = "/tmp/raw startup artifacts"
  const safeRoot = "/tmp/safe startup artifacts"
  const fake = createFakeFs({ candidateRoot })
  const env = {
    CI: "true",
    GH_TOKEN: "",
    GITHUB_TOKEN: "fixture-github-token",
    PATH: "/usr/local/bin:/usr/bin",
  }
  return { candidateRoot, env, fake, rawRoot, safeRoot }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validationFixture() {
  const deskRoot = "/tmp/raw startup artifacts/desk"
  const runtimeCacheRoot = "/tmp/raw startup artifacts/runtime-cache"
  const toolCallId = "tool-call-1"
  const mcpSnapshot = {
    type: "session.mcp_servers_loaded",
    data: {
      servers: [
        {
          name: "desk",
          pluginName: "desk",
          source: "plugin",
          status: "connected",
          transport: "stdio",
        },
        {
          name: "github-mcp-server",
          source: "builtin",
          status: "disabled",
          transport: "http",
        },
      ],
    },
  }
  const payload = {
    status: "ok",
    root: {
      path: deskRoot,
      source: "env:DESK",
    },
    runtime: {
      loaded_from_source_mirror: true,
      node: {
        abi: PINNED_NODE_ABI,
        arch: "arm64",
        platform: "darwin",
      },
      runtime_cache_dir: runtimeCacheRoot,
      target: PINNED_RUNTIME_TARGET,
    },
    startup_fallback: {
      budget_ms: 250,
      degraded: true,
      duration_ms: 348,
      mode: "startup_deferred",
    },
  }
  const events = [
    clone(mcpSnapshot),
    clone(mcpSnapshot),
    clone(mcpSnapshot),
    {
      type: "session.custom_agents_updated",
      data: {
        agents: [{ id: "desk:worker", source: "plugin" }],
        errors: [],
        warnings: [EXPECTED_REMOTE_WARNING],
      },
    },
    {
      type: "assistant.message",
      data: {
        content: "",
        model: PINNED_MODEL,
        toolRequests: [{ name: "desk-desk_status", toolCallId }],
      },
    },
    {
      type: "tool.execution_start",
      data: {
        arguments: {},
        mcpServerName: "desk",
        mcpToolName: "desk_status",
        model: PINNED_MODEL,
        toolCallId,
        toolName: "desk-desk_status",
      },
    },
    {
      type: "tool.execution_complete",
      data: {
        model: PINNED_MODEL,
        result: {
          content: JSON.stringify(payload),
        },
        success: true,
        toolCallId,
      },
    },
    {
      type: "assistant.message",
      data: {
        content: "DESK_STARTUP_READY",
        model: PINNED_MODEL,
        toolRequests: [],
      },
    },
  ]
  const expected = {
    deskRoot,
    model: PINNED_MODEL,
    nodeAbi: PINNED_NODE_ABI,
    runtimeCacheRoot,
    runtimeTarget: PINNED_RUNTIME_TARGET,
    sentinel: "DESK_STARTUP_READY",
  }
  return { events, expected, payload, toolCallId }
}

function validationInput(fixtureState, {
  events = fixtureState.events,
  exitCode = 0,
  stderr = "",
} = {}) {
  return {
    exitCode,
    expected: fixtureState.expected,
    jsonl: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    stderr,
  }
}

function updateToolPayload(events, update) {
  const complete = events.find((event) => event.type === "tool.execution_complete")
  const payload = JSON.parse(complete.data.result.content)
  update(payload)
  complete.data.result.content = JSON.stringify(payload)
}

function assertFailureCodes(smoke, fixtureState, expectedCodes, overrides = {}) {
  const result = smoke.validateStartupResult(validationInput(fixtureState, overrides))
  assert.equal(result.ok, false)
  assert.deepEqual(result.failure_codes, [...expectedCodes].sort())
  assert.deepEqual(result.failure_codes, [...result.failure_codes].sort())
}

test("buildSmokePlan records the exact outbound setup and live command contracts without spawning", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, fake, rawRoot, safeRoot } = fixture()
  let childInvocations = 0

  const plan = smoke.buildSmokePlan(
    { candidateRoot, env, rawRoot, safeRoot },
    {
      fsOps: fake.fsOps,
      runChild() {
        childInvocations += 1
      },
    },
  )

  const expectedPaths = {
    candidateRoot,
    copilotHome: path.join(rawRoot, "copilot-home"),
    cwd: path.join(rawRoot, "workspace"),
    deskRoot: path.join(rawRoot, "desk"),
    homeRoot: path.join(rawRoot, "home"),
    jsonlPath: path.join(rawRoot, "copilot.jsonl"),
    logRoot: path.join(rawRoot, "copilot-logs"),
    rawRoot,
    runtimeCacheRoot: path.join(rawRoot, "runtime-cache"),
    safeRoot,
    stderrPath: path.join(rawRoot, "copilot.stderr.log"),
    summaryPath: path.join(safeRoot, "summary.json"),
    xdgCacheHome: path.join(rawRoot, "xdg", "cache"),
    xdgConfigHome: path.join(rawRoot, "xdg", "config"),
    xdgDataHome: path.join(rawRoot, "xdg", "data"),
  }
  const expectedCommonEnv = {
    ...env,
    COPILOT_HOME: expectedPaths.copilotHome,
    DESK: expectedPaths.deskRoot,
    DESK_RUNTIME_CACHE_DIR: expectedPaths.runtimeCacheRoot,
    HOME: expectedPaths.homeRoot,
    XDG_CACHE_HOME: expectedPaths.xdgCacheHome,
    XDG_CONFIG_HOME: expectedPaths.xdgConfigHome,
    XDG_DATA_HOME: expectedPaths.xdgDataHome,
  }
  const expectedSetupEnv = { ...expectedCommonEnv }
  delete expectedSetupEnv.GH_TOKEN
  delete expectedSetupEnv.GITHUB_TOKEN

  assert.equal(plan.commands.gitInit.command, "git", "git setup must use the expected executable")
  assert.deepEqual(plan.paths, expectedPaths)
  assert.deepEqual(plan.environments, {
    live: expectedCommonEnv,
    setup: expectedSetupEnv,
  })
  assert.deepEqual(plan.commands.gitInit, {
    command: "git",
    args: ["init", "--initial-branch=main", "."],
    options: { cwd: expectedPaths.cwd, env: expectedSetupEnv },
  })
  assert.deepEqual(plan.commands.marketplaceAdd, {
    command: "npx",
    args: [...PINNED_COPILOT_PREFIX, "plugin", "marketplace", "add", candidateRoot],
    options: { cwd: expectedPaths.cwd, env: expectedSetupEnv },
  })
  assert.deepEqual(plan.commands.pluginInstall, {
    command: "npx",
    args: [...PINNED_COPILOT_PREFIX, "plugin", "install", "desk@ouroboros-skills"],
    options: { cwd: expectedPaths.cwd, env: expectedSetupEnv },
  })
  assert.deepEqual(plan.commands.copilotLive, {
    command: "npx",
    args: [
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
      `--log-dir=${expectedPaths.logRoot}`,
      "--output-format=json",
      "-p",
      STARTUP_PROMPT,
    ],
    options: { cwd: expectedPaths.cwd, env: expectedCommonEnv },
  })
  assert.equal(childInvocations, 0, "the Unit 1 builder must never launch a child or model")
  assert.equal(plan.commands.marketplaceAdd.args.at(-1), candidateRoot, "a checkout path containing spaces must remain one argv element")
  assert.equal(plan.commands.copilotLive.args.at(-1), STARTUP_PROMPT, "the complete prompt must remain one argv element")
})

test("buildSmokePlan creates isolated roots and precreates bounded safe metadata", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, fake, rawRoot, safeRoot } = fixture()

  const plan = smoke.buildSmokePlan({ candidateRoot, env, rawRoot, safeRoot }, { fsOps: fake.fsOps })

  const expectedDirectories = [
    plan.paths.rawRoot,
    plan.paths.safeRoot,
    plan.paths.homeRoot,
    plan.paths.copilotHome,
    plan.paths.xdgConfigHome,
    plan.paths.xdgCacheHome,
    plan.paths.xdgDataHome,
    plan.paths.deskRoot,
    plan.paths.runtimeCacheRoot,
    plan.paths.cwd,
    plan.paths.logRoot,
  ]
  for (const directory of expectedDirectories) {
    assert.ok(fake.directories.has(directory), `expected isolated directory ${directory}`)
  }
  assert.equal(path.dirname(plan.paths.summaryPath), plan.paths.safeRoot)
  assert.notEqual(path.dirname(plan.paths.jsonlPath), plan.paths.safeRoot)
  assert.notEqual(path.dirname(plan.paths.stderrPath), plan.paths.safeRoot)
  assert.deepEqual(JSON.parse(fake.files.get(plan.paths.summaryPath)), {
    failure_codes: [],
    phase: "initializing",
    schema_version: 1,
  })
  const summaryWrite = fake.operations.find((entry) => entry.operation === "write" && entry.target === plan.paths.summaryPath)
  assert.deepEqual(summaryWrite?.options, { encoding: "utf8", mode: 0o600 })
})

test("parseArgs preserves option boundaries and rejects malformed invocation", () => {
  const smoke = loadProductionModule()
  const candidateRoot = "/repo/a candidate --with-looking-option"
  const rawRoot = "/tmp/raw output"
  const safeRoot = "/tmp/safe output"

  assert.deepEqual(
    smoke.parseArgs([
      "--candidate-root",
      candidateRoot,
      "--raw-root",
      rawRoot,
      "--safe-root",
      safeRoot,
    ]),
    { candidateRoot, rawRoot, safeRoot },
  )
  assert.throws(
    () => smoke.parseArgs(["--candidate-root", candidateRoot, "--raw-root", rawRoot, "--unknown", "value"]),
    /unknown argument: --unknown/,
  )
  assert.throws(
    () => smoke.parseArgs(["--candidate-root", candidateRoot, "--raw-root"]),
    /--raw-root requires a value/,
  )
  assert.throws(
    () => smoke.parseArgs(["--candidate-root", candidateRoot, "--raw-root", rawRoot]),
    /--safe-root is required/,
  )
})

test("buildSmokePlan fails closed for a missing or non-directory candidate checkout", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, rawRoot, safeRoot } = fixture()
  const missing = createFakeFs()
  const notDirectory = createFakeFs({ candidateIsDirectory: false, candidateRoot })

  assert.throws(
    () => smoke.buildSmokePlan({ candidateRoot, env, rawRoot, safeRoot }, { fsOps: missing.fsOps }),
    /candidate checkout is not a directory: \/repo\/candidate checkout/,
  )
  assert.throws(
    () => smoke.buildSmokePlan({ candidateRoot, env, rawRoot, safeRoot }, { fsOps: notDirectory.fsOps }),
    /candidate checkout is not a directory: \/repo\/candidate checkout/,
  )
})

test("buildSmokePlan rejects empty secrets and non-separate output roots before setup", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, fake, rawRoot, safeRoot } = fixture()

  assert.throws(
    () => smoke.buildSmokePlan({
      candidateRoot,
      env: { GH_TOKEN: " ", GITHUB_TOKEN: "" },
      rawRoot,
      safeRoot,
    }, { fsOps: fake.fsOps }),
    /a non-empty GITHUB_TOKEN or GH_TOKEN is required/,
  )
  assert.throws(
    () => smoke.buildSmokePlan({
      candidateRoot,
      env: { GITHUB_TOKEN: "token" },
      rawRoot,
      safeRoot: path.join(rawRoot, "nested"),
    }, { fsOps: fake.fsOps }),
    /raw and safe roots must be separate non-overlapping directories/,
  )
  assert.throws(
    () => smoke.buildSmokePlan({
      candidateRoot,
      env: { GITHUB_TOKEN: "token" },
      rawRoot: "",
      safeRoot,
    }, { fsOps: fake.fsOps }),
    /rawRoot must be a non-empty path/,
  )
})

test("buildSmokePlan rejects candidate and output roots that overlap", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, fake, rawRoot, safeRoot } = fixture()

  assert.throws(
    () => smoke.buildSmokePlan({
      candidateRoot,
      env,
      rawRoot: candidateRoot,
      safeRoot,
    }, { fsOps: fake.fsOps }),
    /candidate checkout and output roots must be separate non-overlapping directories/,
  )
  assert.throws(
    () => smoke.buildSmokePlan({
      candidateRoot,
      env,
      rawRoot,
      safeRoot: path.join(candidateRoot, "safe"),
    }, { fsOps: fake.fsOps }),
    /candidate checkout and output roots must be separate non-overlapping directories/,
  )
})

test("buildSmokePlan surfaces an unwritable isolated root without launching setup", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, rawRoot, safeRoot } = fixture()
  const fake = createFakeFs({ candidateRoot, failMkdirAt: rawRoot })
  let childInvocations = 0

  assert.throws(
    () => smoke.buildSmokePlan(
      { candidateRoot, env, rawRoot, safeRoot },
      {
        fsOps: fake.fsOps,
        runChild() {
          childInvocations += 1
        },
      },
    ),
    /unable to create isolated root \/tmp\/raw startup artifacts: EACCES/,
  )
  assert.equal(childInvocations, 0)
})

test("startCli is inert on import and executes the supplied runner exactly once as main", async () => {
  const smoke = loadProductionModule()
  const argv = ["--candidate-root", "/candidate", "--raw-root", "/raw", "--safe-root", "/safe"]
  const runCalls = []
  const exitCodes = []
  const run = async (receivedArgv) => {
    runCalls.push(receivedArgv)
    return 0
  }

  await smoke.startCli({ argv, isMain: false, run, setExitCode: (code) => exitCodes.push(code) })
  assert.deepEqual(runCalls, [])
  assert.deepEqual(exitCodes, [])

  await smoke.startCli({ argv, isMain: true, run, setExitCode: (code) => exitCodes.push(code) })
  assert.deepEqual(runCalls, [argv])
  assert.deepEqual(exitCodes, [0])
})

test("startCli maps runner errors to a deterministic nonzero CLI outcome", async () => {
  const smoke = loadProductionModule()
  const exitCodes = []
  const stderr = []

  await smoke.startCli({
    argv: [],
    isMain: true,
    async run() {
      throw new Error("fixture runner failed")
    },
    setExitCode: (code) => exitCodes.push(code),
    writeStderr: (text) => stderr.push(text),
  })

  assert.deepEqual(exitCodes, [1])
  assert.deepEqual(stderr, ["desk-copilot-startup-smoke: fixture runner failed\n"])
})

test("validateStartupResult accepts the distilled healthy fixture and repeated identical MCP snapshots", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()
  fixtureState.events.at(-1).data.content = "\t DESK_STARTUP_READY \r\n"

  const result = smoke.validateStartupResult(validationInput(fixtureState))

  assert.equal(result.ok, true)
  assert.deepEqual(result.failure_codes, [])
})

test("validateStartupResult accepts a healthy degraded startup fallback after source-mirror restoration", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()
  updateToolPayload(fixtureState.events, (payload) => {
    payload.startup_fallback.degraded = true
    payload.startup_fallback.mode = "startup_deferred"
  })

  const result = smoke.validateStartupResult(validationInput(fixtureState))

  assert.equal(result.ok, true)
  assert.deepEqual(result.failure_codes, [])
})

test("validateStartupResult rejects absent or unhealthy MCP state with specific codes", () => {
  const smoke = loadProductionModule()
  const cases = [
    {
      expected: ["mcp_snapshot_missing"],
      mutate(events) {
        return events.filter((event) => event.type !== "session.mcp_servers_loaded")
      },
    },
    {
      expected: ["desk_mcp_not_connected"],
      mutate(events) {
        for (const event of events.filter((item) => item.type === "session.mcp_servers_loaded")) {
          event.data.servers.find((server) => server.name === "desk").status = "failed"
        }
        return events
      },
    },
    {
      expected: ["desk_mcp_not_plugin"],
      mutate(events) {
        for (const event of events.filter((item) => item.type === "session.mcp_servers_loaded")) {
          event.data.servers.find((server) => server.name === "desk").source = "builtin"
        }
        return events
      },
    },
    {
      expected: ["github_mcp_not_disabled"],
      mutate(events) {
        for (const event of events.filter((item) => item.type === "session.mcp_servers_loaded")) {
          event.data.servers.find((server) => server.name === "github-mcp-server").status = "connected"
        }
        return events
      },
    },
    {
      expected: [
        "desk_mcp_count_mismatch",
        "desk_mcp_not_connected",
        "desk_mcp_not_plugin",
        "github_mcp_count_mismatch",
        "github_mcp_not_disabled",
      ],
      mutate(events) {
        for (const event of events.filter((item) => item.type === "session.mcp_servers_loaded")) {
          delete event.data.servers
        }
        return events
      },
    },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = fixtureCase.mutate(clone(fixtureState.events))
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult requires repeated identical MCP snapshots", () => {
  const smoke = loadProductionModule()
  const cases = [
    {
      mutate(events) {
        return events.filter((event, index) => event.type !== "session.mcp_servers_loaded" || index === 0)
      },
    },
    {
      mutate(events) {
        events.findLast((event) => event.type === "session.mcp_servers_loaded").data.sequence = 2
        return events
      },
    },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = fixtureCase.mutate(clone(fixtureState.events))
    assertFailureCodes(smoke, fixtureState, ["mcp_snapshot_inconsistent"], { events })
  }
})

test("validateStartupResult rejects duplicate MCP identities that hide contradictory state", () => {
  const smoke = loadProductionModule()
  const cases = [
    {
      expected: ["desk_mcp_count_mismatch", "desk_mcp_not_connected"],
      mutate(server) {
        return { ...server, status: "failed" }
      },
      name: "desk",
    },
    {
      expected: ["github_mcp_count_mismatch", "github_mcp_not_disabled"],
      mutate(server) {
        return { ...server, status: "connected" }
      },
      name: "github-mcp-server",
    },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    for (const event of events.filter((item) => item.type === "session.mcp_servers_loaded")) {
      const original = event.data.servers.find((server) => server.name === fixtureCase.name)
      event.data.servers.push(fixtureCase.mutate(original))
    }
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult requires a present and consistently pinned model", () => {
  const smoke = loadProductionModule()

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    for (const event of events) {
      if (event.data && Object.hasOwn(event.data, "model")) {
        delete event.data.model
      }
    }
    assertFailureCodes(smoke, fixtureState, ["model_missing"], { events })
  }

  for (const conflictingOnly of [false, true]) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    const modelEvents = events.filter((event) => event.data?.model)
    for (const event of conflictingOnly ? modelEvents.slice(0, 1) : modelEvents) {
      event.data.model = "wrong-model"
    }
    assertFailureCodes(smoke, fixtureState, ["model_mismatch"], { events })
  }
})

test("validateStartupResult accepts only the expected remote-agent warning and no errors", () => {
  const smoke = loadProductionModule()
  const cases = [
    { errors: [], warnings: [], expected: ["unexpected_diagnostic"] },
    { errors: [], warnings: [EXPECTED_REMOTE_WARNING, "extra warning"], expected: ["unexpected_diagnostic"] },
    { errors: ["agent load failed"], warnings: [EXPECTED_REMOTE_WARNING], expected: ["unexpected_diagnostic"] },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    const diagnostic = events.find((event) => event.type === "session.custom_agents_updated")
    diagnostic.data.errors = fixtureCase.errors
    diagnostic.data.warnings = fixtureCase.warnings
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult rejects malformed and truncated JSONL without hiding other valid evidence", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()

  for (const malformedSuffix of ["not-json\n", "{\"type\":\"truncated\"\n"]) {
    const input = validationInput(fixtureState)
    input.jsonl += malformedSuffix
    const result = smoke.validateStartupResult(input)
    assert.equal(result.ok, false)
    assert.deepEqual(result.failure_codes, ["jsonl_malformed"])
  }
})

test("validateStartupResult requires exactly one matched Desk tool request, start, and completion", () => {
  const smoke = loadProductionModule()
  const cases = [
    {
      expected: ["tool_request_count_mismatch"],
      mutate(events) {
        events.find((event) => event.type === "assistant.message" && event.data.toolRequests.length > 0).data.toolRequests = []
        return events
      },
    },
    {
      expected: ["tool_request_count_mismatch"],
      mutate(events) {
        events.find((event) => event.type === "assistant.message" && event.data.toolRequests.length > 0).data.toolRequests.push({
          name: "desk-desk_status",
          toolCallId: "tool-call-2",
        })
        return events
      },
    },
    {
      expected: ["tool_start_count_mismatch"],
      mutate(events) {
        return events.filter((event) => event.type !== "tool.execution_start")
      },
    },
    {
      expected: ["tool_start_count_mismatch"],
      mutate(events) {
        events.push(clone(events.find((event) => event.type === "tool.execution_start")))
        return events
      },
    },
    {
      expected: ["tool_complete_count_mismatch"],
      mutate(events) {
        return events.filter((event) => event.type !== "tool.execution_complete")
      },
    },
    {
      expected: ["tool_complete_count_mismatch"],
      mutate(events) {
        events.push(clone(events.find((event) => event.type === "tool.execution_complete")))
        return events
      },
    },
    {
      expected: ["tool_call_mismatch"],
      mutate(events) {
        events.find((event) => event.type === "tool.execution_complete").data.toolCallId = "different-tool-call"
        return events
      },
    },
    {
      expected: ["tool_call_mismatch"],
      mutate(events) {
        events.find((event) => event.type === "tool.execution_start").data.toolName = "desk-desk_search"
        return events
      },
    },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = fixtureCase.mutate(clone(fixtureState.events))
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult requires a well-formed ordered tool lifecycle before the sentinel", () => {
  const smoke = loadProductionModule()

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.find((event) => event.type === "assistant.message" && event.data.toolRequests.length > 0).data.toolRequests = [null]
    assertFailureCodes(smoke, fixtureState, ["tool_call_mismatch"], { events })
  }

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.find((event) => event.type === "assistant.message" && event.data.toolRequests.length > 0).data.toolRequests[0].toolCallId = null
    events.find((event) => event.type === "tool.execution_start").data.toolCallId = null
    events.find((event) => event.type === "tool.execution_complete").data.toolCallId = null
    assertFailureCodes(smoke, fixtureState, ["tool_call_mismatch"], { events })
  }

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    const sentinel = events.pop()
    const completionIndex = events.findIndex((event) => event.type === "tool.execution_complete")
    events.splice(completionIndex, 0, sentinel)
    assertFailureCodes(smoke, fixtureState, ["tool_event_order_invalid"], { events })
  }
})

test("validateStartupResult rejects failed transport and invalid nested tool content", () => {
  const smoke = loadProductionModule()

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.find((event) => event.type === "tool.execution_complete").data.success = false
    assertFailureCodes(smoke, fixtureState, ["tool_transport_failed"], { events })
  }

  {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.find((event) => event.type === "tool.execution_complete").data.result.content = "{\"status\":"
    assertFailureCodes(smoke, fixtureState, ["tool_payload_invalid"], { events })
  }

  for (const content of ["null", "[]", "\"text\""]) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.find((event) => event.type === "tool.execution_complete").data.result.content = content
    assertFailureCodes(smoke, fixtureState, ["tool_payload_invalid"], { events })
  }
})

test("validateStartupResult rejects degraded and guarded diagnostic payload reasons", () => {
  const smoke = loadProductionModule()
  const cases = [
    { reason: undefined, expected: ["payload_status_not_ok"] },
    { reason: "no_compatible_node", expected: ["payload_reason_no_compatible_node", "payload_status_not_ok"] },
    { reason: "unsupported_target", expected: ["payload_reason_unsupported_target", "payload_status_not_ok"] },
    { reason: "guarded_reexec_failure", expected: ["payload_reason_guarded_reexec_failure", "payload_status_not_ok"] },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    updateToolPayload(events, (payload) => {
      payload.status = "degraded"
      if (fixtureCase.reason) {
        payload.reason = fixtureCase.reason
      }
    })
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult rejects missing restoration, runtime mismatch, and wrong isolated roots", () => {
  const smoke = loadProductionModule()
  const cases = [
    {
      expected: ["source_mirror_not_restored"],
      mutate(payload) {
        delete payload.runtime.loaded_from_source_mirror
      },
    },
    {
      expected: ["source_mirror_not_restored"],
      mutate(payload) {
        payload.runtime.loaded_from_source_mirror = false
      },
    },
    {
      expected: [
        "runtime_abi_mismatch",
        "runtime_cache_root_mismatch",
        "runtime_target_mismatch",
        "source_mirror_not_restored",
      ],
      mutate(payload) {
        delete payload.runtime
      },
    },
    {
      expected: ["runtime_target_mismatch"],
      mutate(payload) {
        payload.runtime.target = "darwin-arm64-node-115"
      },
    },
    {
      expected: ["runtime_abi_mismatch"],
      mutate(payload) {
        payload.runtime.node.abi = "115"
      },
    },
    {
      expected: ["desk_root_mismatch", "runtime_cache_root_mismatch"],
      mutate(payload) {
        payload.root.path = "/wrong/desk"
        payload.runtime.runtime_cache_dir = "/wrong/cache"
      },
    },
  ]

  for (const fixtureCase of cases) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    updateToolPayload(events, fixtureCase.mutate)
    assertFailureCodes(smoke, fixtureState, fixtureCase.expected, { events })
  }
})

test("validateStartupResult rejects the distilled ABI-mismatch fixture despite exit zero and sentinel success", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()
  const events = clone(fixtureState.events)
  updateToolPayload(events, (payload) => {
    delete payload.root
    payload.status = "degraded"
    payload.mode = "diagnostic"
    payload.reason = "no_compatible_node"
    payload.runtime = {
      current_target: {
        arch: "arm64",
        id: "darwin-arm64-node-115",
        node_abi: "115",
        platform: "darwin",
      },
      runtime_cache_path: fixtureState.expected.runtimeCacheRoot,
    }
  })

  assertFailureCodes(smoke, fixtureState, [
    "desk_root_mismatch",
    "payload_reason_no_compatible_node",
    "payload_status_not_ok",
    "runtime_abi_mismatch",
    "runtime_target_mismatch",
    "source_mirror_not_restored",
  ], { events })
})

test("validateStartupResult accepts only surrounding ASCII whitespace around the final sentinel", () => {
  const smoke = loadProductionModule()
  const rejected = [
    "",
    "DESK_STARTUP_READY extra",
    "DESK_STARTUP_NOT_READY",
    "\u00a0DESK_STARTUP_READY\u00a0",
  ]

  for (const content of rejected) {
    const fixtureState = validationFixture()
    const events = clone(fixtureState.events)
    events.at(-1).data.content = content
    assertFailureCodes(smoke, fixtureState, ["sentinel_mismatch"], { events })
  }
})

test("validateStartupResult rejects nonzero exit and nonempty stderr", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()

  assertFailureCodes(smoke, fixtureState, ["process_exit_nonzero"], { exitCode: 1 })
  assertFailureCodes(smoke, fixtureState, ["stderr_nonempty"], { stderr: "unexpected stderr\n" })
})

test("validateStartupResult returns a deterministic sorted complete multi-failure set", () => {
  const smoke = loadProductionModule()
  const fixtureState = validationFixture()
  const events = clone(fixtureState.events)
    .filter((event) => event.type !== "session.mcp_servers_loaded" && event.type !== "tool.execution_start")
  for (const event of events.filter((item) => item.data?.model)) {
    event.data.model = "wrong-model"
  }
  const diagnostic = events.find((event) => event.type === "session.custom_agents_updated")
  diagnostic.data.errors = ["agent error"]
  diagnostic.data.warnings = []
  const completion = events.find((event) => event.type === "tool.execution_complete")
  completion.data.success = false
  completion.data.result.content = "{"
  events.at(-1).data.content = "wrong sentinel"
  const input = validationInput(fixtureState, {
    events,
    exitCode: 9,
    stderr: "unexpected stderr\n",
  })
  input.jsonl += "truncated{\n"

  const result = smoke.validateStartupResult(input)

  assert.equal(result.ok, false)
  assert.deepEqual(result.failure_codes, [
    "jsonl_malformed",
    "mcp_snapshot_missing",
    "model_mismatch",
    "process_exit_nonzero",
    "sentinel_mismatch",
    "stderr_nonempty",
    "tool_payload_invalid",
    "tool_start_count_mismatch",
    "tool_transport_failed",
    "unexpected_diagnostic",
  ])
})

test("planSafeArtifacts retains clean bounded sources with deterministic metadata", () => {
  const smoke = loadProductionModule()
  const sources = [
    { content: "{\"type\":\"result\"}\n", fileName: "copilot.jsonl", source: "jsonl" },
    { content: "", fileName: "copilot.stderr.log", source: "stderr" },
    { content: "debug line\n", fileName: "copilot.debug.log", source: "debug_log" },
    { content: "{\"phase\":\"validation\"}\n", fileName: "diagnostics.json", source: "generated_diagnostics" },
  ]

  const result = smoke.planSafeArtifacts({
    secrets: { GH_TOKEN: "gh-token-clean-fixture", GITHUB_TOKEN: "github-token-clean-fixture" },
    sources,
  })

  assert.deepEqual(result.failure_codes, [])
  assert.deepEqual(result.omitted, [])
  assert.deepEqual(result.retained, sources.map((source) => ({
    bytes: Buffer.byteLength(source.content),
    content: source.content,
    file_name: source.fileName,
    source: source.source,
  })))
})

test("planSafeArtifacts rejects every source that shares a retained artifact filename", () => {
  const smoke = loadProductionModule()
  const sources = [
    { content: "first source", fileName: "duplicate.log", source: "debug_log" },
    { content: "second source", fileName: "duplicate.log", source: "generated_diagnostics" },
  ]

  const result = smoke.planSafeArtifacts({
    limits: { debug_log: 1024, generated_diagnostics: 1024 },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources,
  })

  assert.deepEqual(result.failure_codes, ["artifact_metadata_invalid"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, sources.map((source) => ({
    bytes: Buffer.byteLength(source.content),
    file_name: source.fileName,
    reason: "metadata_invalid",
    source: source.source,
  })))
})

test("planSafeArtifacts omits each secret-bearing source before retention", () => {
  const smoke = loadProductionModule()
  const sourceDefinitions = [
    { fileName: "copilot.jsonl", source: "jsonl" },
    { fileName: "copilot.stderr.log", source: "stderr" },
    { fileName: "copilot.debug.log", source: "debug_log" },
    { fileName: "diagnostics.json", source: "generated_diagnostics" },
  ]

  for (const secretSource of sourceDefinitions) {
    const githubToken = `github-token-${secretSource.source}`
    const ghToken = `gh-token-${secretSource.source}`
    const sources = sourceDefinitions.map((definition) => ({
      ...definition,
      content: definition.source === secretSource.source
        ? `prefix ${githubToken} middle ${ghToken} suffix`
        : `clean ${definition.source}`,
    }))

    const result = smoke.planSafeArtifacts({
      secrets: { GH_TOKEN: ghToken, GITHUB_TOKEN: githubToken },
      sources,
    })

    assert.deepEqual(result.failure_codes, ["secret_detected"])
    assert.deepEqual(result.omitted, [{
      bytes: Buffer.byteLength(sources.find((source) => source.source === secretSource.source).content),
      file_name: secretSource.fileName,
      reason: "secret_detected",
      source: secretSource.source,
    }])
    assert.deepEqual(
      result.retained.map((entry) => entry.source),
      sourceDefinitions.filter((definition) => definition.source !== secretSource.source).map((definition) => definition.source),
    )
    assert.equal(JSON.stringify(result).includes(githubToken), false)
    assert.equal(JSON.stringify(result).includes(ghToken), false)
  }
})

test("planSafeArtifacts omits oversized sources before retention", () => {
  const smoke = loadProductionModule()
  const source = {
    content: "123456",
    fileName: "copilot.jsonl",
    source: "jsonl",
  }

  const result = smoke.planSafeArtifacts({
    limits: { jsonl: 5 },
    secrets: { GH_TOKEN: "clean-gh-token", GITHUB_TOKEN: "clean-github-token" },
    sources: [source],
  })

  assert.deepEqual(result.failure_codes, ["artifact_size_limit_exceeded"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, [{
    bytes: 6,
    file_name: "copilot.jsonl",
    reason: "size_limit_exceeded",
    source: "jsonl",
  }])
})

test("planSafeArtifacts ignores whitespace-only alternate secret values", () => {
  const smoke = loadProductionModule()
  const source = {
    content: "clean diagnostics with spaces",
    fileName: "diagnostics.json",
    source: "generated_diagnostics",
  }

  const result = smoke.planSafeArtifacts({
    secrets: { GH_TOKEN: " ", GITHUB_TOKEN: "github-token-not-present" },
    sources: [source],
  })

  assert.deepEqual(result.failure_codes, [])
  assert.deepEqual(result.omitted, [])
  assert.equal(result.retained.length, 1)
})

test("planSafeArtifacts applies a fail-closed default bound to unknown source labels", () => {
  const smoke = loadProductionModule()
  const source = {
    content: "x".repeat((1024 * 1024) + 1),
    fileName: "future-diagnostic.log",
    source: "future_diagnostic",
  }

  const result = smoke.planSafeArtifacts({
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources: [source],
  })

  assert.deepEqual(result.failure_codes, ["artifact_size_limit_exceeded"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, [{
    bytes: Buffer.byteLength(source.content),
    file_name: "future-diagnostic.log",
    reason: "size_limit_exceeded",
    source: "future_diagnostic",
  }])
})

test("planSafeArtifacts withholds unsafe or secret-bearing artifact metadata", () => {
  const smoke = loadProductionModule()
  const githubToken = "github-token-in-artifact-metadata"
  const ghToken = "gh-token-in-artifact-metadata"
  const sources = [
    { content: "clean path content", fileName: "../escape.log", source: "debug_log" },
    { content: "clean name content", fileName: `${githubToken}.log`, source: "jsonl" },
    { content: "clean source content", fileName: "diagnostics.json", source: ghToken },
  ]

  const result = smoke.planSafeArtifacts({
    secrets: { GH_TOKEN: ghToken, GITHUB_TOKEN: githubToken },
    sources,
  })

  assert.deepEqual(result.failure_codes, ["artifact_metadata_invalid", "secret_detected"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, [
    {
      bytes: Buffer.byteLength(sources[0].content),
      file_name: "withheld",
      reason: "metadata_invalid",
      source: "debug_log",
    },
    {
      bytes: Buffer.byteLength(sources[1].content),
      file_name: "withheld",
      reason: "secret_detected",
      source: "jsonl",
    },
    {
      bytes: Buffer.byteLength(sources[2].content),
      file_name: "diagnostics.json",
      reason: "secret_detected",
      source: "withheld",
    },
  ])
  assert.equal(JSON.stringify(result).includes(githubToken), false)
  assert.equal(JSON.stringify(result).includes(ghToken), false)
})

test("writeSafeArtifacts retains clean diagnostics and atomically replaces the bounded safe summary", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")
  const sources = [
    { content: "{\"type\":\"result\"}\n", fileName: "copilot.jsonl", source: "jsonl" },
    { content: "", fileName: "copilot.stderr.log", source: "stderr" },
    { content: "debug line\n", fileName: "copilot.debug.log", source: "debug_log" },
    { content: "{\"phase\":\"validation\"}\n", fileName: "diagnostics.json", source: "generated_diagnostics" },
  ]
  const processMetadata = {
    exit_code: 0,
    signal: null,
    timed_out: false,
  }

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata,
    secrets: { GH_TOKEN: "clean-gh-token", GITHUB_TOKEN: "clean-github-token" },
    sources,
    validation: { failure_codes: [], ok: true },
  })

  assert.deepEqual(summary, {
    failure_codes: [],
    omitted_files: [],
    phase: "complete",
    process: processMetadata,
    retained_files: sources.map((source) => ({
      bytes: Buffer.byteLength(source.content),
      file_name: source.fileName,
      source: source.source,
    })),
    schema_version: 1,
  })
  for (const source of sources) {
    assert.equal(fake.files.get(path.join(safeRoot, source.fileName)), source.content)
  }
  assert.deepEqual(JSON.parse(fake.files.get(summaryPath)), summary)
  assert.equal(fake.files.has(`${summaryPath}.tmp`), false)
  assert.deepEqual(fake.operations.filter((operation) => operation.operation === "chmod").map((operation) => ({
    mode: operation.mode,
    target: operation.target,
  })), [
    ...sources.map((source) => ({
      mode: 0o600,
      target: path.join(safeRoot, source.fileName),
    })),
    {
      mode: 0o600,
      target: `${summaryPath}.tmp`,
    },
  ])
  assert.deepEqual(fake.operations.slice(-3).map((operation) => ({
    mode: operation.mode,
    operation: operation.operation,
    options: operation.options,
    source: operation.source,
    target: operation.target,
    destination: operation.destination,
  })), [
    {
      operation: "write",
      mode: undefined,
      options: { encoding: "utf8", mode: 0o600 },
      source: undefined,
      target: `${summaryPath}.tmp`,
      destination: undefined,
    },
    {
      operation: "chmod",
      mode: 0o600,
      options: undefined,
      source: undefined,
      target: `${summaryPath}.tmp`,
      destination: undefined,
    },
    {
      operation: "rename",
      mode: undefined,
      options: undefined,
      source: `${summaryPath}.tmp`,
      target: undefined,
      destination: summaryPath,
    },
  ])
})

test("writeSafeArtifacts always writes summary metadata while withholding secret-bearing content", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  const githubToken = "github-token-write-fixture"
  const ghToken = "gh-token-write-fixture"
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")
  const sources = [
    {
      content: `contains ${githubToken} and ${ghToken}`,
      fileName: "copilot.debug.log",
      source: "debug_log",
    },
    {
      content: "clean diagnostics",
      fileName: "diagnostics.json",
      source: "generated_diagnostics",
    },
  ]

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: { exit_code: 1, signal: "SIGTERM", timed_out: true },
    secrets: { GH_TOKEN: ghToken, GITHUB_TOKEN: githubToken },
    sources,
    validation: { failure_codes: ["sentinel_mismatch"], ok: false },
  })

  assert.deepEqual(summary.failure_codes, ["secret_detected", "sentinel_mismatch"])
  assert.deepEqual(summary.retained_files, [{
    bytes: Buffer.byteLength("clean diagnostics"),
    file_name: "diagnostics.json",
    source: "generated_diagnostics",
  }])
  assert.deepEqual(summary.omitted_files, [{
    bytes: Buffer.byteLength(sources[0].content),
    file_name: "copilot.debug.log",
    reason: "secret_detected",
    source: "debug_log",
  }])
  assert.equal(fake.files.has(path.join(safeRoot, "copilot.debug.log")), false)
  assert.equal(fake.files.get(path.join(safeRoot, "diagnostics.json")), "clean diagnostics")
  assert.deepEqual(JSON.parse(fake.files.get(summaryPath)), summary)
  assert.equal(JSON.stringify(summary).includes(githubToken), false)
  assert.equal(JSON.stringify(summary).includes(ghToken), false)
  assert.equal([...fake.files.values()].some((content) => content.includes(githubToken) || content.includes(ghToken)), false)
})

test("writeSafeArtifacts normalizes process metadata and never writes through an escaping filename", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  const token = "github-token-process-metadata"
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: {
      exit_code: "not-an-integer",
      leaked: token,
      signal: token,
      timed_out: "yes",
    },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: token },
    sources: [{ content: "clean", fileName: "../escaped.log", source: "debug_log" }],
    validation: { failure_codes: [], ok: false },
  })

  assert.deepEqual(summary.failure_codes, ["artifact_metadata_invalid", "process_metadata_invalid"])
  assert.deepEqual(summary.process, {
    exit_code: null,
    signal: null,
    timed_out: false,
  })
  assert.deepEqual(summary.retained_files, [])
  assert.deepEqual(summary.omitted_files, [{
    bytes: 5,
    file_name: "withheld",
    reason: "metadata_invalid",
    source: "debug_log",
  }])
  assert.equal(fake.files.has(path.resolve(safeRoot, "../escaped.log")), false)
  assert.equal(JSON.stringify(summary).includes(token), false)
  assert.equal([...fake.files.values()].some((content) => content.includes(token)), false)
})

test("writeSafeArtifacts scans the complete summary before writing any retained source", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  const token = "sentinel_mismatch"
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: { exit_code: 1, signal: null, timed_out: false },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: token },
    sources: [{ content: "clean", fileName: "diagnostics.json", source: "generated_diagnostics" }],
    validation: { failure_codes: [token], ok: false },
  })

  assert.deepEqual(summary, {
    failure_codes: ["secret_detected"],
    omitted_files: [],
    phase: "complete",
    process: {
      exit_code: 1,
      signal: null,
      timed_out: false,
    },
    retained_files: [],
    schema_version: 1,
  })
  assert.equal(fake.files.has(path.join(safeRoot, "diagnostics.json")), false)
  assert.equal(JSON.stringify(summary).includes(token), false)
  assert.deepEqual(fake.operations.filter((operation) => operation.operation === "write").map((operation) => operation.target), [`${summaryPath}.tmp`])
})

test("writeSafeArtifacts replaces an oversized summary with bounded failure metadata", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: { exit_code: 1, signal: null, timed_out: false },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources: [],
    validation: { failure_codes: ["x".repeat((256 * 1024) + 1)], ok: false },
  })

  assert.deepEqual(summary.failure_codes, ["summary_metadata_invalid"])
  assert.equal(Buffer.byteLength(fake.files.get(summaryPath)) < 1024, true)
})

test("writeSafeArtifacts refuses to replace the initializing summary when no secret-free complete summary is possible", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  const initializingSummary = "{\"phase\":\"initializing\"}\n"
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, initializingSummary)

  assert.throws(
    () => smoke.writeSafeArtifacts({
      fsOps: fake.fsOps,
      paths: { safeRoot, summaryPath },
      processMetadata: { exit_code: 1, signal: null, timed_out: false },
      secrets: { GH_TOKEN: "", GITHUB_TOKEN: "complete" },
      sources: [],
      validation: { failure_codes: ["complete"], ok: false },
    }),
    /unable to produce secret-free summary/,
  )
  assert.equal(fake.files.get(summaryPath), initializingSummary)
  assert.deepEqual(fake.operations, [])
})
