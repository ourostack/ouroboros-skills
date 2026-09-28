#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const event = process.argv[2];
const claudeEvents = ["SessionStart", "SubagentStart"];
const copilotEvents = ["sessionStart"];

if (![...claudeEvents, ...copilotEvents].includes(event)) {
  console.error(`unsupported Plain Language hook event: ${event || "missing"}`);
  process.exit(1);
}

const skillPath = path.join(__dirname, "..", "skills", "plain-language", "SKILL.md");

// The one place that reads the skill: its body after the frontmatter, behind the contract tag.
// A failure returns a one-line diagnostic instead of throwing, and each host decides what to do with it.
function loadContract() {
  try {
    const body = fs.readFileSync(skillPath, "utf8").replace(/^---[\s\S]*?---\s*/u, "");
    return { contract: `[PLAIN_LANGUAGE_CONTRACT]\n${body}` };
  } catch (error) {
    return { failure: `Plain Language hook could not load ${skillPath}: ${error.message}` };
  }
}

const { contract, failure } = loadContract();

if (copilotEvents.includes(event)) {
  // Copilot merges every installed plugin's sessionStart output, so one
  // plugin's failure must never block the rest: any error becomes a
  // one-line diagnostic in `additionalContext`, and the process still
  // exits 0.
  process.stdout.write(JSON.stringify({ additionalContext: contract ?? failure }));
  process.exit(0);
}

if (failure !== undefined) {
  console.error(failure);
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: event,
    additionalContext: contract,
  },
}));
