#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const skillPath = path.join(repoRoot, "plugins", "desk", "skills", "using-desk", "SKILL.md");
const maxCodexSkillDescriptionLength = 1024;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function listSkillFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSkillFiles(fullPath, out);
    } else if (entry.name === "SKILL.md") {
      out.push(fullPath);
    }
  }
  return out;
}

function frontmatterScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "mu"));
  if (!match) {
    return null;
  }
  return match[1].trim().replace(/^['"]|['"]$/gu, "");
}

function main() {
  assert.ok(fs.existsSync(skillPath), `missing skill file: ${path.relative(repoRoot, skillPath)}`);

  const skill = read(skillPath);
  const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/u);
  assert.ok(frontmatterMatch, "using-desk skill must include YAML frontmatter");

  const frontmatter = frontmatterMatch[1];
  assert.equal(frontmatterScalar(frontmatter, "name"), "using-desk");

  const description = frontmatterScalar(frontmatter, "description");
  assert.ok(description, "using-desk skill must include a description");
  assert.ok(
    description.length <= maxCodexSkillDescriptionLength,
    `using-desk description exceeds ${maxCodexSkillDescriptionLength} characters`,
  );

  const usingDeskSkills = listSkillFiles(path.join(repoRoot, "plugins", "desk", "skills"))
    .filter((filePath) => /(^|\n)name:\s*["']?using-desk["']?\s*$/mu.test(read(filePath)));
  assert.equal(
    usingDeskSkills.length,
    1,
    `expected exactly one using-desk skill definition, found ${usingDeskSkills.length}`,
  );
  assert.equal(usingDeskSkills[0], skillPath, "using-desk must live at plugins/desk/skills/using-desk/SKILL.md");

  for (const phrase of [
    "The human supplies intent",
    "The agent owns execution",
    "one durable work identity",
    "waiting, repeated synchronization, avoidable rework, or churn",
    "delay, batching, freezing, or resequencing",
    "not maximum agent utilization",
    "verification, review, safety, authority, and real urgency controls intact",
    "must not be silently confused",
    "agentic-engineering-v2-rfc.md",
    "does not automatically read the RFC",
    "child agents",
  ]) {
    assert.match(skill, new RegExp(escapeRegExp(phrase), "iu"));
  }

  const flowSection = skill.match(/## Flow judgment\n\n([\s\S]*?)\n\n## Delegation judgment/u);
  assert.ok(flowSection, "using-desk must include the Flow judgment section");
  assert.equal(
    flowSection[1].split("\n").length,
    1,
    "using-desk Flow judgment prose must stay on one physical line",
  );

  assert.doesNotMatch(skill, /\bADO\b|\bTeams\b|\bMicrosoft\b|\bPWF\b|submissionId|approvals_create/u);

  console.log("using-desk foundation contract passed.");
}

main();
