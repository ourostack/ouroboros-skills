---
name: pr-self-review
description: |
  Final pre-open fresh-eyes pass on a PR after operator-worker
  collab review cycles. Invoke ONLY when the operator explicitly
  signals "ready" for a self-review convergence pass — phrased as
  "run self-review", "polish this PR", "ready to share", "final
  gate", "pr-self-review". Worker runs a thorough evaluation against
  the diff, fact-checks findings, classifies each finding as
  `auto` (agent can fix mechanically) or `human` (requires operator
  judgment), and enters a convergence loop that auto-addresses
  `auto` findings via `pr-feedback-on-own-pr`'s auto-apply path, re-reviewing
  after each pass until no more auto-addressable findings remain.

  Do NOT invoke: during initial implementation (work-doer's job),
  during manual human-agent review cycles (that's step 3 of the
  broader lifecycle — the collab that gives self-review its
  direction), or as a substitute for real reviewer sign-off. This
  skill is a final polish pass, not a replacement for humans.
---

# pr-self-review

## Invariants

These seven properties define what pr-self-review IS and IS NOT. They
are not preferences. Any change that violates one of these is a
redesign, not a tweak.

1. **Workflow owned, content borrowed.** Worker owns the pipeline —
   preflight, evaluate, fact-check, report, and the convergence loop
   around them. Worker does NOT author rule content. Rules come from
   the repo's own `AGENTS.md` / `CLAUDE.md`, from
   `repo-knowledge/<repo>/code-standards.md`, from
   `.vscode/copilot/personas/*.instructions.md`, or from worker's
   minimal language-agnostic baseline. The skill is a harness for
   whichever rule set the repo provides.

2. **Best model throughout.** No multi-model cost optimization. A
   cheap stage contaminates every downstream stage that depends on
   it — a noisy summarizer produces noisy classification, a sloppy
   evaluator produces noisy fact-check, etc. Operator runs this a
   few times per week, not thousands per day. Use the best available
   model for every stage.

3. **Thoroughness over speed.** pr-self-review has no latency budget.
   A massive PR can take multiple days to review exhaustively, and
   that is correct behavior. Anything that trades thoroughness for
   speed (sampling the diff, skipping fact-check, fast-pathing small
   PRs) is a regression. The operator invoked this because they
   wanted the thorough pass.

4. **Findings are findings regardless of source.** The output format
   is `feedback.md`-compatible. `pr-feedback-on-own-pr`'s walk-through flow
   consumes pr-self-review findings the same way it consumes ADO
   reviewer threads. A finding from the self-review evaluator and a
   comment from an external human reviewer are the same kind of
   thing once they land in the queue. No source-specific branching
   downstream.

5. **Rule-IDs are stable.** Every finding cites a rule-ID of the form
   `<PREFIX>-NNN`. Prefixes are namespaced by origin (`TG-STD-` for
   Teams-Graph code-standards, `PSH-` for pr-surface-hygiene, `PSR-`
   for pr-self-review's own baseline rules). Once a rule-ID is
   assigned, it does not get renumbered. This is the prerequisite
   for future per-rule effectiveness tracking and for stable cross-
   references from findings back to the rule that produced them.

6. **Overall PR lifecycle not encoded; within-invocation convergence
   IS encoded.** How worker composes `work-ideator`, `work-planner`,
   `work-doer`, and `work-merger` across a task is flexible — the
   operator decides when pr-self-review runs vs. doesn't, first-open
   vs. re-review, one pass vs. many. This skill does NOT dictate
   those lifecycle decisions. BUT once the operator signals "ready"
   and the skill is invoked, the within-invocation behavior *is*
   encoded: run the pass, auto-address what can be auto-addressed
   via `pr-feedback-on-own-pr`'s auto-apply path, re-review, loop until stable
   or only human-judgment items remain. See the convergence-loop
   section for the full spec.

7. **Collab before convergence.** Do not invoke pr-self-review before
   the operator-worker collab of step 3 in the broader PR lifecycle
   has happened. Front-loading produces findings with no direction
   or context; back-loading produces polish built on the collab's
   accumulated understanding. If the skill is invoked before collab,
   stop and surface that to the operator rather than proceeding.

## Phase 1 — Preflight

Phase 1 produces the **context bundle** that the evaluator reads in
Phase 2. Nothing is evaluated here; the goal is to assemble every
input the evaluator will need, in a stable structure, so the
evaluator can focus on finding issues rather than scrounging for
source material.

### Diff resolution

Resolve the diff against the task's base branch:

```
git diff origin/main...HEAD
```

Use the three-dot form so the diff is scoped to what this branch
adds on top of main, not to unrelated changes that have landed on
main since the branch was cut.

If the task spans multiple repos, Phase 1 runs once per repo clone.
Each invocation produces its own context bundle and its own findings
file. There is no cross-repo merging — rule sources are inherently
repo-specific and cross-references across repos create more
confusion than signal.

### Annotated diff (line-numbered)

Produce an annotated view of the diff where each line the evaluator
may cite has its file-relative line number visible. This pattern is
adopted from Daniel Sada's v3 `/review-pr` implementation in
`teams-modular-packages` — the evaluator's findings are much easier
to ground-truth in Phase 3 when the line numbers in the finding map
cleanly back to the diff the evaluator actually read.

The annotated diff is derivable mechanically from `git diff` output
plus `git blame` or `git show` for the pre-image line numbers;
keep this side of the pipeline boring and deterministic.

### Rule-source discovery (preference order)

Worker does not author rule content. It discovers and loads rules
from whichever sources the repo provides, in this preference order:

1. **`AGENTS.md` or `CLAUDE.md` at repo root.** The repo's own
   written rules are the highest-priority source. Both filenames are
   checked so repos that haven't migrated to the `AGENTS.md`
   convention yet still participate.
2. **`plugins/worker/repo-knowledge/<repo>/code-standards.md`.**
   Worker's own accumulated knowledge about a specific repo, used
   when the repo itself doesn't carry in-tree rules but worker has
   built up standards from operator-worker collab in prior tasks.
3. **`.vscode/copilot/personas/*.instructions.md`.** WAVE-compatible
   persona files — LLM-agnostic, portable, version-controlled. Worker
   can consume these the same as any other rule source.
4. **Worker's own baseline rubric.** Deliberately minimal and
   language-agnostic: null safety, error handling, test presence,
   unused imports, obvious typos. Used only when no other rule
   source applies. Details in Phase 2.

Higher-preference sources do not suppress lower-preference sources;
all available sources are merged into the context bundle. The
preference order exists to resolve conflicts (same rule, different
wording) and to make citation priorities deterministic.

### Plan-excerpt loading

From the task's planning doc, load ONLY:

- `## Scope`
- `## Completion Criteria`

Do not load the full planning doc. The evaluator is not doing
plan-coverage (that happens in step 3 of the broader lifecycle,
before self-review runs). Scope + Completion Criteria give the
evaluator just enough context to reason about "is this PR trying to
do what the plan says it's trying to do" without bloating the
evaluator's working set.

If the planning doc is absent (rare — usually means the task was
taken up without formal planning), Phase 1 proceeds without plan
excerpts. The evaluator still has the diff and the rule sources.

### Doing-doc excerpt loading

From the task's doing doc, load the unit list for **context only**.
The evaluator is not checking whether every unit was implemented
(again, that's step 3's job). The unit list helps the evaluator
understand the intended shape of the change. A finding like "this
file changed but no corresponding unit mentions it" is legitimate
context-aware feedback — that's what the doing-doc excerpts enable.

### Output: the context bundle

Phase 1's output is a structured context bundle the Phase 2
evaluator reads directly:

- `diff` — raw `git diff origin/main...HEAD`
- `annotated_diff` — line-numbered version of the diff
- `rules` — merged rule content from whatever sources resolved
- `rule_source_manifest` — list of which sources contributed (so
  findings can cite which file a rule came from, and so the
  rubric-map claim "rule IDs are stable" has something concrete to
  point at)
- `plan_excerpt` — Scope + Completion Criteria (or `null` if absent)
- `doing_excerpt` — unit list (or `null` if absent)
- `repo_root` — absolute path to the repo clone being reviewed
- `deferred_items` — accumulated list of findings the operator has
  accepted / deferred within this task's convergence loop. Empty on
  iteration 1. Populated by appending entries each time a finding
  is classified `human` and decided "accept / defer / leave-as-is"
  during a convergence-loop iteration. Each entry is a short
  description + the location of the inline rationale pin so the
  reviewer can find the decision in context. See the known-deferred
  list subsection of the convergence loop for the accumulation
  protocol.

This bundle is the only thing Phase 2 reads. All other repo access
in Phase 2 goes through re-reading cited files during evaluation;
the bundle itself is the frozen input.

## Phase 2 — Evaluate

Phase 2 is a **single unified evaluator pass** over the context
bundle from Phase 1. Its output is a list of raw findings that
Phase 3 will then fact-check.

### Why unified, not multi-track

Daniel Sada's v3 implementation splits evaluation into two tracks:
typed rules (executed by a rule compiler) and experts (scoped
personas that each evaluate a slice of the diff). That design makes
sense at Teams' scale — thousands of PRs per day, fine-grained
cost control needed. Worker's scale is low-volume and high-care
per invocation; the expert/rules split collapses cleanly into one
evaluator pass over the merged rule set. The "expert roles" were
always rules in costumes; we just ask for the findings directly.

A single pass also simplifies fact-checking in Phase 3 (one list of
findings, not N lists to reconcile) and keeps the skill small enough
that an operator can read it end-to-end.

### Input

The context bundle from Phase 1. Nothing else. The evaluator may
re-read cited files in the repo during evaluation (to see more of
a function than the diff hunk shows, for example), but the diff,
annotated diff, rules, and plan/doing excerpts are the starting
point.

### Model policy

**Best available model throughout, no multi-model routing.** The
evaluator stage determines the quality of every downstream stage.
A sloppier evaluator produces noisier findings, which contaminates
Phase 3 fact-check (spending work dismissing hallucinations) and
Phase 4 report (operator-facing output gets worse), and which
degrades the convergence loop (auto-apply fixes for findings that
shouldn't have existed). Spending on the evaluator is a force-
multiplier; saving on it costs more downstream.

Worker's invocation cadence (a few times per week per operator) is
not the regime where haiku/sonnet routing pays for itself.

### Latency bound

**None.** There is no bound on Phase 2 runtime. Thorough beats
fast. A large PR can legitimately take multiple days to evaluate
exhaustively; that is correct behavior.
If a latency constraint ever feels necessary, the right move is to
narrow the scope of the invocation (one file, one subsystem) rather
than to cut corners in the evaluator.

### Output: raw findings

Each raw finding has the following fields:

- `rule_id` — stable ID of the rule that produced the finding,
  namespaced (`TG-STD-007`, `PSH-001`, `PSR-001`, etc.).
- `severity` — one of `blocking`, `recommended`, `nit`. Follows
  the HEXA severity classification the field has converged on.
- `resolution_path` — initially left `null`; Phase 4 sets this to
  `auto` or `human`.
- `file` — repo-relative path of the file the finding is about.
- `line` — file-relative line number (from the annotated diff).
- `title` — short one-line summary.
- `body` — longer explanation of the issue and why the rule
  applies here.
- `suggested_fix` — optional. When the fix is mechanical enough to
  spell out, the evaluator spells it out. Otherwise left empty.
- `grounding_verified` — initially `false`; Phase 3 sets this to
  `true` for findings that survive grounding check, and drops the
  rest.

Raw findings go into a structured list that Phase 3 consumes
directly. Nothing is written to the operator-facing report until
Phase 4.

### Sub-threshold signals in evaluator reasoning

Evaluators (and any sub-agent reviewer whose output this skill
consumes in the convergence loop) sometimes surface a finding they
considered raising and decided against — typically because their
internal confidence for the finding was below some threshold, or
because they read the code as intentional and chose not to flag.
Read the evaluator's reasoning, not just its final findings list.
When the reasoning mentions "I considered flagging X but didn't":

1. Treat X as a **candidate finding** for triage, not as the
   evaluator's "pass."
2. Evaluate on its own merits whether a teammate agent or human
   reviewer — reading the PR cold without worker's session context —
   would plausibly flag it. Bias toward "yes"; cold reviewers do not
   share worker's local confidence context.
3. If addressable cheaply (mechanical fix, small-scope test, inline
   rationale pin per the Phase 4 `human` path), close it in this
   iteration. If not, add it to the operator-facing report with a
   note that it was sub-threshold internally but plausibly
   teammate-visible.

Only items that are genuinely hypothetical — no credible scenario a
cold reviewer could construct — are safely ignorable. The cost of
addressing a sub-threshold finding is typically one small fix or one
pin; the cost of NOT addressing it is a teammate reviewer flagging
it later and the loop re-opening. The first cost is cheaper.

### Baseline rubric (language-agnostic only)

When no other rule source applies — no `AGENTS.md`, no
`repo-knowledge`, no personas — the evaluator falls back to
worker's built-in baseline. The baseline is deliberately minimal
and **language-agnostic only**:

- Null safety (null/undefined checks on inputs where the code clearly
  expects a value)
- Error handling (exceptions/errors are caught or propagated
  deliberately, not silently swallowed)
- Test presence (new public functions have at least one test)
- Unused imports (dead imports removed)
- Obvious typos (in identifiers, comments, strings)

That's it. The baseline deliberately does NOT opine on naming
conventions, doc-comment discipline, module layout, formatting, or
any language-specific idiom. Those are repo conventions and belong
in `AGENTS.md` or `repo-knowledge`, not in a general-purpose
worker baseline. The baseline's only job is to produce SOMETHING
useful when no other rule source is available; it does not try to
be a complete ruleset.

Rules in the baseline use the `PSR-` prefix (`PSR-001` through
`PSR-005` for the five rules above).

### Naming-convention checks (language-specific)

Method names carry contracts. When a name implies a behavior the
implementation does not honor, callers (and reviewers) get
surprised — and the evaluator should flag the mismatch even when
each side, read in isolation, is fine.

**TryX naming-vs-behavior mismatch (C#).** The C# `Try*` convention
is "no exceptions on documented failure modes" — `TryParse` returns
`bool`; `TryGetValue` returns `bool` + out-param. A method named
`Try*` with a `throw` on a non-cancellation path violates the
convention even when it ALSO returns `null` on the happy
not-found path; the hybrid shape is misleading because the prefix
promises "won't throw on documented failure" but the body does.

- Detection: grep the diff (and adjacent file regions where the
  diff makes the method visible) for a `Try` prefix on method
  names; trace `throw` statements through the body. Cancellation
  paths (`OperationCanceledException`, `TaskCanceledException`)
  are exempt; any other `throw` on a `Try*` method is a flag.
- Severity: recommended.
- Applies regardless of whether the diff *introduced* the method.
  Old `Try*` methods with throws that the diff makes visible are
  equally misleading; flag them when a reviewer can see them.

**Sibling check — `Get*` / `Find*` / `Parse*` returning `null` on
not-found.** The inverse of the Try case: prefixes that imply
"return the thing or throw" instead silently return `null`,
surprising callers who expected an exception. Same severity, same
detection shape — grep for the prefix, trace returns, flag silent
nulls.

**Acceptable shape when verification isn't possible.** If the
method body is large or split across files such that throw-tracing
is uncertain, soften to a question rather than a directive: "is
this a Try-pattern violation?" beats "rename this method." The
question-form output goes into `suggested_fix` per the comment-tone
rule below.

### Cross-method side-effect audit

Reviewing a method's side-effecting block (catch handler, logging
path, telemetry emission) **in isolation** misses redundancies that
only become visible when the helpers it calls are read too. The
canonical case: a catch block calls `LogException(ex, ...)` then
calls a response-builder helper that ALSO calls `LogException(ex,
...)` internally — same exception, two log lines.

- Rule: when a method has a side-effecting block (catch, log,
  telemetry, audit-write) and immediately calls a helper that takes
  the same exception/argument, audit the helper for redundant side
  effects. Walk INTO the helper; do not read the call site alone.
- Detection pattern: any code path that calls
  `LogException(ex, ...)` (or a metric/audit/telemetry equivalent)
  immediately followed by another helper that takes the same `ex`
  is a candidate for double-log / double-emit.
- **Cheap heuristic** (the actionable bit): when a finding-candidate
  exists at line N, also read the bodies of any helper methods
  called from line N±5. Helpers are short and quick to scan; the
  reward is double-side-effect catches that are invisible from the
  call site alone.
- Generalizes beyond logging. The same shape applies to metric
  increments, audit-trail writes, telemetry events, store writes —
  any side-effecting helper called from a context that already
  side-effects is a redundancy candidate.
- Acceptable shape when verification isn't possible: if the
  helper's source isn't on disk (generated file, separate package
  not in the working tree), soften to a question — "does
  `<helper>` also log/emit `ex` internally?" — rather than claiming
  the double-log as fact.

### Author comments are hypotheses, not oracles

`// intentional`, `// by design`, `// parallel to X`, `// we want
X because Y` comments are author **hypotheses** to TEST, not
oracles to trust. Re-evaluate the code on its own merits and
either confirm the comment's reasoning or flag the disagreement.

- **The actionable test**: for any code carrying a "deliberate"
  comment, ask: **"if this comment WEREN'T here, would I flag this
  code?"** If yes, flag it anyway, with the comment's rationale
  folded into the finding's body so the operator sees both sides
  and can decide which framing wins.
- Cross-check the comment against the code it describes. If the
  comment says "parallel to the GET handler," READ the GET handler
  too. If the same questionable pattern lives there, that DOUBLES
  the signal that something is off; it does not halve it.
- Strongest signal a comment is wrong: a fresh reviewer reading
  the PR cold without the comment's framing would still flag the
  code. A comment that's NEEDED to defend a choice is evidence
  the choice is questionable to a fresh reader.
- Detection: grep the diff (and adjacent code regions) for the
  deliberate-comment phrasings above. For each match, run the
  "comment WEREN'T here" test.
- Output shape: when this rule fires, the finding `body` MUST
  include both (a) the substantive concern about the code and (b)
  the comment's stated rationale folded in, so the operator can
  evaluate the disagreement directly rather than re-discovering
  the author's framing.

### Comment tone in `suggested_fix` and in inline rationale pins

When the evaluator populates `suggested_fix` with a clarifying
comment (rather than a code change), and when Phase 4 later
recommends an inline rationale pin for a `human`-classified finding
that the operator decides to accept / defer, the comment MUST read
as rationale a future maintainer can use — not as a rebuttal to a
reviewer.

Bad (lecturing / defensive):

- "Do NOT flag this as [concern]."
- "Reviewers have suggested X; we're intentionally not doing X."
- "Stop proposing changes to this."
- "Do not re-raise this in review."

Good (rationale-first):

- "[Property/block] is [shape] because [concrete reason about this
  code's context / consumers / contract]."
- "Chose [A] over [B] because [specific tradeoff]."
- (Just explain why it's the right choice; a reader concluding
  "this is considered" is the desired effect, not the stated goal.)

The test: a fresh reviewer reading the comment cold should be able
to see "this is a considered decision" from the rationale itself,
without the comment having to tell them so. If the comment sounds
like the code is arguing with future readers, it is wrong — the
rationale should stand on its own. This constrains both
`suggested_fix` output here in Phase 2 and the inline-pin
recommendations in Phase 4's `human` path.

## Phase 3 — Fact-check

Phase 3 is **grounding verification** for every raw finding out of
Phase 2. It is adopted directly from Daniel Sada's v3 `/review-pr`
implementation in `teams-modular-packages` (his Phase 5c), and
credit is due to that design: fact-check is cheap for an agent to
do and catches a large fraction of hallucinated findings before
they reach the operator.

### The mechanism

For each raw finding, re-open the cited file at the cited line, in
the working tree, and confirm:

- The file exists and the line number is valid.
- The code at that line matches (or is consistent with) what the
  finding describes.
- The finding describes something that is actually wrong or
  worth mentioning — not a misunderstanding of the code's intent,
  not a rule that doesn't apply in this context, not a phantom bug
  that isn't there.

Findings that survive this check have `grounding_verified: true`
set. Findings that fail are **dismissed silently** — they never
reach the operator-facing report and they never become auto-applied
fixes. A dismissed finding costs nothing; a propagated hallucination
costs operator trust.

### Batching

Fact-check per finding is independent. Small batches are fine for
throughput (re-reading the same file once for three findings in
that file is cheaper than re-reading it three times), but each
finding is verified **independently** — one finding's failure does
not dismiss another finding in the same batch, and the verification
reasoning for finding A is not applied to finding B just because
they touched the same file.

The model policy here is the same as Phase 2: best available model.
A sloppy fact-check either passes hallucinations through (bad) or
over-dismisses real findings (also bad); the quality of fact-check
directly determines what shows up in Phase 4's report.

### Output

`verified_findings` — the subset of raw findings where
`grounding_verified` is now `true`. Phase 4 consumes this list;
Phase 2's raw findings are no longer referenced after Phase 3
completes.

Fact-check is the skill's primary defense against the most common
failure mode of LLM-based reviewers: plausible-sounding findings
about code that doesn't exist or doesn't behave the way the
reviewer assumed. The v3 team demonstrated this phase catches
enough of those to justify its cost; worker adopts it for the same
reason.

## Phase 4 — Report

Phase 4 takes the `verified_findings` list out of Phase 3,
classifies each finding by resolution path, emits the artifacts,
and hands off to the convergence loop.

### Classification rules: `auto` vs `human`

Worker marks a finding `resolution_path: auto` only when ALL of
the following hold:

- **Deterministic fix shape.** The rule has a known transformation
  pattern — add a null check, remove an unused import, rename to
  match a convention, add a missing test stub. The fix is not a
  design decision.
- **Scoped.** The change stays within the boundary of the flagged
  code. It does not ripple across unrelated files, does not change
  public API shape, does not alter contracts other code depends on.
- **Reversible.** The change is small enough to revert cleanly in a
  single commit if it turns out to be wrong.
- **No operator-context load-bearing.** The fix would be correct
  regardless of business judgment, architectural preference, or
  operator-specific context. No "it depends on what you meant here"
  conditions.

If any of the four fails, the finding is `resolution_path: human`.

**Default when uncertain: `human`.** This is intentional asymmetry.
A false-positive `auto` means worker edits code the operator didn't
want; that costs operator trust, may introduce bugs, and always
requires cleanup. A false-positive `human` just means an extra
item in the operator-facing report that the operator quickly marks
"nothing to do here." The second failure mode is much cheaper, so
the default falls there.

### Classification examples

Concrete cases, calibrated against the four-criteria rule above:

| Finding | auto | human |
|---|---|---|
| Missing null check on input param | ✓ | |
| Unused import | ✓ | |
| Forgotten test for new public method | ✓ | |
| Off-by-one in loop bound | ✓ | |
| Convention-drift rename (style rule) | ✓ | |
| JSDoc redundant to `[JsonProperty]` | ✓ | |
| "This class is 400 lines, consider splitting" | | ✓ |
| "Retry should be exponential, not linear" | | ✓ |
| "This API shape won't compose with X" | | ✓ |
| "Missing telemetry for this flow" | | ✓ |
| "Consider a different approach" | | ✓ |

The `human` rows each fail at least one of the four criteria:
splitting a class isn't scoped, retry-strategy choice is operator-
context load-bearing, API-shape composability is a design decision,
telemetry gaps require knowing which flows matter, "consider a
different approach" is explicitly a design conversation.

### Test-style findings are agent-owned

The operator delegates test-shape decisions to the agent. When a
Phase 2 finding is about test STYLE, classify
`resolution_path: auto` by default — not `human`. This overrides
the default-when-uncertain asymmetry for the test-style bucket
specifically.

Applies to (non-exhaustive):

- Framework choice within what the project already uses (xUnit vs
  MSTest — follow the existing project).
- Assertion style (`FluentAssertions` vs raw `Assert.*`).
- Arrange-Act-Assert block labeling.
- `[Fact]` vs `[Theory]`.
- Mock library (`Moq` vs `NSubstitute`).
- Fixture / `IClassFixture` usage.
- Test naming convention.
- Helper extraction / consolidation within the test project.
- Whether to convert an entire file vs. partial.

Does NOT apply — these stay `human`:

- Adding or removing tests that exercise **real production
  invariants** (correctness call, not style).
- Changing tests to match a **contract change** in production code
  (downstream of a design decision, not a style tweak).
- Test-style changes whose scope spans **many files** (the scope
  criterion of the four-criteria rule still bites — sweeping a
  whole project's assertion style is a scope decision even if the
  individual edits are mechanical).
- Any change that would **move coverage below** the project's
  threshold.

The operator's gate on test-style is coverage. If a test-style
change could move coverage (adding/removing tests that exercise real
code, refactoring test structure in ways that change what's
asserted), the agent runs the project's coverage gate before and
after and confirms the result stays above the project threshold
BEFORE classifying `auto`. The four-criteria rule's "reversible"
and "no operator-context load-bearing" still apply — if the
test-style call is genuinely contested within the repo (two active
conventions coexist), classify `human` and let the operator pick.

### `human` path — pin-and-move vs pin-gap

Canonical rule for default no-op pinning (placement, tone, and exceptions): see `../pr-feedback-on-own-pr/SKILL.md` Phase 7 — "Pinning no-op decisions in code." Convergence-loop sub-agents inherit the same default for any `human`-classified finding the operator decides "accept / defer / leave-as-is."

Inline-pin and reply-comment authoring follow operator-voice-comments rules: see [`../operator-voice-comments/SKILL.md`](../operator-voice-comments/SKILL.md). Apply both when generating findings' `suggested_fix` and when authoring inline rationale pins.

When a finding is classified `resolution_path: human` and the
operator decides "accept / defer / leave-as-is" during the
convergence loop, the agent's next action is to add an inline
rationale pin at the finding's cited location — or to strengthen an
existing pin that is insufficient for a fresh reviewer.

This is load-bearing. A teammate's agent reviewing the PR reads it
cold, with zero session context and no access to the
`deferred_items` list that keeps worker's own convergence-loop
reviewer quiet. The inline pin is the ONLY mechanism that serves
both audiences — worker's own next iteration and any future
reviewer (human or teammate agent) who reads the PR independently.
Operator's gate, restated: by the time humans read a PR, the only
value left should be human judgment.

Every inline pin MUST satisfy all five of the following:

- [ ] **Explains why** the code is this shape. Not "we decided not to
      change this" — the rationale itself.
- [ ] **Self-contained.** Does not depend on the reader having read
      another file, a commit message, or session context.
- [ ] **Rationale-first tone**, per the Phase 2 comment-tone rule.
      No "do NOT flag this" phrasing; the rationale itself does the
      work.
- [ ] **Located at the flag site** — the code location a reviewer
      would otherwise flag — not several scroll-pages away.
- [ ] **Cross-file rule.** If the finding is cross-file (test-style
      mix, repo-level convention, pattern used at multiple sites),
      EITHER replicate the pin at each affected site OR add a single
      module/project-level note AND a short reference-pin at each
      site pointing at the central note. A reviewer reading any one
      site must see the pointer.

Before a `human`-classified finding is considered closed for the
iteration, the agent re-reads the pin as if seeing the code for the
first time. If reading cold would still flag the finding after the
pin, the pin is insufficient — strengthen or relocate. Only after
the pin passes this self-review is the finding eligible to appear in
the iteration's `deferred_items` list (the tactical optimization for
worker's own next-iteration reviewer; see the convergence-loop
section).

### Output shape (feedback.md-compatible)

Each finding is emitted in a shape that `pr-feedback-on-own-pr` can consume
as a synthetic thread. YAML:

```yaml
- thread_id: self-review-001      # generated; distinguishes from ADO thread IDs
  source: pr-self-review
  iteration: 1                    # which pass of the convergence loop
  rule_id: TG-STD-007
  file: packages/foo/src/bar.ts
  line: 142
  severity: blocking | recommended | nit
  resolution_path: auto | human
  title: "short title"
  body: |
    longer explanation...
  suggested_fix: |
    optional code suggestion
  grounding_verified: true
```

The `source: pr-self-review` marker lets `pr-feedback-on-own-pr` distinguish
self-review synthetic threads from real ADO threads when both are
present, without changing downstream handling — both just flow into
the same walk-through.

### Artifacts

Phase 4 writes two files to the iteration's artifacts directory in
worker-workspace (same location as the planning and doing docs):

- `artifacts/pr-self-review.md` — human-readable report. Grouped by
  file, ordered by severity within file, with suggested fixes
  inlined. This is what the operator reads.
- `artifacts/pr-self-review-findings.json` — machine-readable list
  in the YAML shape above (as JSON). This is what `pr-feedback-on-own-pr`
  reads when it ingests self-review findings in its Phase 1 gather.

Both files are rewritten on each iteration of the convergence loop,
with the `iteration` field updated and only findings from the most
recent pass present. Historical iteration state, if needed for
debugging, can be recovered from the git history of the
worker-workspace iteration folder.

### Hand-off to the convergence loop

Once the artifacts are written, Phase 4 is done. Control passes to
the convergence loop (next section), which decides whether to
invoke `pr-feedback-on-own-pr` in auto-apply-only mode, re-run Phases 1–4,
or exit.

## Auto-address convergence loop

The convergence loop is the defining behavior of this skill and the
reason it's a distinct skill rather than just a reviewer prompt.
When the operator signals "ready," worker runs the full pass,
addresses everything it can mechanically via `pr-feedback-on-own-pr`'s
auto-apply path, re-runs the pass, loops. The loop exits when the
pass surfaces nothing new, when only human-judgment items remain,
or when one of the safeguards trips.

### The loop

```
operator says "ready"
  ↓
┌─ ITERATION N ───────────────────────────────────────────────┐
│                                                              │
│  pr-self-review Phases 1–4 produce findings.json            │
│    ↓                                                         │
│  Any findings with resolution_path: auto?                   │
│    ├─ No  → skip auto-apply                                 │
│    └─ Yes → invoke pr-feedback-on-own-pr on those findings  │
│              (pr-feedback-on-own-pr's existing auto-apply    │
│              path for non-architectural items;               │
│              each fix is a worker code edit + test           │
│              via standard flow) → commit fixes               │
│    ↓                                                         │
│  Did auto-apply change any code?                            │
│    ├─ No  → EXIT (no progress possible by agent)            │
│    └─ Yes → loop to next iteration                          │
└─────────────────────────────────────────────────────────────┘
  ↓
Final state:
  - clean (no findings surfaced) OR
  - only human-judgment items remain OR
  - safeguard tripped (see below)
  ↓
Report to operator: what auto-applied, what remains
```

### Iteration semantics

Each pass of the loop is a full re-execution of Phases 1–4:

- **Phase 1 re-runs** because the diff has changed — auto-applied
  fixes from the previous iteration are now part of the branch, so
  the diff, annotated diff, and any file-state inputs are different
  from last time. The rule sources and plan/doing excerpts are
  re-read for the same reason (the diff context changed what's
  relevant).
- **Phase 2 re-runs** on the new context bundle. Findings resolved
  in the previous iteration should no longer appear; new findings
  that a previous fix revealed (fixing A surfaces B) can appear.
- **Phase 3 re-runs** on the new raw findings. Grounding is re-
  verified against the current working-tree state, not against
  state from the previous iteration.
- **Phase 4 re-runs** and rewrites both artifacts with
  `iteration: N+1` on every finding. Only findings from the most
  recent pass are present in the artifacts; previous iterations live
  in the git history of worker-workspace.

The `iteration` field on each finding is the counter that
distinguishes one pass from another. Iteration 1 is the first pass
after the operator's "ready" signal.

### Pipelined execution — interleave the next reviewer with the current fix round

Iterations are pipelined, not strictly serial. After iteration N's
commit + push, spawn iteration N+1's reviewer **in the background
immediately** — do not wait for the next fix round to finish before
spawning.

Why this works:

- The reviewer reads the just-pushed HEAD (committed state). It
  does not need iteration N+1's in-flight fixes — those aren't on
  the branch yet.
- Iteration N+1's fix application (reading N's findings, editing
  code, running local gates, committing, pushing) is CPU/IO work
  that overlaps cleanly with a background reviewer.
- The `deferred_items` list (see the subsection below) is stable
  across iterations — the reviewer doesn't depend on iteration
  N+1's fix decisions to know what's already decided. It reviews
  the current HEAD against the accumulated list.
- If iteration N introduced a bug, the interleaved reviewer sees
  it — that's the happy case, exactly what the reviewer is for.

Concrete flow:

```
iteration N:
  reviewer_N returns → agent applies fixes →
    local-verify gate (see cross-ref below) → commit → push →
  [spawn reviewer_{N+1} in background on the just-pushed HEAD]
  reviewer_{N+1} runs concurrently with iteration N+1's fix
    application; its findings are consumed when N+1 is ready
```

Iteration 1 is serial (no prior reviewer to wait for): spawn → wait
→ apply. From iteration 2 onward the pattern is pipelined.

Skip the background spawn on pure-docs iterations — no code or test
change means nothing new to review; wait one iteration.

Composes with the existing parallel-reviewer pattern: early
iterations may spawn several reviewers at once for high coverage
(code-quality, security, test-quality, etc.); as the loop converges,
drop to 1–2 reviewers per round since novel findings plateau. Each
round's reviewer(s) still interleave with the next round's fix
application.

### Known-deferred list — accumulated across iterations

The `deferred_items` list on Phase 1's context bundle is what keeps
the convergence loop from re-litigating already-decided items. The
list accumulates across iterations of the same invocation; each
entry is a short description + the location of the inline rationale
pin recommended by Phase 4's `human` path.

Accumulation protocol:

- Iteration 1: `deferred_items` is empty.
- After each iteration where a finding is classified
  `resolution_path: human` and the operator decides "accept / defer
  / leave-as-is," worker:
  1. Adds the inline rationale pin per Phase 4's pin-and-move
     subsection (and re-reads it cold to confirm sufficiency).
  2. Appends an entry to `deferred_items` with:
     - **What** the decision is (short phrase, one line).
     - **Where** the inline pin lives (file + the method / class /
       block the rationale annotates).
- The next iteration's context bundle carries the full accumulated
  list. Reviewer prompts assembled from the bundle include the list
  verbatim with a "known-deferred — do NOT re-flag these" header.

Shape of each entry (concrete enough to locate the pin, vague
enough that minor wording drift does not invalidate):

```
- `<class>.<method>` — <short description of the decision>
  (rationale in `<class>.<method>`'s <remarks> / inline at call
  site / etc.)
```

What a reviewer does with the list:

- Skips items in the list entirely; does not re-read or re-analyze
  them.
- Marks its report with "focus on fresh issues" at the top.
- When it finds a novel issue adjacent to a deferred one, says so
  explicitly ("unrelated to [deferred item]; new finding: X").

Caveat — the list is NOT a permanent gag order. If a later
iteration modifies the surrounding code of a deferred item, the
reviewer re-evaluates whether the deferral still applies in the
changed context. The header for the reviewer prompt should say:

> do NOT re-flag UNLESS the deferred item's context has materially
> changed in this iteration's diff.

This is rare but worth the carve-out — a surrounding-code refactor
can legitimately invalidate a prior deferral.

Mechanically, the list lives in the iteration's artifacts directory
alongside `findings.json` — e.g., `artifacts/deferred-items.md` —
and is rewritten on each iteration with the accumulated entries.
Git history of the worker-workspace iteration folder preserves per-
iteration snapshots for debugging.

Relationship to inline pins (Phase 4 `human` path): the pin is
load-bearing; the deferred-items list is a latency optimization on
top. Pins serve every audience (worker's next iteration, teammate
agents, humans) without needing session context. The list only
serves worker's own convergence loop — it saves the next reviewer
from re-reading the pin's file and re-concluding "oh, there's a
comment explaining this, skip." If a finding has a list entry but
no inline pin, the list entry is insufficient; fix the pin first.

### Local-verification cadence

Each iteration's fix round runs the repo's local-verification gate
before commit + push — compile, unit tests, formatter, whatever the
repo's pre-push expectation is. See `../git-hygiene/SKILL.md#pre-push-gate`
for the general pattern (and repo-specific notes in the matching
`repo-knowledge/<repo>/pipeline-notes.md`). The pipelined-execution
section above assumes this gate has already run — the background
reviewer reads the just-pushed HEAD, which should already be
locally-green.

### Composition with `pr-feedback-on-own-pr`

`pr-feedback-on-own-pr` already knows how to apply fixes against reviewer
feedback — that's its whole job. The convergence loop doesn't
reimplement fix application; it delegates. When iteration N's
Phase 4 produces findings with `resolution_path: auto`, worker
invokes `pr-feedback-on-own-pr` with a mode flag and the path to the
findings file:

- **Mode**: `auto-apply-only`. Skip the operator-confirm phases,
  skip any reply-to-ADO-thread behavior (those are for real
  reviewer threads), process only findings with
  `resolution_path: auto`. Return a summary: list of threads that
  were applied, list that were skipped, and whether any code
  changes occurred.
- **Input**: the `artifacts/pr-self-review-findings.json` produced
  by Phase 4. `pr-feedback-on-own-pr`'s Phase 1 gather (after the extension
  described in that skill) treats each finding as a synthetic
  thread alongside any real ADO threads in scope.

`pr-feedback-on-own-pr` handles the actual edits, test runs, and commits.
When it returns, the convergence loop checks whether any code
changed. If yes, loop. If no, exit — no further progress is
possible without operator involvement.

### Operator interrupt

The operator can halt the loop at any point with a natural-language
signal: "pause self-review", "stop the loop", "I've got this from
here". When worker receives an interrupt:

- Any in-progress iteration completes to a clean state (no
  half-applied fixes left in the working tree).
- The convergence loop exits immediately rather than starting the
  next iteration.
- Worker reports the current state: which iteration was running,
  what had been applied in that iteration so far, what findings
  remain in the most recent `findings.json`, whether any
  safeguards were close to tripping.

The interrupt is cooperative — worker respects it at the next
iteration boundary rather than killing mid-pass — to keep the
working tree in a sane state. In practice this is a sub-iteration
delay, not a long-lived one.

## PII safety (folded in from AIDLC, 2026-05-18)

Code review treats PII handling as a **BLOCKING** category — these findings halt the convergence loop and surface to operator before any further work.

**BLOCKING violations:**

- User OIDs (object identifiers) stored in entity tables or persistent storage
- Email addresses stored in entity tables or persistent storage
- User OIDs logged (any log emit that includes an unhashed user OID)
- User names logged (any log emit that includes an unhashed user name)
- Email addresses logged

**OK (not a finding):**

- Tenant IDs stored or logged (tenant scope, not user scope)
- System identifiers stored or logged (service IDs, machine IDs, etc.)
- Hashed identifiers (one-way hash applied before storage / log emit)
- Anonymized identifiers (mapped through an anonymization layer)

**Different-model deliberation (folded in from AIDLC):**

When sub-agent review is invoked to validate findings (Phase 6a), prefer a **different model** than the one that authored the code. Multi-model deliberation catches single-model blind spots; same-model review often misses what same-model authoring missed. Runtime may not always expose model-choice cleanly; the principle still informs orchestration discipline.

This pattern came from AIDLC's design-reviewer agent (architect produces design → design-reviewer at a different model validates → max 3 iterations → escalate if unresolved). The "different model" property is the load-bearing part.

## Safeguards

The convergence loop must not run forever, must not cause
regressions, and must not silently rewrite more of the codebase
than the operator expects. Five safeguards protect against those
failure modes. Any one of them tripping halts the loop and returns
control to the operator.

1. **Iteration cap.** Default: **10 passes per invocation**. Tunable
   via an argument on the skill call for operators who want to set
   a lower cap on smaller tasks or a higher cap on massive ones.
   The cap is a hard safety net — if the loop hasn't converged in
   10 passes, something is probably wrong that more passes won't
   fix, and an operator should look at the current findings.

2. **Non-progress detection.** If the same `rule_id + file + line`
   finding appears in two consecutive iterations, the loop flags
   the finding as stuck and exits. This is distinct from the
   "loop made no code changes" exit condition — a stuck finding
   means auto-apply *did* produce an edit, but the edit didn't
   resolve the finding (or reintroduced the same issue elsewhere
   on the same line). Legitimate multi-iteration progress looks
   like *different* findings appearing as earlier ones are fixed;
   stuck looks like the exact same finding surviving its own fix.

3. **Scope creep detection.** If successive iterations touch
   monotonically more files or more lines than iteration 1, the
   loop pauses and reports to the operator. The signal here is
   cascading auto-fixes: a fix in file A reveals a "problem" in
   file B, fixing B reveals a "problem" in C, and the branch
   grows in ways the operator didn't expect. Auto-fixes that
   cascade across the codebase need human eyes before they
   continue.

4. **Test regression detection.** If an auto-fix iteration results
   in any test failing that was passing before that iteration, the
   loop pauses immediately and requires operator resolution before
   continuing. `pr-feedback-on-own-pr` already runs tests as part of its
   standard fix-application flow; the safeguard here is that new
   failures coming out of the loop are treated as a hard stop
   rather than something to fix in a subsequent iteration. An
   auto-fix that breaks tests is probably not the right fix.

5. **Operator interrupt.** The operator can stop the loop at any
   time with a natural-language signal ("pause self-review", "I've
   got this from here"). Worker completes any in-progress iteration
   to a clean state and then exits. Detailed semantics are in the
   convergence-loop section above.

## Exit conditions

The convergence loop exits when ANY of the following become true.
This list is the complete set; there is no other path out of the
loop.

1. **No findings surfaced.** Phase 4's most recent run produced an
   empty `verified_findings` list. Clean result.
2. **All remaining findings are `resolution_path: human`.** There's
   nothing left for worker to do mechanically; the operator takes
   the findings report and decides what to do from there.
3. **An iteration auto-applied no code changes.** Phase 4 had `auto`
   findings, worker invoked `pr-feedback-on-own-pr` in auto-apply-only mode,
   and `pr-feedback-on-own-pr` returned without making any edits. No further
   progress is possible without operator intervention.
4. **Iteration cap reached.** Default 10 passes, tunable. Hard stop.
5. **Non-progress detected.** Same `rule_id + file + line` finding
   appeared in two consecutive iterations. Flagged as stuck; loop
   exits for operator review.
6. **Scope creep tripped.** Successive iterations touched
   monotonically more files or lines than iteration 1. Loop pauses
   for operator review.
7. **Test regression introduced.** An auto-fix iteration broke a
   test that was passing before. Hard stop.
8. **Operator interrupt.** Natural-language signal from the operator
   at any point. Loop completes the current iteration to a clean
   state and exits.

Regardless of which condition triggered the exit, worker reports
the final state to the operator: which exit condition fired, what
was auto-applied across all iterations, what findings remain in
the most recent `findings.json`, and whether any safeguards were
close to tripping before exit.
