---
name: task-lifecycle
description: The 8-state task lifecycle machine — states, valid transitions, the state-change protocol, handling of adopted tasks with pre-completed planning, and how a doing doc's `Execution Mode` header affects work-doer dispatch. Use whenever a task changes state, or when checking whether a proposed transition is valid.
---

# Task lifecycle

Every task moves through a state machine with 8 states. The `status` field in `task.md` tracks the current state.

## States

| State | Description | Workflow phase |
|-------|-------------|----------------|
| `drafting` | Exploring the problem, scoping, creating planning + doing docs | `work-ideator` (exploration) → `work-planner` (scoping) |
| `processing` | Writing code, running tests, implementing | `work-doer` |
| `validating` | Creating PR, waiting for CI, merging to main | `work-merger` |
| `collaborating` | Human gate — waiting for operator input/review/approval | Paused for human |
| `paused` | Temporarily suspended by operator | No active work |
| `blocked` | External dependency, unclear requirement | No active work |
| `done` | PR merged, archived | Terminal |
| `cancelled` | Abandoned by operator | Terminal |

## Valid transitions

```
                    +---> collaborating ---+
                    |         ^            |
                    |         |            v
  drafting --> processing --> validating --> done
    |  ^          |              |
    |  |          v              v
    |  +--- collaborating   collaborating
    |
    v
  cancelled

  Any non-terminal state --> paused --> (return to previous state)
  Any non-terminal state --> blocked --> (return to previous state when resolved)
  Any non-terminal state --> cancelled
```

## State-change protocol

Every transition writes THREE places, in order. Commit-message-only is not sufficient — a new session picking up the task must be able to reconstruct what happened by reading the artifacts, not `git log`.

### 1. Task card (`task.md`)

- Update `status` field.
- Update `updated` timestamp to ISO 8601 UTC.
- Body updates as transition dictates:
  - Transitioning to `processing`: add a "Current work" line pointing at the active doing doc.
  - Transitioning to `validating`: add a "PRs" section listing every PR URL that represents this task (one per repo in multi-repo tasks), with repo name + PR title + status.
  - Transitioning to `done`: move the PR list to a "Landed" section with merge shas.
  - Transitioning to `blocked` / `collaborating`: a "Blocker" / "Waiting on" line with the specific reason.

### 2. Doing doc (for `processing`, `validating`, `done` transitions)

Each repo's doing doc must be kept current. At minimum:

- Check off unit checkboxes (`- [ ]` → `- [x]`) for units completed.
- If work-doer produced a "progress log" at the top, append the current transition.
- On `validating`: record the PR URL at the top of the doing doc.

### 3. Track card (`track.md`)

- Update the relevant row in the Tasks table:
  - `State` column to the new status
  - `PR` column if a PR was opened (URL, one per repo in multi-repo)
- If transitioning to `done`: move the row into the "Landed" section or strike it; track the merge.

### 4. Commit + push

After the three artifact updates above:

```
cd $DESK && git add <specific-files> && git commit -m "task(<slug>): <old> -> <new>" && git push origin main
```

Auth and push convention is consumer-specific: worker users push under EMU (`<alias>_microsoft` — see `worker:emu-github`); ouroboros agents push under whatever account their bundle's git remote is configured for; personal agents per their setup.

### 5. Downstream triggers

- If transitioning to `done` or `cancelled` → invoke `archive-workflow`.
- (Optional, worker context) If the transition is shiproom-relevant (`processing`, `validating`, `done`, `blocked`) → invoke `worker:ado-hygiene` to update the parent Feature's status tweet. Skip for non-coding / non-ADO contexts.

### Why three writes

Commit messages are not a handoff format. A new session reading the task card must see: current state, active doing doc, open PRs, blockers — without shell-archaeology. Task-card-only updates fail the same way: without corresponding doing-doc + track-card refresh, downstream consumers (`status` skill, a resuming operator, `ado-hygiene`) see stale state. Update all three or update none.

## Adopted tasks with completed planning

When a task comes in from an external bundle with planning + doing docs already written, it still starts in `drafting` (consistent with the state machine). But the planning work is NOT re-done — worker jumps directly to `work-doer`.

Signal via task card frontmatter:

```yaml
status: drafting
planning_complete: true
```

When resuming a task with `planning_complete: true` and `status: drafting`, transition straight to `processing` — skip `work-ideator` and `work-planner`. Preserve the `planning_complete` flag through the transition for audit trail.

## Doing doc execution mode

A doing doc may carry an `Execution Mode:` header that hints at how `work-doer` should run it:

| Execution Mode | Meaning | worker behavior |
|----------------|---------|-----------------|
| `direct` (default) | Run in the current session, sequentially | Invoke `work-doer` via Skill tool; it runs units in order |
| `spawn` | Run as an autonomous background agent | Invoke `work-doer` with spawn-style execution if the engine supports it; otherwise fall back to `direct` |
| `pending` | Each unit requires operator approval | Invoke `work-doer`; pause for operator confirmation between units |

If the doing doc doesn't specify, default to `direct`. **Don't strip the mode header from adopted doing docs** — preserve it as authored.
