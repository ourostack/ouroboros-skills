#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateManifest() {
  const manifest = readJson("manifest.json");
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
    if (!fs.existsSync(skill.path)) {
      throw new Error(`${skill.name}: missing ${skill.path}`);
    }
    if (typeof skill.description !== "string" || skill.description.trim() === "") {
      throw new Error(`${skill.name}: description is required`);
    }
    if (!Array.isArray(skill.tags) || skill.tags.length === 0) {
      throw new Error(`${skill.name}: tags must be a non-empty array`);
    }

    const body = fs.readFileSync(skill.path, "utf8");
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

function validateWorkSuiteCopies() {
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
  const pluginSkillNames = fs.readdirSync(pluginSkillsDir)
    .filter((name) => fs.statSync(path.join(pluginSkillsDir, name)).isDirectory())
    .sort();

  const missing = expectedSkillNames.filter((name) => !pluginSkillNames.includes(name));
  const extra = pluginSkillNames.filter((name) => !expectedSkillNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`work-suite skill set mismatch: missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`);
  }

  for (const name of expectedSkillNames) {
    const canonicalPath = path.join("skills", name, "SKILL.md");
    const pluginPath = path.join(pluginSkillsDir, name, "SKILL.md");
    if (!fs.existsSync(canonicalPath)) {
      throw new Error(`work-suite skill ${name}: missing canonical ${canonicalPath}`);
    }
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`work-suite skill ${name}: missing plugin copy ${pluginPath}`);
    }
    const canonical = fs.readFileSync(canonicalPath, "utf8");
    const pluginCopy = fs.readFileSync(pluginPath, "utf8");
    if (canonical !== pluginCopy) {
      throw new Error(`work-suite skill ${name}: ${pluginPath} is out of sync with ${canonicalPath}`);
    }
  }

  console.log(`Validated ${expectedSkillNames.length} work-suite plugin skill copies.`);
}

function validatePluginMetadata() {
  const pluginsDir = "plugins";
  const pluginNames = fs.readdirSync(pluginsDir)
    .filter((name) => fs.statSync(path.join(pluginsDir, name)).isDirectory())
    .sort();

  for (const name of pluginNames) {
    const claudePath = path.join(pluginsDir, name, ".claude-plugin", "plugin.json");
    const codexPath = path.join(pluginsDir, name, ".codex-plugin", "plugin.json");
    if (!fs.existsSync(claudePath) || !fs.existsSync(codexPath)) {
      continue;
    }
    const claude = readJson(claudePath);
    const codex = readJson(codexPath);
    if (claude.name !== codex.name) {
      throw new Error(`${name}: Claude plugin name ${claude.name} does not match Codex plugin name ${codex.name}`);
    }
    if (claude.version !== codex.version) {
      throw new Error(`${name}: Claude plugin version ${claude.version} does not match Codex plugin version ${codex.version}`);
    }
  }

  const marketplacePath = path.join(".claude-plugin", "marketplace.json");
  const marketplace = readJson(marketplacePath);
  for (const plugin of marketplace.plugins ?? []) {
    if (typeof plugin.source !== "string") {
      continue;
    }
    const pluginPath = path.join(plugin.source, ".claude-plugin", "plugin.json");
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`${plugin.name}: marketplace source is missing ${pluginPath}`);
    }
    const manifest = readJson(pluginPath);
    if (plugin.name !== manifest.name) {
      throw new Error(`${plugin.name}: marketplace name does not match ${pluginPath} name ${manifest.name}`);
    }
    if (plugin.version !== manifest.version) {
      throw new Error(`${plugin.name}: marketplace version ${plugin.version} does not match ${pluginPath} version ${manifest.version}`);
    }
  }

  console.log("Validated plugin metadata.");
}

function runRuntimeAudit() {
  const autopilotStateResult = spawnSync(process.execPath, ["scripts/test-autopilot-state-audit.cjs"], {
    stdio: "inherit",
  });
  if ((autopilotStateResult.status ?? 1) !== 0) {
    throw new Error("autopilot state audit tests failed");
  }

  const testResult = spawnSync(process.execPath, ["scripts/test-work-suite-runtime-audit.cjs"], {
    stdio: "inherit",
  });
  if ((testResult.status ?? 1) !== 0) {
    throw new Error("work-suite runtime visibility audit tests failed");
  }

  const result = spawnSync(process.execPath, ["scripts/audit-work-suite-runtime.cjs", "--repo-root", "."], {
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("work-suite runtime visibility contract audit failed");
  }
}

try {
  validateManifest();
  validateWorkSuiteCopies();
  validatePluginMetadata();
  runRuntimeAudit();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
