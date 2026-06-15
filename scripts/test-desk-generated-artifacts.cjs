#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { gunzipSync } = require("node:zlib");

const defaultRepoRoot = path.resolve(__dirname, "..");
const defaultMcpRoot = path.join(defaultRepoRoot, "plugins", "desk", "mcp");
const embeddedArchiveShaMarker = "<archive-sha256-recorded-in-sidecar>";
const defaultPublishedRuntimePackTargets = Object.freeze([
  Object.freeze({ platform: "darwin", arch: "arm64", nodeAbi: "127" }),
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function relativeToRepo(repoRoot, filePath) {
  return normalizePath(path.relative(repoRoot, filePath));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadRuntimeDeps(mcpRoot = defaultMcpRoot) {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")).href);
}

function publishedRuntimePackTargets(options = {}) {
  return (options.targets ?? defaultPublishedRuntimePackTargets)
    .map((target) => ({
      platform: target.platform,
      arch: target.arch,
      nodeAbi: target.nodeAbi,
    }));
}

async function productionRuntimePackExpectations(options = {}) {
  const targets = options.targets !== undefined
    ? publishedRuntimePackTargets(options)
    : options.platform === undefined
      ? publishedRuntimePackTargets(options)
      : publishedRuntimePackTargets({
      targets: [{
        platform: options.platform,
        arch: options.arch,
        nodeAbi: options.nodeAbi,
      }],
    });
  return Promise.all(targets.map((target) => productionRuntimePackExpectation({
    ...options,
    platform: target.platform,
    arch: target.arch,
    nodeAbi: target.nodeAbi,
  })));
}

async function productionRuntimePackExpectation(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const mcpRoot = options.mcpRoot ?? path.join(repoRoot, "plugins", "desk", "mcp");
  const runtimeDeps = options.runtimeDeps ?? await loadRuntimeDeps(mcpRoot);
  const packageJson = readJson(path.join(mcpRoot, "package.json"));
  const packageLock = readJson(path.join(mcpRoot, "package-lock.json"));
  const [defaultTarget] = publishedRuntimePackTargets(options);
  const platform = options.platform ?? defaultTarget.platform;
  const arch = options.arch ?? defaultTarget.arch;
  const nodeAbi = options.nodeAbi ?? defaultTarget.nodeAbi;
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
    repoRoot,
    mcpRoot,
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

function readJsonIfPresent(filePath, errors, label) {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return readJson(filePath);
  } catch (error) {
    errors.push(`${label} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function readFileIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined;
}

function readChecksum(filePath, errors) {
  const checksumBytes = readFileIfPresent(filePath);
  if (checksumBytes === undefined) return undefined;
  const checksum = checksumBytes.toString("utf8").trim().split(/\s+/u)[0];
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    errors.push("runtime dependency pack checksum runtime-deps.sha256 must start with a sha256 hex digest");
    return undefined;
  }
  return checksum;
}

function parseArchiveJson(bytes, label, errors) {
  if (bytes === undefined) {
    errors.push(`runtime dependency archive must include root ${label}`);
    return undefined;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    errors.push(`runtime dependency archive ${label} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function embeddedManifestForArchive(manifest) {
  const embeddedManifest = structuredClone(manifest);
  embeddedManifest.archive.sha256 = embeddedArchiveShaMarker;
  return embeddedManifest;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function extractTarGzContents(archivePath) {
  const data = gunzipSync(fs.readFileSync(archivePath));
  const entries = new Map();
  for (let offset = 0; offset < data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = readTarString(header, 0, 100);
    const rawPrefix = readTarString(header, 345, 155);
    const rawSize = readTarString(header, 124, 12).trim();
    const type = header.toString("ascii", 156, 157);
    const size = Number.parseInt(rawSize || "0", 8);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    const name = rawPrefix.length > 0 ? `${rawPrefix}/${rawName}` : rawName;
    if (type === "0" || type === "\0") {
      entries.set(name, Buffer.from(data.subarray(bodyStart, bodyEnd)));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readTarString(header, offset, length) {
  return header.toString("utf8", offset, offset + length).replace(/\0.*$/u, "");
}

function packageRootFromArchiveEntry(entry) {
  if (!entry.startsWith("node_modules/")) return undefined;
  const marker = "/node_modules/";
  const markerIndex = entry.lastIndexOf(marker);
  const rootPrefix = markerIndex === -1 ? "node_modules/" : entry.slice(0, markerIndex + marker.length);
  const remainder = entry.slice(rootPrefix.length).split("/");
  if (remainder[0]?.startsWith("@")) {
    if (remainder.length < 2) return undefined;
    return `${rootPrefix}${remainder[0]}/${remainder[1]}`;
  }
  if (!remainder[0]) return undefined;
  return `${rootPrefix}${remainder[0]}`;
}

function isRuntimeArchiveEntry(entry) {
  return !entry.endsWith("/package.json") && /\.(?:js|cjs|mjs|json|node|dylib|so|dll)$/u.test(entry);
}

function isMutableMcpSourceEntry(entry) {
  return entry === "index.js"
    || entry.startsWith("src/")
    || entry.startsWith("scripts/")
    || entry.startsWith("__tests__/")
    || entry.startsWith("plugins/desk/mcp/");
}

function validatePublishedArchiveShape({ entries, productionDependencies }) {
  const errors = [];
  const entrySet = new Set(entries);
  const expectedLockPaths = new Set(productionDependencies.map((dependency) => dependency.lock_path));

  for (const rootEntry of ["package.json", "package-lock.json", "runtime-deps.manifest.json"]) {
    if (!entrySet.has(rootEntry)) {
      errors.push(`runtime dependency archive must include root ${rootEntry}`);
    }
  }

  for (const dependency of productionDependencies) {
    if (!entrySet.has(`${dependency.lock_path}/package.json`)) {
      errors.push(`runtime dependency archive must include dependency package marker ${dependency.lock_path}/package.json`);
      continue;
    }
    const runtimeEntries = entries.filter((entry) => (
      entry.startsWith(`${dependency.lock_path}/`) && isRuntimeArchiveEntry(entry)
    ));
    if (runtimeEntries.length === 0) {
      errors.push(`runtime dependency archive must include at least one runtime file for ${dependency.name}`);
    }
  }

  for (const entry of entries) {
    if (["package.json", "package-lock.json", "runtime-deps.manifest.json"].includes(entry)) {
      continue;
    }
    if (isMutableMcpSourceEntry(entry)) {
      errors.push(`runtime dependency archive must not include mutable MCP source ${entry}`);
      continue;
    }
    if (entry.startsWith("node_modules/")) {
      const packageRoot = packageRootFromArchiveEntry(entry);
      if (packageRoot === undefined || !expectedLockPaths.has(packageRoot)) {
        errors.push(`runtime dependency archive must not include non-production dependency ${packageRoot ?? entry}`);
      }
      continue;
    }
    errors.push(`runtime dependency archive must not include unexpected root path ${entry}`);
  }

  return errors;
}

function verifyPublishedRuntimeDependencyPack({ expectation, existsSync = fs.existsSync, spawn = spawnSync } = {}) {
  const errors = [];
  for (const artifact of expectation.requiredFiles) {
    if (!existsSync(artifact.path)) {
      errors.push(`generated artifact missing: ${artifact.repoPath}`);
      continue;
    }
    if (!gitTracksFile({ repoRoot: expectation.repoRoot, repoPath: artifact.repoPath, spawn })) {
      errors.push(`generated artifact must be tracked by git: ${artifact.repoPath}`);
    }
  }

  const manifest = readJsonIfPresent(expectation.paths.manifestPath, errors, "runtime dependency pack manifest");
  const archiveBytes = readFileIfPresent(expectation.paths.archivePath);
  const archiveSha = archiveBytes === undefined ? undefined : sha256(archiveBytes);
  const checksumSha = readChecksum(expectation.paths.checksumPath, errors);

  if (archiveBytes === undefined) {
    errors.push("runtime dependency pack archive runtime-deps.tgz is missing");
  }
  if (checksumSha === undefined) {
    errors.push("runtime dependency pack checksum runtime-deps.sha256 is missing");
  } else if (archiveSha !== undefined && checksumSha !== archiveSha) {
    errors.push("runtime dependency pack checksum mismatch for runtime-deps.tgz");
  }

  if (manifest !== undefined) {
    errors.push(...expectation.runtimeDeps.validateRuntimeDependencyPackManifest({
      manifest,
      mcpRoot: expectation.mcpRoot,
      packageJson: expectation.packageJson,
      packageLock: expectation.packageLock,
      platform: expectation.platform,
      arch: expectation.arch,
      nodeAbi: expectation.nodeAbi,
    }));
    if (archiveSha !== undefined && manifest.archive?.sha256 !== archiveSha) {
      errors.push("runtime dependency pack manifest archive.sha256 must match runtime-deps.tgz");
    }
  }

  let archiveContents;
  if (archiveBytes !== undefined) {
    try {
      archiveContents = extractTarGzContents(expectation.paths.archivePath);
    } catch {
      errors.push("runtime dependency archive runtime-deps.tgz must be a readable gzip tar archive");
    }
  }
  if (archiveContents !== undefined && manifest !== undefined) {
    const archivePackageLockBytes = archiveContents.get("package-lock.json");
    parseArchiveJson(archiveContents.get("package.json"), "package.json", errors);
    parseArchiveJson(archivePackageLockBytes, "package-lock.json", errors);
    const embeddedManifest = parseArchiveJson(archiveContents.get("runtime-deps.manifest.json"), "runtime-deps.manifest.json", errors);
    if (archivePackageLockBytes !== undefined && sha256(archivePackageLockBytes) !== manifest.package_lock?.sha256) {
      errors.push("runtime dependency archive package-lock.json sha256 must match sidecar manifest");
    }
    if (embeddedManifest !== undefined && stableStringify(embeddedManifest) !== stableStringify(embeddedManifestForArchive(manifest))) {
      errors.push("runtime dependency archive embedded manifest must match sidecar manifest metadata");
    }
    errors.push(...validatePublishedArchiveShape({
      entries: [...archiveContents.keys()].sort(),
      productionDependencies: manifest.production_dependencies ?? [],
    }));
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
  };
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
  const expectations = await productionRuntimePackExpectations({
    ...options,
    repoRoot,
    mcpRoot,
  });
  const errors = [];
  const verifications = expectations.map((expectation) => verifyPublishedRuntimeDependencyPack({
    expectation,
    existsSync: exists,
    spawn,
  }));
  for (const verification of verifications) {
    errors.push(...verification.errors);
  }
  const labels = expectations.map((expectation) => expectation.relativePackDir).join(", ");

  if (errors.length > 0) {
    io.stderr.write(`Desk generated artifact verification failed for ${labels}\n`);
    for (const error of errors) {
      io.stderr.write(`- ${error}\n`);
    }
  } else {
    io.stdout.write(`Desk generated artifacts verified for ${labels}\n`);
  }

  return {
    ok: errors.length === 0,
    errors,
    expectations,
    verifications,
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
  defaultPublishedRuntimePackTargets,
  defaultRepoRoot,
  extractTarGzContents,
  gitTracksFile,
  loadRuntimeDeps,
  productionRuntimePackExpectations,
  productionRuntimePackExpectation,
  publishedRuntimePackTargets,
  runCli,
  verifyGeneratedArtifacts,
  verifyPublishedRuntimeDependencyPack,
};
