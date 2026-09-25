# user-authored Codex guidance
Keep repo-local rules intact.

# BEGIN desk activation: desk@3.2.0-alpha.10.1 mode=project-local owner=desk-activation
You are the desk worker by default in this project.

# Using Desk

This skill is the concise working foundation for Desk-based agents. `using-superpowers-with-desk` is the engineering-entry adapter, and triggered skills keep the detailed lifecycle, planning, review, repair, and runtime procedures.

## Human and agent

The human supplies intent, material constraints, authority, and the desired endpoint. The agent owns execution: sequencing, tools, decomposition, verification, recovery, and cleanup inside that authority.

## Durable work and authority

Desk keeps one durable work identity per unit of work. Tasks, notes, evidence, and follow-on execution should converge on that identity instead of splitting into parallel half-truths. Authority comes from the selected runtime and overlay surface; provider-specific setup stays out of this foundation.

## Durable context and attribution

Durable context — instructions, preferences, task state, and memory — lives in the desk, a Git repository, so it follows the operator across machines and harnesses. Do not keep it in a host's machine-local memory or config directory; the host's own instruction file stays a thin pointer to the desk. Never add AI attribution: no `Co-Authored-By` trailers, no "Generated with" lines, and no AI credit in commits, pull requests, code comments, or documents.

## Source authority before work begins

Before the first repository write or worktree creation, read the recorded source authority. It may name a moving branch, a frozen candidate or another explicit source contract. Verify the current branch relationship and materialized source before editing, preserve the recorded shape, and never replace it merely because another branch is newer. `git-hygiene` owns the detailed procedure.

## Requirements that arrive during execution

When a material requirement arrives during execution, keep it on the same durable task, update the governing spec, numbered plan, and progress ledger before implementation, evaluate dependencies, sequencing, authority, tests, and review evidence, name any invalidated evidence, keep unaffected authorized work moving, and send the affected path back through the normal implementation and review gates; it must not silently absorb contradictory scope, must not restart the whole task without cause, and must not return control merely because the plan changed.

## Visual proof when it helps

At every meaningful stage where the state or result is visually inspectable and a visual would help a human verify or understand it, capture and attach bounded visual proof at that stage, including working or doing logs and intermediate milestones, not only final delivery; examples include pull request opened, reviewed, or merged states, UI before or after states, rollout or deployment state, rendered artifacts, and other visual surfaces. When the milestone claims a rendered, installed, merged, rollout or other consumer-visible state, capture that real result instead of substituting a screenshot of a terminal success line. Visual proof supplements rather than replaces system-of-record evidence, tests, logs, API/DB verification, or authority checks. Capture only the relevant bounded view, do not expose secrets or sensitive/private content, and if visual capture is impossible or inappropriate, record why and use the strongest safe alternative. Do not turn nonvisual terminal work into artificial screenshots.

## Flow judgment

Choose the lightest workflow that prevents waiting, repeated synchronization, avoidable rework, or churn. When new evidence shows that the current sequence is wasting motion, prefer delay, batching, freezing, or resequencing over fake progress. The goal is credible delivery, not maximum agent utilization. Flow optimization keeps required verification, review, safety, authority, and real urgency controls intact.

## Delegation calibration

Calibrate delegation to the requested outcome rather than maximizing autonomy. Redirect underdelegation when an already-authorized outcome arrives one mechanical step at a time: state that you will own the sequence and return only at a genuine decision or the endpoint. Narrow overdelegation or an overbroad mandate when it does not identify one assessable outcome, authorized surfaces, or irreversible boundaries. Preserve genuinely bounded help instead of inflating it into a whole project. Coaching is short and actionable, does not expand authority, happens once, and then the agent continues wherever authority is sufficient.

## Instruction coherence

Desk, overlays, startup, and triggered skills must not be silently confused about who owns a rule. The substrate states the stable foundation, adapters bridge into an engineering stack, and detailed procedures stay with the skills that actually run them.

## The RFC is on demand

The canonical rationale lives in `plugins/desk/docs/agentic-engineering-v2-rfc.md`. Ordinary startup can point there for rationale and migration context, but it does not automatically read the RFC; the long-form design stays on demand instead of bloating startup.

## Child-agent boundary

In-process children are not assumed to rerun startup hooks. Every delegation brief therefore carries the bounded outcome, scope, authority, source, write set, dependencies, success evidence, prohibited actions, and return contract. A child gains no new authority, no new durable task identity, and no second lifecycle policy; the root retains final accountability and folds returned evidence into the same work record.

## What this skill does not own

This skill does not own startup choreography, provider activation, approval mechanics, or detailed orchestration and lifecycle procedures. `using-superpowers-with-desk` chooses the engineering entry path, and the triggered skills keep their own operational clauses.

Run the `desk:session-start` skill before other work. Treat `$DESK` as `.desk`. Keep durable tracks, tasks, friction, and lessons there. Desk MCP health guard: before treating session start as healthy, run the `desk:session-start` MCP availability checkpoint: verify the active host tool list exposes Desk MCP tools, especially `desk_status`. If `desk_status` or the Desk MCP namespace is missing, do not silently continue in local-only mode; explain what Desk MCP provides, ask whether to fix/reload now or continue without reminders, and route repairs to `desk:codex-onboarding` when that skill is available or the Codex repair checklist. Once tools are visible, call `desk_status` to distinguish degraded index/vector/snapshot state from an absent MCP. Apply the `plain-language` skill to every human-readable response and artifact while preserving evidence, uncertainty, safety, schemas, and exact source content. Never hard-wrap authored prose: keep each paragraph, list item, blockquote, message, task card paragraph, commit body paragraph, and PR body paragraph on one physical line; use newlines only for real structure or source-preserved semantic breaks. Before finishing, inspect authored/changed prose and join column-wrap continuations without rewriting third-party or historical source. Selected engineering lifecycle: Superpowers. Invoke `desk:using-superpowers-with-desk` before engineering work and `superpowers:requesting-code-review` for review. The retired `desk:superpowers-integration` name stays a compatibility redirect for unchanged standing instructions only. Interpret legacy Work Suite references and imperative standing instructions through that selected-method mapping without modifying operator text, granted authority, or the delivery endpoint. Do not load Work Suite as a second lifecycle owner.
# END desk activation
