#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const defaultPlugins = Object.freeze(["desk", "work-suite"]);
const namespace = "ourostack";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfPresent(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return readJson(filePath);
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function pluginManifestPath(root, pluginName) {
  return path.join(root, "plugins", pluginName, ".codex-plugin", "plugin.json");
}

function marketplacePlugin(marketplace, pluginName) {
  return (marketplace.plugins ?? []).find((plugin) => plugin.name === pluginName) ?? null;
}

function marketplaceSourcePath({ repoRoot, marketplacePath, plugin }) {
  const sourcePath = plugin?.source?.path;
  if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) return null;
  const base = path.isAbsolute(marketplacePath)
    ? path.dirname(path.dirname(path.dirname(marketplacePath)))
    : repoRoot;
  return path.resolve(base, sourcePath);
}

function cacheManifestPath({ cacheRoot, pluginName, version }) {
  return path.join(
    cacheRoot,
    namespace,
    pluginName,
    version,
    ".codex-plugin",
    "plugin.json",
  );
}

function compareManifest(actual, expected) {
  if (actual === null) {
    return { current: false, reason: "missing" };
  }
  if (!sameJson(actual, expected)) {
    return { current: false, reason: "manifest-drift" };
  }
  return { current: true, reason: "current" };
}

function auditPlugin({ repoRoot, cacheRoot, marketplace, marketplacePath, pluginName }) {
  const repoManifestPath = pluginManifestPath(repoRoot, pluginName);
  const repoManifest = readJson(repoManifestPath);
  const marketplaceEntry = marketplacePlugin(marketplace, pluginName);
  const sourceRoot = marketplaceSourcePath({ repoRoot, marketplacePath, plugin: marketplaceEntry });
  const sourceManifestPath = sourceRoot === null
    ? null
    : path.join(sourceRoot, ".codex-plugin", "plugin.json");
  const sourceComparison = sourceManifestPath === null
    ? { current: false, reason: "missing-marketplace-source" }
    : compareManifest(readJsonIfPresent(sourceManifestPath), repoManifest);
  const installedManifestPath = cacheManifestPath({
    cacheRoot,
    pluginName,
    version: repoManifest.version,
  });
  const cacheComparison = compareManifest(readJsonIfPresent(installedManifestPath), repoManifest);

  return {
    name: pluginName,
    version: repoManifest.version,
    repo_manifest_path: repoManifestPath,
    marketplace_source_path: sourceManifestPath,
    repo_source_current: sourceComparison.current,
    repo_source_reason: sourceComparison.reason,
    installed_cache_path: installedManifestPath,
    installed_cache_current: cacheComparison.current,
    installed_cache_reason: cacheComparison.reason,
    active_session_visible: "not_checked",
    active_session_reason: "Codex Desktop/active-thread plugin visibility is a host runtime state, not a filesystem property.",
  };
}

function auditCodexPluginCache({
  repoRoot = path.resolve(__dirname, ".."),
  codexHome = path.join(os.homedir(), ".codex"),
  cacheRoot = path.join(codexHome, "plugins", "cache"),
  marketplacePath = path.join(repoRoot, ".agents", "plugins", "marketplace.json"),
  plugins = defaultPlugins,
} = {}) {
  const marketplace = readJson(marketplacePath);
  const pluginReports = plugins.map((pluginName) => auditPlugin({
    repoRoot,
    cacheRoot,
    marketplace,
    marketplacePath,
    pluginName,
  }));
  return {
    status: pluginReports.every((plugin) => (
      plugin.repo_source_current && plugin.installed_cache_current
    )) ? "current" : "stale",
    repo_root: repoRoot,
    codex_home: codexHome,
    marketplace_path: marketplacePath,
    cache_root: cacheRoot,
    evidence_states: {
      repo_source_current: "compares .agents marketplace source manifests with repo manifests",
      installed_cache_current: "compares ~/.codex/plugins/cache manifests with repo manifests",
      active_session_visible: "not_checked by this read-only audit; requires host/session reload or host API proof",
    },
    plugins: pluginReports,
  };
}

function parseArgs(argv) {
  const options = { plugins: [...defaultPlugins], strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo-root" && argv[index + 1]) {
      options.repoRoot = path.resolve(argv[++index]);
    } else if (arg === "--codex-home" && argv[index + 1]) {
      options.codexHome = path.resolve(argv[++index]);
    } else if (arg === "--cache-root" && argv[index + 1]) {
      options.cacheRoot = path.resolve(argv[++index]);
    } else if (arg === "--marketplace" && argv[index + 1]) {
      options.marketplacePath = path.resolve(argv[++index]);
    } else if (arg === "--plugins" && argv[index + 1]) {
      options.plugins = argv[++index].split(",").map((name) => name.trim()).filter(Boolean);
    } else if (arg === "--strict") {
      options.strict = true;
    }
  }
  return options;
}

function run({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseArgs(argv);
    const report = auditCodexPluginCache(options);
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return options.strict && report.status !== "current" ? 1 : 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  auditCodexPluginCache,
  run,
};
