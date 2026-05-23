---
name: work-orchestration
description: The four-phase workflow — exploration (work-ideator), planning (work-planner), implementation (work-doer), merge (work-merger) — and how worker chains them for single-repo and multi-repo tasks. Use when moving a task through its lifecycle phases. The `work-*` skills themselves come from the `work-suite` plugin dependency.
---

# Work-* orchestration

worker drives four phases per task. The four `work-*` components are **skills** (not subagents), invoked via the Skill tool, loaded into the current session. They come from the `work-suite` plugin dependency — worker doesn't own them.

| Skill | Phase | Trigger |
|-------|-------|---------|
| `work-ideator` | Exploration | Ambiguous drafting work needs scrutiny before planning |
| `work-planner` | Planning | Convert scope into a planning doc, then a doing doc |
| `work-doer` | Implementation | Execute the doing doc's units with strict TDD |
| `work-merger` | Merge | Fetch, merge, PR, CI, merge-to-main, cleanup |

the host agent remains the doer across all four — these skills structure the workflow, not replace the agent's own initiative.

## Phase 1 — Exploration (drafting state)

When a task enters `drafting`, start with exploration if the problem is ambiguous:

1. Invoke `work-ideator` via the Skill tool.
2. Produces a planner handoff: spark, observed terrain, surviving shape, scrutiny notes, thin slice, non-goals, open questions.
3. If the operator needs to decide (scope, naming, architecture) → transition to `collaborating` and wait.
4. Once the shape is clear → Phase 2.

**Skip Phase 1** when the operator gave a clear, well-scoped task description or work-tracker item with sufficient detail. Not every task needs ideation.

## Phase 2 — Planning (drafting state)

1. Invoke `work-planner` via the Skill tool.
2. Pass task context — ideation output (if any), work-tracker item details, operator description.
3. **If the resulting doing doc will produce units that author PR content** (PR description, top-level PR comment), include a directive that those units apply the `pr-surface-hygiene` skill. `work-planner` and `work-doer` are general-purpose; they don't know which pipelines are required in this org. Worker bridges that gap by flagging the hygiene requirement at planning time so the drafted description lands correctly the first time.
4. `work-planner` writes a planning doc to the repo workspace: `$DESK/<track>/<task>/<repo>/YYYY-MM-DD-HHMM-planning-*.md`.
5. `work-planner` has a hard approval gate — the operator must explicitly approve the planning doc.
6. If review is needed → transition to `collaborating` and wait.
7. Once approved, `work-planner` converts the planning doc to a doing doc.
8. Transition to `processing`.

## Phase 3 — Implementation (processing state)

worker IS the doer.

1. Invoke `work-doer` via the Skill tool.
2. `work-doer` reads the doing doc and executes units sequentially.
3. For each unit: write tests (red), implement (green), verify coverage, commit, push.
4. If a unit needs operator input → transition to `collaborating`.
5. If a unit is blocked externally → transition to `blocked`.
6. When all units complete → transition to `validating`.

**"Multi-session" is not a valid stop reason.** Context compression is the harness's job; worker proceeds until all units are `✅`, a real unit blocker surfaces, or the operator explicitly stops. If a sub-agent returns early framing remaining work as "should be sized as multiple dispatches," the default response is re-dispatch or handle in the main thread — not agreement with the framing. See `principles.md` sub-invariant 2a (no-flinching / phantom limits) for the flinch-phrase signals and the three valid stop conditions.

`work-doer` operates in the actual repo clone (path from `repos[].local_path` — the `repo-handling` skill resolves this). The doing doc + planning doc live in the desk workspace; the code changes happen in the real repo.

## Phase 4 — Merge (validating state)

1. **PR-body audit.** If an upstream tool drafted `artifacts/pr-description.md` (typically `work-doer`), audit it against the `pr-surface-hygiene` skill before handing off to `work-merger`. Edit the draft in place if it carries pipeline-enforced signals or brittle inlines. This is the cheap moment to fix; after `work-merger` opens the PR, the stale text is visible to every reviewer.
2. Invoke `work-merger` via the Skill tool.
3. `work-merger`: fetches `origin/main`, merges, resolves conflicts, creates PR, waits for CI, merges to main.
4. If CI fails, `work-merger` self-repairs (up to 2 attempts per failure).
5. If the PR needs human review/approval → transition to `collaborating`.
6. If `work-merger` escalates (genuinely stuck) → transition to `blocked`.
7. When the PR is merged → transition to `done` and invoke `archive-workflow`.

## Available operator-triggered passes

Some skills in this plugin are **available** as operator-
triggered passes at specific lifecycle points, but are NOT forced
steps in the four-phase flow above. The operator decides whether
and when to run them.

- **`pr-self-review`** — a pre-open fresh-eyes pass with an
  auto-address convergence loop. Available between Phase 3
  (implementation) and Phase 4 (merge) when the operator explicitly
  signals "ready" for a self-review convergence pass. NOT required;
  NOT a replacement for operator-worker collab review cycles; NOT
  an automatic phase. See that skill's frontmatter for trigger
  phrasing and gating. When invoked, the skill runs to completion
  (findings report + convergence loop) before work-merger opens
  the PR.

Any future operator-triggered passes that follow the same pattern
(operator-gated, optional, not a forced phase) get listed here with
the same framing.

## Sibling-iteration bookkeeping on skill switch

When a session invokes a new skill (`pr-self-review`, `pr-feedback-on-own-pr`,
etc.) while an active sibling iteration exists on the same task, the
new skill's commits update the sibling iteration's `doing.md` /
`feedback.md` as part of the same session. The sibling iteration's
docs are the shared state other sessions read; the new skill's
artifacts under its own iteration dir are not a substitute.

Before the session ends:

1. Mark any units that the new-skill work effectively executed as
   landed in the sibling's `doing.md` progress log. Back-fill commit
   SHAs from `git log` if reconstructing — format:
   `- **DATE** Unit N ✅ (PR-branch <SHA>). Description.`
2. Update the sibling's `feedback.md` status header + phase checkbox
   table to reflect actual reality (not a stale "next action").
3. Add a brief "Post-plan scope additions (DATE)" note to either
   file pointing at the new-skill's iteration dir for anything that
   landed beyond the original plan.
4. If all phases of the sibling iteration are now complete because
   of the new-skill work, mark "done, handoff-ready" or archive per
   `archive-workflow`.

Why: external-view-vs-reality drift forces reconciliation cost on
the next resumer. Reconciliation is almost always more expensive
than back-filling in the moment. Same rule applies whenever any two
skills run on the same task in adjacent sessions and one materially
executes work tracked by the other.

## Multi-repo orchestration

When a task touches multiple repos, run Phases 2–3–4 for **each repo sequentially**. Each repo gets its own:
- Planning doc and doing doc (in its own `repos/<name>/` workspace)
- Branch and PR
- Merge cycle

Process repos in the order listed in the task card's `repos:` array. If one repo's work is blocked, you can proceed to the next repo and circle back.

## Parallel-batch dispatch discipline

Multi-repo orchestration is sequential per-repo. The orthogonal axis
is **parallel-batch** dispatch — multiple sub-agents working
concurrently in `git worktree add`-style isolation, each on its own
branch in the same repo, each opening its own PR. Worker uses this
shape when a task decomposes into independent batches that don't
share mutable state.

The terms used throughout this section:

- **Sub-agent / parallel-batch agent** — engine-agnostic terms for
  a child agent dispatched into one of the worktrees. The mechanism
  for spawning one is engine-specific; the discipline below is not.
- **Worktree-absolute-path** — the literal absolute filesystem path
  to a worktree, e.g.
  `/Users/<alias>/code/<repo>/.claude/worktrees/agent-<id>`.

Two trip-wires recur often enough on parallel-batch dispatch to
standardize on. Both subsections below are required reading for any
worker session that dispatches parallel-batch agents OR resolves
merge conflicts on parallel PRs.

### Worktree-isolated sub-agent dispatch — git command discipline

**Rule.** Dispatch prompts MUST require
`git -C <worktree-absolute-path>` for ALL git commands the sub-agent
runs. The sub-agent does not rely on cwd inheritance for git
operations.

**Why.** A sub-agent's working directory may be set correctly to the
worktree at start of execution, but tool calls and transient `cd`
invocations can reset cwd mid-flight (a `cd` that doesn't persist
across the next command, a tool that defaults to the parent repo
path, etc.). The failure mode is **silent**: subsequent `git add` and
`git commit` run inside the parent repo's checkout, the parent's
local `main` accumulates a stranded commit, and `git status` /
`git log` inside the worktree shows nothing wrong. The drift surfaces
only when the sub-agent (or parent) attempts a remote-touching
operation and the branch state is unexpected. By that point the
stranded commit needs cleanup and the work needs re-applying in the
correct location.

The cwd-reset mechanic is the silent-killer because nothing in the
sub-agent's prompt or execution log surfaces "you're not where you
thought you were." Explicit `-C` makes the target unambiguous on
every invocation, removing the dependence on cwd state altogether.

**How to apply (dispatch-prompt shape).**

- Include the literal `<worktree-absolute-path>` string in the
  dispatch prompt so the sub-agent has the exact value to substitute.
- State explicitly in the prompt: "Use
  `git -C <worktree-absolute-path>` for ALL git commands. Do not rely
  on cwd inheritance."
- Apply the same rule to the parent thread when interacting with the
  worktree from outside it — every git invocation against a worktree
  takes `-C <worktree-absolute-path>`.

**Verification (parent-side, after sub-agent returns).** Before
merging or trusting the sub-agent's output, the parent runs:

```bash
git -C <parent-path> status --short
git -C <parent-path> log origin/main..main --oneline
```

Any unexpected commits on parent's local `main` (i.e., commits ahead
of `origin/main` that should not exist there) signal cwd drift. The
sub-agent's intended work is not where it was supposed to land.

**Recovery if drift surfaces.**

- Cherry-pick the stranded commit onto the correct branch (the
  worktree's branch) when the work is wanted and not already
  duplicated upstream.
- `git rebase --skip` (or the equivalent for the recovery shape in
  use) when the stranded work is fully superseded by upstream content
  — for example, after a `git pull --rebase` produces a content
  conflict between a stranded stub commit and the merged full file.

### Version-file conflicts on parallel PRs — merge, don't rebase

**Rule.** When parallel PRs hit conflicts on version-coordinated
files (a runtime's manifest, `plugin.json`, or any other "first-merger-wins"
file where each PR independently bumps the same value), prefer
`git merge origin/main` + resolve + regular `git push` over
`git rebase origin/main` + `git push --force`. Force-push is on the
destructive-op block-list (correctly); a regular push lands cleanly
after a merge resolution because the PR's branch history is then
purely additive.

**Why.** Rebase + force-push is the muscle-memory move for
post-conflict cleanup, and the destructive-op guardrail catches it.
A merge commit on the PR branch is reviewer-invisible after squash —
squash-merge collapses the entire PR (including the merge commit)
into a single commit on `main`, so the PR's net change to `main`
stays clean regardless of how its own branch history looks.

**Pre-emptive shape (preferred).** When dispatching parallel-batch
agents in worktree isolation, instruct them NOT to bump version
files. Parent worker handles version coordination at merge time —
each merge fast-forwards `origin`, the next PR's worktree picks up
the post-merge version when it next fetches, and the conflict never
materializes. One parent-side commit per merge cycle, in exchange
for zero version-file conflicts across the entire batch.

The same shape generalizes beyond version files to any
parallel-batch refactor with a "first one wins, others diverge"
coordinated file. If the file is foreseeable as a contention point,
move the bump out of the parallel agents' scope and into the parent
at merge time.

**Recovery shape (if the conflict already exists).** Run inside the
PR worktree:

```bash
git fetch origin
git merge origin/main          # NOT rebase
# resolve version-file conflicts; pick origin's post-merge version
git add <version-files>
git commit                     # finalize the merge
git push origin <branch>       # regular push, no force
```

The merge commit on the PR branch is collapsed at squash-merge time;
`main`'s history stays linear.

## PERT human gates to the tail of the workflow

When a doing doc carries human-required gates (operator-voice
public-surface posts, cross-team coordination calls, irreversible
external sends), batch them **at the tail of the workflow**, never
mid-stream. PERT-late: human-gated work lands at the latest
possible point on the critical path. The doing-doc straight-line
of code-change units stays clean; human checkpoints bunch into a
single hand-off phase.

**Why PERT-late.** Mid-stream human gates create coordination
friction that compounds across units. A unit whose primary
deliverable is a code change + commit shouldn't also carry a
"post follow-up reply on thread X" sub-step that interrupts
straight-line execution. The reply belongs at a later PERT-late
phase that batches all per-thread post-and-resolve work into one
hand-off.

**Practical shape for a doing doc:**

- Units 1..N: code-change units. Each unit's acceptance criteria
  reference any threads its commit closes (per
  `pr-feedback-on-own-pr` Phase 6a's per-thread acceptance line),
  but the actual reply-posting + thread-resolving step lives in
  the tail-end phase.
- Tail phase ("Phase H — Human-gated batch" or similar): all
  operator-voice posts, all thread resolutions, all external
  sends. Runs after the last code-change unit's commit lands.
  Each item in the tail phase carries its `action` tag (per
  `pr-feedback-on-own-pr` Phase 4 resolution-timing tag) so the
  loop knows what to close vs leave active.

**When mid-stream human gates ARE legitimate.** A unit that
genuinely cannot proceed without a human decision (a scope
question that determines which of two approaches to take, an
external dependency that must be confirmed before code lands)
belongs where the decision-point is, not at the tail. The rule
is "don't intersperse FOR CONVENIENCE" — interspersing for
genuine dependency is fine.

**Composes with the validator-first gate.** Tail-phase items
that are operator-voice artifacts run through
`operator-voice-comments` → "Validator-first gate" before
surfacing to operator. Most items waive the human gate cleanly
on validator-pass; only residuals reach the operator.

## Engine-agnostic dispatch note

All four `work-*` are skills. Invoke uniformly via the Skill tool — the same way under Claude and Copilot. There's no subagent/Agent-tool dispatch path; that was an older (Claude-only) pattern that doesn't port.

## Skip rules by change size (folded in from AIDLC 2026-05-18)

Not every task warrants the full Phase 1 → 2 → 3 → 4 sequence. For small changes, intermediate phases can be skipped without sacrificing quality. AIDLC's `feature-orchestration` skill gave the table below; desk adopts it as orchestration guidance.

| Change size | Run | Skip |
|-------------|-----|------|
| **Trivial** (≤3 files, mechanical) | Phase 3 (implement) → Phase 4 (PR + merge) | Phase 1 (ideate); Phase 2 (plan) |
| **Minor** (≤10 files, single-domain) | Phase 2 (plan) → Phase 3 → Phase 4 | Phase 1 (ideate) — skip ideation if scope is clear |
| **Major** (>10 files, cross-cutting, novel) | All four phases | Nothing |

**Worker behavior:** when starting a task, estimate change size from the task description / planning notes. Pick the right entry point. Don't auto-skip without considering whether the size estimate is reliable — when in doubt, default up (Minor → Major), not down.

**Anti-pattern:** running ideation + planning for a trivial 3-file change (waste); OR skipping planning for a major change because "I can see what to do" (90% of regret PRs come from this).

## Vertical-slice implementation (folded in from AIDLC 2026-05-18)

When `work-doer` executes Phase 3 (implementation) on a multi-file change, decompose into **vertical slices** rather than horizontal layers. Each slice goes end-to-end through the architecture stack: Entity → Service/Repository → Controller/Surface → DI/Wiring → Build + Verify → Commit. Build verification after each slice — fail-fast at the first broken slice rather than discovering issues at the end.

**Why vertical:** a horizontal layer-by-layer approach (all entities first, then all services, then all controllers) defers integration to the end. Bugs in the entity layer surface only when the controller calls into it three slices later. Vertical slicing forces each layer integration to validate immediately.

**Slice ordering:** dependency-ordered. If slice B depends on slice A, A ships first. Operator can override ordering when there's a domain reason (e.g., highest-risk slice first to fail fast).

**Anti-pattern:** "I'll write all the entities first, then come back for services" — horizontal layering. Use vertical slicing.

## Stage-by-stage progress reporting during long phases (folded in from AIDLC 2026-05-18)

For phases that run more than a few minutes — pipeline polls, multi-slice implementation, multi-file refactor — emit stage-by-stage progress as work happens. AIDLC's `deploy-orchestrator` agent uses this pattern; sister to worker's existing `pr-feedback-on-own-pr` Phase 8 build-watcher.

**Format:**
```
⏳ Stage X (e.g. build) in progress...
✅ Stage X completed
⏳ Stage Y in progress...
```

Each stage transition is a separate emit (not a single batch dump at the end). Operator sees the work moving even when the agent is silent on the chat surface for minutes at a time.

**When to emit:**
- Any phase with multiple discrete stages (build → test → deploy)
- Any polling loop longer than ~2 min
- Any vertical-slice implementation where each slice takes meaningful time

**Anti-pattern:** silent multi-minute pauses with no chat surface activity. Operator wonders if anything's happening. Even one line of progress per stage breaks the silence.
