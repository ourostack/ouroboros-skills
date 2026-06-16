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
  return /\b(troubleshoot|troubleshooting|repair|developer|development|contributor|direct development|local development)\b/u
    .test(headingText(record));
}

function isMcpOnlyFallback(record) {
  return /\b(generic stdio|mcp-only|run it directly|direct launch)\b/u.test(headingText(record));
}

function isNegatedGuidance(record) {
  return /\b(do not|don't|never|without|no |not |rather than|instead of|fails?|rejects?|avoids?|does not|must not)\b/u
    .test(record.lower);
}

function isStrictNegativeGuidance(record) {
  return /\b(do not|don't|never|must not|should not|not part of the healthy path|without manual|without requiring|does not require|do not require|no healthy-path|no (?:normal |manual )?(?:need|requirement|manual|copy|append|mcp registration)|avoid(?:s|ing)? manual)\b/u
    .test(record.lower);
}

function isAllowedManualContext(record) {
  return isDeveloperOrTroubleshooting(record) || isMcpOnlyFallback(record) || isNegatedGuidance(record);
}

function isAllowedManualCommandContext(record) {
  return isDeveloperOrTroubleshooting(record) || isStrictNegativeGuidance(record);
}

function hasUncontrolledWorkerInstructionGuidance(record) {
  const mentionsInstructionTarget =
    /\b(?:agents\.md|codex instructions?|codex worker instructions?|worker default(?: instruction)? block|worker-default(?: instruction)? block|agent files?|worker\.toml)\b/u
      .test(record.lower);
  const hasManualEditVerb =
    /\b(?:append|copy|copied|paste|write|drop|place|add|hand-edit|hand edit|manually edit)\b/u
      .test(record.lower);
  return mentionsInstructionTarget && hasManualEditVerb;
}

function validateHealthyPathRecord(errors, record) {
  if (
    !record.inFence &&
    /\binstall(?:s|ed|ing)?\s+desk\b/u.test(record.lower) &&
    !isAllowedManualContext(record)
  ) {
    errors.push(`${lineRef(record)} frames Desk as something to install manually in healthy-path prose`);
  }

  if (
    /\bnpm\s+install\b/u.test(record.lower) &&
    !isAllowedManualCommandContext(record)
  ) {
    errors.push(`${lineRef(record)} mentions npm install outside troubleshooting/developer notes`);
  }

  if (
    /\bcodex\s+mcp\s+add\b/u.test(record.lower) &&
    !isAllowedManualCommandContext(record)
  ) {
    errors.push(`${lineRef(record)} presents codex mcp add outside troubleshooting/developer notes`);
  }

  if (
    hasUncontrolledWorkerInstructionGuidance(record) &&
    !isDeveloperOrTroubleshooting(record) &&
    !isStrictNegativeGuidance(record)
  ) {
    errors.push(`${lineRef(record)} presents uncontrolled AGENTS/worker copy or append guidance`);
  }
}

function validateHealthyPathLanguage(errors) {
  for (const doc of DOCS) {
    for (const record of markdownLines(doc)) {
      validateHealthyPathRecord(errors, record);
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

function fixtureRecord(text, headingPath = []) {
  return {
    file: "fixture.md",
    line: 1,
    text,
    lower: text.toLowerCase(),
    headingPath,
    inFence: false,
  };
}

function fixtureErrors(text, headingPath = []) {
  const errors = [];
  validateHealthyPathRecord(errors, fixtureRecord(text, headingPath));
  return errors;
}

function assertFixtureFails(errors, text, expected) {
  const found = fixtureErrors(text);
  if (!found.some((error) => error.includes(expected))) {
    errors.push(`docs validator self-test failed: expected ${JSON.stringify(text)} to fail with ${expected}`);
  }
}

function assertFixturePasses(errors, text, headingPath = []) {
  const found = fixtureErrors(text, headingPath);
  if (found.length > 0) {
    errors.push(`docs validator self-test failed: expected ${JSON.stringify(text)} to pass, got ${found.join("; ")}`);
  }
}

function validateValidatorFixtures(errors) {
  assertFixtureFails(
    errors,
    "If activation fails, run `codex mcp add desk` from the repo.",
    "codex mcp add",
  );
  assertFixtureFails(
    errors,
    "Run `npm install` instead of using the runtime pack.",
    "npm install",
  );
  assertFixtureFails(
    errors,
    "Paste the worker default block into your Codex instructions.",
    "AGENTS/worker copy or append",
  );
  assertFixtureFails(
    errors,
    "Append the worker-default instruction block to AGENTS.md.",
    "AGENTS/worker copy or append",
  );

  assertFixturePasses(errors, "Do not run `codex mcp add` for the healthy path.");
  assertFixturePasses(
    errors,
    "If activation fails, run `codex mcp add desk` from the repo.",
    ["Troubleshooting"],
  );
  assertFixturePasses(
    errors,
    "Direct development checkouts can still run `npm install` when intentionally working on the MCP package.",
    ["Developer notes"],
  );
  assertFixturePasses(errors, "Copied agent files are not part of the healthy path.");
}

function run() {
  const errors = [];
  validateValidatorFixtures(errors);
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
