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
    async startCli() {},
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

