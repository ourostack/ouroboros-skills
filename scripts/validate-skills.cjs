#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync: defaultSpawnSync } = require("node:child_process");

const maxCodexSkillDescriptionLength = 1024;
const maxCodexDefaultPromptCount = 3;
const maxCodexDefaultPromptLength = 128;
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

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function frontmatterBlock(body) {
  return body.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? null;
}

function frontmatterScalar(frontmatter, key) {
  const lines = frontmatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`, "u"));
    if (!match) {
      continue;
    }
    const value = match[1].trim();
    if (["|", "|-", ">", ">-"].includes(value)) {
      const blockLines = [];
      for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
        if (/^\S[^:]*:\s*/u.test(lines[blockIndex])) {
          break;
        }
        blockLines.push(lines[blockIndex].replace(/^\s{2,}/u, ""));
      }
      return blockLines.join("\n").trim();
    }
    if (!isQuotedYamlScalar(value) && /:\s/u.test(value)) {
      throw new Error(`${key} inline scalar contains ': '; quote it or use a block scalar`);
    }
    return value.replace(/^"|"$/gu, "").replace(/^'|'$/gu, "");
  }
  return null;
}

function isQuotedYamlScalar(value) {
  return /^(['"]).*\1$/u.test(value);
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

function listSkillFiles(dir, options, out) {
  let entries;
  try {
    entries = readDir(dir, options);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") {
      continue;
    }
    const full = path.join(dir, entry);
    if (stat(full, options).isDirectory()) {
      listSkillFiles(full, options, out);
    } else if (entry === "SKILL.md") {
      out.push(full);
    }
  }
  return out;
}

// Enforces the Agent Skills spec frontmatter limits on EVERY skill in the repo
// (https://agentskills.io/specification): name <=64 chars + matches its directory,
// description non-empty + <=1024 chars. A description over 1024 chars fails to load
// in the Copilot CLI and other Agent Skills runtimes. The authoring rubric for
// writing tight descriptions lives in the skill-management skill.
function validateSkillDescriptionLimits(options = {}) {
  const maxLen = maxCodexSkillDescriptionLength;
  const maxNameLen = 64;
  const files = [];
  for (const root of ["skills", "plugins"]) {
    if (exists(root, options)) {
      listSkillFiles(root, options, files);
    }
  }
  for (const file of files) {
    const frontmatter = frontmatterBlock(readText(file, options));
    if (!frontmatter) {
      throw new Error(`${file}: missing YAML frontmatter`);
    }
    const name = frontmatterScalar(frontmatter, "name");
    const description = frontmatterScalar(frontmatter, "description");
    const dir = path.basename(path.dirname(file));
    if (!hasText(name)) {
      throw new Error(`${file}: frontmatter name is missing`);
    }
    if (name.length > maxNameLen) {
      throw new Error(`${file}: frontmatter name exceeds ${maxNameLen} characters (${name.length})`);
    }
    if (name !== dir) {
      throw new Error(`${file}: frontmatter name "${name}" does not match directory "${dir}"`);
    }
    if (!hasText(description)) {
      throw new Error(`${file}: frontmatter description is missing`);
    }
    if (description.length > maxLen) {
      throw new Error(`${file}: frontmatter description exceeds ${maxLen} characters (${description.length})`);
    }
  }
  console.log(`Validated ${files.length} skill descriptions within ${maxLen} characters.`);
}

function validateAll(options = {}) {
  validateSkillDescriptionLimits(options);
  validateManifest(options);
  validateAppleDistributionKitSkill(options);
}

function validateAppleDistributionKitSkill(options = {}) {
  const {
    childStdio = "inherit",
    repoRoot = process.cwd(),
    spawnSync = defaultSpawnSync,
  } = options;
  const result = spawnSync(process.execPath, ["scripts/check-apple-distribution-kit-skill.cjs"], {
    cwd: repoRoot,
    stdio: childStdio,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("apple distribution kit skill guidance check failed");
  }
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
  startCli,
  validateAll,
  validateAppleDistributionKitSkill,
  validateManifest,
  validateSkillDescriptionLimits,
};

startCli();
