---
name: adopt-inflight-work
description: Six-step flow for bringing existing in-flight work (planning bundles, doing docs, prior-agent output, migrated project state) under worker's management. Use when the operator says "adopt this", "this is now yours", or picks Option 3 in the first-run bootstrap.
---

# Adopt in-flight work

The most common first-run scenario isn't greenfield — it's adoption. An operator has existing work (from a prior agent, a planning bundle, a migrated project, wherever) and wants to bring it under worker's lifecycle without re-planning from scratch. This skill is the flow.

## When to invoke

- Operator says "I have existing work — this is now yours" or any variant.
- A source bundle exists (planning docs, doing docs, design docs, flow diagrams).
- The work maps to an existing ADO Feature (often split from a closed predecessor).
- The goal is to continue execution, not re-plan.
- Operator picked Option 3 in worker's first-run bootstrap.

## The six-step flow

Execute in this order. **Order matters — preservation precedes interpretation.** Skipping ahead loses signal.

### Step 1: Preserve first, curate later

Copy the **entire source bundle** into the new track directory verbatim:

```bash
mkdir -p $DESK/<track-slug>/_planning/_history
```

Sort during the copy, not by dropping:
- **Current-state artifacts** → `<track>/_planning/`
  - The authoritative planning doc
  - The current design doc(s)
  - Flow diagrams that reflect current design
  - Any reference documents still live
- **Superseded or historical artifacts** → `<track>/_planning/_history/`
  - Previous versions of the design
  - Deprecated flow diagrams
  - Meeting decisions that were superseded
  - Binary formats that the markdown equivalent replaces (e.g., `.docx` when a `.md` exists)

Write `<track>/_planning/_history/README.md` explaining what each historical file was and what replaced it. Example:

```markdown
# Planning history

Files in this directory are superseded or historical. Retained for provenance.

- `design-v1.md` — Original design. Superseded by `../design.md` (v2) after the April design review.
- `plan-v2-meeting-decisions.md` — Locked decisions from the April 14 review. Applied into `../planning.md`.
- `Design Doc v1.1 Amendments.docx` — Binary form of v1.1 amendments; content was merged into `../design-v2.md`.
- `flow-gcb-backfill.png` — Old flow. Superseded by `flow-v2-gcb-backfill.png`.
```

**Do NOT drop anything on the floor during adoption.** You've just been handed the work. You don't have the context to decide what's stale. Preservation is the bar; curation is for later with more information.

### Step 2: Snapshot the ADO state

Capture what the target ADO Feature looks like **at adoption time** — before you make any changes. This becomes the "before" reference.

Create `<track>/_planning/ado-snapshot-YYYY-MM-DD.md`:

```markdown
# ADO snapshot: Feature <id> at adoption (YYYY-MM-DD)

**Feature**: <id> — <title>
**State**: <state>
**Area Path**: <path>
**Iteration Path**: <path>
**Assigned To**: <person>
**Status Tweet**: <tweet>
**Target Date**: <date>

## Relations

- **Predecessor**: <id> (<state>) — <title>
- **Successor**: <id> (<state>) — <title>
- **Related**: <ids>

## Children at adoption

| id | type | state | title |
|----|------|-------|-------|
| 1234571 | Requirement | Active | [API] Stub out new /endpoint |
| ... | ... | ... | ... |

## Predecessor children at adoption (if applicable)

| id | type | state | title |
|----|------|-------|-------|
| ... | ... | ... | ... |
```

This freezes "what we inherited" so we can diff against "what we changed."

### Step 3: Snapshot code-repo state

For each repo the source bundle references, capture current state — current branch, HEAD sha, remote, uncommitted-changes flag.

Create `<track>/_planning/code-snapshot-YYYY-MM-DD.md` with one block per repo:

```markdown
## <repo-name>

- **Remote**: <url>
- **Current branch**: <branch>
- **HEAD sha**: <sha>
- **Upstream branch exists**: <yes/no>
- **Uncommitted changes**: <yes/no>
- **Unpushed commits**: <n>
```

This captures the state of in-flight work (e.g., a PoC branch) that you're inheriting.

### Step 4: Pin the source location in track.md frontmatter

Record the exact source path and adoption metadata in `track.md`'s frontmatter:

```yaml
---
title: "..."
# ...
adopted_from:
  source_path: /Users/<alias>/<path>/<to>/<source-bundle>
  source_sha: <git sha if the source is a git repo>
  adopted_at: 2026-01-15T14:30:00Z
  adopted_by: <alias>_microsoft
---
```

The source path survives even if the source bundle gets cleaned up, moved, or deleted.

### Step 5: Mark derivation explicitly

`track.md` and each `task.md` contain your interpretation of the source, not a verbatim copy. Mark which fields are authoritative (from the source) vs. inferred (your best guess at adoption).

In the track body, add a section:

```markdown
## Adoption notes

**Source of truth (copied verbatim from the source bundle):**
- Scope description
- ADO Feature mapping (1234567)
- Predecessor reference (1234560)
- Planning doc content (`_planning/planning.md`)
- Doing doc contents (per-repo workspaces)

**Inferred during adoption (my interpretation, not in the source):**
- Task slugs: `api-validation-layer`, `admin-portal-refactor`, `db-schema-migration`
- Task ordering (derived from planning.md's "Deliverables" section)
- `ado_defaults` (inferred from parent Feature + operator correction)
- Mapping from planning-doc "Deliverable N" numbering to the three task slugs
```

A future operator or auditor can then tell which parts are load-bearing and which are safe to adjust.

### Step 6: Audit the predecessor (and the Feature) before creating new ADO work items

If the target Feature has a predecessor or is newly split, run the **Predecessor Split / Backlog Triage** flow (in the `ado-hygiene` skill) before creating any new child work items. One decision group at a time.

After the triage completes, post a comment on the predecessor Feature summarizing what was done ("N closed as Delivered, M reparented, K reframed, L deferred").

## Track dashboard assembly

Once steps 1-6 are done, assemble `<track>/track.md` as a working dashboard. The track card structure (frontmatter schema + body sections) lives in worker.md's "Track Card Format" reference.

## Adopted task cards

For each task identified during adoption, create `<track>/<task-slug>/task.md` with:

```yaml
status: drafting
planning_complete: true   # skip work-ideator + work-planner; jump to work-doer on resume
adopted_at: 2026-04-16T14:30:00Z
```

### Adopted iteration placement

Per the iteration-centric layout (`directory-structure` skill),
adopted planning/doing docs land inside a per-iteration directory
under `<repo>/`, not loose at `<repo>/` root. The first iteration of
an adopted task is typically:

```
<track>/<task-slug>/<repo-name>/<YYYY-MM-DD>-initial-impl/
  planning.md          # copied from the source bundle
  doing.md             # copied from the source bundle
  artifacts/           # whatever outputs the source bundle had
```

Where `<YYYY-MM-DD>` is the adoption date (or the date the source
bundle was created, if preserving the original timeline matters to
the operator). Do NOT wrap the iteration directories under an
`iterations/` subdir — every direct child of `<repo-name>/` is either
`_archive/` or a date-prefixed iteration directory.

If the source bundle already used the iteration-centric layout, copy
the iteration directory whole into `<repo>/` — do not flatten or
re-layer. Add `adopted_at:` and `adopted_from:` to the doing-doc
frontmatter to disambiguate "when was this written" (iteration-
directory date) from "when did this enter worker-workspace" (frontmatter).

If the source bundle used a legacy flat layout (`YYYY-MM-DD-HHMM-doing-*.md`
loose at `<repo>/` root), repackage into an iteration directory during
step 1: create `<repo>/<YYYY-MM-DD>-adopted/`, move the planning and
doing docs into it, rename to `planning.md` / `doing.md`, and move
any sibling artifacts directory into `<YYYY-MM-DD>-adopted/artifacts/`.

## What's preserved, what's derived

At the end of adoption:
- `<track>/_planning/` holds the complete source bundle, sorted.
- `<track>/_planning/_history/` holds superseded/binary artifacts with a provenance README.
- `<track>/_planning/ado-snapshot-*.md` freezes the pre-adoption ADO state.
- `<track>/_planning/code-snapshot-*.md` freezes the pre-adoption code state.
- `<track>/track.md` points at all of the above via its frontmatter (`adopted_from`, `planning`) and its body (Adoption notes section).
- `<track>/<task-slug>/` directories hold per-task state. Each `task.md` has `adopted_at:` + (if applicable) `planning_complete: true`.
- `<track>/<task-slug>/<repo-name>/<doing-doc>.md` preserves the source timestamp in the filename; frontmatter has `adopted_at:`.

## After adoption

The next thing worker does after completing adoption is the session resume flow — **not execution**. Let the operator look at the dashboard, confirm the adopted state looks right, and direct the next action. Don't leap to work-doer dispatch on your own.
