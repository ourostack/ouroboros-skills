#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WORK_SUITE_SKILLS = [
  "autopilot",
  "deep-research",
  "inch-worm",
  "stay-in-turn",
  "visual-qa-dogfood",
  "work-doer",
  "work-ideator",
  "work-merger",
  "work-planner",
];

function run(args) {
  return spawnSync(process.execPath, ["scripts/audit-work-suite-runtime.cjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function latestCommit(name) {
  const result = spawnSync("git", ["log", "-1", "--format=%H", "--", `skills/${name}/SKILL.md`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function makeRegistry(overrides = {}) {
  const installed = "2026-06-12T00:00:00.000Z";
  const registry = {};
  for (const name of WORK_SUITE_SKILLS) {
    registry[name] = {
      source: `https://raw.githubusercontent.com/ourostack/ouroboros-skills/main/skills/${name}/SKILL.md`,
      commit: latestCommit(name),
      installed,
      selfAuthored: false,
      ...(overrides[name] ?? {}),
    };
  }
  return registry;
}

function makeSkillRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-suite-runtime-audit-"));
  for (const name of WORK_SUITE_SKILLS) {
    const targetDir = path.join(root, name);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(path.join("skills", name, "SKILL.md"), path.join(targetDir, "SKILL.md"));
  }
  if (options.registry !== false) {
    fs.writeFileSync(path.join(root, "_registry.json"), `${JSON.stringify(makeRegistry(options.registryOverrides), null, 2)}\n`, "utf8");
  }
  return root;
}

function parseJson(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function makeRepoCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-suite-runtime-audit-repo-"));
  fs.cpSync("manifest.json", path.join(root, "manifest.json"));
  fs.cpSync("skills", path.join(root, "skills"), { recursive: true });
  fs.cpSync("plugins", path.join(root, "plugins"), { recursive: true });
  return root;
}

const sourceOnly = parseJson(run(["--repo-root", ".", "--json"]));
assert.equal(sourceOnly.status, "pass");
assert.equal(sourceOnly.source.status, "pass");
assert.equal(sourceOnly.active.status, "not_provided");

const fullRoot = makeSkillRoot();
const strictInstalled = parseJson(run([
  "--repo-root",
  ".",
  "--skill-root",
  fullRoot,
  "--strict-installed",
  "--json",
]));
assert.equal(strictInstalled.status, "pass");
assert.equal(strictInstalled.installedRoots[0].status, "pass");

const missingRoot = makeSkillRoot();
fs.rmSync(path.join(missingRoot, "autopilot"), { recursive: true, force: true });
const strictMissing = run([
  "--repo-root",
  ".",
  "--skill-root",
  missingRoot,
  "--strict-installed",
  "--json",
]);
assert.notEqual(strictMissing.status, 0);
const strictMissingJson = JSON.parse(strictMissing.stdout);
assert.equal(strictMissingJson.status, "fail");
assert.equal(strictMissingJson.installedRoots[0].status, "fail");
assert.match(strictMissing.stdout, /missing autopilot\/SKILL\.md/);

const missingRegistryRoot = makeSkillRoot({ registry: false });
const missingRegistry = run([
  "--repo-root",
  ".",
  "--skill-root",
  missingRegistryRoot,
  "--strict-installed",
  "--json",
]);
assert.notEqual(missingRegistry.status, 0);
const missingRegistryJson = JSON.parse(missingRegistry.stdout);
assert.equal(missingRegistryJson.status, "fail");
assert.equal(missingRegistryJson.installedRoots[0].status, "warn");
assert.match(missingRegistry.stdout, /missing _registry\.json/);

const staleRegistryRoot = makeSkillRoot({
  registryOverrides: {
    autopilot: {
      commit: "0000000000000000000000000000000000000000",
    },
  },
});
const staleRegistry = run([
  "--repo-root",
  ".",
  "--skill-root",
  staleRegistryRoot,
  "--strict-installed",
  "--json",
]);
assert.notEqual(staleRegistry.status, 0);
const staleRegistryJson = JSON.parse(staleRegistry.stdout);
assert.equal(staleRegistryJson.status, "fail");
assert.equal(staleRegistryJson.installedRoots[0].status, "warn");
assert.match(staleRegistry.stdout, /autopilot\.commit is 0000000000000000000000000000000000000000/);

const missingSelfAuthoredRoot = makeSkillRoot({
  registryOverrides: {
    autopilot: {
      commit: "0000000000000000000000000000000000000000",
      selfAuthored: undefined,
    },
  },
});
const missingSelfAuthored = run([
  "--repo-root",
  ".",
  "--skill-root",
  missingSelfAuthoredRoot,
  "--strict-installed",
  "--json",
]);
assert.notEqual(missingSelfAuthored.status, 0);
const missingSelfAuthoredJson = JSON.parse(missingSelfAuthored.stdout);
assert.equal(missingSelfAuthoredJson.status, "fail");
assert.equal(missingSelfAuthoredJson.installedRoots[0].status, "warn");
assert.match(missingSelfAuthored.stdout, /autopilot\.selfAuthored is missing/);
assert.match(missingSelfAuthored.stdout, /autopilot\.commit is 0000000000000000000000000000000000000000/);

const nonGitRepo = makeRepoCopy();
const nonGitRoot = makeSkillRoot();
const nonGitStrict = run([
  "--repo-root",
  nonGitRepo,
  "--skill-root",
  nonGitRoot,
  "--strict-installed",
  "--json",
]);
assert.notEqual(nonGitStrict.status, 0);
const nonGitStrictJson = JSON.parse(nonGitStrict.stdout);
assert.equal(nonGitStrictJson.status, "fail");
assert.equal(nonGitStrictJson.installedRoots[0].status, "warn");
assert.match(nonGitStrict.stdout, /cannot verify _registry\.json autopilot\.commit/);

const activeMissing = run([
  "--repo-root",
  ".",
  "--active-skills",
  "work-planner,work-doer,work-merger,stay-in-turn,inch-worm,visual-qa-dogfood,deep-research",
  "--strict-active",
  "--json",
]);
assert.notEqual(activeMissing.status, 0);
const activeMissingJson = JSON.parse(activeMissing.stdout);
assert.equal(activeMissingJson.status, "fail");
assert.deepEqual(activeMissingJson.active.missing, ["autopilot", "work-ideator"]);

const activeFull = parseJson(run([
  "--repo-root",
  ".",
  "--active-skills",
  WORK_SUITE_SKILLS.join(","),
  "--strict-active",
  "--json",
]));
assert.equal(activeFull.status, "pass");
assert.equal(activeFull.active.status, "pass");

const activePrefixed = parseJson(run([
  "--repo-root",
  ".",
  "--active-skills",
  WORK_SUITE_SKILLS.map((name) => `work-suite:${name}`).join(","),
  "--strict-active",
  "--json",
]));
assert.equal(activePrefixed.status, "pass");
assert.equal(activePrefixed.active.status, "pass");

const activeFile = path.join(os.tmpdir(), `work-suite-runtime-audit-active-${Date.now()}.json`);
fs.writeFileSync(activeFile, JSON.stringify({
  skills: WORK_SUITE_SKILLS.map((name) => ({ name: `work-suite:${name}` })),
}), "utf8");
const activeFilePrefixed = parseJson(run([
  "--repo-root",
  ".",
  "--active-skills-file",
  activeFile,
  "--strict-active",
  "--json",
]));
assert.equal(activeFilePrefixed.status, "pass");
assert.equal(activeFilePrefixed.active.status, "pass");
fs.rmSync(activeFile, { force: true });

const extraPluginRepo = makeRepoCopy();
fs.mkdirSync(path.join(extraPluginRepo, "plugins", "work-suite", "skills", "extra-skill"), { recursive: true });
fs.writeFileSync(path.join(extraPluginRepo, "plugins", "work-suite", "skills", "extra-skill", "SKILL.md"), "---\nname: extra-skill\n---\n", "utf8");
const extraPlugin = run(["--repo-root", extraPluginRepo, "--json"]);
assert.notEqual(extraPlugin.status, 0);
const extraPluginJson = JSON.parse(extraPlugin.stdout);
assert.equal(extraPluginJson.status, "fail");
assert.match(extraPlugin.stdout, /extra=\[extra-skill\]/);

console.log("work-suite runtime audit tests passed.");
