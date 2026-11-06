---
name: pr-feedback-on-own-pr
description: Invoke ONLY when the operator explicitly asks to iterate on a PR's reviewer feedback — addressing reviewer comments on an open PR. Triggered by phrases like "comments", "iterate", "address feedback", "review pass", "reviewer comments". Do NOT invoke for opening a new PR, authoring a PR description (that's `pr-surface-hygiene` + work-merger), discussing a PR abstractly, reviewing another author's PR, or pre-merge checks without explicit reviewer input.
---

# pr-feedback-on-own-pr

This skill inherits all invariants in `../../principles.md`. Read
them first if they are not already in context.

Invoke this skill when the operator asks to iterate on a PR's review
feedback. Worker remains the agent; pr-feedback-on-own-pr is a set of
instructions worker follows for the PR-feedback task.

## Three-doc layered design

A feedback-triggered iteration produces three markdown artifacts in
the iteration directory. Each layer owns a distinct concern; no
duplication across layers. Each artifact is reviewable in isolation.

| File | Granularity | Owns |
|------|-------------|------|
| `feedback.md` | per-thread, per-design-decision | Source of truth for WHAT was agreed. Bucketed thread table, shape-view, per-item `proposed_action`, phase 5a sweep table, phase 8 pipeline iteration log, phase 9 per-thread disposition + Resolved-status. |
| `planning.md` | per-iteration | Scope + completion-criteria contract. `Scope` in/out, `Completion criteria` checkboxes that work-doer syncs, `Context`, `Architecture shape` (references feedback shape-view), `Dependencies + critical path`, `Risks`. |
| `doing.md` | per-unit | HOW we execute, unit-by-unit, TDD-shaped. Unit definitions with exact signatures, exact test names, per-unit acceptance criteria, `Addresses: #threadIds`, `Satisfies: [x] <planning completion-criteria line>`, `Sweep sites: <phase-5a paths>`, progress log, unit-status checkboxes. |

**Cross-doc reference convention:**
- `planning.md` references `feedback.md` ("per walks 1–4 lock-in,"
  "see feedback.md phase 5a sweep"); does not duplicate design.
- `doing.md` references both: each unit lists thread IDs it addresses
  (feedback.md entries) and the completion-criteria checkbox it ticks
  (planning.md).
- At phase 7 exit, `planning.md` completion-criteria sync `[x]` on
  landed evidence. At phase 9 exit, `feedback.md` per-thread status
  column is synced Resolved.

Reference-heaviness is a feature. If planning.md starts restating
design inline, feedback.md becomes stale and two sources disagree —
drift.

## Table of contents

- [Three-doc layered design](#three-doc-layered-design)
- [Invocation](#invocation)
- [Inputs (stored on task card)](#inputs-stored-on-task-card)
- [Buckets](#buckets)
- [Phase 1 — Gather](#phase-1--gather)
- [Phase 2 — Auto-resolve auto-comments (privacy-scan vs AI-review triage)](#phase-2--auto-resolve-auto-comments-privacy-scan-vs-ai-review-triage)
- [Phase 3 — Shape conversation](#phase-3--shape-conversation)
- [Phase 4 — Walk-through](#phase-4--walk-through)
- [Phase 5 — Synthesize (sweep + bake-in)](#phase-5--synthesize-sweep--bake-in)
- [Phase 6a — Plan](#phase-6a--plan)
- [Phase 6b — Execute setup + drift re-fetch gate](#phase-6b--execute-setup--drift-re-fetch-gate)
- [Phase 7 — Execute](#phase-7--execute)
- [Phase 8 — Pipeline-verify (no cap, per-push log)](#phase-8--pipeline-verify-no-cap-per-push-log)
- [Phase 9 — Per-thread verify (loop, not walk)](#phase-9--per-thread-verify-loop-not-walk)
- [Hard rules](#hard-rules)
- [Run-file schema](#run-file-schema)
- [Error modes](#error-modes)
- [Revisions](#revisions)

## Invocation

- Operator says "comments," "iterate," "address feedback," "review
  pass."
- OR session-start detects new Active threads on a PR the operator is
  tracking.

**Disambiguation:**
- Zero in-flight feedback runs → ask "on which PR? I see: [list from
  active tasks]."
- Exactly one in-flight run → confirm "resuming pr-feedback-on-own-pr:
  `<slug>` on PR `<id>` (phase X, next: Y). Continue?"
- Multiple in-flight runs → list them; ask which to work on.

Never assume context. The workspace is shared and the prior session
may have been on a different PR.

### Invocation modes

pr-feedback-on-own-pr runs in one of two modes, set by the caller:

- **`interactive`** (default). The full phase sequence runs: gather,
  triage, shape, walk-through, synthesize, plan, execute, verify,
  close. Operator confirmations happen per `approval_checkpoint`.
  This is the mode used when an operator says "iterate on the
  feedback."

- **`auto-apply-only`**. Invoked by `pr-self-review`'s convergence
  loop. In this mode:
  - Phase 1 Gather still runs, but only the synthetic self-review
    threads from `pr-self-review-findings.json` are in scope. Real
    real PR threads are loaded for awareness but not acted on in this
    invocation.
  - Phase 2 (auto-comment triage) is skipped — self-review
    findings have no bot-vs-reviewer triage to do.
  - Phases 3–5 (shape conversation, walk-through, synthesize) are
    skipped. The evaluator's classification already spells out
    which findings are `resolution_path: auto`; no operator
    conversation is needed.
  - Phase 6a (plan) runs in a compressed form — findings with
    `resolution_path: auto` become units directly, one unit per
    finding, no DAG ceremony.
  - Phase 7 (execute) applies the fixes via the standard
    work-doer flow: strict TDD per repo, commit-and-push per unit,
    tests green before continuing.
  - Phase 8 (pipeline-verify) runs normally.
  - Phase 9 (per-thread verify) runs in a narrowed form: for each
    synthetic self-review thread that was executed, mark the
    corresponding finding as addressed in the findings file.
  - Return to caller: summary of which synthetic threads were
    applied, which were skipped (e.g., test regression on fix),
    and whether any code actually changed (the signal
    pr-self-review's convergence loop needs to decide whether to
    iterate again).
  - Approval checkpoints are effectively `none` for this mode —
    findings were already classified `resolution_path: auto` based
    on the deterministic-fix criteria, so operator-confirm would
    be redundant.
  - **Known-deferred list passthrough.** pr-self-review's
    convergence loop passes its accumulated `deferred_items` list
    (see `../pr-self-review/SKILL.md` — "Known-deferred list"
    subsection) alongside the findings file. When pr-feedback-on-own-pr
    dispatches any sub-agent for batch fix-application in this
    mode (e.g., to apply a fix while reading surrounding code for
    context), the sub-agent's prompt includes the known-deferred
    list verbatim with the same "do NOT re-flag UNLESS context has
    materially changed" header. This keeps the fix sub-agent from
    re-surfacing items already decided — same noise-suppression
    rationale as on the reviewer side, applied to the fix side.

The caller passes the mode at invocation. Default is `interactive`
so existing usage patterns are unaffected.

## Inputs (stored on task card)

```yaml
pr_feedback_prefs:
  approval_checkpoint: always | architecture-and-behavior-only | none
  # Default: architecture-and-behavior-only (nits + doc hygiene
  # auto-apply during phase 7; operator confirms arch/behavior items).
  # In `auto-apply-only` invocation mode (used by pr-self-review's
  # convergence loop), approval_checkpoint is effectively `none` —
  # findings were already classified `resolution_path: auto` on the
  # deterministic-fix criteria, so operator-confirm would be
  # redundant.

  reply_format: behavioral
  # "Addressed — <what changed, one sentence> <why it matches the ask,
  # one sentence if not obvious>." Commit SHA is optional; include only
  # if reviewer needs a specific hunk.

  thread_close_policy: agent-closes-when-addressed | agent-replies-operator-closes
  # Default: agent-closes-when-addressed. Operator can override
  # per-thread.
```

## Buckets

How each comment is categorized up front.

| Bucket | Description | Requires operator confirm? | Example |
|---|---|---|---|
| **architecture** | Refactor a method, split a file, move logic between layers, change shape of a type | Yes | "this 400-line method needs chunking" |
| **behavior** | Change what the code does (null handling, enum mapping, validation rule, log content) | Yes | "undefined bool PATCH should preserve stored value, not flip to false" |
| **doc** | Redundant xmldoc, leaky impl notes, missing "why," numbered-step confusion | No (auto-apply) | "comments shouldn't be redundant to the JsonProperty" |
| **clarification** | Reviewer is asking a question, not requesting a change | Yes (reply-first, no edit) | "what's 'binder default' mean?" |
| **nit** | Small style/naming tweaks | No (auto-apply) | "let's give this a more declarative name" |
| **auto-comment** | Bot-generated noise or gate feedback — not operator review input | Varies; see triage below | ref-update bot, privacy-scan bot, AI-review bot, coverage bot |

---

## Phase 1 — Gather

Pull every Active thread on the PR. Bucket by the categories above.
Produce a table the operator can skim.

**Data source (engine-agnostic):** the PR host's threads/comments API
(e.g. `GET /repos/<owner>/<repo>/pulls/<pr-id>/reviews` + `/comments`
on GitHub, or the equivalent on whatever code-review system the
overlay targets). The call returns the full thread list. Each thread's
first-comment author identifier is the bot/author; the comment body
is the content.

Produce the run file at
`<iteration-dir>/feedback.md` and populate the threads-table with
every Active thread. Mark each row with a proposed bucket; operator
refines in phase 3.

### pr-self-review findings ingestion

If `<iteration-dir>/artifacts/pr-self-review-findings.json` exists
(produced by the `pr-self-review` skill), load every finding in that
file as an additional **synthetic thread** alongside the real PR
threads. Each synthetic thread carries:

- `id`: the `thread_id` from the findings file (e.g., `self-review-001`),
  distinguishable from real PR thread IDs by prefix.
- `author`: `pr-self-review` (so the bucketing + disposition code
  can branch on it when needed).
- `bucket`: derived from the finding's `severity` and
  `resolution_path`. `resolution_path: auto` findings default to
  `nit` or `doc` (the auto-apply buckets); `resolution_path: human`
  findings default to `behavior` or `architecture` (operator-confirm
  buckets).
- `file:line`, `body`, `suggested_fix`: copied through from the
  finding.
- `proposed_action`: pre-populated from the finding's title/body so
  Phase 3 and Phase 4 can treat it identically to a real thread.

Synthetic threads flow through the same downstream phases as real
PR threads. The only phase that branches on source is Phase 9
close — synthetic self-review threads have no real PR thread to mark
Resolved, so the "post behavioral reply + Resolved" step becomes
"update the findings file entry to mark the finding as addressed."

**Exit criteria:** bucketed table emitted to `feedback.md`, with
synthetic self-review threads included if a findings file is
present.

---

## Phase 2 — Auto-resolve auto-comments (privacy-scan vs AI-review triage)

For each `auto-comment` thread, pick a disposition. Most auto-comment
disposition is mechanical; the load-bearing exception is the
**privacy-scan-bot vs AI-review-bot** distinction — these can post
under the same author identity, and conflating them costs threads
mid-iteration.

### Author + body-content triage table

Author alone is insufficient: multiple bot services may post under
the same `displayName`. Triage on body content.

| Bot class | Body-content signal | Triage | Default action |
|---|---|---|---|
| ref-update bot | "The reference refs/heads/... was updated." | ref-update | Resolve silently, no reply. |
| coverage / test-service bot | Coverage/build bot output | coverage bot | Leave Active. Auto-clears when the underlying gate turns green. Do not reply. |
| **privacy-scan bot** | Body begins with a privacy-defect header + "Brittle Pattern" or similar pattern-match line | privacy scan | Default False-Positive (most are noise). If the flagged line is plausibly real AND introduced/touched by this PR, escalate to operator with a one-line "Fix / FP / Pre-existing?" proposal. Never auto-create follow-up tracker items. |
| **AI review bot** | Body contains an `AI Code Review` badge, an embedded "Assistant" span, OR a ` ```suggestion ` code block | AI review | **Treat as reviewer feedback.** Bucket by content (behavior / architecture / nit / doc); push into the walk-through queue. Do NOT auto-FP. |
| Any other bot | — | Unknown bot | Batch-flag to operator; don't assume. |

### Pre-close safety check

Before posting `status=Closed` on any bot thread, read the first
100–200 chars of the body and match against the signals above. If the
body looks like an AI-review suggestion (`suggestion` block present,
or an Assistant span) — escalate to walk-through instead of closing.

### Harness-denied reopen is correct-by-design

If you mis-classify and close a PR-Assistant thread, the PR host's API will
sometimes accept a reopen request and sometimes reject it. A correctly-
configured operating environment may deny the reopen ("reversing a
resolution without authorization is destructive"). That denial is
correct: the right fix is to not close the thread in the first place,
not to layer reopens on top of mis-classification. If a reopen is
denied, proceed with the thread in the walk-through queue at its
current (closed) status and let the operator decide whether to reopen
from the UI.

**Exit criteria:** every `auto-comment` thread has a disposition line
in `feedback.md`. No `auto-comment` threads remain unhandled before
phase 3 begins.

---

## Phase 3 — Shape conversation

Agent produces a **shape-view**, NOT per-item proposals. The goal is
macro alignment — decisions made here set boundaries for all per-item
work in phase 4.

The shape-view surfaces:

- **Themes** across the feedback (2–5 high-level clusters).
- **Dependency graph** between clusters: which clusters gate which.
- **Critical path**: the longest chain of dependencies that will
  determine iteration duration.
- **Cut points**: what could be deferred without blocking merge of
  the PR.
- **Cross-cutting principles** the feedback implies (these promote to
  friction for bake-in in phase 5b).
- **Open questions** needing operator judgment.

Operator reviews, pushes back, redirects, adds context. This is a
conversation, not a proposal list — per `../../principles.md` Invariant 1
(collab-flow), do not walk each item one-at-a-time here.

**Agent output shape:** analysis only. If you catch yourself drafting
"for item 5, I propose X" during phase 3, stop and reframe to shape-
level. Per-item proposals are phase 4 output.

**Exit criteria:** shared shape-view in `feedback.md § Shape view`;
operator has acknowledged agreement (not a separate signoff — a
continuation message is sufficient).

---

## Phase 4 — Walk-through

Now narrower. Per-item discussion runs only for items NOT already
addressed by the phase-3 shape-level decisions. Proceed in
**dependency order** — critical path first. Many items will resolve
collectively via shape agreements; document those as
"resolved-by-shape" rather than re-walking them.

Nits and docs still auto-apply (no operator interaction). Architecture
and behavior items require operator confirmation per
`approval_checkpoint: architecture-and-behavior-only`.

Per the batch-refinements sub-invariant in `../../principles.md`
Invariant 2: do not act once per operator sentence. If operator sends
a second refinement while the first is being processed, wait and
consolidate.

Operator-voice comment discipline (verify load-bearing claims, no
fabricated specifics or timelines, no sycophantic padding, match
operator's voice, bot signals are not urgency): see
[`../operator-voice-comments/SKILL.md`](../operator-voice-comments/SKILL.md).
Apply at every draft-time touchpoint in this phase. The same tone
bar applies to inline rationale pins added in Phase 7 (see
"Pinning no-op decisions in code").

### Comment classification (4-way)

Every reviewer comment-thread sorts into exactly one of four
categories, each with a different response shape. Apply at
walk-through time so the right action is locked in before
Phase 7 execute / Phase 9 reply.

| Category | Signal | Action |
|---|---|---|
| **Code change requested** | Reviewer says: rename this, remove this, refactor, use X instead of Y, add an import, etc. — directive about the diff. | Plan the change. Land in Phase 7. Reply at Phase 9 names the commit SHA. |
| **Question about code** | Reviewer asks: why did you do X? what does this do? is this necessary? Curiosity, not directive. | Draft a reply. **Do NOT post automatically.** Surface to operator with `DRAFT REPLY:` prefix. The operator decides whether to post the reply, post a different reply, or change the code instead. |
| **Needs human decision** | Scope disagreement, architectural choice, product question, or ambiguity that can't be resolved from the diff alone. | Flag with `NEEDS HUMAN: <author> on <file:line> — <one-line summary>`. Don't act, don't draft. Operator resolves. |
| **Nit / style** | Trivial formatting, naming preference, micro-clarification. | Apply if the change is clearly an improvement. Otherwise flag for operator. |

**The "DRAFT REPLY, don't post" rule is load-bearing.** Most
reviewer questions deserve a thoughtful answer the operator
shapes — not an auto-reply that sounds like the operator but
isn't. Pre-empting the operator's voice on a question is the
exact failure mode `operator-voice-comments` exists to prevent.
The draft is worker doing 80% of the work; the operator does
the 20% that has to be theirs.

**The classification is per-thread**, not per-comment within a
thread. If a thread has multiple comments, classify against the
most recent comment from a human (ignore bot replies, our own
prior replies).

### Resolution-timing tag (per-thread)

Every confirmed thread carries a **resolution-timing tag** that
drives Phase 9's resolve-or-leave-active discriminator. The tag is
implied by the category but recorded explicitly in `feedback.md` so
sub-agents executing per-thread replies don't have to re-derive it
and so the planner can wire the resolution step into per-unit
acceptance criteria.

| Tag | When it applies | Phase 9 behavior |
|---|---|---|
| **`post-and-resolve`** | Explanation-only thread — typically a nit where worker can explain the existing code without changing it, or a code-change-requested thread whose change is `resolved-by-shape` (no per-thread unit needed). | Reply with the explanation, mark thread `Resolved` in the same turn. |
| **`post-and-stay-active-until-{unit}`** | Code-change-requested. The reply promises a change ("Addressing by doing X") that is scheduled in unit N. | Reply with "Addressing by doing X", **leave thread `Active`**. When unit N lands, post a follow-up "Done — change is in" reply on the same thread (referencing the commit), **then** mark `Resolved`. |
| **`post-and-leave-open`** | Open question requiring operator or cross-team decision; or `needs-human-decision` items where the resolution requires an offline call. | Reply with the framing ("Operator is checking with X"; "Pending offline decision"), leave thread `Active` indefinitely. Operator resolves in a future session. |

**Why distinguishing matters.** A thread with status `Resolved`
carries the signal "this is done." Resolving on a promissory reply
("Addressing by doing X") before the code lands lies about the
state — the reviewer gets no callback when the change is in,
mid-rollout review hygiene breaks (reviewer can no longer filter on
`status=active` to find what's still pending), and trust erodes.
The discriminator makes the timing constraint structural rather than
something each reply-author has to remember per-thread.

**Common slip mode.** When generating per-thread reply prompts for a
sub-agent, the action tag must be passed through verbatim. A
sub-agent prompt that says "Resolve thread on post" for a
`post-and-stay-active-until-{unit}` thread will follow instructions
correctly — and the slip is upstream, in the prompt the sub-agent
received, not in the sub-agent's execution. The fix lives in the
planner output: per-unit acceptance criteria for code-change-tied
threads must include the resolution step as its own line.

**Exit criteria:** every thread has one of:
- `confirmed` + `proposed_action: <one-liner>` + `action: post-and-resolve | post-and-stay-active-until-{unit} | post-and-leave-open` (code change requested or nit)
- `resolved-by-shape` (references which shape decision; `action: post-and-resolve` once shape decision is communicated)
- `pending-clarification` (a question was posed; waiting for operator)
- `draft-reply-pending-operator-approval` (question about code; reply drafted but not posted)
- `needs-human-decision` (flagged with `NEEDS HUMAN:` prefix; awaiting operator; `action: post-and-leave-open`)

---

## Phase 5 — Synthesize (sweep + bake-in)

### Phase 5a — Pattern sweep

For each `confirmed` item, grep the full PR diff for every site where
the same rule applies. Single-site fixes are a bug — if a reviewer
flagged nullability once, every other nullable member in the PR gets
the same scrutiny.

Output: `feedback.md § Sweep table` with `pattern → [file:line]`
entries. Populate the per-thread `sweep sites` column.

### Phase 5b — Bake-in

For each `confirmed` item, draft the "do this right the first time"
rule and append to the active track's `_friction/` directory. Every
confirmed human comment produces a bake-in rule — even if the rule is
just "see existing rule X."

Bake-in is the mechanism that prevents the same feedback from being
raised on the next PR. It is not optional.

**Exit criteria:** sweep table + bake-in rules both complete.

---

## Phase 6a — Plan

Hand off to `work-ideator` for architecture items (explore tradeoffs,
surface alternatives) → `work-planner` to produce `planning.md`
**shaped as a DAG, not a flat list**:
- Nodes = units.
- Edges = "must finish before."
- Critical path marked.
- Parallelizable branches annotated.
- Every unit lists its `sweep sites` from phase 5a.
- **Every code-change-tied thread is wired into a unit's acceptance
  criteria.** For each thread carrying `action: post-and-stay-active-until-{unit}`,
  the named unit's acceptance criteria must include — as its own line,
  not collapsed into the code commit — the post-and-resolve step:
  *"Post follow-up reply on thread <id> referencing the landed
  commit, then mark thread Resolved."* Phase 9 enforcement depends on
  this; without an explicit acceptance line, the resolution step
  drifts into "I'll remember to do it" territory and gets missed.

For trivially-linear dependency graphs, prose is fine — don't
over-engineer a 3-unit iteration into a DAG.

**Exit criteria — agent self-attestation, not operator signoff.** The
default exit is autonomous: produce the plan, run skepticism passes
on it, self-attest, proceed to phase 6b. Operator retains the right
to async-review and push back, but the agent does not block waiting
for that.

1. Produce `planning.md` per the DAG conventions above.
2. Run **at least two adversarial skepticism passes** on the plan and
   record findings inline in a `## Skepticism passes` section of
   `planning.md`. Suggested modes:
   - **Tinfoil Hat**: "what breaks this plan — hidden coupling,
     timing assumption, PR-branch vs main drift, untested path,
     reviewer likely to push back on this choice?"
   - **Stranger With Candy**: "a reviewer with zero session context
     lands on `planning.md` — where would they flinch, what would
     they ask, what reads as unexplained?"
   Incorporate findings into the plan; don't just log them. If a
   pass finds nothing, say so explicitly — silent passes are a
   smell.
3. **Self-attest** at the top of `planning.md` with three lines:
   - Every walk-through disposition has a matching unit.
   - Skepticism passes ran and findings are incorporated.
   - No open architectural questions.
   If any of the three is false, escalate per the next bullet.
4. **Escalation criteria.** Stop and ask the operator only when:
   - A walk-through disposition does NOT yet have a matching unit
     (means walk-through itself was incomplete — re-enter phase 3/4
     for that thread, don't punt the question into phase 6a).
   - A skepticism pass surfaces a gap not resolvable by the
     walk-through's existing shape (a genuine new architectural
     decision, not a clarifying detail).
   - A prereq the plan depends on is missing (unmerged dependency
     PR, an MCP that's down, an `az` token expired, etc.).
   These are the only valid stop conditions; "I want to be safe and
   ask" is scaffolding (per `principles.md` Invariant 6) and is not
   on the list.

The self-attestation is a record on the iteration, not a silencer
for the operator. Operator can read `planning.md` at any time and
push back; the agent's job is to make that push-back unnecessary by
default.

---

## Phase 6b — Execute setup + drift re-fetch gate

Before handing off to `work-doer`:

1. **Re-pull active threads** via the PR host's threads API (same call as
   phase 1).
2. **Diff against `feedback.md`'s thread list.** New threads posted
   since phase 1 get bucketed and assigned to units BEFORE execution
   starts.
3. Between-units is NOT a re-fetch point — that's noise.

This is the drift-refetch gate: threads added during phase 3–5 do not
get missed, but we also don't re-pull on every commit.

**Exit criteria:** drift re-fetch complete; any new threads either
assigned to a unit or dispositioned.

---

## Phase 7 — Execute

`work-doer` runs critical-path units serially + parallelizable units
concurrently. Strict TDD per `../../principles.md` invariants. Repo-
specific build-check before every commit (e.g., a formatter `--check`
flag for a C#-heavy reference implementation; capture per-repo
build/lint commands in a repo-local notes file).

**doing.md kept live:** every unit completion triggers
`docs(doing): complete Unit X` — unit status flip `⬜ → ✅`,
progress-log entry with git timestamp, Completion Criteria checkbox
sync.

**planning.md kept live:** at phase 7 exit, `Completion Criteria`
checkboxes sync `[x]` based on landed evidence.

Commit-and-push cadence per `../skills/git-hygiene/SKILL.md`: every
file edit commits and pushes atomically. No end-of-phase batch
push.

### Pinning no-op decisions in code

When a reviewer finding (or a pr-self-review synthetic finding) is
decided **no-op / defer / accept-status-quo** during walk-through
or the convergence loop, the default next step is to add a short
evergreen comment at the finding's cited line explaining the
rationale. **Not pinning is the explicit exception, not the
default.** Re-flagging the same deferred-design-decision across
later reviews is a tax on the operator's time that compounds every
time a new agent or reviewer reads the code.

**Placement.** Inline at the smell, as close as possible to the
line a future reviewer would otherwise flag. For cross-file smells
(style inconsistency across a test project, repo-level convention
applied at multiple sites), use a top-of-file or top-of-module
pointer instead of cascading inline comments at every site.

**Tone — rationale-first.** Same bar as Phase 4's operator-voice
discipline. Explain WHY the code is this way in terms a maintainer
would read. Never write "do not flag," "stop suggesting," or
"reviewers proposed." The rationale itself does the work; a fresh
reviewer concluding "this is a considered decision" from the
rationale alone is the desired effect, not the stated goal.

Good shapes:

```csharp
// Non-nullable bool on the GET response even though the PATCH
// side uses bool? — consumers at this surface treat "unset" and
// "false" identically, so the tri-state doesn't surface in any
// UI or downstream behavior. Response narrows intentionally.
```

```csharp
// CancellationToken.None here matches the rest of this layer's
// service-call pattern; CT propagation from HttpContext is wired
// in two places today and follows the dominant pattern until the
// repo adopts a broader sweep.
```

Bad (lecturing / defensive — do not write these):

- "Do NOT flag this as [concern]."
- "Reviewers have suggested X; we're intentionally not doing X."
- "Stop proposing changes to this."

**Exceptions** (don't pin inline; do something else):

1. **Cross-file noise.** If the smell is inherently file- or
   project-scoped and a cascade of comments across many files
   would itself be noise, use a single pointer comment or
   module-level design note instead of pinning every site.
2. **Genuine TODO** (do this eventually, just not this PR). A TODO
   comment is the right shape there, not a "no-op is fine" pin.
   Keep them distinguishable: TODO is "fix later," rationale-pin
   is "this is the right shape and won't change."
3. **Absence findings** (missing feature, missing test, missing
   log). There's no line to pin a comment to. Log the decision in
   the task card or follow-up-issues file instead.
4. **Operator-already-rejected.** If the operator decided no-op
   without leaving any rationale that maps to the code (pure
   judgment call: "we're not doing that"), pinning would just be
   inventing a maintainer-facing rationale. Skip the pin and
   record the decision in the task card.

The pin's audience is every future reader — the operator, the
operator's next agent, a teammate's agent reviewing the PR cold,
and any human reviewer who lands on the file later. None of those
readers shares the session context that produced the no-op
decision; the inline pin is the only mechanism that serves all of
them. Re-read the pin as if seeing the code for the first time
before considering the finding closed; if reading cold would still
flag the finding after the pin, strengthen or relocate the pin.

**Exit criteria:** every unit done; tests green per unit.

---

## Phase 8 — Pipeline-verify (no cap, per-push log)

All required pipelines green, coverage at or above gate.

**No iteration cap.** 10+ pipeline iterations to green is not unheard
of on a large repo (one reference implementation took 6 iterations on
initial-impl just to clear stale-main + flakes). Do NOT hard-cap
pipeline iterations. Do NOT return control for a cap hit. Return
control ONLY for blockers that genuinely require operator input (see
`../../principles.md` Invariant 1 on what counts as a real decision
point).

**Every pipeline run (success or failure) logs** to the iteration's
`feedback.md` under `## Phase 8 — pipeline iteration log`, one row in
a running table:

| # | push SHA | pipeline(s) | status | failure mode | diagnosis | remedy | outcome |
|---|----------|-------------|--------|--------------|-----------|--------|---------|

Diagnosis classes:
- `flake (matches prior fingerprint)`
- `flake (new)` — log enough detail to become a searchable
  fingerprint for future iterations
- `stale-main`
- `real regression (compile)`
- `real regression (test)`
- `coverage gap`
- `formatter (e.g., csharpier / prettier / black / gofmt)`
- `environment`

Operator reading the table at any moment sees: how many iterations,
what keeps breaking, what patterns of flake. Operator may interrupt
if the pattern is concerning; that's operator's call. Agent's job is
to keep iterating + logging.

Capture repo-specific failure classes (and pipeline parity details)
in a repo-local notes file so future iterations can match new
failures against a known fingerprint set.

### Phase 8 and Phase 9 run in parallel after final-unit push

Once the final unit is pushed and the walk-through dispositions are
signed off, Phase 8 (pipeline-verify) and Phase 9 (per-thread
verify) are independent work streams. The agent should run them
concurrently rather than serially:

- Phase 9 thread replies reference stable commit SHAs
  (e.g. `"Resolved by commit 473f9a56"`). Those SHAs don't change
  as fix-up commits for format / test-contract errors layer on.
- Pipeline churn during Phase 8 therefore rarely invalidates Phase
  9 work.
- Exception: if a pipeline failure forces a **code** fix that
  changes a unit's landed shape, update the affected thread replies
  post-hoc. Cheap — threads are small, the relevant SHAs are one
  grep away.

The agent should not block Phase 9 behind Phase 8 green. Human-
facing latency on `pr-feedback-on-own-pr` iterations compresses significantly
when the pipeline wait runs in parallel with the thread-verify
walk.

### Long-running pipeline waits

Pipeline-verify on a large repo can mean waiting 30-60 minutes (or
more) for required builds to reach a final result. The right shape
for that wait is a **single backgrounded poll loop that fires
exactly one completion notification** when the watched state
becomes true. The wrong shape — and the failure mode this rule
targets — is a delegated helper that returns "still in progress"
repeatedly, leaking intermediate status as separate notifications
and producing no clear "done" signal.

**Required loop properties.**

1. **Single-fire on completion.** One notification when the watch
   condition is met (or the timeout trips). Not many.
2. **Token refresh per tick.** Long polls outlive ~1h auth tokens
   trivially. Refresh inside the loop, not once outside.
3. **Hard timeout with distinct exit code.** `0 = done`,
   `1 = timeout` (or equivalent). The parent branches on the exit
   code to know whether the wait succeeded or hit the wall.
4. **Per-tick interval respects the watched system's rate
   limits.** For long-running CI pipelines, 3-4 minutes between
   ticks is a typical bar. Faster runs into rate-limit / load problems.

**Tool selection — pick by behavior signature, not by tool name.**

- "Notify me **once** when X is true" → single backgrounded poll
  loop with a completion signal. The right shape for pipeline-
  verify waits and similar one-shot async-state checks.
- "Notify me on **every** occurrence of Y, indefinitely" →
  continuous monitor. Different shape; not what's wanted here.
- "**Synthesize** a structured result from async data" →
  synchronous helper that produces the result. Different shape
  again; the helper returns the work, not a signal.

The first shape is the one to reach for when waiting on pipelines.
The other two shapes are listed so the contrast is obvious — they
are not interchangeable with the first.

**Counter-pattern to avoid: dispatching multiple watchers in
succession because the previous returned early.** Each new
dispatch spawns its own context and burns its own quota; none of
them actually wait on the underlying state. The fix is the tool
choice, not the dispatch — switch to the single-fire backgrounded
poll loop and stop dispatching helpers that won't wait.

**Annotated example** (illustrative; the principle is engine-
agnostic, the example uses a generic shell shape):

```bash
# Example shape — single backgrounded poll loop with token
# refresh per tick, hard timeout, distinct exit codes. Wait
# until two pipelines both report a finished state, then exit.

START=$(date +%s); MAX_SECONDS=3600
while true; do
  TOKEN=$(<refresh auth token here>)
  DONE_A=$(<probe pipeline A; emit non-empty when finished>)
  DONE_B=$(<probe pipeline B; emit non-empty when finished>)
  if [ -n "$DONE_A" ] && [ -n "$DONE_B" ]; then
    echo "DONE"; exit 0
  fi
  if [ $(( $(date +%s) - START )) -gt "$MAX_SECONDS" ]; then
    echo "TIMEOUT"; exit 1
  fi
  sleep 240   # 4 minutes; respects CI pipeline rate limits
done
```

The example launches as a single backgrounded process. Exit code
0 means both watched states became true; exit code 1 means the
hard timeout tripped. The parent reads only the final exit and
the loop's last output line — no streamed intermediate status.

**Exit criteria:** all required pipelines green on the most recent
push; pipeline iteration log complete.

### Build-failure-vs-infra-failure triage

Not every red pipeline needs a code fix. A meaningful share of CI
failures are infrastructure issues — agent disconnects, network
timeouts, registry hiccups, package-restore flakes — where the
right move is **retrigger the policy**, not edit code. Trying to
fix code when the failure is infra wastes a push cycle on a fake
fix that doesn't address the actual cause.

**Infrastructure-failure signals** (retrigger; don't edit code):

- Build agent timeout or "the agent stopped responding"
- "Unable to connect to..." / network errors
- "The job was canceled" without an associated code error
- Disk-space failures
- Docker / container runtime failures
- Package-restore timeouts (NPM / Yarn / NuGet registry issues)
- Out-of-memory errors not caused by recent code changes
- Generic CI / cloud-build service errors with no test or compile
  trail in the log

**Code-failure signals** (fix in code):

- Compiler errors (`CS####`, `TS####`, etc.)
- Test assertion failures with stack traces in repo files
- Linter / formatter violations
- Coverage-gate failures

**Retrigger flow.** Use whatever your platform provides to re-run a
required policy or check without pushing a new commit (GitHub: re-run
a failed check via `gh run rerun`; GitLab: retry a CI job; other
platforms: their equivalent). The mechanics are platform-specific;
the discipline is universal — retrigger on infra failure, code-fix on
code failure.

> **Overlay users:** platform-specific retrigger recipes (e.g.
> non-GitHub PR hosts requiring an auth-token refresh + a state-PATCH
> against a policy-evaluation endpoint) typically live in a consumer
> overlay's PR-toolbox skill.

**Guard rails on retriggers:**

- **Max 2 retrigger attempts per build.** A third infra failure on
  the same build means the infra itself is the issue (registry
  outage, agent pool down, CI incident); surface to operator with
  "Build [name] has failed 3 times due to infra issues — needs CI
  platform support."
- **Retriggers don't count against code-fix push cycles.** The
  separate counter exists because retriggering is cheap and
  doesn't risk a wrong-fix landing.
- **Always log the retrigger** in the pipeline-iteration log with
  diagnosis class `environment` or `infrastructure-retrigger`,
  not as a code-fix iteration.

**Why keep them separate:** conflating infra-retrigger and
code-fix in the same counter rewards "edit something, anything,
on every red" — which is how fake fixes land. Distinct counters
keep the discipline honest.

### Production pitfalls when polling CI state via shell + Python

Tactical wisdom for any code that polls CI state via shell
loops (whether in this skill, in pipeline-verify scripts, or in
ad-hoc one-offs):

- **CLI `--query` / `--jq` flags are rarely sufficient for complex
  filtering.** Pipe to `jq` or `python3` for non-trivial extraction.
- **Use temp files (`mktemp`) to pass JSON between shell and
  Python.** Shell variable interpolation breaks on JSON `null`
  values; the cleanest workaround is `echo "$BLOB" > "$TMPFILE"`
  and have Python read the file.
- **Inline Python in shell strings: prefer heredoc (`<<'PYEOF'`)
  over `-c` with double-quoted body.** Shell escaping mangles
  characters like `!=`; heredoc with single-quoted delimiter
  passes the body through verbatim.
- **Use `json.dump(data, sys.stdout)` instead of
  `print(json.dumps(data))`.** The `print` form adds a trailing
  newline that some captures interpret as part of the value.
- **Pipe CLI commands through `2>/dev/null || echo '[]'`** for
  graceful handling of transient errors. The poll loop should
  treat a single-tick failure as "try again next tick," not as
  a hard stop.
- **Token refresh per tick is mandatory** for any loop whose run
  duration approaches the auth token TTL.

> **Overlay users:** platform-specific variants of these patterns
> (token-refresh recipes, vendor-CLI `--query` quirks) typically live
> in a consumer overlay's PR-toolbox skill.

---

## Phase 9 — Per-thread verify (loop, not walk)

**Phase 9 is a hard loop over landed code, not intention.**

Before starting phase 9: re-pull active threads one more time. Any
thread posted during phases 7–8 gets bucketed and handled before
closing the iteration. (This is the second drift re-fetch; the first
was at phase 6b start.)

**Each thread carries a resolution-timing tag from Phase 4** —
`post-and-resolve`, `post-and-stay-active-until-{unit}`, or
`post-and-leave-open`. The tag determines whether this loop closes
the thread or only posts a reply:

- **`post-and-resolve`** — explanation-only or `resolved-by-shape`.
  Reply, then mark `Resolved` in the same turn.
- **`post-and-stay-active-until-{unit}`** — code-change-tied. The
  initial reply ("Addressing by doing X") posts here AND the thread
  stays `Active`. The thread closes only when the named unit lands:
  the unit's acceptance criteria from Phase 6a name a follow-up
  reply that references the landed commit, after which the thread
  is marked `Resolved`. **Never resolve on the promissory reply.**
- **`post-and-leave-open`** — open question or
  `needs-human-decision`. Post the framing reply here, leave thread
  `Active` indefinitely. Operator resolves in a future session.

For each non-auto thread, in dependency order:

1. Re-read reviewer body + `proposed_action` + `action` tag +
   assigned unit(s) + actual landed diff on the PR (via the PR
   host's "PR iterations / changes" API or equivalent).
2. Landed code must satisfy the ask. Not "intended to"; landed.
3. **If no:** loop back to phase 6a (update plan) or phase 7 (add
   units). Never Resolved on intention.
4. **If yes:** post a behavioral reply per `reply_format` (what
   changed, one sentence; why it matches the ask, one sentence if not
   obvious) and mark thread Resolved. The `pr-surface-hygiene` skill's
   per-thread-reply carve-out applies here: citing the thread's file
   and line IS legitimate because the thread itself anchors the
   location. Avoid brittle inlines UNRELATED to the thread's scope
   (test counts, Unit-N refs, timing claims from development).

   **Reply tone.** Behavioral replies explain what changed and why
   it matches the ask. They do NOT rebuff the reviewer, restate the
   reviewer's own words as if explaining back to them, or use
   defensive framings like "as documented in the comment" or
   "intentionally not changed per X." If the ask is satisfied by
   landed code, state the change; if the ask was declined, explain
   the reason as a considered decision, not as a rebuttal. Bad:
   "We intentionally kept this because reviewers have proposed X
   before." Good: "Kept [shape] because [concrete reason about the
   consumer contract]." A reviewer reading the reply should feel
   heard, not lectured.

**Verify-loop-not-walk.** The distinguishing rule: if the reviewer's
ask is not satisfied by the landed code, the phase restarts at the
failing thread — it does not proceed past the failure with a
"resolved-with-caveats" label. Phase 9 exits only when every thread
is dispositioned cleanly.

**Platform link syntax.** When a reply body references another PR
or work item, use the platform's auto-link syntax — not raw URLs and
not "PR <id>" prose. Each platform has its own conventions; pick the
one your platform renders as a styled link with title/status.

On GitHub: `#<id>` for PRs/issues. On GitLab: `!<id>` for MRs, `#<id>`
for issues. Other PR hosts have their own conventions.

Example (GitHub): `"Resolved by #1543 — landed the unified accessor in
that PR; this thread's read-side now goes through it."` Reads
shorter than `"Resolved by PR 1543"` and renders as a clickable
styled link in the comment. Same applies to commit references where a
sibling-PR commit landed the resolution. Reserve raw URLs for
non-PR/non-WI links (wiki, dashboard, log).

Edge cases:
- Reviewer-closed thread during the run: skip (withdrawn input).
- Operator-skip thread: mark `operator-skip` + reply pointing at the
  offline decision.

### Cross-check live PR threads after any thread-creation flow

**Rule.** After any flow that creates PR threads — whether
written inline by the agent doing per-thread verify, or via a
delegated authoring helper that may retry internally — query the
live PR's thread list and look for duplicates of the just-created
content. Don't trust a single returned thread ID as authoritative
for "the only one."

**Why.** A flow's reported thread ID is authoritative for "the
latest one I posted," not for "the only one I posted." Internal
retries (a preview-render check that didn't look right; a transient
REST timeout where the second call thinks the first failed but it
actually landed) can leave orphaned earlier posts. Two threads
with substantially the same body, both `active`, is the symptom.

**How to check.**

```
GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests/{pullRequestId}/threads?api-version=7.1
```

Filter for threads matching the expected content — substring match
on the comment body, or filter by author + recent timestamp window
(threads posted in the last few minutes by the same identity).
If multiple match: duplicate.

**Cleanup when a duplicate is found.**

1. Pick the keeper. Default heuristics: the thread linked from the
   PR description, or the most recently updated.
2. Delete the duplicate's comment:
   `DELETE /threads/<dup>/comments/<commentId>?api-version=7.1`.
3. Close the now-empty thread:
   `PATCH /threads/<dup>` with `{"status":"closed"}`.

Once a single thread remains, resolve its status (active /
byDesign / closed) per the operator's preference for the thread's
role.

### Bulk regex replace safety on PR comments

When running regex-based bulk cleanup on a long PR comment body
(e.g., to strip many stale line-range placeholders or
boilerplate), apply two safety rules:

**Prefer drop-to-empty over fallback-prose substitution.** Replace
the matched text with `''` rather than substituting a fallback
string like `'<line-range removed; navigate by method name>'`.
Fallback prose is verbose and visible if the regex over-matches —
a noisy reviewer-facing artifact that's easy to spot but
unpleasant to clean up. Drop-to-empty is harder to make worse with
an over-match: if the pattern hits something it shouldn't, the
result is missing text the operator can see, not redundant prose
they have to scrub out.

**Verify before / after counts.** Count pattern matches before
the replace, run the replace, count remaining matches after.

- Non-zero after-count → the pattern under-matched; fix the regex
  before re-posting.
- Length-diff doesn't roughly match `(matches × pattern_length)`
  → something other than the intended pattern got hit. Investigate
  before trusting the new body.

The before/after count check is the cheap defense against an
over-broad pattern that silently chews extra text. Run it every
time, even when the regex looks obviously correct.

**Exit criteria:** zero unresolved non-auto threads.

---

## Hard rules

- **Agent output shape matches phase.** Analysis during shape/
  synthesis; proposals during walk-through; execution during doer;
  reply during close. Don't leak per-item resolution-proposals into
  analysis phases.
- **No code edits between phases 1 and 7.**
- **Every confirmed human comment goes through the phase-5a sweep.**
  Single-site fixes are a bug.
- **Every confirmed human comment produces a bake-in rule in phase
  5b**, even if the rule is "see existing rule X."
- **Phase 9 is a loop, not a walk.** Re-read, verify, loop back if
  not landed; don't mark Resolved on intention.
- **Resolution-timing tag is load-bearing.** A `post-and-stay-active-until-{unit}`
  thread closes only when the unit's commit lands and the follow-up
  reply names it. Resolving on the promissory "Addressing by doing X"
  reply lies about the state and breaks reviewer-side filtering.
- **Thread replies describe behavioral change, not commit SHA.** SHA
  optional if reviewer needs a specific hunk; usually not.
- **PERT framing** on the plan DAG when clusters branch. Trivially-
  linear chains are prose — don't force a DAG on 3 units.

## Run-file schema

A single markdown file at
`<iteration-dir>/feedback.md` structured so a new session reads the
top and immediately knows the next action:

```markdown
# Feedback state: <task> / <iteration-slug>

**Status**: phase N (<phase-name>) in progress
**Started**: <ISO-8601 UTC>
**Last updated**: <ISO-8601 UTC>
**Next action**: <one-line concrete next step>

## Phase completion
- [x] 1. Gather (completed <timestamp>)
- [x] 2. Auto-resolve (completed <timestamp>)
- [ ] 3. Shape conversation (in progress since <timestamp>)
- [ ] 4. Walk-through
- [ ] 5. Synthesize
- [ ] 6a. Plan
- [ ] 6b. Execute setup + drift re-fetch
- [ ] 7. Execute
- [ ] 8. Pipeline-verify
- [ ] 9. Per-thread verify+close

## Shape view (phase 3)
... themes, dependency graph, critical path, cut points,
    cross-cutting principles, open questions ...

## Threads — human-authored
| id | author | bucket | file:line | summary | shape-cluster | confirmed? | action | sweep sites | bake-in | verify |

`action` column values: `post-and-resolve` | `post-and-stay-active-until-{unit}` | `post-and-leave-open`. Drives Phase 9's resolve-vs-leave-active discriminator.

## Threads — auto
| id | author | disposition |

## Sweep results (phase 5a)
| pattern | sites |

## Bake-in rules (phase 5b → friction)
| rule | friction file |

## Phase 8 — pipeline iteration log
| # | push SHA | pipeline(s) | status | failure mode | diagnosis | remedy | outcome |
```

**Per-push log:** the phase-8 table has one row per push to the PR
branch during execution. No upper bound on row count.

Update discipline — commit + push to `$DESK/` after every
edit to the run file. The iteration directory is the single source of
truth; if the agent dies mid-iteration, the next session reconstructs
from this file alone.

## Error modes

| Condition | Action |
|---|---|
| Operator redirects during walk-through | Update `proposed_action`, keep going |
| Two human comments conflict | Surface, block, wait for resolution before phase 5 |
| Volume > 20 human comments | Break walk-through into batches of ~10 |
| Thread is a clarification question | Reply first, mark `pending-clarification`; don't mark confirmed until operator answers |
| Comment in a file the PR only touches adjacently | Confirm with operator whether it's in-scope; if not, resolve with "pre-existing, follow-up tracked in `<tracker-id>`" |
| Architecture change would require reverting a unit the PR already built | Surface the cost tradeoff BEFORE planning; operator may accept or request compromise |
| Phase 9 verify fails for a thread | Loop back to phase 6a (update plan) or phase 7 (add units). Don't mark Resolved-with-caveats. |
| Harness / environment blocker (permission denial, unreachable service) | Return control to operator per `../../principles.md` Invariant 1 — that's a real decision point. |

---

## Revisions

Append dated revisions here as the skill evolves during or after a
live run. Format: `### YYYY-MM-DD — <short title>`. Preserve "why we
changed" with explicit dated entries rather than rewriting phase
bodies in place.

### 2026-04-21 — open layout questions, deferred

Three scaling edge cases flagged during first-run discussion, not yet
designed; deferring until first occurrence rather than speculative
design:
- Pre-code iterations (task has no repo yet).
- Cross-repo atomic iteration (must land in multiple repos
  simultaneously).
- Task-level non-iteration notes (incident reports, ad-hoc analytics findings).

### 2026-04-21 — process clarifications from first-run (commit+push cadence; doing.md live; drift re-fetch; phase-9 loop; phase-8 no-cap)

Clarifications surfaced during the first live run (review-pass-1 on
the pilot PR). None contradict the phase bodies above; they sharpen
specific invariants.

**Commit+push cadence — atomic, everywhere, every file edit.**
- `$DESK/` edits: commit + push per edit. Never batch.
- Code repo edits during phase 7: every unit's test / impl / verify
  commit gets pushed immediately. No single end-of-phase push.
- **doing.md kept live** during phase 7: every unit completion
  triggers a `docs(doing): complete Unit X` commit + push. Unit
  status flip `⬜ → ✅`, progress-log entry with git timestamp,
  Completion Criteria checkbox sync.
- **planning.md kept live** too: at phase 7 exit,
  `Completion Criteria` checkboxes synced `[x]` based on landed
  evidence.

**Drift re-fetch gates — phase 9 is not the only place we re-check.**
- End of phase 6b (before starting phase 7): re-pull active threads
  via the PR host's threads API. Diff against `feedback.md`'s thread
  list. New human threads get bucketed + assigned to units BEFORE
  execution starts.
- Start of phase 9: re-pull once more. Threads posted during
  execution are handled before closing the iteration.
- Between units is NOT a re-pull point — noise.

**Phase 9 verify is a hard loop over landed code, not intention.**
- For each non-auto thread: re-read reviewer body + `proposed_action`
  + assigned unit(s) + actual landed diff on the PR.
- Landed code must satisfy the ask. Not "intended to"; landed.
- If no → loop back to phase 6 or 7. Never Resolved on intention.
- If yes → behavioral reply per `reply_format` + Resolved.
- Phase 9 exit = zero unresolved non-auto threads.
- Reviewer-closed threads during the run: skip (withdrawn input).
- Operator-skip threads: mark `operator-skip` + reply pointing at the
  offline decision.

**Phase 8 — no iteration cap, mandatory per-iteration failure log.**
- This is a big repo. 10+ pipeline iterations to green is not unheard
  of (first-run precedent: 6 iterations on initial-impl just to clear
  stale-main + flakes).
- **DO NOT hard-cap** pipeline iterations. Do NOT return control for a
  cap hit. Return control ONLY for blockers that genuinely require
  operator input.
- **Every pipeline run (success or failure) logs** to the iteration's
  `feedback.md` under `## Phase 8 — pipeline iteration log` as one row
  in a running table (schema above).
- If a flake fingerprint is new (not matching past), log with enough
  detail that it becomes a searchable fingerprint for future
  iterations.

### 2026-04-21 — three-doc layered design record formalized (feedback.md / planning.md / doing.md)

Pattern piloted during the first review-pass-1. Re-evaluate at
archive time (what worked, what didn't, what to adjust before second
use).

The three-doc structure, cross-doc reference convention, and exit-
sync discipline are documented in the "Three-doc layered design"
section at the top of this skill.

**Validation TODO** (revisit at archive time):
- Did the reference pattern scale for doing.md? Or did per-unit
  pointers at feedback.md get cumbersome?
- Did operator find planning.md's scope/completion-criteria contract
  auditable in isolation, or did they keep needing to jump into
  feedback.md?
- Did phase 7 execution ever hit a case where a doing-doc unit needed
  a design decision that wasn't already locked in feedback.md? If so,
  the walk-through phase(s) missed something — which?
- Did syncing planning.md Completion Criteria at phase 7 exit feel
  mechanical (good: predictable execution) or error-prone (bad: needs
  tooling)?
