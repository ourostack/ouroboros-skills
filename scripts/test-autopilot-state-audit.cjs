#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function writeState(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-state-audit-"));
  const file = path.join(dir, "AUTOPILOT-STATE.md");
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function run(stateFile) {
  return spawnSync(process.execPath, [
    "scripts/audit-autopilot-state.cjs",
    "--state-file",
    stateFile,
    "--json",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function parse(result) {
  return JSON.parse(result.stdout);
}

const validState = writeState(`# Autopilot State

## Current Item

- PR #123 merged and installed for the current runtime change.

## Terminal Evidence

- merged: PR #123
- checks: node scripts/validate-skills.cjs passed
- smoke: installed-root audit verified the consuming runtime copy

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| open PR cleanup | hard exception | gh pr list returned no open PRs; no cleanup exists | nothing to start |
| unrelated design idea | deferred by scope | outside this runtime-fix mandate | backlog only |

## Stop Condition

Hard no: no ready work remains; only hard exceptions or out of scope items remain.
`);

const valid = run(validState);
assert.equal(valid.status, 0, valid.stderr || valid.stdout);
assert.equal(parse(valid).status, "pass");

const readyState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| add missing audit | ready | direct continuation from run | start it |

## Stop Condition

Hard no: no ready work remains.
`);

const ready = run(readyState);
assert.notEqual(ready.status, 0);
assert.equal(parse(ready).status, "fail");
assert.match(ready.stdout, /classification 'ready'/);

const reviewerGateState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| ambiguous cleanup | needs reviewer gate | possible follow-up found in feedback | spawn reviewer |

## Stop Condition

Hard no: no ready work remains.
`);

const reviewerGate = run(reviewerGateState);
assert.notEqual(reviewerGate.status, 0);
assert.equal(parse(reviewerGate).status, "fail");
assert.match(reviewerGate.stdout, /needs reviewer gate/);

const laterReadyTableState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| first table cleanup | hard exception | no open PRs found | no action |

Additional queue:

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| late ready cleanup | ready | found in backlog after the first table | must be started |

## Stop Condition

Hard no: no ready work remains.
`);

const laterReadyTable = run(laterReadyTableState);
assert.notEqual(laterReadyTable.status, 0);
assert.equal(parse(laterReadyTable).status, "fail");
assert.match(laterReadyTable.stdout, /late ready cleanup/);

const fencedTemplateThenReadyState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

\`\`\`markdown
| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| example only | hard exception | template text | ignore this fenced table |
\`\`\`

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| actual ready cleanup | ready | real queue evidence | must be started |

## Stop Condition

Hard no: no ready work remains.
`);

const fencedTemplateThenReady = run(fencedTemplateThenReadyState);
assert.notEqual(fencedTemplateThenReady.status, 0);
assert.equal(parse(fencedTemplateThenReady).status, "fail");
assert.match(fencedTemplateThenReady.stdout, /actual ready cleanup/);

const fencedHeadingThenReadyState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| first table cleanup | hard exception | no open PRs found | no action |

\`\`\`markdown
## Example Template Heading
\`\`\`

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| hidden ready cleanup | ready | appeared after a fenced heading | must be started |

## Stop Condition

Hard no: no ready work remains.
`);

const fencedHeadingThenReady = run(fencedHeadingThenReadyState);
assert.notEqual(fencedHeadingThenReady.status, 0);
assert.equal(parse(fencedHeadingThenReady).status, "fail");
assert.match(fencedHeadingThenReady.stdout, /hidden ready cleanup/);

const fencedReadyExampleThenSafeState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

\`\`\`markdown
| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| example ready | ready | template text | ignore this fenced table |
\`\`\`

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| actual closed queue | hard-exception | queues inspected | no action |
| unrelated future idea | deferred-by-scope | outside this mandate | backlog only |

## Stop Condition

Hard no: no ready work remains; only hard exceptions or out of scope items remain.
`);

const fencedReadyExampleThenSafe = run(fencedReadyExampleThenSafeState);
assert.equal(fencedReadyExampleThenSafe.status, 0, fencedReadyExampleThenSafe.stderr || fencedReadyExampleThenSafe.stdout);
assert.equal(parse(fencedReadyExampleThenSafe).status, "pass");

const malformedClassificationState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| vague follow-up | maybe later | found from memory | unknown |

## Stop Condition

Hard no: no ready work remains.
`);

const malformed = run(malformedClassificationState);
assert.notEqual(malformed.status, 0);
assert.equal(parse(malformed).status, "fail");
assert.match(malformed.stdout, /invalid classification/);

const missingTableState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

- no table here

## Stop Condition

Hard no: no ready work remains.
`);

const missingTable = run(missingTableState);
assert.notEqual(missingTable.status, 0);
assert.equal(parse(missingTable).status, "fail");
assert.match(missingTable.stdout, /markdown table/);

const missingSectionState = writeState(`# Autopilot State

## Current Item

- PR #123 merged.

## Terminal Evidence

- checks: test suite passed.

## Continuation Scan

| candidate | classification | evidence | disposition |
| --- | --- | --- | --- |
| none | hard exception | queues empty | nothing to start |
`);

const missingSection = run(missingSectionState);
assert.notEqual(missingSection.status, 0);
assert.equal(parse(missingSection).status, "fail");
assert.match(missingSection.stdout, /Stop Condition/);

console.log("autopilot state audit tests passed.");
