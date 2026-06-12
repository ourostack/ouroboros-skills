#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REQUIRED_SECTIONS = [
  "Current Item",
  "Terminal Evidence",
  "Continuation Scan",
  "Stop Condition",
];

const ALLOWED_CLASSIFICATIONS = new Set([
  "ready",
  "needs reviewer gate",
  "hard exception",
  "deferred by scope",
  "none",
]);

const BLOCKING_CLASSIFICATIONS = new Set([
  "ready",
  "needs reviewer gate",
]);

function usage() {
  return [
    "Usage: node scripts/audit-autopilot-state.cjs --state-file <path> [options]",
    "",
    "Options:",
    "  --state-file <path>  Markdown state file containing the exit preflight proof.",
    "  --json               Emit machine-readable JSON.",
    "  --help               Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    stateFile: null,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--state-file") {
      args.stateFile = requireValue(argv, ++index, arg);
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function expandHome(inputPath) {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function normalizeHeading(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectSections(markdown) {
  const sections = new Map();
  const visibleMarkdown = linesOutsideFences(markdown).join("\n");
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const matches = [...visibleMarkdown.matchAll(headingPattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const heading = match[1].trim();
    const start = match.index + match[0].length;
    const end = next ? next.index : visibleMarkdown.length;
    sections.set(normalizeHeading(heading), visibleMarkdown.slice(start, end).trim());
  }

  return sections;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function linesOutsideFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let fenceCharacter = null;

  return lines.map((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceCharacter = marker;
      } else if (marker === fenceCharacter) {
        inFence = false;
        fenceCharacter = null;
      }
      return "";
    }

    return inFence ? "" : line;
  });
}

function normalizeClassification(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseContinuationTables(markdown) {
  const lines = linesOutsideFences(markdown);
  const rows = [];
  let tableCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("|")) {
      continue;
    }

    const headers = splitTableRow(line).map((cell) => cell.toLowerCase());
    const candidateIndex = headers.indexOf("candidate");
    const classificationIndex = headers.indexOf("classification");
    const evidenceIndex = headers.indexOf("evidence");
    const dispositionIndex = headers.indexOf("disposition");
    if (
      candidateIndex === -1 ||
      classificationIndex === -1 ||
      evidenceIndex === -1 ||
      dispositionIndex === -1
    ) {
      continue;
    }

    tableCount += 1;
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex];
      if (!rowLine.trim()) {
        index = rowIndex;
        break;
      }
      if (!rowLine.includes("|")) {
        index = rowIndex;
        break;
      }

      const cells = splitTableRow(rowLine);
      if (isSeparatorRow(cells)) {
        continue;
      }

      rows.push({
        candidate: cells[candidateIndex] ?? "",
        classification: normalizeClassification(cells[classificationIndex] ?? ""),
        evidence: cells[evidenceIndex] ?? "",
        disposition: cells[dispositionIndex] ?? "",
      });
    }
  }

  return {
    tableCount,
    rows,
  };
}

function auditState(markdown, stateFile) {
  const issues = [];
  const sections = collectSections(markdown);

  for (const section of REQUIRED_SECTIONS) {
    const body = sections.get(normalizeHeading(section));
    if (!body) {
      issues.push(`missing or empty section: ## ${section}`);
    }
  }

  const terminalEvidence = sections.get(normalizeHeading("Terminal Evidence")) ?? "";
  if (terminalEvidence && !/(merged|ci|check|test|deploy|publish|install|smoke|verified|not applicable|n\/a)/i.test(terminalEvidence)) {
    issues.push("Terminal Evidence must include concrete merge/check/deploy/install/smoke evidence or an explicit non-applicable note");
  }

  const continuationScan = sections.get(normalizeHeading("Continuation Scan")) ?? "";
  const parsedScan = continuationScan ? parseContinuationTables(continuationScan) : { tableCount: 0, rows: [] };
  const candidates = parsedScan.rows;
  const noneRows = candidates.filter((candidate) => candidate.classification === "none");
  if (parsedScan.tableCount === 0) {
    issues.push("Continuation Scan must include a markdown table with candidate, classification, evidence, and disposition columns");
  } else if (candidates.length === 0) {
    issues.push("Continuation Scan table must include at least one row. Use a single 'none' sentinel row when no candidates remain");
  } else {
    if (noneRows.length > 0 && candidates.length > 1) {
      issues.push("Continuation Scan 'none' classification must be the only row because it means no candidates remain");
    }
    for (const candidate of candidates) {
      const label = candidate.candidate || "(unnamed candidate)";
      if (!candidate.candidate.trim()) {
        issues.push("Continuation Scan row has an empty candidate");
      }
      if (!candidate.evidence.trim()) {
        issues.push(`${label}: missing evidence`);
      }
      if (!candidate.disposition.trim()) {
        issues.push(`${label}: missing disposition`);
      }
      if (!ALLOWED_CLASSIFICATIONS.has(candidate.classification)) {
        issues.push(`${label}: invalid classification '${candidate.classification}'`);
      } else if (BLOCKING_CLASSIFICATIONS.has(candidate.classification)) {
        issues.push(`${label}: classification '${candidate.classification}' means autopilot must keep working before a final response`);
      }
    }
  }

  const stopCondition = sections.get(normalizeHeading("Stop Condition")) ?? "";
  if (stopCondition && !/(hard no|no ready|queue is empty|no item is ready|nothing ready|only hard exceptions|out of scope)/i.test(stopCondition)) {
    issues.push("Stop Condition must explicitly state the hard-no/no-ready-work condition");
  }

  return {
    status: issues.length === 0 ? "pass" : "fail",
    stateFile,
    issues,
    candidates,
  };
}

function printHuman(result) {
  if (result.status === "pass") {
    console.log(`autopilot state audit passed: ${result.stateFile}`);
    console.log(`candidates checked: ${result.candidates.length}`);
    return;
  }

  console.error(`autopilot state audit failed: ${result.stateFile}`);
  for (const issue of result.issues) {
    console.error(`- ${issue}`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.stateFile) {
    throw new Error(`--state-file is required\n\n${usage()}`);
  }

  const stateFile = path.resolve(expandHome(args.stateFile));
  const markdown = fs.readFileSync(stateFile, "utf8");
  const result = auditState(markdown, stateFile);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  if (result.status !== "pass") {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
