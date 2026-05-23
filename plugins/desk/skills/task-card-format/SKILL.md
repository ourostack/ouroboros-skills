---
name: task-card-format
description: Schema for `task.md` — the per-task card inside a task directory. Covers required fields, adoption signals (`planning_complete`, `adopted_at`), local-path portability via tilde paths, and adopted doc filename conventions. Use when creating, reading, or updating a task card.
---

# Task card format

`task.md` is the cover of the folder — one task per folder, one folder per piece of work. it lives inside a task directory and represents one unit of work within a track.

## Template

```yaml
---
schema_version: 1
title: "<task-slug>"
status: drafting
created: "YYYY-MM-DDTHH:MM:SSZ"
updated: "YYYY-MM-DDTHH:MM:SSZ"
track: <track-directory-name>

# Optional: categorization + runtime fields (see "Runtime fields" below)
category: general                       # general | reminder | coordination | infrastructure | <free>
cadence: "30m"                          # recurring cadence — daemon fires `ouro poke <agent> --task <id>` per cadence
scheduledAt: 2026-05-21T09:00:00Z       # one-time scheduled fire (mutually compatible with `cadence` if both present)
requester: "ari"                        # who asked for this task (defaults to "self" when agent-initiated)
validator: "ari"                        # who validates completion
artifacts: [https://github.com/.../pull/123]  # outputs produced by this task (PR URLs / file paths)
active_bridge: "bridge-abc123"          # set by bridge promotion — bridge ID this task durably records
bridge_sessions: ["sess-xyz789"]        # set by bridge promotion — session IDs the bridge is coordinating

# Optional: adoption signals
planning_complete: true                 # skip ideator/planner; jump to work-doer
adopted_at: 2026-04-16T14:30:00Z        # when the task entered the workspace (distinct from `created`)

repos:
  - name: OrderService
    local_path: ~/code/OrderService     # tilde paths only — never absolute /Users/<alias>/...
    mode: local                         # local (cloned) | remote (read-only via API)
  - name: OrderAdminPortal
    local_path: ""
    mode: remote

# Optional: per-task iteration history
# Each repo workspace contains per-iteration directories. The task card
# tracks which iteration is active and the full history, so an agent
# reading the task card alone sees the iteration shape without needing
# to traverse the repo workspace.
iterations:
  active: ./OrderService/2026-04-21-review-pass-1    # null when between iterations
  history:
    - slug: 2026-04-13-initial-impl
      repo: OrderService
      trigger: initial-impl
      pr: 1234567                                    # null for task-level refactor iterations
      path: ./OrderService/_archive/2026-04-13-initial-impl
      outcome: shipped-to-pr                         # shipped-to-pr | merged | reverted
    - slug: 2026-04-21-review-pass-1
      repo: OrderService
      trigger: pr-feedback
      pr: 1234567
      path: ./OrderService/2026-04-21-review-pass-1
      outcome: in-progress
---
```

## Required fields

`title`, `status`, `created`, `updated`, `track`, `repos[]` (each with `name`, `local_path`, `mode`).

## Schema versioning

`schema_version: 1` declares the current task-card schema. consumers (parsers, migrators, the desk MCP server) read it to know how to interpret the rest of the frontmatter.

**back-compat rule:** files missing `schema_version` are treated as `schema_version: 0` (pre-versioned). consumers MUST accept v0 files indefinitely — parsing them with the current schema works because v1 is a strict superset of v0. new task creation always writes `schema_version: 1`.

**bump rule:** increment `schema_version` only when a change is genuinely breaking (a required field added, a field renamed, a value range changed). adding optional fields is NOT a schema bump — desk has many optional fields and they accumulate without disturbing the schema_version.

## Runtime fields (optional)

these fields are read by the harness, not the agent. set them when the task represents something the harness needs to schedule, route, or reconcile:

- **`category`** — free-string tag. reserved values: `reminder` (creates via `ouro reminder create` — fires on a schedule), `coordination` (bridge-promoted tasks), `infrastructure` (harness self-maintenance). anything else is a project category the agent can use freely.
- **`cadence`** — recurring schedule expressed as `Nm` / `Nh` / `Nd` (e.g. `30m`, `4h`, `1d`) or a cron expression. the daemon scheduler fires `ouro poke <agent> --task <id>` at each cadence interval. leave unset for non-recurring tasks.
- **`scheduledAt`** — ISO 8601 timestamp for a one-time scheduled fire. compatible with `cadence`: `scheduledAt` is the first/next fire; `cadence` is the repeat interval after.
- **`requester`** — who asked for this task. `"self"` when agent-initiated; the operator's alias when operator-initiated; another agent's name when delegated cross-agent.
- **`validator`** — who validates completion. usually the same as `requester`; differs when the validator is a separate party (e.g. automated test suite).
- **`artifacts`** — list of outputs this task produced. PR URLs, file paths, document references. appended to as the task progresses.
- **`active_bridge`** — set automatically by `promoteBridgeToDesk`. records the bridge ID this task durably represents. read by the bridge lifecycle reconciler to auto-resolve bridges when their backing task reaches `done` / `cancelled`.
- **`bridge_sessions`** — set automatically by `promoteBridgeToDesk`. session IDs the bridge is coordinating across. read by the same reconciler.

agents creating tasks via `desk` skills don't typically set runtime fields directly — they're added by `ouro reminder create`, by bridge promotion, or by the operator. but agents reading task cards should understand what these fields mean so they don't strip them on edits.

consumer agents extending this with their own work-tracker schema
(e.g. enterprise overlays with Feature / Epic hierarchies) add their
own frontmatter block — typically the overlay ships a card-fields
skill defining the tracker-specific `tracker:` + `repos[].org` shape.

## Local path portability

the desk travels — same folder, different machines. **never commit absolute paths with a specific username** (e.g. `/Users/<alias>/code/<repo>`). they don't resolve on other machines. always use `~/code/<repo-name>` tilde paths — they expand to `$HOME` on whatever machine opens the task card.

the `repo-handling` skill handles auto-discovery and machine-local overrides when the tilde path doesn't resolve on a given machine.

## Iteration history (`iterations:`)

`iterations:` is the canonical per-task record of iteration shape — every page that's ever been laid open on the desk for this folder. it supersedes the older `doing_docs:` field (now deprecated — see `directory-structure` for the iteration-centric layout).

- `iterations.active` → relative path to the currently-running
  iteration directory (`./<repo>/<YYYY-MM-DD>-<slug>/`), or `null`
  when the task is between iterations.
- `iterations.history[]` → one entry per past or current iteration.
  each entry carries:
  - `slug` — iteration slug (`YYYY-MM-DD-<trigger>`)
  - `repo` — which repo the iteration targets (matches `repos[].name`)
  - `trigger` — one of `initial-impl`, `pr-feedback`,
    `architecture-review`, `post-int-smoke-fixes`,
    `revert-and-reland`, `pre-merge-polish`, or a new slug the
    operator confirms
  - `pr` — PR number this iteration drives, or `null` for
    task-level refactor iterations with no PR yet
  - `path` — relative path from task root to the iteration
    directory (active entries point at the live dir; archived
    entries point at `_archive/`)
  - `outcome` — `shipped-to-pr` | `merged` | `reverted` |
    `in-progress`

linking out from the task card to per-iteration `doing.md`,
`planning.md`, and `feedback.md` is how the agent navigates the
layered-doc model documented in `skills/pr-feedback-on-own-pr/SKILL.md`.

## Iteration-doc `required_mcps:` field

a per-iteration doc (`doing.md`, `investigation.md`, etc.) MAY declare
`required_mcps:` in its frontmatter — a list of MCP keys matching
aliased entries in the runtime's workspace MCP config under either
`[mcps.builtins.<alias>]` (runtime-proxied builtins) or
`[mcps.servers.<alias>]` (external stdio MCPs). the field signals a
HARD requirement: when the operator picks the task to resume,
`session-resumption` stops at the resumption prompt if any required
MCP isn't loaded. see the `session-resumption` skill for enforcement
details and the consumer overlay's "Workspace MCPs" docs for the
runtime-specific workspace MCP config convention.

## Filename timestamp convention for adopted docs

per-iteration docs (`planning.md`, `doing.md`, `feedback.md`) live
inside an iteration directory named `<YYYY-MM-DD>-<slug>/`. the
iteration directory's date prefix carries the "when was this
originally written" signal; the files inside use canonical names
without embedded timestamps.

for **adopted** planning/doing docs pulled from legacy bundles:
- preserve the adoption date in the iteration directory name
  (typically `<YYYY-MM-DD>-adopted` or the original iteration slug
  if it was already in the source layout).
- add `adopted_at:` to the doing-doc frontmatter to record when the
  doc entered `$DESK/` (distinct from the iteration date).

## Cross-org / multi-platform routing

when a task spans repos hosted across different orgs or platforms,
the routing is encoded in consumer-specific frontmatter fields
(e.g. `repos[].org` selecting an org-specific MCP server). consumer
overlays ship the routing schema specific to their tracker(s).
