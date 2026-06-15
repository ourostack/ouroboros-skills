import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  mkdirSync,
  mkdtempSync,
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

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "desk-activation-config-"))
  const dirs = {
    root,
    explicitRoot: path.join(root, "explicit-desk"),
    hostSessionRoot: path.join(root, "host-session-desk"),
    activationRoot: path.join(root, "activation-desk"),
    envRoot: path.join(root, "env-desk"),
    home: path.join(root, "home"),
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
      "--root",
      "/tmp/desk",
      "--person",
      "ari",
    ]),
    {
      activationConfig: "/tmp/desk.activation-config.json",
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}
