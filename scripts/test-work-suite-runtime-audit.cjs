#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WORK_SUITE_SKILLS = [
  "autopilot",
  "inch-worm",
  "stay-in-turn",
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

function makeSkillRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "work-suite-runtime-audit-"));
  for (const name of WORK_SUITE_SKILLS) {
    const targetDir = path.join(root, name);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(path.join("skills", name, "SKILL.md"), path.join(targetDir, "SKILL.md"));
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

const activeMissing = run([
  "--repo-root",
  ".",
  "--active-skills",
  "work-planner,work-doer,work-merger,stay-in-turn,inch-worm",
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
