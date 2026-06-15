import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, it } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(__dirname, "../..");
const deskPluginRoot = path.resolve(mcpRoot, "..");
const fixtureRoot = path.join(mcpRoot, "__tests__/fixtures/runtime");
const hostLaunchFixture = path.join(fixtureRoot, "host-launch/generic-stdio.mcp.json");
const immutableFixtureDirs = [
  path.join(deskPluginRoot, ".codex-plugin"),
  path.join(deskPluginRoot, ".claude-plugin"),
  path.join(fixtureRoot, "immutable/plugin-source"),
  path.join(fixtureRoot, "immutable/host-cache-source"),
  path.join(fixtureRoot, "immutable/readonly-plugin-cache"),
];

const bootstrapModule = await import(pathToFileURL(path.join(mcpRoot, "src/runtime/bootstrap.js")).href);
const runtimeDepsModule = await import(pathToFileURL(path.join(mcpRoot, "src/runtime/runtime-deps.js")).href);
const { deriveRuntimeDependencyPackPaths } = runtimeDepsModule;
const { prepareRuntime } = bootstrapModule;
const packageJson = readJson(path.join(mcpRoot, "package.json"));
const packageLock = readJson(path.join(mcpRoot, "package-lock.json"));

const tempRoots = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function runtimePackExists() {
  const paths = deriveRuntimeDependencyPackPaths({
    mcpRoot,
    packageJson,
    packageLock,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
  });
  return existsSync(paths.archivePath) && existsSync(paths.checksumPath);
}

function hasRuntimeDeps(cacheDir) {
  return (
    existsSync(path.join(cacheDir, "node_modules")) &&
    existsSync(path.join(cacheDir, "package.json")) &&
    existsSync(path.join(cacheDir, "package-lock.json"))
  );
}

function assertNoDeskStateRuntimeDeps(deskRoot) {
  const stateDir = path.join(deskRoot, ".state");
  assert.equal(existsSync(path.join(stateDir, "node_modules")), false, "runtime node_modules must not be written under desk .state");
  assert.equal(existsSync(path.join(stateDir, "package.json")), false, "runtime package.json must not be written under desk .state");
  assert.equal(existsSync(path.join(stateDir, "package-lock.json")), false, "runtime package-lock.json must not be written under desk .state");
  assert.equal(existsSync(path.join(stateDir, ".desk-runtime-cache.json")), false, "runtime marker must not be written under desk .state");
}

function listTree(dirPath) {
  if (!existsSync(dirPath)) return [];
  const entries = [];
  const walk = (current, relativePrefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relativePath = path.join(relativePrefix, entry.name);
      const absolutePath = path.join(current, entry.name);
      const stat = statSync(absolutePath);
      entries.push({
        path: relativePath,
        type: entry.isDirectory() ? "dir" : "file",
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
      if (entry.isDirectory()) walk(absolutePath, relativePath);
    }
  };
  walk(dirPath);
  return entries;
}

function snapshotImmutableDirs() {
  return new Map(immutableFixtureDirs.map((dirPath) => [dirPath, listTree(dirPath)]));
}

function assertImmutableDirsUnchanged(before) {
  for (const [dirPath, expected] of before.entries()) {
    assert.deepEqual(listTree(dirPath), expected, `${dirPath} should not be mutated by runtime startup`);
    assert.equal(existsSync(path.join(dirPath, "node_modules")), false, `${dirPath} must not receive node_modules`);
    assert.equal(existsSync(path.join(dirPath, ".desk-runtime-cache.json")), false, `${dirPath} must not receive runtime markers`);
    assert.equal(existsSync(path.join(dirPath, "source-mirror")), false, `${dirPath} must not receive source mirrors`);
  }
}

function materializeLaunchValue(value, pluginRoot) {
  return value.replaceAll("${pluginRoot}", pluginRoot);
}

function mcpServerFromConfig(configPath) {
  const config = readJson(configPath);
  assert.ok(config.mcpServers?.desk, `${configPath} should declare a desk MCP server`);
  return config.mcpServers.desk;
}

function mcpServerFromManifest(manifestPath) {
  const manifest = readJson(manifestPath);
  if (typeof manifest.mcpServers === "string") {
    return mcpServerFromConfig(path.resolve(deskPluginRoot, manifest.mcpServers));
  }
  assert.ok(manifest.mcpServers?.desk, `${manifestPath} should declare or reference a desk MCP server`);
  return manifest.mcpServers.desk;
}

function declarationCases() {
  return [
    {
      id: "desk .mcp.json",
      sourcePath: path.join(deskPluginRoot, ".mcp.json"),
      server: mcpServerFromConfig(path.join(deskPluginRoot, ".mcp.json")),
    },
    {
      id: "desk plugin.json",
      sourcePath: path.join(deskPluginRoot, "plugin.json"),
      server: mcpServerFromManifest(path.join(deskPluginRoot, "plugin.json")),
    },
    {
      id: "codex plugin.json",
      sourcePath: path.join(deskPluginRoot, ".codex-plugin/plugin.json"),
      server: mcpServerFromManifest(path.join(deskPluginRoot, ".codex-plugin/plugin.json")),
    },
    {
      id: "claude plugin.json",
      sourcePath: path.join(deskPluginRoot, ".claude-plugin/plugin.json"),
      server: mcpServerFromManifest(path.join(deskPluginRoot, ".claude-plugin/plugin.json")),
    },
    {
      id: "generic stdio fixture",
      sourcePath: hostLaunchFixture,
      server: mcpServerFromConfig(hostLaunchFixture),
    },
  ];
}

function makeMcpEnvelope(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

function waitForResponse(child, id, stderrChunks, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for response ${id}. stderr:\n${stderrChunks.join("")}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onStdout);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`MCP process exited before response ${id} (code=${code}, signal=${signal}). stderr:\n${stderrChunks.join("")}`));
    };

    const onStdout = (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === id) {
          cleanup();
          resolve(message);
          return;
        }
      }
    };

    child.stdout.on("data", onStdout);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function runListToolsSession({ command, args, cwd, env }) {
  const stderrChunks = [];
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));
  const closePromise = new Promise((resolve) => child.once("close", resolve));

  try {
    child.stdin.write(makeMcpEnvelope(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cache-and-launch-test", version: "1.0.0" },
    }));
    const init = await waitForResponse(child, 1, stderrChunks);
    assert.equal(init.error, undefined, `initialize failed: ${JSON.stringify(init.error)}`);

    child.stdin.write(makeMcpEnvelope(2, "tools/list"));
    const tools = await waitForResponse(child, 2, stderrChunks);
    assert.equal(tools.error, undefined, `tools/list failed: ${JSON.stringify(tools.error)}`);
    assert.ok(Array.isArray(tools.result?.tools), "tools/list should return tools");
    assert.ok(tools.result.tools.some((tool) => tool.name === "task_create"), "desk task_create tool should be available");
    return tools;
  } finally {
    child.kill("SIGTERM");
    await closePromise;
  }
}

async function runIndexListTools({ args, cwd, env }) {
  return runListToolsSession({
    command: process.execPath,
    args: [path.join(mcpRoot, "index.js"), ...args],
    cwd,
    env,
  });
}

function makeDeskHome(tempRoot) {
  const homeDir = ensureDir(path.join(tempRoot, "home"));
  const deskRoot = ensureDir(path.join(homeDir, "ms-desk"));
  return { homeDir, deskRoot };
}

describe("runtime cache and host launch contract", () => {
  it("uses activation-config runtimeCacheDir before DESK_RUNTIME_CACHE_DIR and never writes runtime deps under desk .state", async (t) => {
    if (!runtimePackExists()) {
      t.skip("host-specific runtime dependency pack is not present");
      return;
    }

    const tempRoot = makeTempRoot("desk-runtime-cache-config-");
    const { homeDir, deskRoot } = makeDeskHome(tempRoot);
    const activationCache = ensureDir(path.join(tempRoot, "activation-cache"));
    const envCache = ensureDir(path.join(tempRoot, "env-cache"));
    const xdgCache = ensureDir(path.join(tempRoot, "xdg-cache"));
    const activationConfigPath = path.join(tempRoot, "activation.json");
    writeJson(activationConfigPath, {
      schema_version: 1,
      desk: { root: deskRoot },
      runtimeCacheDir: activationCache,
    });

    await runIndexListTools({
      args: ["--activation-config", activationConfigPath],
      cwd: makeTempRoot("desk-runtime-cache-cwd-"),
      env: {
        ...process.env,
        DESK: "",
        DESK_RUNTIME_CACHE_DIR: envCache,
        XDG_CACHE_HOME: xdgCache,
        HOME: homeDir,
      },
    });

    assert.equal(hasRuntimeDeps(activationCache), true, "activation config runtimeCacheDir should receive runtime dependencies");
    assert.equal(hasRuntimeDeps(envCache), false, "DESK_RUNTIME_CACHE_DIR should not be used when activation config supplies runtimeCacheDir");
    assert.equal(hasRuntimeDeps(path.join(xdgCache, "ouroboros-skills/desk")), false, "XDG cache fallback should not be used");
    assertNoDeskStateRuntimeDeps(deskRoot);
  });

  it("launches every committed host declaration from a temporary cwd without mutating plugin source/cache directories", async (t) => {
    if (!runtimePackExists()) {
      t.skip("host-specific runtime dependency pack is not present");
      return;
    }

    const before = snapshotImmutableDirs();

    for (const declaration of declarationCases()) {
      await t.test(declaration.id, async () => {
        const tempRoot = makeTempRoot("desk-host-launch-");
        const cwd = ensureDir(path.join(tempRoot, "caller-cwd"));
        const { homeDir } = makeDeskHome(tempRoot);
        const runtimeCacheDir = ensureDir(path.join(tempRoot, "runtime-cache"));
        const server = declaration.server;
        const args = (server.args ?? []).map((arg) => materializeLaunchValue(arg, deskPluginRoot));

        await runListToolsSession({
          command: materializeLaunchValue(server.command, deskPluginRoot),
          args,
          cwd,
          env: {
            ...process.env,
            ...(server.env ?? {}),
            DESK: "",
            DESK_RUNTIME_CACHE_DIR: runtimeCacheDir,
            HOME: homeDir,
          },
        });
      });
    }

    assertImmutableDirsUnchanged(before);
  });

  it("repairs cached runtime dependencies when the cache marker belongs to a different plugin version", async (t) => {
    if (!runtimePackExists()) {
      t.skip("host-specific runtime dependency pack is not present");
      return;
    }

    const tempRoot = makeTempRoot("desk-runtime-cache-marker-");
    const runtimeCacheDir = ensureDir(path.join(tempRoot, "runtime-cache"));

    prepareRuntime({ mcpRoot, env: process.env, runtimeCacheDir });
    const markerPath = path.join(runtimeCacheDir, ".desk-runtime-cache.json");
    const marker = readJson(markerPath);
    marker.plugin.version = "0.0.0-incompatible";
    writeJson(markerPath, marker);

    prepareRuntime({ mcpRoot, env: process.env, runtimeCacheDir });
    const repairedMarker = readJson(markerPath);

    assert.equal(repairedMarker.plugin.version, packageJson.version, "runtime cache marker should be repaired from the committed pack");
  });
});
