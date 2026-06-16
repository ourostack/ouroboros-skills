#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: defaultSpawnSync } = require("node:child_process");

const requiredDeskMcpPackageScripts = {
  "activation:support-matrix:generate": "node scripts/generate-support-matrix.js",
  "activation:copilot-bundle:generate": "node scripts/generate-copilot-bundle.js",
  "runtime:deps-pack:build": "node scripts/build-runtime-deps-pack.js",
  "runtime:deps-pack:verify": "node scripts/verify-runtime-deps-pack.js",
  "artifact:vector-pack:build": "node scripts/build-vector-pack.js",
  "artifact:snapshot:build": "node scripts/build-snapshot.js",
  "artifact:snapshot:verify": "node scripts/verify-snapshot.js",
  "artifact:validate": "node scripts/validate-artifacts.js",
};

function repoPath(filePath, { repoRoot = process.cwd() } = {}) {
  return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
}

function readText(filePath, options = {}) {
  const fsImpl = options.fs ?? fs;
  return fsImpl.readFileSync(repoPath(filePath, options), "utf8");
}

function readJson(filePath, options = {}) {
  return JSON.parse(readText(filePath, options));
}

function exists(filePath, options = {}) {
  const fsImpl = options.fs ?? fs;
  return fsImpl.existsSync(repoPath(filePath, options));
}

function readDir(filePath, options = {}) {
  const fsImpl = options.fs ?? fs;
  return fsImpl.readdirSync(repoPath(filePath, options));
}

function stat(filePath, options = {}) {
  const fsImpl = options.fs ?? fs;
  return fsImpl.statSync(repoPath(filePath, options));
}

function validateManifest(options = {}) {
  const manifest = readJson("manifest.json", options);
  if (!Array.isArray(manifest.skills)) {
    throw new Error("manifest.skills must be an array");
  }

  const names = new Set();
  for (const skill of manifest.skills) {
    if (!skill || typeof skill !== "object") {
      throw new Error("every skill entry must be an object");
    }
    if (typeof skill.name !== "string" || skill.name.trim() === "") {
      throw new Error(`invalid skill name: ${JSON.stringify(skill)}`);
    }
    if (names.has(skill.name)) {
      throw new Error(`duplicate skill name: ${skill.name}`);
    }
    names.add(skill.name);

    if (typeof skill.path !== "string" || !skill.path.endsWith("/SKILL.md")) {
      throw new Error(`${skill.name}: path must point at SKILL.md`);
    }
    if (!exists(skill.path, options)) {
      throw new Error(`${skill.name}: missing ${skill.path}`);
    }
    if (typeof skill.description !== "string" || skill.description.trim() === "") {
      throw new Error(`${skill.name}: description is required`);
    }
    if (!Array.isArray(skill.tags) || skill.tags.length === 0) {
      throw new Error(`${skill.name}: tags must be a non-empty array`);
    }

    const body = readText(skill.path, options);
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      throw new Error(`${skill.name}: missing YAML frontmatter`);
    }
    const declaredName = frontmatter[1].match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1];
    if (declaredName !== skill.name) {
      throw new Error(`${skill.name}: frontmatter name is ${declaredName ?? "missing"}`);
    }
  }

  console.log(`Validated ${manifest.skills.length} skills.`);
}

function validateWorkSuiteCopies(options = {}) {
  const pluginSkillsDir = "plugins/work-suite/skills";
  const expectedSkillNames = [
    "autopilot",
    "inch-worm",
    "stay-in-turn",
    "work-doer",
    "work-ideator",
    "work-merger",
    "work-planner",
  ];
  const pluginSkillNames = readDir(pluginSkillsDir, options)
    .filter((name) => stat(path.join(pluginSkillsDir, name), options).isDirectory())
    .sort();

  const missing = expectedSkillNames.filter((name) => !pluginSkillNames.includes(name));
  const extra = pluginSkillNames.filter((name) => !expectedSkillNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`work-suite skill set mismatch: missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`);
  }

  for (const name of expectedSkillNames) {
    const canonicalPath = path.join("skills", name, "SKILL.md");
    const pluginPath = path.join(pluginSkillsDir, name, "SKILL.md");
    if (!exists(canonicalPath, options)) {
      throw new Error(`work-suite skill ${name}: missing canonical ${canonicalPath}`);
    }
    if (!exists(pluginPath, options)) {
      throw new Error(`work-suite skill ${name}: missing plugin copy ${pluginPath}`);
    }
    const canonical = readText(canonicalPath, options);
    const pluginCopy = readText(pluginPath, options);
    if (canonical !== pluginCopy) {
      throw new Error(`work-suite skill ${name}: ${pluginPath} is out of sync with ${canonicalPath}`);
    }
  }

  console.log(`Validated ${expectedSkillNames.length} work-suite plugin skill copies.`);
}

function validatePluginMetadata(options = {}) {
  const pluginsDir = "plugins";
  const pluginNames = readDir(pluginsDir, options)
    .filter((name) => stat(path.join(pluginsDir, name), options).isDirectory())
    .sort();

  for (const name of pluginNames) {
    const claudePath = path.join(pluginsDir, name, ".claude-plugin", "plugin.json");
    const codexPath = path.join(pluginsDir, name, ".codex-plugin", "plugin.json");
    if (!exists(claudePath, options) || !exists(codexPath, options)) {
      continue;
    }
    const claude = readJson(claudePath, options);
    const codex = readJson(codexPath, options);
    if (claude.name !== codex.name) {
      throw new Error(`${name}: Claude plugin name ${claude.name} does not match Codex plugin name ${codex.name}`);
    }
    if (claude.version !== codex.version) {
      throw new Error(`${name}: Claude plugin version ${claude.version} does not match Codex plugin version ${codex.version}`);
    }
  }

  const marketplacePath = path.join(".claude-plugin", "marketplace.json");
  const marketplace = readJson(marketplacePath, options);
  for (const plugin of marketplace.plugins ?? []) {
    if (typeof plugin.source !== "string") {
      continue;
    }
    const pluginPath = path.join(plugin.source, ".claude-plugin", "plugin.json");
    if (!exists(pluginPath, options)) {
      throw new Error(`${plugin.name}: marketplace source is missing ${pluginPath}`);
    }
    const manifest = readJson(pluginPath, options);
    if (plugin.name !== manifest.name) {
      throw new Error(`${plugin.name}: marketplace name does not match ${pluginPath} name ${manifest.name}`);
    }
    if (plugin.version !== manifest.version) {
      throw new Error(`${plugin.name}: marketplace version ${plugin.version} does not match ${pluginPath} version ${manifest.version}`);
    }
  }

  console.log("Validated plugin metadata.");
}

function validateDeskMcpPackageScripts(options = {}) {
  const packagePath = path.join("plugins", "desk", "mcp", "package.json");
  const packageJson = readJson(packagePath, options);
  for (const [scriptName, command] of Object.entries(requiredDeskMcpPackageScripts)) {
    if (packageJson.scripts?.[scriptName] !== command) {
      throw new Error(`desk MCP package script ${scriptName} must be ${command}`);
    }
    const targetPath = path.join("plugins", "desk", "mcp", command.replace(/^node\s+scripts\//u, "scripts/"));
    if (!exists(targetPath, options)) {
      throw new Error(`desk MCP package script ${scriptName} target is missing: ${targetPath}`);
    }
  }

  console.log(`Validated ${Object.keys(requiredDeskMcpPackageScripts).length} desk MCP package scripts.`);
}

function runDeskFreshnessChecks(options = {}) {
  const {
    childStdio = "inherit",
    repoRoot = process.cwd(),
    spawnSync = defaultSpawnSync,
  } = options;
  validateDeskMcpPackageScripts(options);

  const hostManifestResult = spawnSync(process.execPath, ["scripts/test-desk-host-manifests.cjs"], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((hostManifestResult.status ?? 1) !== 0) {
    throw new Error("desk host manifest freshness tests failed");
  }

  const generatedArtifactResult = spawnSync(process.execPath, ["scripts/test-desk-generated-artifacts.cjs"], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((generatedArtifactResult.status ?? 1) !== 0) {
    throw new Error("desk generated artifact freshness tests failed");
  }
}

function runRuntimeAudit(options = {}) {
  const {
    childStdio = "inherit",
    repoRoot = process.cwd(),
    spawnSync = defaultSpawnSync,
  } = options;
  const autopilotStateResult = spawnSync(process.execPath, ["scripts/test-autopilot-state-audit.cjs"], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((autopilotStateResult.status ?? 1) !== 0) {
    throw new Error("autopilot state audit tests failed");
  }

  const testResult = spawnSync(process.execPath, ["scripts/test-work-suite-runtime-audit.cjs"], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((testResult.status ?? 1) !== 0) {
    throw new Error("work-suite runtime visibility audit tests failed");
  }

  const result = spawnSync(process.execPath, ["scripts/audit-work-suite-runtime.cjs", "--repo-root", "."], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("work-suite runtime visibility contract audit failed");
  }
}

function validateAll(options = {}) {
  validateManifest(options);
  validateWorkSuiteCopies(options);
  validatePluginMetadata(options);
  runDeskFreshnessChecks(options);
  runRuntimeAudit(options);
}

function run({
  stderr = process.stderr,
  stdout = process.stdout,
  validateAllFn = validateAll,
  ...options
} = {}) {
  try {
    validateAllFn({ ...options, stderr, stdout });
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function startCli({
  isMain = require.main === module,
  runFn = run,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  if (!isMain) return null;
  const code = runFn();
  setExitCode(code);
  return code;
}

module.exports = {
  readJson,
  run,
  runDeskFreshnessChecks,
  runRuntimeAudit,
  startCli,
  validateAll,
  validateDeskMcpPackageScripts,
  validateManifest,
  validatePluginMetadata,
  validateWorkSuiteCopies,
};

startCli();
