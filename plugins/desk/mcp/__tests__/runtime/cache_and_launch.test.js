import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, afterEach, describe, it } from "node:test";

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
const forbiddenPluginArtifactPaths = [
  path.join(deskPluginRoot, ".desk-runtime-cache.json"),
  path.join(deskPluginRoot, ".state"),
  path.join(deskPluginRoot, "node_modules"),
  path.join(deskPluginRoot, "runtime-cache"),
  path.join(deskPluginRoot, "source-mirror"),
  path.join(mcpRoot, ".desk-runtime-cache.json"),
  path.join(mcpRoot, ".state"),
  path.join(mcpRoot, "node_modules"),
  path.join(mcpRoot, "runtime-cache"),
  path.join(mcpRoot, "source-mirror"),
];
const mutablePluginSourcePaths = [
  path.join(deskPluginRoot, "activation"),
  path.join(mcpRoot, "artifacts", "runtime-deps"),
  path.join(mcpRoot, "node_modules"),
];
const runtimeArtifactNames = new Set([
  ".desk-runtime-cache.json",
  "node_modules",
  "package-lock.json",
  "package.json",
  "runtime-cache",
  "source-mirror",
]);

const bootstrapModule = await import(pathToFileURL(path.join(mcpRoot, "src/runtime/bootstrap.js")).href);
const runtimeDepsModule = await import(pathToFileURL(path.join(mcpRoot, "src/runtime/runtime-deps.js")).href);
const { buildRuntimeDependencyPack, deriveRuntimeDependencyPackPaths } = runtimeDepsModule;
const { prepareRuntime } = bootstrapModule;
const packageJson = readJson(path.join(mcpRoot, "package.json"));
const packageLock = readJson(path.join(mcpRoot, "package-lock.json"));
const hostPackPaths = deriveRuntimeDependencyPackPaths({
  mcpRoot,
  packageJson,
  packageLock,
  platform: process.platform,
  arch: process.arch,
  nodeAbi: process.versions.modules,
});
const committedHostPackExisted = runtimePackExists();
let builtTemporaryHostPack = false;

const tempRoots = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

after(() => {
  if (builtTemporaryHostPack && !committedHostPackExisted) {
    rmSync(hostPackPaths.packDir, { recursive: true, force: true });
    removeEmptyParentsUntil(path.dirname(hostPackPaths.packDir), path.join(mcpRoot, "artifacts", "runtime-deps"));
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
  return existsSync(hostPackPaths.archivePath) && existsSync(hostPackPaths.checksumPath);
}

function ensureRuntimePack() {
  if (runtimePackExists()) return;
  const result = buildRuntimeDependencyPack({
    mcpRoot,
    platform: process.platform,
    arch: process.arch,
    nodeAbi: process.versions.modules,
    createdAt: "1970-01-01T00:00:00.000Z",
    provenanceSource: "cache_and_launch.test temporary host pack",
  });
  assert.equal(result.packDir, hostPackPaths.packDir, "temporary host pack should use the canonical runtime pack path");
  builtTemporaryHostPack = true;
}

function removeEmptyParentsUntil(startDir, stopDir) {
  let current = startDir;
  while (current.startsWith(stopDir) && current !== stopDir) {
    try {
      if (readdirSync(current).length > 0) return;
      rmSync(current, { recursive: true, force: true });
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

function hasRuntimeDeps(cacheDir) {
  return (
    existsSync(path.join(cacheDir, "node_modules")) &&
    existsSync(path.join(cacheDir, "package.json")) &&
    existsSync(path.join(cacheDir, "package-lock.json"))
  );
}

function assertNoDeskStateRuntimeDeps(deskRoot) {
  assert.deepEqual(
    findRuntimeArtifactsUnder(path.join(deskRoot, ".state")),
    [],
    "runtime dependency artifacts must not be written anywhere under desk .state",
  );
}

function findRuntimeArtifactsUnder(rootPath) {
  if (!existsSync(rootPath)) return [];
  const matches = [];
  const walk = (current, relativePrefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relativePath = path.join(relativePrefix, entry.name);
      const absolutePath = path.join(current, entry.name);
      if (runtimeArtifactNames.has(entry.name)) {
        matches.push(relativePath);
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) walk(absolutePath, relativePath);
    }
  };
  walk(rootPath);
  return matches.sort();
}

function assertNoRuntimeArtifactsUnder(rootPath, message) {
  assert.deepEqual(findRuntimeArtifactsUnder(rootPath), [], message);
}

function listTree(dirPath, { skipPaths = [] } = {}) {
  if (!existsSync(dirPath)) return [];
  const entries = [];
  const walk = (current, relativePrefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relativePath = path.join(relativePrefix, entry.name);
      const absolutePath = path.join(current, entry.name);
      if (skipPaths.some((skipPath) => absolutePath === skipPath || absolutePath.startsWith(`${skipPath}${path.sep}`))) {
        continue;
      }
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

function snapshotPath(targetPath) {
  if (!existsSync(targetPath)) return { exists: false };
  const stat = statSync(targetPath);
  if (!stat.isDirectory()) {
    return {
      exists: true,
      type: "file",
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }
  return {
    exists: true,
    type: "dir",
    entries: listTree(targetPath),
  };
}

function snapshotImmutableState() {
  return {
    fixtureDirs: new Map(immutableFixtureDirs.map((dirPath) => [dirPath, listTree(dirPath)])),
    pluginArtifacts: new Map(forbiddenPluginArtifactPaths.map((targetPath) => [targetPath, snapshotPath(targetPath)])),
    pluginSourceTree: listTree(deskPluginRoot, { skipPaths: mutablePluginSourcePaths }),
  };
}

function assertImmutableStateUnchanged(before) {
  assert.deepEqual(
    listTree(deskPluginRoot, { skipPaths: mutablePluginSourcePaths }),
    before.pluginSourceTree,
    `${deskPluginRoot} plugin source must not be mutated by runtime startup`,
  );
  for (const [dirPath, expected] of before.fixtureDirs.entries()) {
    assert.deepEqual(listTree(dirPath), expected, `${dirPath} should not be mutated by runtime startup`);
    assert.equal(existsSync(path.join(dirPath, "node_modules")), false, `${dirPath} must not receive node_modules`);
    assert.equal(existsSync(path.join(dirPath, ".desk-runtime-cache.json")), false, `${dirPath} must not receive runtime markers`);
    assert.equal(existsSync(path.join(dirPath, "source-mirror")), false, `${dirPath} must not receive source mirrors`);
  }
  for (const [targetPath, expected] of before.pluginArtifacts.entries()) {
    assert.deepEqual(snapshotPath(targetPath), expected, `${targetPath} must not be created or mutated by runtime startup`);
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

function mcpServerFromManifest(manifestPath, { pluginRoot = deskPluginRoot } = {}) {
  const manifest = readJson(manifestPath);
  if (typeof manifest.mcpServers === "string") {
    const configPath = path.resolve(pluginRoot, manifest.mcpServers);
    assert.equal(existsSync(configPath), true, `${manifestPath} mcpServers must resolve relative to the installed plugin root: ${configPath}`);
    return mcpServerFromConfig(configPath);
  }
  assert.ok(manifest.mcpServers?.desk, `${manifestPath} should declare or reference a desk MCP server`);
  return manifest.mcpServers.desk;
}

function manifestCases() {
  return [
    {
      id: "desk plugin.json",
      sourcePath: path.join(deskPluginRoot, "plugin.json"),
    },
    {
      id: "codex plugin.json",
      sourcePath: path.join(deskPluginRoot, ".codex-plugin/plugin.json"),
    },
    {
      id: "claude plugin.json",
      sourcePath: path.join(deskPluginRoot, ".claude-plugin/plugin.json"),
    },
  ];
}

function declarationCases() {
  return [
    {
      id: "desk .mcp.json",
      sourcePath: path.join(deskPluginRoot, ".mcp.json"),
      resolveServer: () => mcpServerFromConfig(path.join(deskPluginRoot, ".mcp.json")),
    },
    {
      id: "desk plugin.json",
      sourcePath: path.join(deskPluginRoot, "plugin.json"),
      resolveServer: () => mcpServerFromManifest(path.join(deskPluginRoot, "plugin.json")),
    },
    {
      id: "codex plugin.json",
      sourcePath: path.join(deskPluginRoot, ".codex-plugin/plugin.json"),
      resolveServer: () => mcpServerFromManifest(path.join(deskPluginRoot, ".codex-plugin/plugin.json")),
    },
    {
      id: "claude plugin.json",
      sourcePath: path.join(deskPluginRoot, ".claude-plugin/plugin.json"),
      resolveServer: () => mcpServerFromManifest(path.join(deskPluginRoot, ".claude-plugin/plugin.json")),
    },
    {
      id: "generic stdio fixture",
      sourcePath: hostLaunchFixture,
      resolveServer: () => mcpServerFromConfig(hostLaunchFixture),
    },
  ];
}

function staticLaunchConfigCases() {
  return declarationCases();
}

function assertCwdIndependentLaunchArgs(id, server) {
  assert.equal(server.command, "node", `${id} must launch through the host-provided node command`);
  const args = server.args ?? [];
  const entrypointArg = args.find((arg) => materializeLaunchValue(arg, deskPluginRoot).replaceAll("\\", "/").endsWith("/mcp/index.js"));
  assert.ok(entrypointArg, `${id} must launch plugins/desk/mcp/index.js`);
  assert.equal(entrypointArg.startsWith("./") || entrypointArg.startsWith("../"), false, `${id} must not use caller-cwd-relative MCP entrypoint args`);
  assert.equal(path.isAbsolute(materializeLaunchValue(entrypointArg, deskPluginRoot)), true, `${id} MCP entrypoint arg must materialize to an absolute installed path`);
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

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function prependNodeShimToPath(tempRoot, existingPath) {
  const binDir = ensureDir(path.join(tempRoot, "bin"));
  const invocationLogPath = path.join(tempRoot, "node-shim-invocations.log");
  if (process.platform === "win32") {
    writeFileSync(path.join(binDir, "node.cmd"), `@echo node %*>>"${invocationLogPath}"\r\n@"${process.execPath}" %*\r\n`);
  } else {
    const shimPath = path.join(binDir, "node");
    writeFileSync(shimPath, `#!/bin/sh\nprintf '%s\\n' "node $*" >> ${shellQuote(invocationLogPath)}\nexec ${shellQuote(process.execPath)} "$@"\n`);
    chmodSync(shimPath, 0o755);
  }
  return {
    invocationLogPath,
    path: [binDir, existingPath ?? ""].filter(Boolean).join(path.delimiter),
  };
}

describe("runtime cache and host launch contract", () => {
  it("resolves committed host manifest MCP references relative to the installed plugin root", async (t) => {
    for (const manifest of manifestCases()) {
      await t.test(manifest.id, () => {
        const server = mcpServerFromManifest(manifest.sourcePath);
        assert.equal(server.type, "stdio", `${manifest.id} should resolve a stdio MCP server`);
        assert.ok(Array.isArray(server.args), `${manifest.id} should resolve launch args`);
      });
    }
  });

  it("committed MCP launch configs use cwd-independent installed entrypoint args", async (t) => {
    for (const declaration of staticLaunchConfigCases()) {
      await t.test(declaration.id, () => {
        assertCwdIndependentLaunchArgs(declaration.id, declaration.resolveServer());
      });
    }
  });

  it("uses activation-config runtimeCacheDir before DESK_RUNTIME_CACHE_DIR and never writes runtime deps under desk .state", async (t) => {
    ensureRuntimePack();

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
    assertNoRuntimeArtifactsUnder(envCache, "DESK_RUNTIME_CACHE_DIR should not be used when activation config supplies runtimeCacheDir");
    assertNoRuntimeArtifactsUnder(path.join(xdgCache, "ouroboros-skills", "desk"), "XDG cache fallback should not be used");
    assertNoDeskStateRuntimeDeps(deskRoot);
  });

  it("launches every committed host declaration from a temporary cwd without mutating plugin source/cache directories", async (t) => {
    ensureRuntimePack();

    const before = snapshotImmutableState();

    for (const declaration of declarationCases()) {
      await t.test(declaration.id, async () => {
        const tempRoot = makeTempRoot("desk-host-launch-");
        const cwd = ensureDir(path.join(tempRoot, "caller-cwd"));
        const { homeDir } = makeDeskHome(tempRoot);
        const runtimeCacheDir = ensureDir(path.join(tempRoot, "runtime-cache"));
        const server = declaration.resolveServer();
        const nodeShim = prependNodeShimToPath(tempRoot, process.env.PATH);
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
            PATH: nodeShim.path,
          },
        });
        assert.match(readFileSync(nodeShim.invocationLogPath, "utf8"), /^node .+/u, `${declaration.id} must launch through the controlled node PATH shim`);
      });
    }

    assertImmutableStateUnchanged(before);
  });

  it("repairs cached runtime dependencies when the cache marker and dependency artifacts are stale", async (t) => {
    ensureRuntimePack();

    const tempRoot = makeTempRoot("desk-runtime-cache-marker-");
    const runtimeCacheDir = ensureDir(path.join(tempRoot, "runtime-cache"));

    prepareRuntime({ mcpRoot, env: process.env, runtimeCacheDir });
    const markerPath = path.join(runtimeCacheDir, ".desk-runtime-cache.json");
    const marker = readJson(markerPath);
    marker.plugin.version = "0.0.0-incompatible";
    writeJson(markerPath, marker);
    const cachedPackageJsonPath = path.join(runtimeCacheDir, "package.json");
    const cachedPackageJson = readJson(cachedPackageJsonPath);
    cachedPackageJson.version = "0.0.0-incompatible";
    writeJson(cachedPackageJsonPath, cachedPackageJson);
    const staleRuntimeArtifactPath = path.join(runtimeCacheDir, "node_modules/.stale-runtime-artifact");
    writeFileSync(staleRuntimeArtifactPath, "stale runtime artifact\n");

    prepareRuntime({ mcpRoot, env: process.env, runtimeCacheDir });
    const repairedMarker = readJson(markerPath);
    const repairedPackageJson = readJson(cachedPackageJsonPath);

    assert.equal(repairedMarker.plugin.version, packageJson.version, "runtime cache marker should be repaired from the committed pack");
    assert.equal(repairedPackageJson.version, packageJson.version, "runtime cache package.json should be restored from the committed pack");
    assert.equal(existsSync(staleRuntimeArtifactPath), false, "stale runtime dependency artifacts should be removed during cache repair");
  });
});
