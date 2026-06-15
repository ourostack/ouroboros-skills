#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const defaultRepoRoot = path.resolve(__dirname, "..");
const defaultMcpRoot = path.join(defaultRepoRoot, "plugins", "desk", "mcp");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function relativeToRepo(repoRoot, filePath) {
  return normalizePath(path.relative(repoRoot, filePath));
}

async function loadRuntimeDeps(mcpRoot = defaultMcpRoot) {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")).href);
}

async function productionRuntimePackExpectation(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const mcpRoot = options.mcpRoot ?? path.join(repoRoot, "plugins", "desk", "mcp");
  const runtimeDeps = options.runtimeDeps ?? await loadRuntimeDeps(mcpRoot);
  const packageJson = readJson(path.join(mcpRoot, "package.json"));
  const packageLock = readJson(path.join(mcpRoot, "package-lock.json"));
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const nodeAbi = options.nodeAbi ?? process.versions.modules;
  const prodDependencyLockHash = runtimeDeps.productionDependencyLockHash({
    packageJson,
    packageLock,
  });
  const paths = runtimeDeps.deriveRuntimeDependencyPackPaths({
    mcpRoot,
    packageJson,
    packageLock,
    platform,
    arch,
    nodeAbi,
  });
  const target = `${platform}-${arch}-node-${nodeAbi}`;
  const requiredFiles = [
    paths.archivePath,
    paths.manifestPath,
    paths.checksumPath,
  ].map((filePath) => ({
    path: filePath,
    repoPath: relativeToRepo(repoRoot, filePath),
  }));

  return {
    packageJson,
    packageLock,
    paths,
    platform,
    arch,
    nodeAbi,
    target,
    prodDependencyLockHash,
    relativePackDir: relativeToRepo(repoRoot, paths.packDir),
    requiredFiles,
    runtimeDeps,
  };
}

function gitTracksFile({ repoRoot, repoPath, spawn = spawnSync }) {
  const result = spawn("git", ["ls-files", "--error-unmatch", "--", repoPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return (result.status ?? 1) === 0;
}

async function verifyGeneratedArtifacts(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const mcpRoot = options.mcpRoot ?? path.join(repoRoot, "plugins", "desk", "mcp");
  const exists = options.existsSync ?? fs.existsSync;
  const spawn = options.spawn ?? spawnSync;
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  };
  const expectation = await productionRuntimePackExpectation({
    ...options,
    repoRoot,
    mcpRoot,
  });
  const errors = [];

  for (const artifact of expectation.requiredFiles) {
    if (!exists(artifact.path)) {
      errors.push(`generated artifact missing: ${artifact.repoPath}`);
      continue;
    }
    if (!gitTracksFile({ repoRoot, repoPath: artifact.repoPath, spawn })) {
      errors.push(`generated artifact must be tracked by git: ${artifact.repoPath}`);
    }
  }

  const verification = expectation.runtimeDeps.verifyRuntimeDependencyPack({
    packDir: expectation.paths.packDir,
    mcpRoot,
    platform: expectation.platform,
    arch: expectation.arch,
    nodeAbi: expectation.nodeAbi,
  });
  errors.push(...verification.errors);

  if (errors.length > 0) {
    io.stderr.write(`Desk generated artifact verification failed for ${expectation.relativePackDir}\n`);
    for (const error of errors) {
      io.stderr.write(`- ${error}\n`);
    }
  } else {
    io.stdout.write(`Desk generated artifacts verified for ${expectation.relativePackDir}\n`);
  }

  return {
    ok: errors.length === 0,
    errors,
    expectation,
    verification,
  };
}

async function runCli(options = {}) {
  try {
    const result = await verifyGeneratedArtifacts(options);
    return result.ok ? 0 : 1;
  } catch (error) {
    const io = options.io ?? { stderr: process.stderr };
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  defaultMcpRoot,
  defaultRepoRoot,
  gitTracksFile,
  loadRuntimeDeps,
  productionRuntimePackExpectation,
  runCli,
  verifyGeneratedArtifacts,
};
