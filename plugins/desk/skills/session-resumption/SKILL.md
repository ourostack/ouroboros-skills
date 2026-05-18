---
name: session-resumption
description: Resume a specific non-terminal task the operator selected from the session-start status block. Reads the task card, checks the repo workspaces' git state, and re-enters the right workflow phase based on the task's current `status`. Use when the operator picks one of the listed active tasks.
---

# Session resumption

The operator picked an active task to resume. Enter the right phase without starting over.

## Step 1 — Read the task card

```
$DESK/<track>/<task>/task.md
```

Note: `status`, `planning_complete` (if set), `repos[]`, any `collaborating`/`blocked` reason fields.

## Step 2 — Check repo workspaces

For each `mode: local` repo: `git status` for uncommitted changes, `git rev-list @{u}..` for unpushed commits, and the current branch. If anything surprises you (unclean tree, branch not matching the doing doc's expectation), surface it before doing anything else.

## Step 2.5 — Required MCPs hard-gate

If the resumption target's iteration doc (e.g., the active iteration's
`doing.md`, an `investigation.md`, or any per-iteration doc named in
the task card's `iterations.active`) declares `required_mcps:` in
frontmatter, treat that list as a **hard requirement** for resuming —
not a recommendation.

`required_mcps:` is a list of MCP keys matching aliased entries in
the workspace's `$DESK/agency.toml` — either under
`[mcps.builtins.<alias>]` (agency-proxied builtins) or
`[mcps.servers.<alias>]` (external stdio MCPs). Both namespaces are
valid sources; the key just needs to be loaded at runtime. Example
frontmatter snippet:

```yaml
required_mcps:
  - ccs-kusto
```

**Check**: for each entry in `required_mcps`, consult the runtime's
loaded-MCP registry to confirm the key is currently loaded —
engine-specific. (Implementations may probe the harness's own
loaded-MCP listing, an introspection MCP, or a tool-name-prefix
scan; encode the principle, not the API.)

**Hard-stop**: if any required MCP key isn't loaded, **STOP at the
resumption prompt before proceeding to Step 3**. Do not start the
phase, do not begin tool work, do not silently continue. Print:

1. The list of required MCP keys that are missing.
2. The likely root cause: `~/agency.toml` symlink absent, broken,
   or pointing somewhere else; or the MCP isn't declared in
   `$DESK/agency.toml`. Reference session-start
   Step 4.7's symlink check.
3. A note that the agent will not proceed with this resumption
   until restarted with the required MCPs loaded.

Example stop message:

```
Required MCPs not loaded for this iteration: [ccs-kusto]

Likely cause: ~/agency.toml symlink absent or broken. session-start
will create it on the next launch if $DESK/agency.toml
exists. Confirm the MCP is declared there, then restart:

  agency claude -a worker:worker --dangerously-skip-permissions

Resumption paused until the required MCPs are available.
```

**Why hard-stop, not recommendation**: when an iteration doc declares
`required_mcps`, the planning pass already determined the work
cannot proceed without those tools. Letting the agent continue and
discover the missing tool mid-investigation wastes operator time
and contaminates the iteration's audit trail with abandoned work.
session-start's Step 4.7 is the soft self-healing path (creates the
symlink so MCPs auto-load next time); this gate is the hard
requirement at the resumption boundary.

If the iteration doc has no `required_mcps:` field, this step is a
no-op — proceed to Step 3.

## Step 3 — Re-enter the right phase

| Status | Resume action |
|--------|---------------|
| `drafting` (default) | Check for existing planning/doing docs. If they exist, resume where `work-planner` or `work-ideator` left off. |
| `drafting` + `planning_complete: true` | Adoption case — skip ideator/planner. Transition directly to `processing` and dispatch `work-doer`. Preserve the flag through the transition for audit trail. |
| `processing` | Find the doing doc, check which units are complete, resume `work-doer` from the next unfinished unit. |
| `validating` | Check if a PR exists and its CI state. Resume `work-merger`. |
| `collaborating` | Show what was waiting on the operator. Ask for the specific input needed and wait. |
| `paused` | Ask the operator whether they want to resume (go back to the pre-pause state) or update the status. |
| `blocked` | Show the blocker description + when/why. Ask whether it's resolved. If yes, go back to the pre-block state. |

Full transition rules and state machine live in the `task-lifecycle` skill.

## Step 4 — Commit any state changes

If resuming caused a status transition (e.g., `drafting` → `processing` because `planning_complete: true`), follow the state-change protocol in `task-lifecycle`: update the `updated` timestamp, commit, push, and trigger any downstream actions (status tweet, archive) as applicable.
