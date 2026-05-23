---
name: status
description: Emit a one-screen resume-friendly dashboard of all active worker state — tracks, tasks, uncommitted code changes, blockers, recent friction. Use when the operator says "status", "/status", "where are we", "summary", or asks any variant of the resume question.
---

# Status

A single-screen dashboard that answers "where are we?" without manual archaeology across workspace markdown, external work trackers, and local code repos.

> **Overlay users:** consumer overlays often ship tracker-formatted status entries (work-item IDs, tracker URLs, identity-aware paths) via an overlay-specific card-fields skill.

## When to invoke

- Operator types `/status` or says "status".
- Operator asks "where are we?", "what's in flight?", "what's blocked?", "summary please".
- Mid-session when the operator wants a checkpoint without reading every task card.
- At the start of a resumed session, AFTER the session-start checklist completes (the checklist's status block is a SUBSET of `/status` — `/status` is the full read-out).

> Tracker-aware variant: overlays add work-item-ID-aware status with tracker URLs via their card-fields skill.

## What to emit

Output a single Markdown block with these sections **in this order**. Skip empty sections silently — don't emit "No blockers" if there aren't any.

```markdown
# Status — <operator alias>, <date YYYY-MM-DD>

## Active tracks (N)

- **<track-slug>** — <track-title> · [<tracker-id>](<tracker-url>)
  - Tasks: <count by state>, e.g., `2 processing, 1 collaborating, 1 drafting`
  - Last activity: <human-friendly relative time>

(repeat per track, most recently active first)

## Active tasks (M)

| Track | Task | State | Repos | Tracker | Updated |
|-------|------|-------|-------|---------|---------|
| <track-slug> | <task-slug> | processing | <repo-a>, <repo-b> | [<tracker-id>](<url>) | 2h ago |
| ... | ... | ... | ... | ... | ... |

## Code repo state

- `~/code/<repo-a>` (branch: `feature/<branch-name>`) — 3 uncommitted, 1 unpushed
- `~/code/<repo-b>` (branch: `main`) — clean
- (omit repos with no changes if list is long; show "All other repos clean")

## Attention required

(only render if there are items in collaborating or blocked)

- 🟡 **collaborating**: `<track>/<task>` — waiting on operator: <one-line reason>
- 🔴 **blocked**: `<track>/<task>` — <blocker description> (since <date>)

## Recent friction (last 3)

(only render if `$DESK/_meta/friction.md` exists)

- <YYYY-MM-DD> — <short title> — <status: open|landed|partial|deferred>
- ...

---

Resume one (`<track>/<task>`), start new, or run another command?
```

## Data sources

| Section | Source | How to fetch |
|---------|--------|--------------|
| Active tracks | `$DESK/<track>/track.md` | Read frontmatter; filter `status: active` |
| Active tasks | `$DESK/<track>/<task>/task.md` | Glob non-archived task.md, filter status not `done`/`cancelled` |
| Code repo state | each `repos[].local_path` from active task cards | `git -C <path> status --porcelain` + `rev-list @{u}..` |
| Attention required | task.md `status` field == `collaborating` or `blocked` | filter step from active tasks |
| Recent friction | `$DESK/_meta/friction.md` | Parse `## YYYY-MM-DD — <title>` headers, take last 3 |

External work tracker IDs/URLs (if any) come from the task/track frontmatter — schema is tracker-agnostic at this layer.

## Implementation notes

- **Read-only operation.** `/status` never modifies state — no commits, no tracker writes, no file changes. If the operator wants action, they say so after seeing the dashboard.
- **Do NOT pull the workspace before running `/status`** — that's the session-start checklist's job. `/status` reflects local state. If the operator wants a fresh sync, they ask.
- **Do NOT fetch the external tracker live** — the dashboard reads `track.md` / `task.md` cached metadata only. Tracker links are clickable for the operator to drill in. Fetching live tracker state on every `/status` is too slow.
- **Skip code-repo state if `mode: mcp`** — only check `mode: local` repos.
- **Group by track in the tasks table**, sort tasks within a track by `updated` descending.
- **Use relative timestamps** ("2h ago", "yesterday", "3d ago") not absolute — the dashboard is for orientation, not audit.
- **Cap the tasks table at 20 rows.** If there are more, emit "... and N more (run `/status all` to see everything)" — but `/status all` is just `/status` without the cap.

## What NOT to include

- Archived tasks (those live under `_archive/`; the operator can browse manually).
- Per-task planning doc previews (the task table links to the doing doc; that's enough).
- External tracker work item descriptions (the tracker link is clickable).
- Git log or commit history (out of scope; use `git log` directly).
- The agent's own internal state, TaskCreate items, or session memory — the dashboard reflects **persistent workspace state**, not session ephemera.

## Example output (small desk workspace)

```markdown
# Status — alice, 2026-01-15

## Active tracks (1)

- **order-service-hardening** — [Infra] Order service compliance hardening · [TRACKER-1234567](<tracker-url>)
  - Tasks: 3 drafting
  - Last activity: 4h ago

## Active tasks (3)

| Track | Task | State | Repos | Tracker | Updated |
|-------|------|-------|-------|---------|---------|
| order-service-hardening | api-validation-layer | drafting | OrderService | [TRACKER-1234571](<tracker-url>) | 4h ago |
| order-service-hardening | admin-portal-refactor | drafting | OrderAdminPortal | [TRACKER-1234572](<tracker-url>) | 4h ago |
| order-service-hardening | db-schema-migration | drafting | OrderLegacy (mcp), OrderService | [TRACKER-1234573](<tracker-url>) | 4h ago |

## Code repo state

All `mode: local` repos clean.

## Recent friction (last 3)

- 2026-01-14 — Status dashboard proposal — landed
- 2026-01-13 — Task cards aren't portable across machines — landed
- 2026-01-12 — Enforce work-account identity via pre-Bash hook — open

---

Resume one (`order-service-hardening/api-validation-layer`), start new, or run another command?
```
