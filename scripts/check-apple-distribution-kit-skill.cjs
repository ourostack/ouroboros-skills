#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();
const skillPath = path.join(repoRoot, "skills", "sign-apple-apps", "SKILL.md");
const skill = fs.readFileSync(skillPath, "utf8");

const requiredNeedles = [
  "apple-distribution-kit",
  "distribution/apple-distribution.json",
  "scripts/apple-distribution-kit.sh",
  "bot.ouro.md",
  "bot.ouro.workbench",
  "app.spoonjoy",
  "APP_STORE_CONNECT_API_KEY_ID",
  "APP_STORE_CONNECT_PROVIDER_PUBLIC_ID",
];

const missing = requiredNeedles.filter((needle) => !skill.includes(needle));
if (missing.length > 0) {
  console.error(`sign-apple-apps skill is missing Apple distribution kit guidance: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("sign-apple-apps apple distribution kit guidance ok");
