#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skill = fs.readFileSync(
  path.join(root, "skills", "video-editing", "SKILL.md"),
  "utf8",
);

assert.match(skill, /Choose the production seat/i);
assert.match(skill, /Final Cut Pro-led/i);
assert.match(skill, /script-first/i);
assert.match(skill, /technical hackathon/i);
assert.match(skill, /low-token collaboration/i);
assert.doesNotMatch(skill, /Do not proceed until you understand these answers/);

console.log("video-editing contract: ok");
