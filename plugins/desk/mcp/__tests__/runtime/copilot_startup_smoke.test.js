import { strict as assert } from "node:assert"
import { EventEmitter } from "node:events"
import * as path from "node:path"
import { createRequire } from "node:module"
import { PassThrough } from "node:stream"
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
const PROCESS_PHASES = ["git_init", "marketplace_add", "plugin_install", "copilot_live"]
const SUPERVISION_LIMITS = {
  childDeadlineMs: 90_000,
  debugBytes: 8_388_608,
  debugPollMs: 250,
  killVerifyMs: 2_000,
  stderrBytes: 1_048_576,
  stdoutBytes: 1_048_576,
  termGraceMs: 2_000,
  workflowBudgetMs: 600_000,
}

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
  }
}

function processRecord(phase, updates) {
  return { ...blankProcess(phase), ...updates }
}

function requireSupervisionApi(smoke) {
  if (typeof smoke.runSupervisedSmoke === "function") {
    return smoke.runSupervisedSmoke
  }
  return async () => ({
    failure_codes: ["supervision_not_implemented"],
    ok: false,
    phase: "not_implemented",
    processes: PROCESS_PHASES.map(blankProcess),
    schema_version: 1,
  })
}

function supervisionPlan() {
  const setupEnv = { CI: "true" }
  const liveEnv = { ...setupEnv, GITHUB_TOKEN: "fixture-token" }
  const cwd = "/fixture/workspace"
  const jsonlPath = "/fixture/raw/copilot.jsonl"
  const stderrPath = "/fixture/raw/copilot.stderr.log"
  return {
    commands: {
      copilotLive: { args: ["copilot-live"], command: "/fixture/npx", options: { cwd, env: liveEnv } },
      gitInit: { args: ["git-init"], command: "/fixture/git", options: { cwd, env: setupEnv } },
      marketplaceAdd: { args: ["marketplace-add"], command: "/fixture/npx", options: { cwd, env: setupEnv } },
      pluginInstall: { args: ["plugin-install"], command: "/fixture/npx", options: { cwd, env: setupEnv } },
    },
    expected: {
      deskRoot: "/fixture/raw/desk",
      model: PINNED_MODEL,
      nodeAbi: PINNED_NODE_ABI,
      runtimeCacheRoot: "/fixture/raw/runtime-cache",
      runtimeTarget: PINNED_RUNTIME_TARGET,
      sentinel: "DESK_STARTUP_READY",
    },
    paths: {
      jsonlPath,
      logRoot: "/fixture/raw/copilot-logs",
      processOutputs: {
        copilot_live: { stderr: stderrPath, stdout: jsonlPath },
        git_init: { stderr: "/fixture/raw/git-init.stderr.log", stdout: "/fixture/raw/git-init.stdout.log" },
        marketplace_add: { stderr: "/fixture/raw/marketplace-add.stderr.log", stdout: "/fixture/raw/marketplace-add.stdout.log" },
        plugin_install: { stderr: "/fixture/raw/plugin-install.stderr.log", stdout: "/fixture/raw/plugin-install.stdout.log" },
      },
      safeRoot: "/fixture/safe",
      stderrPath,
      summaryPath: "/fixture/safe/summary.json",
    },
  }
}

function fakeChild({ pid, onSpawn } = {}) {
  const child = new EventEmitter()
  child.pid = pid
  child.stderr = new PassThrough()
  child.stdout = new PassThrough()
  child.on("error", () => {})
  child.stderr.on("error", () => {})
  child.stdout.on("error", () => {})
  child.start = () => onSpawn?.(child)
  return child
}

function manualTimers() {
  const entries = []
  let nextId = 1
  return {
    clearTimeout(handle) {
      const entry = entries.find((candidate) => candidate.handle === handle)
      if (entry) {
        entry.cleared = true
      }
    },
    entries,
    async fireNext(delayMs) {
      const entry = entries.find((candidate) => !candidate.cleared && !candidate.fired && candidate.delayMs === delayMs)
      assert.ok(entry, `expected an active ${delayMs}ms timer`)
      entry.fired = true
      await entry.callback()
      await new Promise((resolve) => setImmediate(resolve))
    },
    setTimeout(callback, delayMs) {
      const handle = { id: nextId, unref() {} }
      nextId += 1
      entries.push({ callback, cleared: false, delayMs, fired: false, handle })
      return handle
    },
  }
}

function assertTimersSettled(timers) {
  assert.equal(
    timers.entries.every((entry) => entry.cleared || entry.fired),
    true,
    "every scheduled timer must be fired or cleared before supervision settles",
  )
}

function supervisionFs({
  debugContents = new Map(),
  debugEntries = [],
  debugReadErrorAt = null,
  openOutput,
} = {}) {
  const outputs = new Map()
  const published = []
  const publishedSources = []
  const readCalls = []
  const sinks = new Map()
  const fsOps = {
    listDebugEntries() {
      return typeof debugEntries === "function" ? debugEntries() : debugEntries
    },
    openOutput({ target }) {
      if (openOutput) {
        const sink = openOutput({ outputs, target })
        sinks.set(target, sink)
        return sink
      }
      const sink = new PassThrough()
      const chunks = []
      sink.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      sink.on("finish", () => outputs.set(target, Buffer.concat(chunks)))
      sinks.set(target, sink)
      return sink
    },
    readBoundedFile({ maxBytes, target }) {
      readCalls.push({ maxBytes, target })
      if (target === debugReadErrorAt) {
        const error = new Error(`unable to read ${target}`)
        error.code = "EACCES"
        throw error
      }
      if (!debugContents.has(target)) {
        const error = new Error(`missing debug fixture ${target}`)
        error.code = "ENOENT"
        throw error
      }
      const content = Buffer.from(debugContents.get(target))
      return content.subarray(0, maxBytes)
    },
    publishSummary(summary, { sources = [] } = {}) {
      published.push(clone(summary))
      publishedSources.push(clone(sources))
    },
  }
  return { fsOps, outputs, published, publishedSources, readCalls, sinks }
}

function supervisionDependencies({
  children = [],
  collectArtifacts,
  debugContents,
  debugEntries,
  debugReadErrorAt,
  kill,
  openOutput,
  timers = manualTimers(),
  validateStartupResult,
} = {}) {
  const calls = []
  const clock = { nowMs: () => 1_000 }
  const fileSystem = supervisionFs({
    debugContents,
    debugEntries,
    debugReadErrorAt,
    openOutput,
  })
  const state = { activeChildren: 0, maxActiveChildren: 0 }
  const spawn = (command, args, options) => {
    const child = children[calls.length]
    assert.ok(child, `unexpected spawn ${command}`)
    assert.equal(state.activeChildren, 0, "only one supervised child may be active")
    calls.push({ args, command, options })
    state.activeChildren += 1
    state.maxActiveChildren = Math.max(state.maxActiveChildren, state.activeChildren)
    child.once("close", () => {
      state.activeChildren -= 1
    })
    queueMicrotask(() => child.start())
    return child
  }
  const dependencies = {
    clock,
    fsOps: fileSystem.fsOps,
    kill: kill ?? (() => true),
    limits: SUPERVISION_LIMITS,
    runtime: { abi: PINNED_NODE_ABI, arch: "arm64", platform: "darwin" },
    spawn,
    timers: {
      clearTimeout: timers.clearTimeout,
      setTimeout: timers.setTimeout,
    },
    validateStartupResult: validateStartupResult ?? (() => ({ failure_codes: [], ok: true })),
  }
  if (collectArtifacts !== undefined) {
    dependencies.collectArtifacts = collectArtifacts
  }
  return {
    calls,
    dependencies,
    fileSystem,
    state,
    timers,
  }
}

function closeChild(child, code = 0, signal = null, { stderr = "", stdout = "" } = {}) {
  if (stdout) {
    child.stdout.write(stdout)
  }
  if (stderr) {
    child.stderr.write(stderr)
  }
  child.stdout.end()
  child.stderr.end()
  child.emit("close", code, signal)
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
    processOutputs: {
      copilot_live: {
        stderr: path.join(rawRoot, "copilot.stderr.log"),
        stdout: path.join(rawRoot, "copilot.jsonl"),
      },
      git_init: {
        stderr: path.join(rawRoot, "git-init.stderr.log"),
        stdout: path.join(rawRoot, "git-init.stdout.log"),
      },
      marketplace_add: {
        stderr: path.join(rawRoot, "marketplace-add.stderr.log"),
        stdout: path.join(rawRoot, "marketplace-add.stdout.log"),
      },
      plugin_install: {
        stderr: path.join(rawRoot, "plugin-install.stderr.log"),
        stdout: path.join(rawRoot, "plugin-install.stdout.log"),
      },
    },
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
    failure_codes: ["harness_incomplete"],
    phase: "initializing",
    processes: PROCESS_PHASES.map(blankProcess),
    schema_version: 1,
  })
  const summaryWrite = fake.operations.find((entry) => entry.operation === "write" && entry.target === plan.paths.summaryPath)
  assert.deepEqual(summaryWrite?.options, { encoding: "utf8", mode: 0o600 })
})

test("buildSmokePlan refuses to write an initializing summary containing a token value", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, fake, rawRoot, safeRoot } = fixture()
  env.GITHUB_TOKEN = "initializing"
  const summaryPath = path.join(path.resolve(safeRoot), "summary.json")

  assert.throws(
    () => smoke.buildSmokePlan({ candidateRoot, env, rawRoot, safeRoot }, { fsOps: fake.fsOps }),
    /unable to produce secret-free initializing summary/,
  )
  assert.equal(fake.files.has(summaryPath), false)
  assert.equal(fake.operations.some((entry) => entry.operation === "write"), false)
})

test("buildSmokePlan scans only declared token environment variables", () => {
  const smoke = loadProductionModule()
  const { candidateRoot, env, fake, rawRoot, safeRoot } = fixture()
  env.GITHUB_RUN_ATTEMPT = "1"

  const plan = smoke.buildSmokePlan(
    { candidateRoot, env, rawRoot, safeRoot },
    { fsOps: fake.fsOps },
  )

  assert.equal(fake.files.has(plan.paths.summaryPath), true)
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

test("validateStartupResult rejects parseable non-event JSONL records and non-JSON Unicode whitespace", () => {
  const smoke = loadProductionModule()
  const malformedRecords = [
    "null",
    "0",
    "\"junk\"",
    "[]",
    "{}",
    "{\"type\":null}",
    "{\"type\":\"\"}",
    "\u00a0",
  ]

  for (const malformedRecord of malformedRecords) {
    const fixtureState = validationFixture()
    const input = validationInput(fixtureState)
    input.jsonl = `${malformedRecord}\n${input.jsonl}`
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

test("planSafeArtifacts refuses missing declared token configuration", () => {
  const smoke = loadProductionModule()

  assert.throws(
    () => smoke.planSafeArtifacts({
      sources: [{ content: "unscanned", fileName: "copilot.jsonl", source: "jsonl" }],
    }),
    /a non-empty GITHUB_TOKEN or GH_TOKEN is required/,
  )
})

test("planSafeArtifacts rejects every source that shares a retained artifact filename", () => {
  const smoke = loadProductionModule()
  const sources = [
    { content: "first source", fileName: "duplicate.log", source: "debug_log" },
    { content: "second source", fileName: "DUPLICATE.LOG", source: "generated_diagnostics" },
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

test("planSafeArtifacts does not inherit artifact limits for prototype-named source labels", () => {
  const smoke = loadProductionModule()
  const source = {
    content: "x".repeat((1024 * 1024) + 1),
    fileName: "constructor.log",
    source: "constructor",
  }

  const result = smoke.planSafeArtifacts({
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources: [source],
  })

  assert.deepEqual(result.failure_codes, ["artifact_size_limit_exceeded"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, [{
    bytes: Buffer.byteLength(source.content),
    file_name: source.fileName,
    reason: "size_limit_exceeded",
    source: source.source,
  }])
})

test("planSafeArtifacts ignores inherited caller artifact limits", () => {
  const smoke = loadProductionModule()
  const limits = Object.create({ future_diagnostic: Number.MAX_SAFE_INTEGER })
  const source = {
    content: "x".repeat((1024 * 1024) + 1),
    fileName: "future-diagnostic.log",
    source: "future_diagnostic",
  }

  const result = smoke.planSafeArtifacts({
    limits,
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources: [source],
  })

  assert.deepEqual(result.failure_codes, ["artifact_size_limit_exceeded"])
  assert.deepEqual(result.retained, [])
  assert.deepEqual(result.omitted, [{
    bytes: Buffer.byteLength(source.content),
    file_name: source.fileName,
    reason: "size_limit_exceeded",
    source: source.source,
  }])
})

test("planSafeArtifacts rejects invalid explicit artifact limits", () => {
  const smoke = loadProductionModule()
  const invalidLimits = [-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1024", null, {}]

  for (const limit of invalidLimits) {
    const result = smoke.planSafeArtifacts({
      limits: { debug_log: limit },
      secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
      sources: [{ content: "clean", fileName: "copilot.debug.log", source: "debug_log" }],
    })

    assert.deepEqual(result.failure_codes, ["artifact_limit_invalid"])
    assert.deepEqual(result.retained, [])
    assert.deepEqual(result.omitted, [{
      bytes: 5,
      file_name: "copilot.debug.log",
      reason: "limit_invalid",
      source: "debug_log",
    }])
  }
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

test("writeSafeArtifacts refuses missing declared token configuration before writing", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")

  assert.throws(
    () => smoke.writeSafeArtifacts({
      fsOps: fake.fsOps,
      paths: { safeRoot, summaryPath },
      processMetadata: { exit_code: 0, signal: null, timed_out: false },
      sources: [{ content: "unscanned", fileName: "copilot.jsonl", source: "jsonl" }],
      validation: { failure_codes: [], ok: true },
    }),
    /a non-empty GITHUB_TOKEN or GH_TOKEN is required/,
  )
  assert.equal(fake.operations.some((operation) => operation.operation === "write"), false)
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

test("writeSafeArtifacts rejects sources that collide with summary control filenames", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  fake.directories.add(safeRoot)
  fake.files.set(summaryPath, "{\"phase\":\"initializing\"}\n")
  const sources = [
    { content: "summary collision", fileName: "summary.json", source: "generated_diagnostics" },
    { content: "temporary collision", fileName: "summary.json.tmp", source: "debug_log" },
  ]

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: { exit_code: 1, signal: null, timed_out: false },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources,
    validation: { failure_codes: [], ok: false },
  })

  assert.deepEqual(summary.failure_codes, ["artifact_metadata_invalid"])
  assert.deepEqual(summary.retained_files, [])
  assert.deepEqual(summary.omitted_files, sources.map((source) => ({
    bytes: Buffer.byteLength(source.content),
    file_name: source.fileName,
    reason: "metadata_invalid",
    source: source.source,
  })))
  assert.deepEqual(fake.operations.filter((operation) => operation.operation === "write").map((operation) => operation.target), [`${summaryPath}.tmp`])
  assert.deepEqual(JSON.parse(fake.files.get(summaryPath)), summary)
})

test("writeSafeArtifacts rejects case-variant summary collisions on case-insensitive filesystems", () => {
  const smoke = loadProductionModule()
  const safeRoot = "/tmp/safe startup artifacts"
  const summaryPath = path.join(safeRoot, "summary.json")
  const fake = createFakeFs()
  fake.directories.add(safeRoot)
  const sources = [
    { content: "summary collision", fileName: "SUMMARY.JSON", source: "generated_diagnostics" },
    { content: "temporary collision", fileName: "SUMMARY.JSON.TMP", source: "debug_log" },
  ]

  const summary = smoke.writeSafeArtifacts({
    fsOps: fake.fsOps,
    paths: { safeRoot, summaryPath },
    processMetadata: { exit_code: 1, signal: null, timed_out: false },
    secrets: { GH_TOKEN: "", GITHUB_TOKEN: "github-token-not-present" },
    sources,
    validation: { failure_codes: [], ok: false },
  })

  assert.deepEqual(summary.failure_codes, ["artifact_metadata_invalid"])
  assert.deepEqual(summary.retained_files, [])
  assert.deepEqual(summary.omitted_files.map((entry) => entry.reason), ["metadata_invalid", "metadata_invalid"])
  assert.equal(fake.files.has(path.join(safeRoot, "SUMMARY.JSON")), false)
  assert.equal(fake.files.has(path.join(safeRoot, "SUMMARY.JSON.TMP")), false)
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

test("Unit 1e freezes evidence-backed supervision limits and the complete four-child budget", () => {
  const smoke = loadProductionModule()
  requireSupervisionApi(smoke)

  assert.deepEqual(smoke.SUPERVISION_LIMITS, SUPERVISION_LIMITS, "production must export the frozen Unit 1e limits")
  assert.equal(typeof smoke.runSupervisedSmoke, "function", "production must export the injectable Unit 1e supervisor")
  assert.equal(Object.isFrozen(smoke.SUPERVISION_LIMITS), true)
  const worstCaseSupervisionMs = PROCESS_PHASES.length * (
    smoke.SUPERVISION_LIMITS.childDeadlineMs
    + smoke.SUPERVISION_LIMITS.termGraceMs
    + smoke.SUPERVISION_LIMITS.killVerifyMs
  )
  assert.equal(worstCaseSupervisionMs, 376_000)
  assert.ok(worstCaseSupervisionMs < smoke.SUPERVISION_LIMITS.workflowBudgetMs)
})

test("Unit 1e rejects malformed or unsafe injected limits before spawning", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const missingDeadline = { ...SUPERVISION_LIMITS }
  delete missingDeadline.childDeadlineMs
  const inheritedDeadline = Object.assign(
    Object.create({ childDeadlineMs: SUPERVISION_LIMITS.childDeadlineMs }),
    SUPERVISION_LIMITS,
  )
  delete inheritedDeadline.childDeadlineMs
  const cases = [
    ["missing required value", missingDeadline],
    ["inherited required value", inheritedDeadline],
    ["zero value", { ...SUPERVISION_LIMITS, debugPollMs: 0 }],
    ["negative value", { ...SUPERVISION_LIMITS, stderrBytes: -1 }],
    ["fractional value", { ...SUPERVISION_LIMITS, termGraceMs: 1.5 }],
    ["infinite value", { ...SUPERVISION_LIMITS, killVerifyMs: Number.POSITIVE_INFINITY }],
    ["unsafe integer value", { ...SUPERVISION_LIMITS, debugBytes: Number.MAX_SAFE_INTEGER + 1 }],
    ["non-numeric value", { ...SUPERVISION_LIMITS, stdoutBytes: "1048576" }],
    ["supervision exceeds workflow budget", { ...SUPERVISION_LIMITS, childDeadlineMs: 200_000 }],
  ]

  for (const [name, limits] of cases) {
    await t.test(name, async () => {
      const harness = supervisionDependencies()
      harness.dependencies.limits = limits

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.equal(result.ok, false)
      assert.deepEqual(result.failure_codes, ["supervision_limits_invalid"])
      assert.deepEqual(result.processes, PROCESS_PHASES.map(blankProcess))
      assert.deepEqual(harness.calls, [])
      assert.deepEqual(harness.fileSystem.published, [result])
      assert.deepEqual(harness.timers.entries, [])
    })
  }
})

test("Unit 1e refuses host platform, architecture, or ABI drift before spawning", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const cases = [
    { code: "host_platform_mismatch", field: "platform", value: "linux" },
    { code: "host_arch_mismatch", field: "arch", value: "x64" },
    { code: "host_abi_mismatch", field: "abi", value: "115" },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.field, async () => {
      const harness = supervisionDependencies()
      harness.dependencies.runtime[fixtureCase.field] = fixtureCase.value

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.equal(result.ok, false)
      assert.deepEqual(result.failure_codes, [fixtureCase.code])
      assert.deepEqual(result.processes, PROCESS_PHASES.map(blankProcess))
      assert.deepEqual(harness.calls, [])
      assert.deepEqual(harness.fileSystem.published, [result])
    })
  }
})

test("Unit 1e runs the four commands in exact order with one detached child at a time", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const plan = supervisionPlan()
  const children = PROCESS_PHASES.map((phase, index) => fakeChild({
    pid: 8_000 + index,
    onSpawn(child) {
      closeChild(child, 0, null, { stdout: `${phase}-ok\n` })
    },
  }))
  const harness = supervisionDependencies({ children })

  const result = await runSupervisedSmoke(plan, harness.dependencies)

  assert.deepEqual(harness.calls.map((call) => [call.command, call.args]), [
    ["/fixture/git", ["git-init"]],
    ["/fixture/npx", ["marketplace-add"]],
    ["/fixture/npx", ["plugin-install"]],
    ["/fixture/npx", ["copilot-live"]],
  ])
  const commands = [
    plan.commands.gitInit,
    plan.commands.marketplaceAdd,
    plan.commands.pluginInstall,
    plan.commands.copilotLive,
  ]
  for (const [index, call] of harness.calls.entries()) {
    assert.deepEqual(call.options, {
      ...commands[index].options,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
  }
  assert.equal(harness.state.maxActiveChildren, 1)
  assert.equal(result.ok, true)
  assert.equal(result.phase, "complete")
  assert.equal(result.schema_version, 1)
  assert.deepEqual(result.failure_codes, [])
  assert.deepEqual(result.processes, PROCESS_PHASES.map((phase) => processRecord(phase, {
    exit_code: 0,
    outcome: "succeeded",
    stdout_bytes: Buffer.byteLength(`${phase}-ok\n`),
  })))
  assert.deepEqual([...harness.fileSystem.outputs.keys()].sort(), Object.values(supervisionPlan().paths.processOutputs)
    .flatMap((streams) => Object.values(streams))
    .sort())
  assert.deepEqual(harness.fileSystem.published, [result])
})

test("Unit 1e validates only normally completed live output before publishing success", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  await t.test("the production validator accepts complete live evidence", async () => {
    const fixtureState = validationFixture()
    const liveInput = validationInput(fixtureState)
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_025 + index,
      onSpawn(child) {
        closeChild(child, 0, null, {
          stdout: index === 3 ? liveInput.jsonl : "",
        })
      },
    }))
    const harness = supervisionDependencies({ children })
    delete harness.dependencies.validateStartupResult
    const plan = supervisionPlan()
    plan.expected = fixtureState.expected

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.equal(result.ok, true)
    assert.deepEqual(result.failure_codes, [])
  })

  await t.test("the production validator rejects malformed live JSONL", async () => {
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_035 + index,
      onSpawn(child) {
        closeChild(child, 0, null, {
          stdout: index === 3 ? "not-json\n" : "",
        })
      },
    }))
    const harness = supervisionDependencies({ children })
    delete harness.dependencies.validateStartupResult

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.equal(result.ok, false)
    assert.equal(result.failure_codes.includes("jsonl_malformed"), true)
    assert.equal(harness.fileSystem.publishedSources.length, 1)
    assert.deepEqual(
      harness.fileSystem.publishedSources[0].find((source) => source.source === "jsonl"),
      { content: "not-json\n", fileName: "copilot.jsonl", source: "jsonl" },
    )
  })

  await t.test("the production validator rejects nonempty live stderr below its byte cap", async () => {
    const fixtureState = validationFixture()
    const liveInput = validationInput(fixtureState)
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_045 + index,
      onSpawn(child) {
        closeChild(child, 0, null, {
          stderr: index === 3 ? "unexpected stderr\n" : "",
          stdout: index === 3 ? liveInput.jsonl : "",
        })
      },
    }))
    const harness = supervisionDependencies({ children })
    delete harness.dependencies.validateStartupResult
    const plan = supervisionPlan()
    plan.expected = fixtureState.expected

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.equal(result.ok, false)
    assert.equal(result.failure_codes.includes("stderr_nonempty"), true)
  })

  await t.test("validation receives live JSONL and stderr rather than setup output", async () => {
    let validationInput
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_050 + index,
      onSpawn(child) {
        closeChild(child, 0, null, {
          stderr: index === 3 ? "" : `${phase}-setup-stderr\n`,
          stdout: index === 3 ? "{\"type\":\"live.fixture\"}\n" : `${phase}-setup-stdout\n`,
        })
      },
    }))
    const harness = supervisionDependencies({
      children,
      validateStartupResult(input) {
        validationInput = input
        return { failure_codes: ["sentinel_mismatch"], ok: false }
      },
    })
    const plan = supervisionPlan()

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(validationInput, {
      exitCode: 0,
      expected: plan.expected,
      jsonl: "{\"type\":\"live.fixture\"}\n",
      stderr: "",
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.failure_codes, ["sentinel_mismatch"])
    assert.deepEqual(harness.fileSystem.published, [result])
  })

  await t.test("validator exceptions fail closed", async () => {
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_060 + index,
      onSpawn(child) {
        closeChild(child)
      },
    }))
    const harness = supervisionDependencies({
      children,
      validateStartupResult() {
        throw new Error("validator failed")
      },
    })

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.equal(result.ok, false)
    assert.deepEqual(result.failure_codes, ["validation_failed"])
    assert.deepEqual(harness.fileSystem.published, [result])
  })
})

test("Unit 1e collects bounded raw evidence after validation and passes it to safe publication", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  await t.test("validation, collection, and publication happen in fail-closed order", async () => {
    const order = []
    const sources = [
      { content: "{\"type\":\"live.fixture\"}\n", fileName: "copilot.jsonl", source: "jsonl" },
      { content: "", fileName: "copilot.stderr.log", source: "stderr" },
    ]
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_070 + index,
      onSpawn(child) {
        closeChild(child, 0, null, {
          stdout: index === 3 ? "{\"type\":\"live.fixture\"}\n" : "",
        })
      },
    }))
    let collectionInput
    const harness = supervisionDependencies({
      children,
      collectArtifacts(input) {
        order.push("collect")
        collectionInput = input
        return sources
      },
      validateStartupResult() {
        order.push("validate")
        return { failure_codes: [], ok: true }
      },
    })
    const originalPublish = harness.dependencies.fsOps.publishSummary
    harness.dependencies.fsOps.publishSummary = (summary, options) => {
      order.push("publish")
      originalPublish(summary, options)
    }
    const plan = supervisionPlan()

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(order, ["validate", "collect", "publish"])
    assert.deepEqual(collectionInput, {
      limits: {
        debugBytes: SUPERVISION_LIMITS.debugBytes,
        stderrBytes: SUPERVISION_LIMITS.stderrBytes,
        stdoutBytes: SUPERVISION_LIMITS.stdoutBytes,
      },
      paths: plan.paths,
      processes: result.processes,
    })
    assert.deepEqual(harness.fileSystem.publishedSources, [sources])
    assert.deepEqual(harness.fileSystem.published, [result])
  })

  await t.test("production-default collection preserves failure diagnostics within stream caps", async () => {
    const child = fakeChild({
      pid: 8_075,
      onSpawn(spawned) {
        closeChild(spawned, 17, null, {
          stderr: "setup stderr\n",
          stdout: "setup stdout\n",
        })
      },
    })
    const harness = supervisionDependencies({ children: [child] })

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.deepEqual(result.failure_codes, ["git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.publishedSources, [[
      {
        content: "setup stdout\n",
        fileName: "git-init.stdout.log",
        source: "git_init_stdout",
      },
      {
        content: "setup stderr\n",
        fileName: "git-init.stderr.log",
        source: "git_init_stderr",
      },
    ]])
    assert.deepEqual(harness.fileSystem.published, [result])
  })

  await t.test("production-default collection reads regular debug diagnostics through a bounded seam", async () => {
    const plan = supervisionPlan()
    const debugPath = path.join(plan.paths.logRoot, "copilot.debug.log")
    const debugContent = "debug details\n"
    const child = fakeChild({
      pid: 8_076,
      onSpawn(spawned) {
        closeChild(spawned, 17, null, {
          stderr: "setup stderr\n",
          stdout: "setup stdout\n",
        })
      },
    })
    const harness = supervisionDependencies({
      children: [child],
      debugContents: new Map([[debugPath, debugContent]]),
      debugEntries: [{ kind: "file", path: debugPath, size: Buffer.byteLength(debugContent) }],
    })

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(result.failure_codes, ["git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.readCalls, [{
      maxBytes: SUPERVISION_LIMITS.debugBytes + 1,
      target: debugPath,
    }])
    assert.deepEqual(harness.fileSystem.publishedSources, [[
      {
        content: "setup stdout\n",
        fileName: "git-init.stdout.log",
        source: "git_init_stdout",
      },
      {
        content: "setup stderr\n",
        fileName: "git-init.stderr.log",
        source: "git_init_stderr",
      },
      {
        content: debugContent,
        fileName: "copilot.debug.log",
        source: "debug_log",
      },
    ]])
  })

  await t.test("production-default collection rejects oversized debug diagnostics before reading", async () => {
    const plan = supervisionPlan()
    const debugPath = path.join(plan.paths.logRoot, "oversized.log")
    const child = fakeChild({
      pid: 8_076,
      onSpawn(spawned) {
        closeChild(spawned, 17)
      },
    })
    const harness = supervisionDependencies({
      children: [child],
      debugEntries: [{ kind: "file", path: debugPath, size: SUPERVISION_LIMITS.debugBytes + 1 }],
    })

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(result.failure_codes, ["artifact_collection_failed", "git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.readCalls, [])
    assert.deepEqual(harness.fileSystem.publishedSources, [[]])
  })

  await t.test("production-default collection detects debug growth after stat without reading past cap plus one", async () => {
    const plan = supervisionPlan()
    const debugPath = path.join(plan.paths.logRoot, "grew-after-stat.log")
    const child = fakeChild({
      pid: 8_076,
      onSpawn(spawned) {
        closeChild(spawned, 17)
      },
    })
    const harness = supervisionDependencies({
      children: [child],
      debugContents: new Map([[debugPath, Buffer.alloc(SUPERVISION_LIMITS.debugBytes + 1, 0x61)]]),
      debugEntries: [{ kind: "file", path: debugPath, size: 16 }],
    })

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(result.failure_codes, ["artifact_collection_failed", "git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.readCalls, [{
      maxBytes: SUPERVISION_LIMITS.debugBytes + 1,
      target: debugPath,
    }])
    assert.deepEqual(harness.fileSystem.publishedSources, [[]])
  })

  await t.test("production-default collection fails closed when bounded debug reading fails", async () => {
    const plan = supervisionPlan()
    const debugPath = path.join(plan.paths.logRoot, "unreadable.log")
    const child = fakeChild({
      pid: 8_076,
      onSpawn(spawned) {
        closeChild(spawned, 17)
      },
    })
    const harness = supervisionDependencies({
      children: [child],
      debugEntries: [{ kind: "file", path: debugPath, size: 16 }],
      debugReadErrorAt: debugPath,
    })

    const result = await runSupervisedSmoke(plan, harness.dependencies)

    assert.deepEqual(result.failure_codes, ["artifact_collection_failed", "git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.readCalls, [{
      maxBytes: SUPERVISION_LIMITS.debugBytes + 1,
      target: debugPath,
    }])
    assert.deepEqual(harness.fileSystem.publishedSources, [[]])
  })

  await t.test("production-default publication uses the secret-scanning atomic safe writer", async () => {
    const plan = supervisionPlan()
    const child = fakeChild({
      pid: 8_077,
      onSpawn(spawned) {
        closeChild(spawned, 17, null, {
          stderr: "setup stderr\n",
          stdout: "setup fixture-token stdout\n",
        })
      },
    })
    const harness = supervisionDependencies({ children: [child] })
    const nativeFs = createFakeFs()
    nativeFs.directories.add(plan.paths.safeRoot)
    nativeFs.files.set(plan.paths.summaryPath, "{\"failure_codes\":[\"harness_incomplete\"],\"phase\":\"initializing\"}\n")
    delete harness.dependencies.fsOps.publishSummary
    Object.assign(harness.dependencies.fsOps, nativeFs.fsOps)

    const result = await runSupervisedSmoke(plan, harness.dependencies)
    const storedSummary = JSON.parse(nativeFs.files.get(plan.paths.summaryPath))

    assert.deepEqual(storedSummary, result)
    assert.deepEqual(result.failure_codes, ["git_init_exit_nonzero", "secret_detected"])
    assert.deepEqual(result.retained_files, [
      { bytes: 13, file_name: "git-init.stderr.log", source: "git_init_stderr" },
    ])
    assert.deepEqual(result.omitted_files, [{
      bytes: Buffer.byteLength("setup fixture-token stdout\n"),
      file_name: "git-init.stdout.log",
      reason: "secret_detected",
      source: "git_init_stdout",
    }])
    assert.equal(nativeFs.files.has(path.join(plan.paths.safeRoot, "git-init.stdout.log")), false)
    assert.equal(nativeFs.files.get(path.join(plan.paths.safeRoot, "git-init.stderr.log")), "setup stderr\n")
    assert.equal([...nativeFs.files.values()].some((content) => content.includes("fixture-token")), false)
    assert.equal(
      nativeFs.operations.filter((entry) => entry.operation === "chmod").every((entry) => entry.mode === 0o600),
      true,
    )
    assert.deepEqual(nativeFs.operations.at(-1), {
      destination: plan.paths.summaryPath,
      operation: "rename",
      source: `${plan.paths.summaryPath}.tmp`,
    })
  })

  await t.test("collection failure is explicit and publishes no unscanned source", async () => {
    const child = fakeChild({
      pid: 8_080,
      onSpawn(spawned) {
        closeChild(spawned, 17)
      },
    })
    const harness = supervisionDependencies({
      children: [child],
      collectArtifacts() {
        throw new Error("stat failed")
      },
    })

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.equal(result.ok, false)
    assert.deepEqual(result.failure_codes, ["artifact_collection_failed", "git_init_exit_nonzero"])
    assert.deepEqual(harness.fileSystem.publishedSources, [[]])
    assert.deepEqual(harness.fileSystem.published, [result])
  })
})

test("Unit 1e fails closed when any phase cannot spawn", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  for (const phase of PROCESS_PHASES) {
    await t.test(phase, async () => {
      const failedIndex = PROCESS_PHASES.indexOf(phase)
      const children = PROCESS_PHASES.slice(0, failedIndex).map((childPhase, index) => fakeChild({
        pid: 8_090 + index,
        onSpawn(child) {
          closeChild(child)
        },
      }))
      const harness = supervisionDependencies({ children })
      const successfulSpawn = harness.dependencies.spawn
      const attempts = []
      harness.dependencies.spawn = (command, args, options) => {
        attempts.push({ args, command, options })
        if (attempts.length - 1 === failedIndex) {
          throw new Error("spawn failed")
        }
        return successfulSpawn(command, args, options)
      }

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.equal(result.ok, false)
      assert.deepEqual(result.failure_codes, [`${phase}_spawn_failed`])
      assert.equal(attempts.length, failedIndex + 1)
      assert.equal(harness.calls.length, failedIndex)
      assert.deepEqual(result.processes.slice(0, failedIndex), PROCESS_PHASES.slice(0, failedIndex).map((successfulPhase) => (
        processRecord(successfulPhase, { exit_code: 0, outcome: "succeeded" })
      )))
      assert.deepEqual(result.processes[failedIndex], processRecord(phase, {
        outcome: "supervision_failure",
      }))
      assert.deepEqual(result.processes.slice(failedIndex + 1), PROCESS_PHASES.slice(failedIndex + 1).map(blankProcess))
      assert.equal([...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded), true)
      assert.deepEqual(harness.fileSystem.published, [result])
      assertTimersSettled(harness.timers)
    })
  }
})

test("Unit 1e stops after every setup or live exit and signal failure", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const cases = [
    { code: 19, failureSuffix: "exit_nonzero", outcome: "exit_failure", signal: null },
    { code: null, failureSuffix: "signal_termination", outcome: "signal_failure", signal: "SIGABRT" },
  ]

  for (const phase of PROCESS_PHASES) {
    for (const fixtureCase of cases) {
      await t.test(`${phase} ${fixtureCase.failureSuffix}`, async () => {
        const failedIndex = PROCESS_PHASES.indexOf(phase)
        const children = PROCESS_PHASES.slice(0, failedIndex + 1).map((childPhase, index) => fakeChild({
          pid: 8_100 + index,
          onSpawn(child) {
            if (index === failedIndex) {
              closeChild(child, fixtureCase.code, fixtureCase.signal)
            } else {
              closeChild(child)
            }
          },
        }))
        const harness = supervisionDependencies({ children })

        const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

        assert.equal(result.ok, false)
        assert.deepEqual(result.failure_codes, [`${phase}_${fixtureCase.failureSuffix}`])
        assert.equal(harness.calls.length, failedIndex + 1)
        assert.deepEqual(result.processes.slice(failedIndex + 1), PROCESS_PHASES.slice(failedIndex + 1).map(blankProcess))
        assert.deepEqual(result.processes[failedIndex], processRecord(phase, {
          exit_code: fixtureCase.code,
          outcome: fixtureCase.outcome,
          signal: fixtureCase.signal,
        }))
        assert.deepEqual(harness.fileSystem.published, [result])
      })
    }
  }
})

test("Unit 1e terminates and records a child error in every phase", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  for (const phase of PROCESS_PHASES) {
    await t.test(phase, async () => {
      const failedIndex = PROCESS_PHASES.indexOf(phase)
      let failedChild
      const children = PROCESS_PHASES.slice(0, failedIndex + 1).map((childPhase, index) => fakeChild({
        pid: 8_175 + index,
        onSpawn(child) {
          if (index === failedIndex) {
            failedChild = child
            child.emit("error", new Error("child failed"))
          } else {
            closeChild(child)
          }
        },
      }))
      const killCalls = []
      const harness = supervisionDependencies({
        children,
        kill(pid, signal) {
          killCalls.push({ pid, signal })
          if (signal === "SIGTERM") {
            queueMicrotask(() => closeChild(failedChild, null, "SIGTERM"))
          }
          return true
        },
      })

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.equal(result.ok, false)
      assert.deepEqual(result.failure_codes, [`${phase}_child_error`])
      assert.deepEqual(killCalls, [{ pid: -failedChild.pid, signal: "SIGTERM" }])
      assert.equal(harness.calls.length, failedIndex + 1)
      assert.deepEqual(result.processes[failedIndex], processRecord(phase, {
        outcome: "supervision_failure",
        signal: "SIGTERM",
      }))
      assert.deepEqual(result.processes.slice(failedIndex + 1), PROCESS_PHASES.slice(failedIndex + 1).map(blankProcess))
      assert.deepEqual(harness.fileSystem.published, [result])
      assertTimersSettled(harness.timers)
    })
  }
})

test("Unit 1e gives every child a fresh independent deadline and stops on that phase", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  for (const phase of PROCESS_PHASES) {
    await t.test(phase, async () => {
      const timedIndex = PROCESS_PHASES.indexOf(phase)
      let timedChild
      const children = PROCESS_PHASES.slice(0, timedIndex + 1).map((childPhase, index) => fakeChild({
        pid: 8_200 + index,
        onSpawn(child) {
          if (index === timedIndex) {
            timedChild = child
          } else {
            closeChild(child)
          }
        },
      }))
      const killCalls = []
      const harness = supervisionDependencies({
        children,
        kill(pid, signal) {
          killCalls.push({ pid, signal })
          if (signal === "SIGTERM") {
            queueMicrotask(() => closeChild(timedChild, null, "SIGTERM"))
          }
          return true
        },
      })
      const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
      await new Promise((resolve) => setImmediate(resolve))

      const deadlines = harness.timers.entries.filter((entry) => entry.delayMs === SUPERVISION_LIMITS.childDeadlineMs)
      assert.equal(deadlines.length, timedIndex + 1)
      assert.equal(deadlines.slice(0, -1).every((entry) => entry.cleared), true)
      await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
      const result = await running

      assert.deepEqual(killCalls, [{ pid: -timedChild.pid, signal: "SIGTERM" }])
      assert.equal(harness.calls.length, timedIndex + 1)
      assert.deepEqual(result.failure_codes, [`${phase}_timeout`])
      assert.deepEqual(result.processes[timedIndex], processRecord(phase, {
        outcome: "timeout",
        signal: "SIGTERM",
        timed_out: true,
      }))
      assertTimersSettled(harness.timers)
    })
  }
})

test("Unit 1e escalates only the timed child process group and verifies it is gone", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const child = fakeChild({ pid: 8_300 })
  const killCalls = []
  let probes = 0
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      assert.equal(pid, -child.pid)
      if (signal === 0) {
        probes += 1
        if (probes === 2) {
          const error = new Error("process group gone")
          error.code = "ESRCH"
          throw error
        }
      }
      return true
    },
  })
  const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  await new Promise((resolve) => setImmediate(resolve))

  await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
  assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
  await harness.timers.fireNext(SUPERVISION_LIMITS.termGraceMs)
  assert.deepEqual(killCalls, [
    { pid: -child.pid, signal: "SIGTERM" },
    { pid: -child.pid, signal: 0 },
    { pid: -child.pid, signal: "SIGKILL" },
  ])
  await harness.timers.fireNext(SUPERVISION_LIMITS.killVerifyMs)
  const result = await running

  assert.deepEqual(killCalls, [
    { pid: -child.pid, signal: "SIGTERM" },
    { pid: -child.pid, signal: 0 },
    { pid: -child.pid, signal: "SIGKILL" },
    { pid: -child.pid, signal: 0 },
  ])
  assert.equal(killCalls.some((call) => call.pid === -999 || call.pid === 999 || call.pid === 0), false)
  assert.deepEqual(result.failure_codes, ["git_init_timeout"])
  assert.deepEqual(result.processes[0], processRecord("git_init", {
    outcome: "timeout",
    timed_out: true,
  }))
  assert.equal(
    [...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded),
    true,
    "timeout settlement must close every output sink",
  )
  assertTimersSettled(harness.timers)
})

test("Unit 1e suppresses SIGKILL when the timed process group exits during grace", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const child = fakeChild({ pid: 8_400 })
  const killCalls = []
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      return true
    },
  })
  const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  await new Promise((resolve) => setImmediate(resolve))

  await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
  closeChild(child, null, "SIGTERM")
  const result = await running

  assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
  assert.equal(harness.timers.entries.some((entry) => entry.delayMs === SUPERVISION_LIMITS.termGraceMs && !entry.cleared), false)
  assert.deepEqual(result.failure_codes, ["git_init_timeout"])
  assert.deepEqual(result.processes[0], processRecord("git_init", {
    outcome: "timeout",
    signal: "SIGTERM",
    timed_out: true,
  }))
})

test("Unit 1e distinguishes ESRCH exit races from failed post-KILL verification", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  await t.test("ESRCH during TERM means the group is already gone", async () => {
    const child = fakeChild({ pid: 8_450 })
    const killCalls = []
    const harness = supervisionDependencies({
      children: [child],
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        const error = new Error("gone")
        error.code = "ESRCH"
        throw error
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
    const result = await running

    assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
    assert.deepEqual(result.failure_codes, ["git_init_timeout"])
    assert.equal(result.processes[0].cleanup_failed, false)
    assert.equal([...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded), true)
    assertTimersSettled(harness.timers)
  })

  await t.test("a group still alive after SIGKILL verification fails cleanup", async () => {
    const child = fakeChild({ pid: 8_460 })
    const killCalls = []
    const harness = supervisionDependencies({
      children: [child],
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        return true
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.termGraceMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.killVerifyMs)
    const result = await running

    assert.deepEqual(killCalls, [
      { pid: -child.pid, signal: "SIGTERM" },
      { pid: -child.pid, signal: 0 },
      { pid: -child.pid, signal: "SIGKILL" },
      { pid: -child.pid, signal: 0 },
    ])
    assert.deepEqual(result.failure_codes, ["git_init_cleanup_failed", "git_init_timeout"])
    assert.equal(result.processes[0].cleanup_failed, true)
    assert.equal([...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded), true)
    assertTimersSettled(harness.timers)
  })

  await t.test("a non-ESRCH liveness-probe error is never mistaken for disappearance", async () => {
    const child = fakeChild({ pid: 8_470 })
    const killCalls = []
    const harness = supervisionDependencies({
      children: [child],
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        if (signal === 0) {
          const error = new Error("probe denied")
          error.code = "EPERM"
          throw error
        }
        return true
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.termGraceMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.killVerifyMs)
    const result = await running

    assert.deepEqual(killCalls, [
      { pid: -child.pid, signal: "SIGTERM" },
      { pid: -child.pid, signal: 0 },
      { pid: -child.pid, signal: "SIGKILL" },
      { pid: -child.pid, signal: 0 },
    ])
    assert.deepEqual(result.failure_codes, ["git_init_cleanup_failed", "git_init_timeout"])
    assert.equal(result.processes[0].cleanup_failed, true)
    assertTimersSettled(harness.timers)
  })

  await t.test("a non-ESRCH SIGKILL error remains a cleanup failure after bounded verification", async () => {
    const child = fakeChild({ pid: 8_480 })
    const killCalls = []
    const harness = supervisionDependencies({
      children: [child],
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        if (signal === "SIGKILL") {
          const error = new Error("kill denied")
          error.code = "EPERM"
          throw error
        }
        return true
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.termGraceMs)
    await harness.timers.fireNext(SUPERVISION_LIMITS.killVerifyMs)
    const result = await running

    assert.deepEqual(killCalls, [
      { pid: -child.pid, signal: "SIGTERM" },
      { pid: -child.pid, signal: 0 },
      { pid: -child.pid, signal: "SIGKILL" },
      { pid: -child.pid, signal: 0 },
    ])
    assert.deepEqual(result.failure_codes, ["git_init_cleanup_failed", "git_init_timeout"])
    assert.equal(result.processes[0].cleanup_failed, true)
    assertTimersSettled(harness.timers)
  })
})

test("Unit 1e never signals an invalid PID or a non-group target", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const invalidPids = [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    undefined,
    "123",
  ]

  for (const invalidPid of invalidPids) {
    await t.test(String(invalidPid), async () => {
      const child = fakeChild({ pid: invalidPid })
      const killCalls = []
      const harness = supervisionDependencies({
        children: [child],
        kill(pid, signal) {
          killCalls.push({ pid, signal })
          return true
        },
      })

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.deepEqual(killCalls, [])
      assert.deepEqual(result.failure_codes, ["git_init_invalid_pid"])
      assert.deepEqual(result.processes[0], processRecord("git_init", {
        outcome: "supervision_failure",
      }))
      assert.equal(harness.calls.length, 1)
      assert.deepEqual(harness.fileSystem.published, [result])
      assert.deepEqual(harness.timers.entries, [])
    })
  }
})

test("Unit 1e accepts each stream at the exact byte cap for every phase", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  for (const phase of PROCESS_PHASES) {
    for (const streamName of ["stdout", "stderr"]) {
      await t.test(`${phase} ${streamName}`, async () => {
        const targetIndex = PROCESS_PHASES.indexOf(phase)
        const children = PROCESS_PHASES.map((childPhase, index) => fakeChild({
          pid: 8_500 + index,
          onSpawn(child) {
            if (index === targetIndex) {
              child[streamName].write(Buffer.alloc(SUPERVISION_LIMITS[`${streamName}Bytes`], 0x61))
            }
            closeChild(child)
          },
        }))
        const harness = supervisionDependencies({ children })

        const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

        assert.equal(result.ok, true)
        assert.equal(result.processes[targetIndex][`${streamName}_bytes`], SUPERVISION_LIMITS[`${streamName}Bytes`])
      })
    }
  }
})

test("Unit 1e terminates immediately at cap plus one and ignores later chunks", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  for (const phase of PROCESS_PHASES) {
    for (const streamName of ["stdout", "stderr"]) {
      await t.test(`${phase} ${streamName}`, async () => {
        const targetIndex = PROCESS_PHASES.indexOf(phase)
        const children = PROCESS_PHASES.slice(0, targetIndex + 1).map((childPhase, index) => fakeChild({
          pid: 8_600 + index,
          onSpawn(child) {
            if (index !== targetIndex) {
              closeChild(child)
              return
            }
            const cap = SUPERVISION_LIMITS[`${streamName}Bytes`]
            child[streamName].write(Buffer.alloc(cap + 1, 0x61))
            child[streamName].write(Buffer.alloc(1_024, 0x62))
          },
        }))
        const killCalls = []
        const harness = supervisionDependencies({
          children,
          kill(pid, signal) {
            killCalls.push({ pid, signal })
            if (signal === "SIGTERM") {
              queueMicrotask(() => closeChild(children[targetIndex], null, "SIGTERM"))
            }
            return true
          },
        })

        const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

        assert.deepEqual(killCalls, [{ pid: -children[targetIndex].pid, signal: "SIGTERM" }])
        assert.deepEqual(result.failure_codes, [`${phase}_${streamName}_limit_exceeded`])
        assert.equal(result.processes[targetIndex][`${streamName}_bytes`], SUPERVISION_LIMITS[`${streamName}Bytes`] + 1)
        assert.equal(result.processes[targetIndex].outcome, `${streamName}_limit`)
        assert.equal(harness.calls.length, targetIndex + 1)
        const target = supervisionPlan().paths.processOutputs[phase][streamName]
        assert.equal(harness.fileSystem.outputs.get(target)?.length, SUPERVISION_LIMITS[`${streamName}Bytes`])
      })
    }
  }
})

test("Unit 1e escalates an unresponsive non-timeout breach through TERM, grace, KILL, and verification", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const child = fakeChild({
    pid: 8_675,
    onSpawn(spawned) {
      spawned.stdout.write(Buffer.alloc(SUPERVISION_LIMITS.stdoutBytes + 1, 0x61))
    },
  })
  const killCalls = []
  let probes = 0
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      assert.equal(pid, -child.pid)
      if (signal === 0) {
        probes += 1
        if (probes === 2) {
          const error = new Error("process group gone")
          error.code = "ESRCH"
          throw error
        }
      }
      return true
    },
  })
  const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
  await harness.timers.fireNext(SUPERVISION_LIMITS.termGraceMs)
  await harness.timers.fireNext(SUPERVISION_LIMITS.killVerifyMs)
  const result = await running

  assert.deepEqual(killCalls, [
    { pid: -child.pid, signal: "SIGTERM" },
    { pid: -child.pid, signal: 0 },
    { pid: -child.pid, signal: "SIGKILL" },
    { pid: -child.pid, signal: 0 },
  ])
  assert.deepEqual(result.failure_codes, ["git_init_stdout_limit_exceeded"])
  assert.deepEqual(result.processes[0], processRecord("git_init", {
    outcome: "stdout_limit",
    stdout_bytes: SUPERVISION_LIMITS.stdoutBytes + 1,
  }))
  assert.equal([...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded), true)
  assertTimersSettled(harness.timers)
})

test("Unit 1e counts split multibyte stream data by bytes rather than characters", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  let child
  child = fakeChild({
    pid: 8_700,
    onSpawn(spawned) {
      const euro = Buffer.from("€", "utf8")
      spawned.stdout.write(euro.subarray(0, 2))
      spawned.stdout.write(euro.subarray(2))
      spawned.stdout.write("x")
    },
  })
  const killCalls = []
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      if (signal === "SIGTERM") {
        queueMicrotask(() => closeChild(child, null, "SIGTERM"))
      }
      return true
    },
  })
  harness.dependencies.limits = { ...SUPERVISION_LIMITS, stdoutBytes: 3 }

  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

  assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
  assert.deepEqual(result.failure_codes, ["git_init_stdout_limit_exceeded"])
  assert.equal(result.processes[0].stdout_bytes, 4)
})

test("Unit 1e honors output backpressure before accepting the next chunk", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const stdoutTarget = supervisionPlan().paths.processOutputs.git_init.stdout
  let blocked = false
  let drainCount = 0
  let writesWhileBlocked = 0
  const firstChild = fakeChild({
    pid: 8_750,
    onSpawn(spawned) {
      spawned.stdout.write("first")
      spawned.stdout.write("second")
      spawned.stdout.end()
      spawned.stderr.end()
      setImmediate(() => spawned.emit("close", 0, null))
    },
  })
  const children = [
    firstChild,
    ...PROCESS_PHASES.slice(1).map((phase, index) => fakeChild({
      pid: 8_751 + index,
      onSpawn(child) {
        closeChild(child)
      },
    })),
  ]
  const harness = supervisionDependencies({
    children,
    openOutput({ outputs, target }) {
      if (target !== stdoutTarget) {
        return new PassThrough()
      }
      const sink = new EventEmitter()
      const chunks = []
      sink.destroyed = false
      sink.writableEnded = false
      sink.destroy = () => {
        sink.destroyed = true
        sink.emit("close")
      }
      sink.end = () => {
        sink.writableEnded = true
        outputs.set(target, Buffer.concat(chunks))
        sink.emit("finish")
      }
      sink.write = (chunk) => {
        if (blocked) {
          writesWhileBlocked += 1
          throw new Error("write occurred before drain")
        }
        chunks.push(Buffer.from(chunk))
        blocked = true
        queueMicrotask(() => {
          blocked = false
          drainCount += 1
          sink.emit("drain")
        })
        return false
      }
      return sink
    },
  })

  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

  assert.equal(result.ok, true)
  assert.deepEqual(result.failure_codes, [])
  assert.equal(writesWhileBlocked, 0)
  assert.equal(drainCount, 2)
  assert.equal(harness.fileSystem.outputs.get(stdoutTarget)?.toString("utf8"), "firstsecond")
  assert.equal(result.processes[0].stdout_bytes, Buffer.byteLength("firstsecond"))
  assertTimersSettled(harness.timers)
})

test("Unit 1e bounds output settlement without signaling a child that already closed", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const stdoutTarget = supervisionPlan().paths.processOutputs.git_init.stdout
  let stuckSink
  const child = fakeChild({
    pid: 8_775,
    onSpawn(spawned) {
      spawned.stdout.write("blocked")
      spawned.stdout.end()
      spawned.stderr.end()
      spawned.emit("close", 0, null)
    },
  })
  const killCalls = []
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      return true
    },
    openOutput({ target }) {
      if (target !== stdoutTarget) {
        return new PassThrough()
      }
      const sink = new EventEmitter()
      sink.destroyed = false
      sink.writableEnded = false
      sink.destroy = () => {
        sink.destroyed = true
        sink.emit("close")
      }
      sink.end = () => {
        sink.writableEnded = true
      }
      sink.write = () => false
      stuckSink = sink
      return sink
    },
  })
  const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  await new Promise((resolve) => setImmediate(resolve))

  const deadline = harness.timers.entries.find((entry) => (
    entry.delayMs === SUPERVISION_LIMITS.childDeadlineMs && !entry.cleared
  ))
  assert.ok(deadline, "the phase deadline must cover stream and sink settlement")
  await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
  const result = await running

  assert.deepEqual(killCalls, [])
  assert.equal(stuckSink.destroyed, true)
  assert.deepEqual(result.failure_codes, ["git_init_stdout_close_timeout"])
  assert.deepEqual(result.processes[0], processRecord("git_init", {
    exit_code: 0,
    outcome: "supervision_failure",
    stdout_bytes: Buffer.byteLength("blocked"),
  }))
  assert.equal(harness.calls.length, 1)
  assert.deepEqual(harness.fileSystem.published, [result])
  assertTimersSettled(harness.timers)
})

test("Unit 1e observes an aggregate regular-file debug threshold and performs a final measurement", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)

  await t.test("exact aggregate boundary ignores non-regular entries", async () => {
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_800 + index,
      onSpawn(child) {
        closeChild(child)
      },
    }))
    const harness = supervisionDependencies({
      children,
      debugEntries: [
        { kind: "file", path: "a.log", size: 4_194_304 },
        { kind: "file", path: "nested/b.log", size: 4_194_304 },
        { kind: "symlink", path: "outside.log", size: 99_999_999 },
      ],
    })

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.equal(result.ok, true)
    assert.equal(result.processes[3].debug_bytes, SUPERVISION_LIMITS.debugBytes)
  })

  await t.test("poll re-arms throughout a live child and settles every timer", async () => {
    let liveChild
    let measurements = 0
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_850 + index,
      onSpawn(child) {
        if (index === 3) {
          liveChild = child
        } else {
          closeChild(child)
        }
      },
    }))
    const harness = supervisionDependencies({
      children,
      debugEntries() {
        measurements += 1
        return []
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))
    const initialMeasurements = measurements

    for (let poll = 1; poll <= 3; poll += 1) {
      await harness.timers.fireNext(SUPERVISION_LIMITS.debugPollMs)
      assert.equal(measurements, initialMeasurements + poll)
    }
    closeChild(liveChild)
    const result = await running

    assert.equal(result.ok, true)
    assert.equal(measurements, initialMeasurements + 4, "live closure must perform one final measurement")
    assert.equal(
      harness.timers.entries.filter((entry) => entry.delayMs === SUPERVISION_LIMITS.debugPollMs).length,
      4,
      "each completed poll must re-arm exactly once until live closure",
    )
    assertTimersSettled(harness.timers)
  })

  await t.test("poll catches aggregate boundary plus one", async () => {
    let liveChild
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_900 + index,
      onSpawn(child) {
        if (index === 3) {
          liveChild = child
        } else {
          closeChild(child)
        }
      },
    }))
    const killCalls = []
    const harness = supervisionDependencies({
      children,
      debugEntries: [
        { kind: "file", path: "a.log", size: 4_194_304 },
        { kind: "file", path: "nested/b.log", size: 4_194_305 },
      ],
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        if (signal === "SIGTERM") {
          queueMicrotask(() => closeChild(liveChild, null, "SIGTERM"))
        }
        return true
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.debugPollMs)
    const result = await running

    assert.deepEqual(killCalls, [{ pid: -liveChild.pid, signal: "SIGTERM" }])
    assert.deepEqual(result.failure_codes, ["copilot_live_debug_limit_exceeded"])
    assert.equal(result.processes[3].debug_bytes, SUPERVISION_LIMITS.debugBytes + 1)
  })

  await t.test("a poll failure terminates an active live process group", async () => {
    let liveChild
    let measurements = 0
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 8_950 + index,
      onSpawn(child) {
        if (index === 3) {
          liveChild = child
        } else {
          closeChild(child)
        }
      },
    }))
    const killCalls = []
    const harness = supervisionDependencies({
      children,
      debugEntries() {
        measurements += 1
        if (measurements > 1) {
          throw new Error("debug stat failed")
        }
        return []
      },
      kill(pid, signal) {
        killCalls.push({ pid, signal })
        if (signal === "SIGTERM") {
          queueMicrotask(() => closeChild(liveChild, null, "SIGTERM"))
        }
        return true
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))

    await harness.timers.fireNext(SUPERVISION_LIMITS.debugPollMs)
    const result = await running

    assert.deepEqual(killCalls, [{ pid: -liveChild.pid, signal: "SIGTERM" }])
    assert.deepEqual(result.failure_codes, ["copilot_live_debug_monitor_failed"])
    assert.equal(result.processes[3].outcome, "supervision_failure")
    assertTimersSettled(harness.timers)
  })

  await t.test("final measurement catches growth after the last poll", async () => {
    let measurements = 0
    const children = PROCESS_PHASES.map((phase, index) => fakeChild({
      pid: 9_000 + index,
      onSpawn(child) {
        closeChild(child)
      },
    }))
    const harness = supervisionDependencies({
      children,
      debugEntries() {
        measurements += 1
        return [{ kind: "file", path: "late.log", size: measurements === 1 ? 0 : SUPERVISION_LIMITS.debugBytes + 1 }]
      },
    })

    const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

    assert.equal(measurements >= 2, true)
    assert.deepEqual(result.failure_codes, ["copilot_live_debug_limit_exceeded"])
    assert.equal(result.processes[3].debug_bytes, SUPERVISION_LIMITS.debugBytes + 1)
  })
})

test("Unit 1e fails closed on spawn, stream, sink, timer, clock, debug, and cleanup errors", async (t) => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const cases = [
    {
      code: "git_init_spawn_failed",
      configure(harness) {
        harness.dependencies.spawn = () => {
          throw new Error("spawn failed")
        }
      },
    },
    {
      code: "git_init_clock_failed",
      configure(harness) {
        harness.dependencies.clock.nowMs = () => {
          throw new Error("clock failed")
        }
      },
    },
    {
      code: "git_init_clock_invalid",
      configure(harness) {
        harness.dependencies.clock.nowMs = () => Number.NaN
      },
    },
    {
      code: "git_init_timer_failed",
      configure(harness) {
        harness.dependencies.timers.setTimeout = () => {
          throw new Error("timer failed")
        }
      },
    },
    {
      code: "git_init_timer_clear_failed",
      configure(harness, child) {
        child.start = () => {
          closeChild(child)
        }
        harness.dependencies.timers.clearTimeout = () => {
          throw new Error("timer clear failed")
        }
      },
    },
    {
      code: "git_init_clock_regressed",
      configure(harness, child) {
        const samples = [1_000, 999]
        harness.dependencies.clock.nowMs = () => samples.shift() ?? 999
        child.start = () => {
          closeChild(child)
        }
      },
    },
    {
      code: "git_init_stdout_stream_failed",
      configure(harness, child) {
        child.start = () => {
          child.stdout.emit("error", new Error("stream failed"))
        }
      },
    },
    {
      code: "git_init_stdout_write_failed",
      configure(harness, child) {
        const stdoutTarget = supervisionPlan().paths.processOutputs.git_init.stdout
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          const sink = new PassThrough()
          if (target === stdoutTarget) {
            sink.write = () => {
              throw new Error("write failed")
            }
          }
          return sink
        }
        child.start = () => {
          child.stdout.write("data")
        }
      },
    },
    {
      code: "git_init_stdout_destination_failed",
      configure(harness, child) {
        const stdoutTarget = supervisionPlan().paths.processOutputs.git_init.stdout
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          const sink = new PassThrough()
          if (target === stdoutTarget) {
            const write = sink.write.bind(sink)
            sink.write = (...args) => {
              const accepted = write(...args)
              queueMicrotask(() => sink.emit("error", new Error("destination failed")))
              return accepted
            }
          }
          return sink
        }
        child.start = () => {
          child.stdout.write("data")
        }
      },
    },
    {
      code: "git_init_stdout_close_failed",
      configure(harness, child) {
        const stdoutTarget = supervisionPlan().paths.processOutputs.git_init.stdout
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          if (target !== stdoutTarget) {
            return new PassThrough()
          }
          const sink = new PassThrough()
          sink.end = () => {
            throw new Error("close failed")
          }
          return sink
        }
        child.start = () => {
          closeChild(child)
        }
      },
    },
    {
      code: "git_init_stderr_stream_failed",
      configure(harness, child) {
        child.start = () => {
          child.stderr.emit("error", new Error("stream failed"))
        }
      },
    },
    {
      code: "git_init_stderr_write_failed",
      configure(harness, child) {
        const stderrTarget = supervisionPlan().paths.processOutputs.git_init.stderr
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          const sink = new PassThrough()
          if (target === stderrTarget) {
            sink.write = () => {
              throw new Error("write failed")
            }
          }
          return sink
        }
        child.start = () => {
          child.stderr.write("data")
        }
      },
    },
    {
      code: "git_init_stderr_destination_failed",
      configure(harness, child) {
        const stderrTarget = supervisionPlan().paths.processOutputs.git_init.stderr
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          const sink = new PassThrough()
          if (target === stderrTarget) {
            const write = sink.write.bind(sink)
            sink.write = (...args) => {
              const accepted = write(...args)
              queueMicrotask(() => sink.emit("error", new Error("destination failed")))
              return accepted
            }
          }
          return sink
        }
        child.start = () => {
          child.stderr.write("data")
        }
      },
    },
    {
      code: "git_init_stderr_close_failed",
      configure(harness, child) {
        const stderrTarget = supervisionPlan().paths.processOutputs.git_init.stderr
        harness.dependencies.fsOps.openOutput = ({ target }) => {
          const sink = new PassThrough()
          if (target === stderrTarget) {
            sink.end = () => {
              throw new Error("close failed")
            }
          }
          return sink
        }
        child.start = () => {
          closeChild(child)
        }
      },
    },
    {
      code: "copilot_live_debug_monitor_failed",
      configure(harness) {
        const children = PROCESS_PHASES.map((phase, index) => fakeChild({
          pid: 9_300 + index,
          onSpawn(child) {
            closeChild(child)
          },
        }))
        harness.dependencies.spawn = (command, args, options) => {
          const child = children[harness.calls.length]
          harness.calls.push({ args, command, options })
          queueMicrotask(() => child.start())
          return child
        }
        harness.dependencies.fsOps.listDebugEntries = () => {
          throw new Error("debug stat failed")
        }
      },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.code, async () => {
      const child = fakeChild({ pid: 9_400 })
      const harness = supervisionDependencies({
        children: [child],
        kill(pid, signal) {
          if (signal === "SIGTERM") {
            queueMicrotask(() => closeChild(child, null, "SIGTERM"))
          }
          return true
        },
      })
      fixtureCase.configure(harness, child)
      const configuredSpawn = harness.dependencies.spawn
      let spawnAttempts = 0
      harness.dependencies.spawn = (...args) => {
        spawnAttempts += 1
        return configuredSpawn(...args)
      }

      const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

      assert.equal(result.ok, false)
      assert.equal(result.failure_codes.includes(fixtureCase.code), true)
      if (fixtureCase.code.startsWith("copilot_live_")) {
        assert.equal(spawnAttempts, 4)
      } else {
        assert.equal(spawnAttempts <= 1, true, "a first-phase dependency failure must not start a later phase")
      }
      assert.equal(harness.fileSystem.published.length, 1)
      assert.deepEqual(harness.fileSystem.published[0], result)
    })
  }

  await t.test("failed TERM records cleanup failure and never starts the next child", async () => {
    const child = fakeChild({ pid: 9_500 })
    const harness = supervisionDependencies({
      children: [child],
      kill() {
        throw new Error("signal failed")
      },
    })
    const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
    await new Promise((resolve) => setImmediate(resolve))
    await harness.timers.fireNext(SUPERVISION_LIMITS.childDeadlineMs)
    const result = await running

    assert.deepEqual(result.failure_codes, ["git_init_cleanup_failed", "git_init_timeout"])
    assert.equal(result.processes[0].cleanup_failed, true)
    assert.equal(harness.calls.length, 1)
    assert.equal([...harness.fileSystem.sinks.values()].every((sink) => sink.destroyed || sink.writableEnded), true)
    assertTimersSettled(harness.timers)
  })
})

test("Unit 1e cleared deadline callbacks cannot signal a completed or reused process group", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const children = PROCESS_PHASES.map((phase, index) => fakeChild({
    pid: 9_600 + index,
    onSpawn(child) {
      closeChild(child)
    },
  }))
  const killCalls = []
  const harness = supervisionDependencies({
    children,
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      return true
    },
  })
  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  const deadlines = harness.timers.entries.filter((entry) => entry.delayMs === SUPERVISION_LIMITS.childDeadlineMs)

  assert.equal(deadlines.length, PROCESS_PHASES.length)
  assert.equal(deadlines.every((entry) => entry.cleared), true)
  for (const deadline of deadlines) {
    await deadline.callback()
  }

  assert.equal(result.ok, true)
  assert.equal(harness.fileSystem.published.length, 1)
  assert.deepEqual(harness.fileSystem.published[0], result)
  assert.deepEqual(killCalls, [])
  assert.equal(harness.calls.length, PROCESS_PHASES.length)
  assertTimersSettled(harness.timers)
})

test("Unit 1e settles once across stream-error, child-error, close, and deadline races", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const child = fakeChild({ pid: 9_650 })
  const killCalls = []
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      return true
    },
  })
  const running = runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  await new Promise((resolve) => setImmediate(resolve))
  const deadline = harness.timers.entries.find((entry) => entry.delayMs === SUPERVISION_LIMITS.childDeadlineMs)
  assert.ok(deadline)

  child.stdout.emit("error", new Error("stream failed"))
  child.emit("error", new Error("late child error"))
  closeChild(child)
  const result = await running
  await deadline.callback()

  assert.deepEqual(result.failure_codes, ["git_init_stdout_stream_failed"])
  assert.equal(harness.fileSystem.published.length, 1)
  assert.deepEqual(harness.fileSystem.published[0], result)
  assert.deepEqual(killCalls, [{ pid: -child.pid, signal: "SIGTERM" }])
  assert.equal(harness.calls.length, 1)
  assertTimersSettled(harness.timers)
})

test("Unit 1e a failed timer clear cannot signal after the phase has settled", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const child = fakeChild({
    pid: 9_675,
    onSpawn(spawned) {
      closeChild(spawned)
    },
  })
  const killCalls = []
  const harness = supervisionDependencies({
    children: [child],
    kill(pid, signal) {
      killCalls.push({ pid, signal })
      return true
    },
  })
  harness.dependencies.timers.clearTimeout = () => {
    throw new Error("timer clear failed")
  }

  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)
  const deadline = harness.timers.entries.find((entry) => entry.delayMs === SUPERVISION_LIMITS.childDeadlineMs)
  assert.ok(deadline)
  await deadline.callback()

  assert.deepEqual(result.failure_codes, ["git_init_timer_clear_failed"])
  assert.deepEqual(killCalls, [])
  assert.equal(harness.fileSystem.published.length, 1)
  assert.deepEqual(harness.fileSystem.published[0], result)
})

test("Unit 1e preserves the precreated fail-closed summary when final publication fails", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const initialSummary = {
    failure_codes: ["harness_incomplete"],
    phase: "initializing",
    processes: PROCESS_PHASES.map(blankProcess),
    schema_version: 1,
  }
  const child = fakeChild({
    pid: 9_700,
    onSpawn(spawned) {
      closeChild(spawned, 23, null)
    },
  })
  const harness = supervisionDependencies({ children: [child] })
  harness.fileSystem.fsOps.publishSummary = () => {
    throw new Error("rename failed")
  }
  harness.fileSystem.published.push(clone(initialSummary))

  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

  assert.equal(result.ok, false)
  assert.equal(result.failure_codes.includes("summary_publication_failed"), true)
  assert.deepEqual(harness.fileSystem.published, [initialSummary])
})

test("Unit 1e uses only injected children, clocks, timers, signals, and filesystem seams", async () => {
  const smoke = loadProductionModule()
  const runSupervisedSmoke = requireSupervisionApi(smoke)
  const children = PROCESS_PHASES.map((phase, index) => fakeChild({
    pid: 9_800 + index,
    onSpawn(child) {
      closeChild(child)
    },
  }))
  const harness = supervisionDependencies({ children })

  const result = await runSupervisedSmoke(supervisionPlan(), harness.dependencies)

  assert.equal(result.ok, true)
  assert.equal(harness.calls.length, 4)
  assert.equal(harness.calls.every((call) => call.command.startsWith("/fixture/")), true)
  assert.equal(harness.timers.entries.every((entry) => [250, 2_000, 90_000].includes(entry.delayMs)), true)
})
