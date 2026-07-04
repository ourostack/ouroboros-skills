#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const requiredNeedles = [
  "apple-distribution-kit",
  "distribution/apple-distribution.json",
  "scripts/apple-distribution-kit.sh",
  "bot.ouro.md",
  "bot.ouro.workbench",
  "app.spoonjoy",
  "APP_STORE_CONNECT_API_KEY_ID",
  "APP_STORE_CONNECT_PROVIDER_PUBLIC_ID",
  "TestFlight Submission Lane",
  "testflight plan",
  "testflight publish",
  "asc get",
  "ExportOptions.testflight.plist",
  "method = app-store-connect",
  "Stop for the operator for:",
  "not source files",
  "non-secret CI/preflight gate",
  "Use app-neutral names for reusable materials",
  "For non-Ouro apps, rename these env vars",
];

function skillPathFor(repoRoot = process.cwd()) {
  return path.join(repoRoot, "skills", "sign-apple-apps", "SKILL.md");
}

function readSkill(repoRoot = process.cwd()) {
  return fs.readFileSync(skillPathFor(repoRoot), "utf8");
}

function findMissingNeedles(skill, needles = requiredNeedles) {
  return needles.filter((needle) => !skill.includes(needle));
}

function checkAppleDistributionKitSkill({
  repoRoot = process.cwd(),
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  const missing = findMissingNeedles(readSkill(repoRoot));
  if (missing.length > 0) {
    stderr.write(
      `sign-apple-apps skill is missing Apple distribution kit guidance: ${missing.join(", ")}\n`,
    );
    return 1;
  }

  stdout.write("sign-apple-apps apple distribution kit guidance ok\n");
  return 0;
}

function startCli({
  isMain = require.main === module,
  run = checkAppleDistributionKitSkill,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  if (!isMain) return;
  setExitCode(run());
}

startCli();

module.exports = {
  checkAppleDistributionKitSkill,
  findMissingNeedles,
  readSkill,
  requiredNeedles,
  skillPathFor,
  startCli,
};
