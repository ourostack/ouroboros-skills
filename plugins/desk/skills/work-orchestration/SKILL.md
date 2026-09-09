---
name: work-orchestration
description: Bind authorized engineering work to the selected Superpowers method and preserve Desk state and cross-repository dependency authority.
---

# Work orchestration

Invoke `desk:superpowers-integration`. This Desk compatibility entrypoint selects no second engineering method: Superpowers owns discovery, planning, execution and verification; Desk owns the work state and approved terminal boundary.

Read the existing task, agreement and plan before choosing the matching Superpowers skill. Consume prior approval without reopening it. Use `superpowers:brainstorming` for missing design agreement, `superpowers:writing-plans` when a plan is needed, and `superpowers:executing-plans` or authorized `superpowers:subagent-driven-development` for implementation. Keep plans and progress on Desk. Invoke `desk:independent-review` for the required independent gate.

Verify repository authority and the approved contribution path before any branch, worktree or source edit. Read-only requests remain read-only. Delegation and worktree creation stay within the recorded mandate.

The cross-repository plan owns an explicit DAG; `repos[]` must never define dependency order. Reject cycles and unknown dependencies. A failed predecessor blocks its dependents, not independent ready nodes. Use isolated worktrees and explicit working directories for authorized parallel work. Serialize shared/version surfaces or merge normally; never force-push through a coordinated conflict.

Only a current, unsatisfied `needs-human-approval` is a hard exception. Superseded records do not revoke existing go. Mechanical reviews go to the authorized reviewer. A nested worker returns its frozen brief to the parent rather than self-certifying or waiting for the parent's entire task to finish.

Desk owns task and iteration state and archive transitions. The agreed endpoint determines whether verification ends at an intentional alpha/PR-only branch or includes authorized merge, release/install, consuming-surface smoke and cleanup. Superpowers finish options cannot silently change that endpoint.

Invoke `desk:independent-review` for a fresh cold branch review at the diff boundary, using frozen source and evidence inputs. This is the same independent-review cycle with one Superpowers remediation owner, not a second implementation loop or a repeated per-edit ceremony.
