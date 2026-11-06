#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const CANONICAL_RFC = "plugins/desk/docs/agentic-engineering-v2-rfc.md";
const PATH_1_HEADINGS = [
  "Entrance A — new to Desk",
  "Entrance B — existing V1 Desk",
  "Converged endpoint",
];
const PATH_2_HEADINGS = [
  "Phase 1 — repository migration",
  "Phase 2 — existing member activation",
  "Phase 3 — new member join",
];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseHeadings(markdown) {
  return [...markdown.matchAll(/^(#{1,6})[ \t]+(.+?)\s*$/gmu)].map((match) => ({
    level: match[1].length,
    title: match[2].trim(),
    index: match.index,
  }));
}

function findHeading(headings, level, title) {
  return headings.find((heading) => heading.level === level && heading.title === title);
}

function sectionBounds(headings, heading) {
  const start = heading.index;
  const startIndex = headings.findIndex((candidate) => candidate === heading);
  const nextPeerOrAncestor = headings
    .slice(startIndex + 1)
    .find((candidate) => candidate.level <= heading.level);
  return {
    start,
    end: nextPeerOrAncestor?.index ?? Number.POSITIVE_INFINITY,
  };
}

function sectionText(markdown, headings, heading) {
  const { start, end } = sectionBounds(headings, heading);
  return markdown.slice(start, end === Number.POSITIVE_INFINITY ? undefined : end);
}

function childHeadingTitles(markdown, headings, heading, level) {
  const { start, end } = sectionBounds(headings, heading);
  return headings
    .filter((candidate) => candidate.level === level && candidate.index > start && candidate.index < end)
    .map((candidate) => candidate.title);
}

function listTrackedMarkdownFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry.endsWith(".md"));
}

function findCanonicalRfcCopies() {
  return listTrackedMarkdownFiles().filter((file) => /^# Agentic Engineering V2\s*$/mu.test(read(file)));
}

function main() {
  const rfc = read(CANONICAL_RFC);
  const firstRun = read("plugins/desk/skills/first-run-bootstrap/SKILL.md");
  const joinCrew = read("plugins/crew/skills/join-crew/SKILL.md");
  const sessionStart = read("plugins/desk/skills/session-start/SKILL.md");
  const sessionStartMigrations = read("plugins/desk/skills/session-start-migrations/SKILL.md");
  const rfcHeadings = parseHeadings(rfc);
  const firstRunHeadings = parseHeadings(firstRun);
  const joinCrewHeadings = parseHeadings(joinCrew);
  const sessionStartHeadings = parseHeadings(sessionStart);

  assert.deepStrictEqual(findCanonicalRfcCopies(), [CANONICAL_RFC]);
  assert.deepStrictEqual(
    rfcHeadings.filter((heading) => heading.level === 2 && /Desk|Crew workspace/u.test(heading.title)).map((heading) => heading.title),
    ["Start or upgrade a Desk", "Migrate a Crew workspace"],
  );

  const path1 = findHeading(firstRunHeadings, 2, "Path 1 — start or upgrade a Desk");
  assert.ok(path1, "first-run-bootstrap must expose Path 1");
  assert.deepStrictEqual(childHeadingTitles(firstRun, firstRunHeadings, path1, 3), PATH_1_HEADINGS);
  const convergedEndpoint = findHeading(firstRunHeadings, 3, "Converged endpoint");
  assert.ok(convergedEndpoint, "Path 1 must define a converged endpoint");
  assert.match(sectionText(firstRun, firstRunHeadings, convergedEndpoint), /same durable workspace/iu);

  const path2 = findHeading(joinCrewHeadings, 2, "Path 2 — migrate the Crew workspace, then activate members");
  assert.ok(path2, "join-crew must expose Path 2");
  assert.deepStrictEqual(childHeadingTitles(joinCrew, joinCrewHeadings, path2, 3), PATH_2_HEADINGS);
  const repositoryMigration = findHeading(joinCrewHeadings, 3, "Phase 1 — repository migration");
  assert.ok(repositoryMigration, "Path 2 must begin with repository migration");
  assert.match(sectionText(joinCrew, joinCrewHeadings, repositoryMigration), /parallel Crew repository/iu);

  const step2 = findHeading(sessionStartHeadings, 2, "Step 2 — Workspace sync");
  assert.ok(step2, "session-start must keep Step 2 as the existing-workspace router");
  assert.deepStrictEqual(childHeadingTitles(sessionStart, sessionStartHeadings, step2, 3), ["Existing-workspace V1 upgrade branch"]);
  const step2Text = sectionText(sessionStart, sessionStartHeadings, step2);
  assert.equal((step2Text.match(/first-run-bootstrap/gu) ?? []).length, 2);
  const existingWorkspaceUpgrade = findHeading(sessionStartHeadings, 3, "Existing-workspace V1 upgrade branch");
  assert.ok(existingWorkspaceUpgrade, "session-start must route existing V1 workspaces explicitly");
  const existingWorkspaceUpgradeText = sectionText(sessionStart, sessionStartHeadings, existingWorkspaceUpgrade);
  assert.match(existingWorkspaceUpgradeText, /Entrance B/iu);
  assert.match(existingWorkspaceUpgradeText, /same workspace/iu);

  assert.match(sessionStartMigrations, /before any path-dependent startup scans/iu);
  assert.match(sessionStartMigrations, /completed onboarding is not replayed during normal resumption/iu);

  console.log("V2 onboarding path contract passed.");
}

main();
