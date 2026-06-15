import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const pathsModule = await import(pathToFileURL(path.join(mcpRoot, "src", "util", "paths.js")))
const entrypoint = await import(pathToFileURL(path.join(mcpRoot, "index.js")))
const runtimeDeps = await import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")))
const packageJson = JSON.parse(readFileSync(path.join(mcpRoot, "package.json"), "utf8"))
const packageLock = JSON.parse(readFileSync(path.join(mcpRoot, "package-lock.json"), "utf8"))
const hostPackPaths = runtimeDeps.deriveRuntimeDependencyPackPaths({
  mcpRoot,
  packageJson,
  packageLock,
})
const hostRuntimePackExists = existsSync(hostPackPaths.archivePath)

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "desk-activation-config-"))
  const dirs = {
    root,
    explicitRoot: path.join(root, "explicit-desk"),
    hostSessionRoot: path.join(root, "host-session-desk"),
    activationRoot: path.join(root, "activation-desk"),
    envRoot: path.join(root, "env-desk"),
    home: path.join(root, "home"),
    runtimeCache: path.join(root, "runtime-cache"),
    xdgCache: path.join(root, "xdg-cache"),
  }
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true })
  }
  mkdirSync(path.join(dirs.home, "ms-desk"), { recursive: true })
  dirs.configPath = path.join(root, "desk.activation-config.json")
  return dirs
}

function writeActivationConfig(filePath, rootPath, extra = {}) {
  writeFileSync(
    filePath,
    JSON.stringify({
      schema_version: 1,
      desk: {
        root: rootPath,
      },
      ...extra,
    }, null, 2),
    "utf8",
  )
}

function requireFunction(module, name) {
  assert.equal(typeof module[name], "function", `${name} must be exported`)
  return module[name]
}

function projectTried(result) {
  return result.tried.map((entry) => [entry.source, entry.path])
}

test("parseArgs captures activation config path without losing root or person", () => {
  assert.deepEqual(
    entrypoint.parseArgs([
      "--activation-config",
      "/tmp/desk.activation-config.json",
      "--host-session-root",
      "/tmp/host-session-desk",
      "--root",
      "/tmp/desk",
      "--person",
      "ari",
    ]),
    {
      activationConfig: "/tmp/desk.activation-config.json",
      hostSessionRoot: "/tmp/host-session-desk",
      person: "ari",
      root: "/tmp/desk",
    },
  )
})

test("resolveDeskRootWithSource applies explicit, host-session, activation, DESK, then home fallback precedence", () => {
  const resolveDeskRootWithSource = requireFunction(pathsModule, "resolveDeskRootWithSource")
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const common = {
      activationConfigPath: fixture.configPath,
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    }

    const explicit = resolveDeskRootWithSource({
      ...common,
      explicitRoot: fixture.explicitRoot,
      hostSessionRoot: fixture.hostSessionRoot,
    })
    assert.equal(explicit.root, fixture.explicitRoot)
    assert.equal(explicit.source, "explicit-root")
    assert.deepEqual(projectTried(explicit), [["explicit-root", fixture.explicitRoot]])

    const hostSession = resolveDeskRootWithSource({
      ...common,
      hostSessionRoot: fixture.hostSessionRoot,
    })
    assert.equal(hostSession.root, fixture.hostSessionRoot)
    assert.equal(hostSession.source, "host-session-root")

    const activation = resolveDeskRootWithSource(common)
    assert.equal(activation.root, fixture.activationRoot)
    assert.equal(activation.source, "activation-config")
    assert.deepEqual(projectTried(activation).map(([source]) => source), [
      "activation-config",
    ])

    const envDesk = resolveDeskRootWithSource({
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    })
    assert.equal(envDesk.root, fixture.envRoot)
    assert.equal(envDesk.source, "env:DESK")

    const fallback = resolveDeskRootWithSource({
      env: {
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    })
    assert.equal(fallback.root, path.join(fixture.home, "ms-desk"))
    assert.equal(fallback.source, "fallback:ms-desk")
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("activation config loader validates schema and redacts malformed JSON content", () => {
  const loadActivationConfig = requireFunction(pathsModule, "loadActivationConfig")
  const fixture = makeFixture()
  try {
    const invalidJsonPath = path.join(fixture.root, "invalid.activation-config.json")
    writeFileSync(invalidJsonPath, '{"desk":{"root":"SECRET-DESK-PATH"', "utf8")
    assert.throws(
      () => loadActivationConfig({ configPath: invalidJsonPath }),
      (err) => {
        assert.match(err.message, /activation config .* must be valid JSON/u)
        assert.match(err.message, new RegExp(escapeRegExp(invalidJsonPath), "u"))
        assert.doesNotMatch(err.message, /SECRET-DESK-PATH/u)
        return true
      },
    )

    const badSchemaPath = path.join(fixture.root, "bad-schema.activation-config.json")
    writeFileSync(badSchemaPath, JSON.stringify({
      schema_version: 2,
      desk: {
        root: fixture.activationRoot,
      },
    }), "utf8")
    assert.throws(
      () => loadActivationConfig({ configPath: badSchemaPath }),
      /activation config schema_version must be 1/u,
    )

    const missingRootPath = path.join(fixture.root, "missing-root.activation-config.json")
    writeFileSync(missingRootPath, JSON.stringify({ schema_version: 1, desk: {} }), "utf8")
    assert.throws(
      () => loadActivationConfig({ configPath: missingRootPath }),
      /activation config desk\.root must be a non-empty string/u,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("legacy resolveDeskRoot delegates to the same root resolver with injectable env and home", () => {
  const resolveDeskRootWithSource = requireFunction(pathsModule, "resolveDeskRootWithSource")
  const fixture = makeFixture()
  try {
    const options = {
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    }
    assert.equal(pathsModule.resolveDeskRoot(undefined, options), fixture.envRoot)
    assert.equal(
      pathsModule.resolveDeskRoot(undefined, options),
      resolveDeskRootWithSource(options).root,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("entrypoint startup root resolution uses parsed activation config and canonical path resolver", () => {
  const resolveStartupDeskRoot = requireFunction(entrypoint, "resolveStartupDeskRoot")
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const args = entrypoint.parseArgs(["--activation-config", fixture.configPath])
    const result = resolveStartupDeskRoot({
      args,
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    })
    assert.equal(result.root, fixture.activationRoot)
    assert.equal(result.source, "activation-config")
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("entrypoint startup root resolution lets host/session root override activation config", () => {
  const resolveStartupDeskRoot = requireFunction(entrypoint, "resolveStartupDeskRoot")
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const args = entrypoint.parseArgs([
      "--host-session-root",
      fixture.hostSessionRoot,
      "--activation-config",
      fixture.configPath,
    ])
    const result = resolveStartupDeskRoot({
      args,
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
    })
    assert.equal(result.root, fixture.hostSessionRoot)
    assert.equal(result.source, "host-session-root")
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("entrypoint main resolves startup root before launching injected runtime server", async () => {
  const main = requireFunction(entrypoint, "main")
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const calls = []
    await main({
      argv: [
        "--host-session-root",
        fixture.hostSessionRoot,
        "--activation-config",
        fixture.configPath,
        "--person",
        "ari",
      ],
      env: {
        DESK: fixture.envRoot,
        HOME: fixture.home,
      },
      homeDir: fixture.home,
      mcpRoot: "/fixture/mcp",
      runtimeImporter: async ({ mcpRoot }) => {
        calls.push(["runtimeImporter", mcpRoot])
        return {
          startServer: async ({ deskRoot, person }) => {
            calls.push(["startServer", deskRoot, person])
          },
        }
      },
    })
    assert.deepEqual(calls, [
      ["runtimeImporter", "/fixture/mcp"],
      ["startServer", fixture.hostSessionRoot, "ari"],
    ])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("entrypoint guard handles direct launch, import, realpath fallback, and fatal launch errors", async () => {
  const isEntrypoint = requireFunction(entrypoint, "isEntrypoint")
  const runIfEntrypoint = requireFunction(entrypoint, "runIfEntrypoint")
  const modulePath = path.join(repoRoot, "plugins", "desk", "mcp", "index.js")
  const moduleUrl = pathToFileURL(modulePath).href

  assert.equal(isEntrypoint({ argv: ["node"], moduleUrl }), false)
  assert.equal(isEntrypoint({
    argv: ["node", "/same/path"],
    moduleUrl,
    realpath: () => "/same/path",
  }), true)
  assert.equal(isEntrypoint({
    argv: ["node", modulePath],
    moduleUrl,
    realpath: () => {
      throw new Error("realpath unavailable")
    },
  }), true)

  assert.equal(runIfEntrypoint({ argv: ["node"], moduleUrl }), null)

  let launched = false
  await runIfEntrypoint({
    argv: ["node", modulePath],
    moduleUrl,
    launch: async () => {
      launched = true
    },
  })
  assert.equal(launched, true)

  const writes = []
  const exits = []
  await runIfEntrypoint({
    argv: ["node", modulePath],
    moduleUrl,
    launch: async () => {
      throw new Error("bad launch")
    },
    stderr: { write: (text) => writes.push(text) },
    exit: (code) => exits.push(code),
  })
  assert.match(writes.join(""), /\[desk-mcp\] fatal: bad launch/u)
  assert.deepEqual(exits, [1])
})

test("entrypoint stdio startup uses activation config root for real MCP tool calls", {
  skip: hostRuntimePackExists ? false : `no committed runtime dependency pack for ${process.platform}-${process.arch}-node-${process.versions.modules}`,
}, async () => {
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const result = await runTaskCreateThroughEntrypoint(fixture)
    assert.equal(result.initialize.error, undefined, result.stderr || result.stdout)
    assert.equal(result.created.error, undefined, result.stderr || result.stdout)
    assert.equal(
      existsSync(path.join(fixture.activationRoot, "activation-check", "from-server", "task.md")),
      true,
      "real MCP startup must write through the activation-config root",
    )
    assert.equal(
      existsSync(path.join(fixture.envRoot, "activation-check", "from-server", "task.md")),
      false,
      "conflicting DESK root must not receive writes when activation config is present",
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("entrypoint stdio startup lets host/session root override activation config root", {
  skip: hostRuntimePackExists ? false : `no committed runtime dependency pack for ${process.platform}-${process.arch}-node-${process.versions.modules}`,
}, async () => {
  const fixture = makeFixture()
  try {
    writeActivationConfig(fixture.configPath, fixture.activationRoot)
    const result = await runTaskCreateThroughEntrypoint(fixture, {
      args: [
        "--host-session-root",
        fixture.hostSessionRoot,
        "--activation-config",
        fixture.configPath,
      ],
      track: "host-session-check",
    })
    assert.equal(result.initialize.error, undefined, result.stderr || result.stdout)
    assert.equal(result.created.error, undefined, result.stderr || result.stdout)
    assert.equal(
      existsSync(path.join(fixture.hostSessionRoot, "host-session-check", "from-server", "task.md")),
      true,
      "real MCP startup must write through the host/session root when provided",
    )
    assert.equal(
      existsSync(path.join(fixture.activationRoot, "host-session-check", "from-server", "task.md")),
      false,
      "activation config root must not receive writes when host/session root is present",
    )
    assert.equal(
      existsSync(path.join(fixture.envRoot, "host-session-check", "from-server", "task.md")),
      false,
      "conflicting DESK root must not receive writes when host/session root is present",
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

async function runTaskCreateThroughEntrypoint(fixture, {
  args = ["--activation-config", fixture.configPath],
  track = "activation-check",
} = {}) {
  const child = spawn(process.execPath, [
    path.join(mcpRoot, "index.js"),
    ...args,
  ], {
    cwd: fixture.root,
    env: {
      ...process.env,
      DESK: fixture.envRoot,
      DESK_RUNTIME_CACHE_DIR: fixture.runtimeCache,
      HOME: fixture.home,
      XDG_CACHE_HOME: fixture.xdgCache,
    },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  const responses = []
  let closed

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8")
    stdout += text
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim() === "") continue
      try {
        responses.push(JSON.parse(line))
      } catch {
        // Keep raw stdout for assertion context.
      }
    }
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
  })
  const closePromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      closed = { code, signal }
      resolve(closed)
    })
  })
  try {
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "unit-8a", version: "1.0.0" },
      },
    }) + "\n")
    const initialize = await waitForResponse({ closed: () => closed, id: 1, responses, stderr: () => stderr, stdout: () => stdout })
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }) + "\n")
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "task_create",
        arguments: {
          track,
          slug: "from-server",
          title: "From server",
        },
      },
    }) + "\n")
    const created = await waitForResponse({ closed: () => closed, id: 2, responses, stderr: () => stderr, stdout: () => stdout })
    return {
      initialize,
      created,
      stderr,
      stdout,
    }
  } finally {
    child.kill("SIGTERM")
    await closePromise
  }
}

function waitForResponse({ closed, id, responses, stderr, stdout, timeoutMs = 10000 }) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const response = responses.find((message) => message.id === id)
      if (response !== undefined) {
        clearInterval(timer)
        resolve(response)
      } else if (closed() !== undefined) {
        clearInterval(timer)
        reject(new Error(`process exited before response ${id}: ${JSON.stringify(closed())}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`))
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`timed out waiting for response ${id}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`))
      }
    }, 25)
  })
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
