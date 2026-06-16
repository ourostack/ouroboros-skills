#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

const DOCS = Object.freeze([
  "plugins/desk/README.md",
  "plugins/desk/docs/agent-files.md",
  "plugins/desk/mcp/README.md",
  "plugins/desk/activation/README.md",
  "plugins/desk/docs/dependency-activation-stories-and-criteria.md",
  "desk/tasks/2026-06-14-1335-planning-desk-dependency-activation.md",
]);

const PRIVACY_REQUIRED_DOCS = Object.freeze([
  "plugins/desk/README.md",
  "plugins/desk/mcp/README.md",
  "plugins/desk/activation/README.md",
]);

const WORKFLOW_REQUIREMENTS = Object.freeze([
  Object.freeze({
    path: ".github/workflows/validate-skills.yml",
    command: "node scripts/test-desk-docs.cjs",
  }),
  Object.freeze({
    path: ".github/workflows/desk-mcp-tests.yml",
    command: "node scripts/test-desk-docs.cjs",
    paths: [
      "plugins/desk/README.md",
      "plugins/desk/docs/**",
      "plugins/desk/mcp/README.md",
      "plugins/desk/activation/README.md",
      "desk/tasks/2026-06-14-1335-planning-desk-dependency-activation.md",
      "scripts/test-desk-docs.cjs",
    ],
  }),
]);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function markdownLines(relativePath) {
  const lines = readRepoFile(relativePath).split(/\r?\n/u);
  const records = [];
  const headings = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (/^\s*```/u.test(text)) inFence = !inFence;
    if (!inFence) {
      const heading = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
      if (heading) {
        const depth = heading[1].length;
        headings.length = depth - 1;
        headings.push(heading[2]);
      }
    }
    records.push({
      file: relativePath,
      line: index + 1,
      text,
      lower: text.toLowerCase(),
      headingPath: [...headings],
      inFence,
    });
  }
  return records;
}

function lineRef(record) {
  return `${record.file}:${record.line}`;
}

function headingText(record) {
  return record.headingPath.join(" > ").toLowerCase();
}

function isDeveloperOrTroubleshooting(record) {
  return /\b(troubleshoot|repair|developer|development|contributor|direct development|local development)\b/u
    .test(headingText(record));
}

function isMcpOnlyFallback(record) {
  return /\b(generic stdio|mcp-only|run it directly|direct launch)\b/u.test(headingText(record));
}

function isNegatedGuidance(record) {
  return /\b(do not|don't|never|without|no |not |rather than|instead of|fails?|rejects?|avoids?|does not|must not)\b/u
    .test(record.lower);
}

function isAllowedManualContext(record) {
  return isDeveloperOrTroubleshooting(record) || isMcpOnlyFallback(record) || isNegatedGuidance(record);
}

function validateHealthyPathLanguage(errors) {
  for (const doc of DOCS) {
    for (const record of markdownLines(doc)) {
      if (
        !record.inFence &&
        /\binstall(?:s|ed|ing)?\s+desk\b/u.test(record.lower) &&
        !isAllowedManualContext(record)
      ) {
        errors.push(`${lineRef(record)} frames Desk as something to install manually in healthy-path prose`);
      }

      if (
        /\bnpm\s+install\b/u.test(record.lower) &&
        !isDeveloperOrTroubleshooting(record) &&
        !isNegatedGuidance(record)
      ) {
        errors.push(`${lineRef(record)} mentions npm install outside troubleshooting/developer notes`);
      }

      if (
        /\bcodex\s+mcp\s+add\b/u.test(record.lower) &&
        !isDeveloperOrTroubleshooting(record) &&
        !isNegatedGuidance(record)
      ) {
        errors.push(`${lineRef(record)} presents codex mcp add outside troubleshooting/developer notes`);
      }

      if (
        /\b(?:append|copy|copied)\b.*\b(?:agents\.md|codex worker instructions|agent files?)\b/u.test(record.lower) &&
        !/\b(owned|delimited|controlled|without|no |not |never|do not|does not|avoid|avoids|not part of the healthy path)\b/u
          .test(record.lower)
      ) {
        errors.push(`${lineRef(record)} presents uncontrolled AGENTS/worker copy or append guidance`);
      }
    }
  }
}

function validatePrivacyNotes(errors) {
  for (const doc of PRIVACY_REQUIRED_DOCS) {
    const lower = readRepoFile(doc).toLowerCase();
    const hasPrivacyNote =
      lower.includes("derivative data") &&
      lower.includes("privacy risk") &&
      lower.includes("embedding") &&
      lower.includes("snapshot");
    if (!hasPrivacyNote) {
      errors.push(`${doc} must state that embeddings and snapshots are derivative data and may carry privacy risk`);
    }
  }
}

function validateWorkflowWiring(errors) {
  for (const requirement of WORKFLOW_REQUIREMENTS) {
    const body = readRepoFile(requirement.path);
    if (!body.includes(requirement.command)) {
      errors.push(`${requirement.path} must run ${requirement.command}`);
    }
    for (const requiredPath of requirement.paths ?? []) {
      if (!body.includes(`"${requiredPath}"`) && !body.includes(`'${requiredPath}'`) && !body.includes(requiredPath)) {
        errors.push(`${requirement.path} path filters must include ${requiredPath}`);
      }
    }
  }
}

function run() {
  const errors = [];
  validateWorkflowWiring(errors);
  validateHealthyPathLanguage(errors);
  validatePrivacyNotes(errors);

  if (errors.length > 0) {
    console.error("Desk docs validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    return 1;
  }
  console.log("Desk docs validation passed.");
  return 0;
}

process.exitCode = run();
