---
name: session-resumption
description: Checkpoint and resume an authorized non-terminal task, including a fresh-process handover after interruption or runtime pressure. Preserve actual source, unfinished work, work identity and authority; admit a replacement writer only after the prior owner is released.
---

# Session resumption

Invoke `desk:superpowers-integration` before resuming engineering. Consume the existing approval and canonical Desk paths; do not start another lifecycle or repeat go-ahead.

at the desk again. the operator picked an active task to resume — a manilla envelope already part-filled, papers laid out where the last session left them. pick up where things were, don't start over.

## Checkpoint before handoff

Keep the same work-item identity, task card and existing doing record. Checkpoint at completed integration or delegation boundaries and before a long unattended batch, not only when context compression starts failing. A checkpoint is a resumable state of the existing work, not another task, progress database or approval round.

Record the following in the canonical doing record, or the task card when no doing record exists:

- Current outcome, explicit authority, delivery endpoint, next concrete action, outstanding findings and responsible owner.
- The exact repository roots and revisions, branch and remote publication state; distinguish current source from the source each retained result actually exercised.
- Task-owned uncommitted changes and untracked files, plus local-only commits. Commit and publish through the approved contribution path when ready; otherwise preserve a binary patch, necessary untracked payload and prerequisite-bound bundle in the approved protected evidence location. Do not sweep unrelated work, ignored credentials or private stores into a source archive.
- Evidence locations, hashes and read-back of the preserved payload, including bundle prerequisites. Publish a ready checkpoint only after its referenced files are complete and readable; a missing or partially written archive cannot count as saved work.
- Pending external side effects, their existing request or operation identities, what was observed, and what remains uncertain. Preserve failed and interrupted attempts; never infer success from a submitted request.
- The actual host/process generation, remaining delegated writers and the host-owned recovery entry point, with its availability limits.

A protected handoff manifest binds these references to one checkpoint generation, including the canonical task/iteration, step/attempt, exact source and unfinished-file hashes, owned writers and unresolved operations. It is an admission artifact for the existing records, not a second task database. Check storage before capture, persist and read back every referenced payload, then atomically publish the complete generation as ready using a temporary file and rename. Retain the previous complete generation; a torn successor cannot replace it.

Determine freshness by reconciling current authority, actual source/publication and writer ownership against that generation, not by a recent timestamp alone. Before using a previous complete generation, preserve and reconcile intervening committed and unfinished source. Missing or corrupt latest evidence is never permission to overwrite newer work or silently treat a partial snapshot as ready.

Keep raw transcripts, credentials and private measurement outside Git. A same-host protected copy is not an off-host backup; state which durability boundary was actually achieved. Do not delete the originals merely because an archive exists.

## Fresh-process recovery

Read the current task and ready checkpoint generation before starting any replacement writer. Revalidate the recorded authority, source, result and publication claims against current state. A cached session label or PID alone is not ownership: the host must establish the exact prior process generation and its owned descendants, including delegated agents, MCP/command children and keep-awake processes, and confirm that no previous writer remains active on the same worktree. An unobservable or unresolved remote writer is not a released writer. If release cannot be established, do not start a competing writer.

Start a fresh process with a bounded handoff from the canonical record; do not replay the exhausted transcript or restore its entire conversation as a substitute for state reconciliation. Keep the work item, commitments and accounting continuous while allowing a new runtime/session identity. Read a specific retained transcript segment only when a missing fact requires it, bounded by the relevant owner and event range.

Inspect actual committed and unfinished source without overwriting it, then reconcile pending external side effects by read-back or the destination's existing idempotency mechanism before retrying; uncertain delivery is not permission to resend. Refresh a stale checkpoint from reachable source and evidence before admission. Treat missing, corrupt, stale or foreign-owned recovery evidence, invalid process identity, active writers and insufficient storage as explicit non-ready states rather than success-shaped fallbacks.

Process monitoring and restart belong outside the worker process to the owning host. Use its maintained launch/recovery capability without changing authentication, source selection, permissions or default profiles. An in-session reminder, restored terminal label, live MCP server or successful process launch does not prove the worker resumed. If the required host capability is unavailable, report that specific gap and continue independent safe work rather than inventing a scheduler or claiming unattended recovery.

## Step 1 — Read the task card

```
$DESK/<track>/<task>/task.md
```

note: `status`, `planning_complete` (if set), `repos[]`, any `collaborating`/`blocked` reason fields. the card is the memory of what was happening; read it before reaching for anything else.

## Step 2 — Check repo workspaces

for each `mode: local` repo: `git status` for uncommitted changes, `git rev-list @{u}..` for unpushed commits, and the current branch. if anything surprises you (unclean tree, branch not matching the doing doc's expectation), surface it before doing anything else.

## Step 2.5 — Required MCPs hard-gate

if the resumption target's iteration doc (e.g., the active iteration's
`doing.md`, an `investigation.md`, or any per-iteration doc named in
the task card's `iterations.active`) declares `required_mcps:` in
frontmatter, treat that list as a **hard requirement** for resuming —
not a recommendation. the previous session committed to needing these
hands; opening the envelope without them just wastes everyone's time.

`required_mcps:` is a list of MCP keys matching aliased entries in
the workspace's runtime MCP config — either under
`[mcps.builtins.<alias>]` (runtime-proxied builtins) or
`[mcps.servers.<alias>]` (external stdio MCPs). both namespaces are
valid sources; the key just needs to be loaded at runtime. example
frontmatter snippet:

```yaml
required_mcps:
  - analytics-store
```

**check**: for each entry in `required_mcps`, consult the runtime's
loaded-MCP registry to confirm the key is currently loaded —
engine-specific. (implementations may probe the harness's own
loaded-MCP listing, an introspection MCP, or a tool-name-prefix
scan; encode the principle, not the API.)

**hard-stop**: if any required MCP key isn't loaded, **STOP at the
resumption prompt before proceeding to Step 3**. don't start the
phase, don't begin tool work, don't silently continue. print:

1. the list of required MCP keys that are missing.
2. the likely root cause: the runtime's workspace MCP config link
   absent, broken, or pointing somewhere else; or the MCP isn't
   declared in the workspace MCP config. reference session-start
   Step 4.7's link check.
3. a note that the agent will not proceed with this resumption
   until restarted with the required MCPs loaded.

example stop message:

```
Required MCPs not loaded for this iteration: [analytics-store]

Likely cause: workspace MCP-config link absent or broken.
session-start will create it on the next launch if the workspace
MCP config exists. Confirm the MCP is declared there, then restart
the agent.

Resumption paused until the required MCPs are available.
```

**why hard-stop, not recommendation**: when an iteration doc declares
`required_mcps`, the planning pass already determined the work
cannot proceed without those tools. letting the agent continue and
discover the missing tool mid-investigation wastes operator time
and contaminates the iteration's audit trail with abandoned work.
session-start's Step 4.7 is the soft self-healing path (creates the
symlink so MCPs auto-load next time); this gate is the hard
requirement at the resumption boundary.

if the iteration doc has no `required_mcps:` field, this step is a
no-op — proceed to Step 3.

## Step 3 — Re-enter the right phase

| Status | Resume action |
|--------|---------------|
| `drafting` (default) | Read the existing alignment receipt and planning/doing docs. Use `work-orchestration` and transition clear work directly to `processing` only with an agreed definition of done and explicit go-ahead; otherwise resume alignment, not implementation. |
| `drafting` + `planning_complete: true` | Reuse the plan and recorded go; the flag alone is not approval. Transition to `processing` when authorized and retain the flag for history. |
| `processing` | Resume the selected Superpowers execution skill from the task, branch and canonical doing record. |
| `validating` | Resume verification of the agreed endpoint through `desk:superpowers-integration`; do not turn an alpha endpoint into a main merge. |
| `collaborating` | Show what was waiting on the operator. Ask for the specific input needed and wait. |
| `paused` | Ask the operator whether they want to resume (go back to the pre-pause state) or update the status. |
| `blocked` | Show the blocker description + when/why. Ask whether it's resolved. If yes, go back to the pre-block state. |

full transition rules and state machine live in the `task-lifecycle` skill.

## Step 4 — Commit any state changes

if resuming caused a status transition (e.g., `drafting` → `processing` because `planning_complete: true`), follow the state-change protocol in `task-lifecycle`: update the `updated` timestamp, commit, push, and trigger any downstream actions (status tweet, archive) as applicable.
