import { test } from "node:test"
import { strict as assert } from "node:assert"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJson = loadJson(path.join(mcpRoot, "package.json"))
const packageLock = loadJson(path.join(mcpRoot, "package-lock.json"))
const hostTarget = `${process.platform}-${process.arch}-node-${process.versions.modules}`
const productionLockHash = productionDependencyLockHash({ packageJson, packageLock })
const hostRuntimePackDir = path.join(
  mcpRoot,
  "artifacts",
  "runtime-deps",
  packageJson.version,
  hostTarget,
  productionLockHash,
)
const hostRuntimePackExists = existsSync(path.join(hostRuntimePackDir, "runtime-deps.tgz"))
const productionDependencyNames = [
  "@modelcontextprotocol/sdk",
  "better-sqlite3",
  "gray-matter",
  "sqlite-vec",
]

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function productionDependencyLockHash({ packageJson, packageLock }) {
  const dependencies = collectAllSupportedProductionDependencies({ packageJson, packageLock })
  return sha256(stableStringify({
    dependencies: packageJson.dependencies ?? {},
    lock_entries: dependencies.map((dependency) => ({
      name: dependency.name,
      lock_path: dependency.lock_path,
      native: dependency.native,
      package: relevantLockFields(packageLock.packages[dependency.lock_path]),
    })),
  }))
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function collectAllSupportedProductionDependencies({ packageJson, packageLock }) {
  const supportedTargets = [
    { platform: "darwin", arch: "arm64" },
    { platform: "darwin", arch: "x64" },
    { platform: "linux", arch: "arm64" },
    { platform: "linux", arch: "x64" },
    { platform: "win32", arch: "x64" },
  ]
  const byLockPath = new Map()
  for (const target of supportedTargets) {
    for (const dependency of collectProductionDependencyClosure({ packageJson, packageLock, ...target })) {
      byLockPath.set(dependency.lock_path, dependency)
    }
  }
  return [...byLockPath.values()].sort((left, right) => left.lock_path.localeCompare(right.lock_path))
}

function collectProductionDependencyClosure({ packageJson, packageLock, platform, arch }) {
  const queue = Object.keys(packageJson.dependencies ?? {})
    .map((name) => packageLockPathForName(name, packageLock))
  const seen = new Set()
  while (queue.length > 0) {
    const lockPath = queue.shift()
    if (seen.has(lockPath)) continue
    const entry = packageLock.packages?.[lockPath]
    assert.ok(entry, `lock entry must exist for ${lockPath}`)
    if (entry.dev || !supportsTarget(entry, { platform, arch })) continue
    seen.add(lockPath)
    for (const name of Object.keys(entry.dependencies ?? {})) {
      queue.push(packageLockPathForName(name, packageLock, lockPath))
    }
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      queue.push(packageLockPathForName(name, packageLock, lockPath))
    }
    for (const [name, range] of Object.entries(entry.peerDependencies ?? {})) {
      if (entry.peerDependenciesMeta?.[name]?.optional !== true && range !== undefined) {
        queue.push(packageLockPathForName(name, packageLock, lockPath))
      }
    }
  }
  return [...seen].sort().map((lockPath) => ({
    name: packageNameFromLockPath(lockPath),
    lock_path: lockPath,
    native: /^node_modules\/(?:better-sqlite3|sqlite-vec(?:-|$))/u.test(lockPath),
  }))
}

function packageLockPathForName(name, packageLock, fromLockPath) {
  if (fromLockPath !== undefined) {
    for (const candidateRoot of packageAncestorLockPaths(fromLockPath)) {
      const nestedCandidate = `${candidateRoot}/node_modules/${name}`
      if (packageLock.packages[nestedCandidate] !== undefined) {
        return nestedCandidate
      }
    }
  }
  return `node_modules/${name}`
}

function packageAncestorLockPaths(lockPath) {
  const ancestors = []
  let current = lockPath
  while (current !== undefined) {
    ancestors.push(current)
    current = parentPackageLockPath(current)
  }
  return ancestors
}

function parentPackageLockPath(lockPath) {
  const nestedMarkerIndex = lockPath.lastIndexOf("/node_modules/")
  return nestedMarkerIndex === -1 ? undefined : lockPath.slice(0, nestedMarkerIndex)
}

function packageNameFromLockPath(lockPath) {
  const match = lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u)
  assert.notEqual(match, null, `lock path must end in a package node_modules segment: ${lockPath}`)
  return match[1]
}

function supportsTarget(entry, { platform, arch }) {
  return (!Array.isArray(entry.os) || entry.os.includes(platform))
    && (!Array.isArray(entry.cpu) || entry.cpu.includes(arch))
}

function relevantLockFields(entry = {}) {
  return {
    version: entry.version,
    resolved: entry.resolved,
    integrity: entry.integrity,
    dependencies: entry.dependencies ?? {},
    optionalDependencies: entry.optionalDependencies ?? {},
    peerDependencies: entry.peerDependencies ?? {},
    peerDependenciesMeta: entry.peerDependenciesMeta ?? {},
    os: entry.os ?? [],
    cpu: entry.cpu ?? [],
    dev: entry.dev === true,
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "desk-entrypoint-"))
  const fixtureMcpRoot = path.join(root, "mcp")
  const deskRoot = path.join(root, "desk")
  const runtimeCacheDir = path.join(root, "runtime-cache")
  const binDir = path.join(root, "bin")
  const networkLog = path.join(root, "network.log")
  const commandLog = path.join(root, "commands.log")
  copyMcpPackage(fixtureMcpRoot)
  mkdirSync(deskRoot, { recursive: true })
  mkdirSync(runtimeCacheDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  for (const command of ["npm", "npx", "curl", "wget"]) {
    writeFileSync(
      path.join(binDir, command),
      `#!/usr/bin/env sh\necho "${command} $*" >> "${commandLog}"\nexit 91\n`,
      { encoding: "utf8", mode: 0o755 },
    )
  }
  const preloadPath = path.join(root, "forbid-network.mjs")
  const loaderPath = path.join(root, "forbid-network-loader.mjs")
  const forbiddenNetworkModules = ["http", "https", "net", "tls", "node:http", "node:https", "node:net", "node:tls"]
  writeFileSync(
    loaderPath,
    [
      `import { appendFileSync } from "node:fs"`,
      `const forbidden = new Set(${JSON.stringify(forbiddenNetworkModules)})`,
      `export async function resolve(specifier, context, nextResolve) {`,
      `  if (forbidden.has(specifier)) {`,
      `    appendFileSync(${JSON.stringify(networkLog)}, "module " + specifier + "\\n")`,
      `    throw new Error("network module forbidden during runtime dependency bootstrap: " + specifier)`,
      `  }`,
      `  return nextResolve(specifier, context)`,
      `}`,
      "",
    ].join("\n"),
    "utf8",
  )
  writeFileSync(
    preloadPath,
    [
      `import { register } from "node:module"`,
      `import { appendFileSync } from "node:fs"`,
      `import Module from "node:module"`,
      `register(${JSON.stringify(pathToFileURL(loaderPath).href)})`,
      `const forbidden = new Set(${JSON.stringify(forbiddenNetworkModules)})`,
      `const originalLoad = Module._load`,
      `Module._load = function(request, parent, isMain) {`,
      `  if (forbidden.has(request)) {`,
      `    appendFileSync(${JSON.stringify(networkLog)}, "require " + request + "\\n")`,
      `    throw new Error("network module forbidden during runtime dependency bootstrap: " + request)`,
      `  }`,
      `  return originalLoad.apply(this, arguments)`,
      `}`,
      `globalThis.fetch = async (...args) => {`,
      `  appendFileSync(${JSON.stringify(networkLog)}, JSON.stringify(args.map(String)) + "\\n")`,
      `  throw new Error("network access forbidden during runtime dependency bootstrap")`,
      `}`,
      "",
    ].join("\n"),
    "utf8",
  )
  return {
    root,
    mcpRoot: fixtureMcpRoot,
    deskRoot,
    runtimeCacheDir,
    binDir,
    networkLog,
    commandLog,
    preloadPath,
  }
}

function copyMcpPackage(targetRoot) {
  mkdirSync(targetRoot, { recursive: true })
  for (const entry of [
    "index.js",
    "package.json",
    "package-lock.json",
    "scripts",
    "src",
    "artifacts",
  ]) {
    cpSync(path.join(mcpRoot, entry), path.join(targetRoot, entry), {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes("node_modules"),
    })
  }
}

function fixtureEnv(fixture) {
  return {
    ...process.env,
    DESK_RUNTIME_CACHE_DIR: fixture.runtimeCacheDir,
    HOME: path.join(fixture.root, "home"),
    XDG_CACHE_HOME: path.join(fixture.root, "xdg-cache"),
    NODE_OPTIONS: `--import=${pathToFileURL(fixture.preloadPath).href}`,
    PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  }
}

async function importEntrypointWithoutNodeModules(fixture) {
  return spawnNode([
    "--input-type=module",
    "--eval",
    [
      `const mod = await import(${JSON.stringify(pathToFileURL(path.join(fixture.mcpRoot, "index.js")).href)});`,
      `console.log(JSON.stringify(mod.parseArgs(["--root", "desk", "--person", "agent"])))`,
    ].join("\n"),
  ], {
    cwd: fixture.mcpRoot,
    env: fixtureEnv(fixture),
    timeoutMs: 5000,
  })
}

async function runMcpListToolsSession(fixture, { timeoutMs = 10000 } = {}) {
  const child = spawn(process.execPath, [
    path.join(fixture.mcpRoot, "index.js"),
    "--root",
    fixture.deskRoot,
  ], {
    cwd: fixture.mcpRoot,
    env: fixtureEnv(fixture),
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  const responses = []
  let closed

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8")
    for (const line of chunk.toString("utf8").split(/\r?\n/u)) {
      if (line.trim().length === 0) continue
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

  const waitForResponse = (id) => new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const response = responses.find((message) => message.id === id)
      if (response !== undefined) {
        clearInterval(timer)
        resolve(response)
      } else if (closed !== undefined) {
        clearInterval(timer)
        reject(new Error(`process exited before response ${id}: ${JSON.stringify(closed)}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`timed out waiting for response ${id}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      }
    }, 25)
  })

  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unit-7a", version: "1.0.0" },
    },
  }) + "\n")
  const initialize = await waitForResponse(1)
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }) + "\n")
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }) + "\n")
  const tools = await waitForResponse(2)
  child.kill("SIGTERM")
  await closePromise
  return {
    code: 0,
    initialize,
    tools,
    stdout,
    stderr,
  }
}

async function runMcpStatusSession(fixture, { timeoutMs = 10000 } = {}) {
  const child = spawn(process.execPath, [
    path.join(fixture.mcpRoot, "index.js"),
    "--root",
    fixture.deskRoot,
  ], {
    cwd: fixture.mcpRoot,
    env: fixtureEnv(fixture),
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  const responses = []
  let closed

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8")
    for (const line of chunk.toString("utf8").split(/\r?\n/u)) {
      if (line.trim().length === 0) continue
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

  const waitForResponse = (id) => new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const response = responses.find((message) => message.id === id)
      if (response !== undefined) {
        clearInterval(timer)
        resolve(response)
      } else if (closed !== undefined) {
        clearInterval(timer)
        reject(new Error(`process exited before response ${id}: ${JSON.stringify(closed)}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error(`timed out waiting for response ${id}\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      }
    }, 25)
  })

  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unit-10a", version: "1.0.0" },
    },
  }) + "\n")
  const initialize = await waitForResponse(1)
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  }) + "\n")
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  }) + "\n")
  const tools = await waitForResponse(2)
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "desk_status",
      arguments: {},
    },
  }) + "\n")
  const status = await waitForResponse(3)
  child.kill("SIGTERM")
  await closePromise
  return {
    code: 0,
    initialize,
    tools,
    status,
    stdout,
    stderr,
  }
}

async function runEntrypointExpectingFailure(fixture, { timeoutMs = 5000 } = {}) {
  return spawnNode([
    path.join(fixture.mcpRoot, "index.js"),
    "--root",
    fixture.deskRoot,
  ], {
    cwd: fixture.mcpRoot,
    env: fixtureEnv(fixture),
    timeoutMs,
  })
}

function spawnNode(args, { cwd, env, input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr, timedOut })
    })
    if (input !== undefined) {
      child.stdin.end(input)
    } else {
      child.stdin.end()
    }
  })
}

function listSourceMirrors(runtimeCacheDir) {
  const mirrorRoot = path.join(runtimeCacheDir, "source-mirror")
  if (!existsSync(mirrorRoot)) return []
  return readdirSync(mirrorRoot)
    .map((name) => path.join(mirrorRoot, name))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
}

function assertNoBootstrapSideEffects(fixture) {
  assert.equal(existsSync(path.join(fixture.mcpRoot, "node_modules")), false)
  assert.equal(existsSync(fixture.commandLog), false, "runtime bootstrap must not shell out to npm/npx/curl/wget")
  assert.equal(existsSync(fixture.networkLog), false, "runtime bootstrap must not use fetch or network modules")
}

function assertRuntimeDependenciesRestoredToCache(fixture) {
  for (const entry of [
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
    "node_modules/@modelcontextprotocol/sdk/package.json",
    "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js",
    "node_modules/better-sqlite3/package.json",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/gray-matter/package.json",
    "node_modules/sqlite-vec/package.json",
  ]) {
    assert.equal(
      existsSync(path.join(fixture.runtimeCacheDir, entry)),
      true,
      `runtime dependency pack must restore ${entry} into DESK_RUNTIME_CACHE_DIR`,
    )
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

test("MCP entrypoint is dependency-light before bootstrap", async () => {
  const entrypoint = readFileSync(path.join(mcpRoot, "index.js"), "utf8")
  assert.doesNotMatch(entrypoint, /from\s+["']\.\/src\/server\.js["']/u)
  for (const dependency of productionDependencyNames) {
    assert.doesNotMatch(entrypoint, new RegExp(`["']${dependency.replace("/", "\\/")}(?:\\/|["'])`, "u"))
  }

  const fixture = makeFixture()
  try {
    const result = await importEntrypointWithoutNodeModules(fixture)
    assert.equal(result.code, 0, result.stderr || result.stdout)
    assert.deepEqual(JSON.parse(result.stdout), { root: "desk", person: "agent" })
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("MCP entrypoint restores runtime dependencies offline and serves list-tools from the source mirror", {
  skip: hostRuntimePackExists ? false : `no committed runtime dependency pack for ${hostTarget}`,
}, async () => {
  const fixture = makeFixture()
  try {
    const beforeSource = readFileSync(path.join(fixture.mcpRoot, "src", "tool-names.js"), "utf8")
    const first = await runMcpListToolsSession(fixture)
    assert.equal(first.initialize.error, undefined, first.stderr || first.stdout)
    assert.equal(first.tools.error, undefined, first.stderr || first.stdout)
    assert.ok(
      first.tools.result.tools.some((tool) => tool.name === "desk_search"),
      "list-tools response must come from the restored runtime server",
    )
    assertNoBootstrapSideEffects(fixture)
    assertRuntimeDependenciesRestoredToCache(fixture)
    const firstMirrors = listSourceMirrors(fixture.runtimeCacheDir)
    assert.equal(firstMirrors.length, 1, "runtime cache must contain one source mirror after first start")

    writeFileSync(
      path.join(fixture.mcpRoot, "src", "tool-names.js"),
      beforeSource.replace(
        "Hybrid lexical+semantic search across desk.",
        "Unit 7a source mirror sentinel.",
      ),
      "utf8",
    )
    const second = await runMcpListToolsSession(fixture)
    assert.equal(second.tools.error, undefined, second.stderr || second.stdout)
    assertNoBootstrapSideEffects(fixture)
    const secondMirrors = listSourceMirrors(fixture.runtimeCacheDir)
    assert.equal(secondMirrors.length, 2, "source hash changes must create a new source mirror")
    assert.ok(
      secondMirrors.some((mirror) => (
        readFileSync(path.join(mirror, "src", "tool-names.js"), "utf8").includes("Unit 7a source mirror sentinel.")
      )),
      "new source mirror must contain updated plugin source",
    )
    assert.ok(
      second.tools.result.tools.some((tool) => (
        tool.name === "desk_search" && tool.description.includes("Unit 7a source mirror sentinel.")
      )),
      "list-tools response must be served from the updated source mirror",
    )
    assert.equal(existsSync(path.join(fixture.mcpRoot, "node_modules")), false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("MCP entrypoint serves coherent desk_status from the source mirror after bounded startup fallback", {
  skip: hostRuntimePackExists ? false : `no committed runtime dependency pack for ${hostTarget}`,
}, async () => {
  const fixture = makeFixture()
  try {
    mkdirSync(path.join(fixture.deskRoot, "ops", "status-check"), { recursive: true })
    writeFileSync(
      path.join(fixture.deskRoot, "ops", "status-check", "task.md"),
      "---\nschema_version: 1\nstatus: in_progress\n---\n\n# Status Check\n\nThis file would be indexed if startup ran repair work.\n",
      "utf8",
    )

    const result = await runMcpStatusSession(fixture)
    assert.equal(result.initialize.error, undefined, result.stderr || result.stdout)
    assert.equal(result.tools.error, undefined, result.stderr || result.stdout)
    assert.equal(result.status.error, undefined, result.stderr || result.stdout)
    assert.ok(
      result.tools.result.tools.some((tool) => tool.name === "desk_status"),
      "list-tools response must expose desk_status from the restored runtime server",
    )
    assert.equal(result.status.result.isError, undefined, JSON.stringify(result.status.result))
    const body = JSON.parse(result.status.result.content[0].text)
    assert.equal(body.status, "ok")
    assert.equal(body.root.path, fixture.deskRoot)
    assert.equal(body.local_db.exists, true)
    assert.equal(body.local_db.state, "available")
    assert.equal(body.lexical_index.available, true)
    assert.ok(
      ["lexical_only", "startup_deferred"].includes(body.startup_fallback.mode),
      `expected bounded lexical or deferred fallback, got ${body.startup_fallback.mode}`,
    )
    if (body.startup_fallback.mode === "lexical_only") {
      assert.equal(body.document_vectors.state, "missing")
      assert.ok(body.document_vectors.chunks_total > 0)
      assert.ok(body.document_vectors.repairable_missing_vectors > 0)
    } else {
      assert.equal(body.document_vectors.state, "available")
      assert.equal(body.document_vectors.chunks_total, 0)
      assert.equal(body.document_vectors.vectors_indexed, 0)
    }
    assert.equal(body.startup_fallback.degraded, true)
    assert.equal(body.runtime.loaded_from_source_mirror, true)
    assert.ok(
      body.runtime.source_mirror_path.startsWith(path.join(fixture.runtimeCacheDir, "source-mirror")),
      `expected source mirror under runtime cache, got ${body.runtime.source_mirror_path}`,
    )
    assert.equal(
      existsSync(path.join(fixture.deskRoot, ".state", "desk-index.sqlite")),
      true,
      "bounded session-start fallback should create the lexical local index DB",
    )
    assertNoBootstrapSideEffects(fixture)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("MCP entrypoint reports missing or ABI-mismatched runtime packs without npm install or stack traces", async () => {
  const fixture = makeFixture()
  try {
    const artifactsRoot = path.join(fixture.mcpRoot, "artifacts", "runtime-deps", packageJson.version)
    const actualTargetDir = path.join(artifactsRoot, hostTarget)
    const wrongTargetDir = path.join(artifactsRoot, `${process.platform}-${process.arch}-node-0`)
    let seedTargetDir
    if (existsSync(actualTargetDir)) {
      seedTargetDir = path.join(artifactsRoot, `${hostTarget}.saved-for-test`)
      renameSync(actualTargetDir, seedTargetDir)
    } else {
      seedTargetDir = readdirSync(artifactsRoot)
        .map((name) => path.join(artifactsRoot, name))
        .find((candidate) => statSync(candidate).isDirectory())
    }
    assert.ok(seedTargetDir, "runtime fixture must contain at least one committed target to synthesize ABI mismatch")
    rmSync(wrongTargetDir, { recursive: true, force: true })
    cpSync(seedTargetDir, wrongTargetDir, { recursive: true })
    if (path.basename(seedTargetDir).endsWith(".saved-for-test")) {
      rmSync(seedTargetDir, { recursive: true, force: true })
    }

    const result = await runEntrypointExpectingFailure(fixture)
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /runtime dependency pack/i)
    assert.match(result.stderr, new RegExp(escapeRegExp(hostTarget), "u"))
    assert.match(result.stderr, new RegExp(escapeRegExp(path.join(artifactsRoot, hostTarget)), "u"))
    assert.match(result.stderr, new RegExp(`available.+${escapeRegExp(path.basename(wrongTargetDir))}`, "isu"))
    assert.match(result.stderr, /runtime:deps-pack:build/u)
    assert.doesNotMatch(result.stderr, /Cannot find package '@modelcontextprotocol\/sdk'/u)
    assert.doesNotMatch(result.stderr, /\n\s+at\s+/u)
    assertNoBootstrapSideEffects(fixture)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
