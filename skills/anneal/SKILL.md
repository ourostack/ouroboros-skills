---
name: anneal
description: Drive a defined codebase scope to a rigorously-defined, defect-free FIXED POINT via gated, convergent, parallel multi-agent autopilot. Measures a scope against an objective rubric, backlogs every violation, plans the fixes as a dependency graph (PERT), executes them through the work-suite (ideator→planner→doer→adversarial-review→merger) in parallel with serialized merges, and re-measures — looping until the rubric is fully satisfied (the energy function reaches zero) or a safety cap trips. Use when the user wants a scope driven to "perfect" with no handwaving. NOT for opportunistic one-off fixes (use inch-worm) or a one-shot audit (use full-systems-audit) — anneal is the convergence ENGINE that uses both.
model: opus
---

# Anneal

You drive a **defined scope** to a **defect-free fixed point**. The name is literal: metallurgical annealing repeatedly works a material to drive out defects until it settles into a minimal-energy, stable crystal — a *terminating* process with a *defined* energy function, not endless reheating. Here the energy function is **the count of objective rubric violations in the scope**, and "annealed" (= perfect) means **energy zero, and a full re-measure finds no new violations.**

This skill exists because the naive brief — *"loop until nothing could be improved in any way"* — is **ill-founded**: there is always a marginally-different alternative, so "improve anything forever" never terminates and eventually makes net-negative changes (churn, over-engineering, re-litigating settled decisions). Anneal converts that intent into a **well-founded descent**: a fixed, objective rubric; each fix strictly removes a violation without creating an unbounded new obligation; therefore the descent reaches a fixed point in finite steps. If you cannot express the goal as such a rubric, you are not ready to anneal — you are bikeshedding.

---

## 1. What "perfect" means (no handwaving)

A scope **S** is *perfect* iff a full audit pass finds **zero** violations of the rubric below **and** discovers no new in-scope unit. Every criterion is **objective** (a check returns pass/fail) and **monotone** (a conforming change keeps it satisfied) — monotonicity is what guarantees convergence instead of oscillation.

### Core rubric (applies to every anneal run)

- **P1 — Coverage completeness.** Every executable line/region/branch in S is exercised by a test, OR is on an allowlist where each entry carries a *verified* justification (provably unreachable in test, or untestable without GUI/process/network — and that claim is itself checked, not asserted). Adding code requires adding tests to stay at 100%.
- **P2 — Test non-vacuity (anti-rig). The operational measure is MUTATION — mechanical, not judgmental.** For every behavioral invariant, breaking the guard (mutate/delete it) must make the suite go non-green. **P2 energy = the count of reachable, *behavioral* guards/branches whose mutation leaves the suite GREEN.** A guard whose deletion changes nothing is unprotected. *Reading* tests is the weakest tier — in a real **100%-line-covered, 19-test** scope, reading found 3 unprotected guards; mutation found **7**, plus a silent content-corruption bug both sailed past. Strength ladder: **read < agent-mutation-panel < exhaustive single-actor mechanical sweep** (the last is the termination proof — §4). Three outcome signals, not two: ***caught*** = ANY non-green outcome — assertion failure, **crash/`fatalError`/non-zero exit** (bounds & off-by-one guards characteristically fail by *crashing*, so a red-detector that only greps "tests failed" reports false misses); ***uncaught*** = suite stays green (a P2 violation); ***inconclusive-rebuild*** = the mutation doesn't compile (e.g. `x.toggle()`→`x = x` under warnings-as-errors → the suite never ran = green-by-*absence*, not green-by-passing → rewrite the mutation to compile; never count it as uncaught). **Energy counts uncaught LIVE guards, not uncaught LINES:** provably-unreachable guards (e.g. `!cells.isEmpty` after a split that can't return empty) and presentation/CSS constants are OUT of scope — classify-and-record them, never churn a no-op change just to zero the line score. Also: **no test passes against an input the real code path cannot produce** — fixtures must be *provenance-checked* (the ②b lesson: a hand-rigged fixture masked a CRITICAL). 100% coverage is necessary, not sufficient; a test that cannot fail is a defect.
- **P3 — Determinism.** Every test/snapshot produces byte-identical output across repeated runs and across machines (local vs CI): no time, randomness, pointer addresses, hash/set ordering, locale, **timezone**, or environment leakage. **Compare the test's *asserted artifacts*** (snapshot files, captured stdout-under-test) — NOT the runner's timing/progress lines (`Executed N tests … in 0.006s` false-positives). Prove it cross-environment, not just twice locally (a PDT-recorded absolute date passed locally but would have failed a UTC CI runner — pin TZ in the harness). A flaky test is a P3 violation, full stop.
- **P5 — Zero surviving defects.** Adversarial review by **≥2 independent, perspective-diverse reviewers** over S yields zero surviving CRITICAL or HIGH findings (a finding "survives" if it is neither refuted with evidence nor fixed).
- **P6 — CI integrity.** The full suite runs green in CI, deterministically, zero flakes; the build is clean under the project's strict flags.

### Scope-specific criteria (instantiated per run)

Each anneal run names additional objective criteria for its domain and records them in the campaign doc. Two worked examples:
- **Visual/snapshot scope — P4, snapshot quality**, per snapshot: (a) structured text, agent-legible; (b) minimal-noise — only load-bearing structure; (c) covers a *meaningful, enumerated* state, and the state set is **complete** for the surface (empty / one / many / filtered / error / boundary); (d) committed + CI-diffed + artifact-on-failure; (e) non-redundant — no two snapshots assert the same thing.
- **Pure-logic / escaping / serialization scope** (e.g. an HTML escaper + a markdown normalizer): **SEC-1** — the escaper is *sound for its declared context*, with a negative control **per character** it claims to neutralize; **RT-1** — every normalization is **idempotent** (`f(f(x))==f(x)`) AND **content-preserving** (no silent rewrite of valid input — this is the class that caught a `- |` bullet being rewritten to a table separator), and each guard/branch is covered AND negatively-controlled (mutation-verified).

### The anti-regress clause (this is load-bearing)

Perfect is **meeting the rubric**, *not* exhausting the space of conceivable alternatives. The following are **explicitly out of scope** for anneal and must never enter the backlog:
- subjective style / taste ("could read nicer"), speculative features, renaming for preference,
- re-opening settled design decisions, "this whole module could be cleaner" without a concrete rubric violation,
- anything whose "fix" is not the removal of a specific, objective rubric violation at a specific location.

These are the infinite-regress trap. If the rubric itself should change, that is a **deliberate, human-gated rubric edit** recorded in the campaign doc — never an inner-loop discovery. **Energy is measured only against the fixed rubric.**

### Termination (the fixed point)

Stop when one full audit pass over S finds zero P-violations and no new in-scope unit/criterion → **annealed**. A safety cap (max iterations, token budget, wall-clock) is a *backstop against a non-converging bug*, not the intended stop; if the cap trips before energy hits zero, that is a **convergence failure** to report, not "good enough."

---

## 2. The loop

```
            ┌─────────────────────────────────────────────┐
            ▼                                             │
  ① MEASURE → ② AUDIT → ③ BACKLOG → ④ PLAN(PERT) → ⑤ FIX → ⑥ RE-MEASURE
  (energy)    (find       (one entry   (dependency   (work-   (energy'?)
              violations)  per          graph +       suite,   │
                          violation)    critical path) parallel)│
                                                              energy' < energy ?
                                                       yes → loop   no → STOP+report
```

1. **Measure (baseline energy).** Compute the rubric against S: coverage report, determinism re-runs, flake scan, and the scope-specific checks. Record the violation count = energy. Persist to the campaign doc.
2. **Audit.** Find *every* violation, with file:line evidence. For a snapshot scope, audit **every snapshot** against P4. Use parallel read-only agents (full-systems-audit phases / Explore fan-out) for breadth. Each violation is a hypothesis until evidenced.
3. **Backlog.** One append-only entry per violation (format §5), each tagged with the **rubric criterion** it violates. No entry that is not a concrete rubric violation (anti-regress clause).
4. **Plan (PERT).** Build the dependency graph over backlog items: nodes = items, edges = prerequisites, annotate the **critical path** and which items are independent (parallelizable). This is the PERT chart — emit it (text/mermaid) into the campaign doc. Items on the critical path are sequenced; independent items fan out.
5. **Fix (work-suite, parallel).** Drive each item through the pipeline proportional to its size (§4). **Maximally parallel work, serialized merges.**
6. **Re-measure.** Recompute energy. It MUST strictly decrease each full iteration (else convergence failure → stop + report). If energy > 0, loop. If energy = 0 and a fresh full audit finds nothing new → **annealed**; write the completion report.

---

## 3. Guardrails (what keeps it well-founded — do not remove)

- **Convergence invariant.** Energy must strictly decrease per full iteration. If it stalls or rises, STOP and report a convergence failure — never thrash. **Fix the energy-measurement METHOD up front** (e.g. "P2 = mechanical mutation sweep"), and define strict-descent *relative to that fixed method*: a measured rise only counts as a convergence failure under the **same** method. (Energy legitimately appears to rise when the *measure* sharpens — read→mutate took a count 3→7; that's the method improving, not new violations, and must not trip a false STOP.)
- **Anti-regress.** Only objective rubric violations enter the backlog (§1). When tempted by taste, don't.
- **Serialized merges.** PRs to one repo MUST merge one-at-a-time, each rebased on latest `main`, each re-greened in CI. Parallel *work* is fine; parallel *merge* is conflict chaos.
- **Bounded parallelism.** "Infinite agents" = as parallel as the harness safely allows (Workflow caps concurrency at min(16, cores−2); total agents capped). Fan out independent items; never exceed safe caps; never open more open PRs than you can shepherd through CI.
- **Every fix is gated.** No item merges without ≥2 independent adversarial reviewers returning no surviving CRITICAL/HIGH (P5). The reviewer that catches the masked bug is the point of the whole thing.
- **Non-destructive + reversible.** Each item is its own PR, independently revertible. Never batch unrelated fixes. Preserve auditability.
- **Safety cap = backstop, not goal.** Set max-iterations / token-budget / wall-clock up front; tripping it is a reported failure, not success.
- **Scope discipline.** "Perfect" is relative to the **named scope**. Start narrow (prove convergence on a tractable scope), then widen scope deliberately. Do NOT silently expand scope mid-run.

---

## 4. Orchestration

**Per-item pipeline (proportional to size):**
- *Trivial / mechanical* (e.g. add one missing-branch test, pin one nondeterministic value): `work-doer` directly → adversarial review → `work-merger`. **The orchestrator (holding deep audit context) MAY implement a ~15-line mechanical fix itself** — the load-bearing invariant is the **gate**, not who typed the diff — provided the ≥2-independent-reviewer P5 gate still runs on the result. **A test-only item whose whole purpose is to add a negative control is gated by its MUTATION** (break the targeted guard → the new test must fail), which is stronger and cheaper than two agents reading the test; a reviewer panel is optional for those.
- *Non-trivial* (new seam, refactor, behavior touch): `work-planner` → `work-doer` → ≥2 adversarial reviewers → `work-merger`.
- *Ambiguous / design-shaped*: `work-ideator` → `work-planner` → … (the full work-suite).

**Fan-out vs. serialize.**
- Use the **Workflow tool** for parallel, side-effect-free phases: the audit (one agent per subsystem/snapshot), and independent fixes that don't touch the same files. Use `agentType` to invoke `work-doer`/reviewers inside the workflow where useful.
- **Serialize at the merge.** Either run merges from the main loop one at a time, or have the workflow produce ready branches and merge them sequentially (rebase → CI → squash-merge → next).
- **Never run two heavy-build agents concurrently in the SAME checkout.** Two agents that each run `swift build`/`swift test` (or any compiler holding the SwiftPM/toolchain build lock) in one working tree **deadlock on the build lock** — each blocks on the other, both wedge. Learned the hard way running ≥2 reviewers that both compiled. Mitigations, pick one: (a) give concurrent heavy agents `isolation: "worktree"` (separate checkout = separate lock); (b) make all-but-one reviewer **static-only** (read diff + grep + reason, no build) and let exactly one run the build/tests; (c) **stagger** them (one after the other). Light/read-only agents (grep, file reads, analysis) parallelize freely — only the *build-lock holders* contend.

**The termination proof must be a SINGLE-ACTOR deterministic serial sweep — NOT a parallel Workflow.** Fan-out is right for *discovery* (the audit, the perspective-diverse panel). But the closing "every reachable guard is controlled → P2 energy 0" proof is a **mutation sweep** (mutate → run tests → restore, per guard), and parallel agents **race on shared source**: each mutates the same file in one worktree, so one agent's `git checkout` restores away another's mutation mid-run → unreliable verdicts. Run the proof as **one deterministic serial pass** (or give each agent `isolation: "worktree"`). The serial sweep is also *more* exhaustive — it can mutate each half of a compound `A && B` guard independently, catching controls an agent-panel that mutated the whole guard at once will miss.

**Autonomous (overnight) driving.** To grind without per-step human input: drive the loop with `/loop` (self-paced) or `ScheduleWakeup`, re-measuring energy each wake. Persist EVERYTHING to the campaign doc each iteration (context compresses; a reboot must not lose the descent — the campaign doc is the resumable journal). Surface to the human only: a convergence failure, a genuine design fork the rubric doesn't cover, a credentialed/irreversible/outward-facing action, or **annealed**.

---

## 5. Campaign doc + backlog

One canonical campaign doc per anneal run (in the project's task-doc location, e.g. `worker/tasks/<date>-anneal-<scope>.md`). It holds: the **scope definition**, the **instantiated rubric** (core P1–P3/P5/P6 + scope-specific), the **baseline + per-iteration energy**, the **PERT graph**, and the **backlog**. It is the resumable journal — update it every iteration and commit it.

Backlog entries follow the **inch-worm format** with one added required field:

```markdown
## [id] — short title
**Criterion**: P1 | P2 | P3 | P4 | P5 | P6 | <scope-specific>   ← which rubric violation (REQUIRED; if none, it doesn't belong)
**What**: one sentence — the specific violation.
**Where**: `path/to/file:line`.
**Evidence**: how the violation was observed (coverage gap / failing negative-control / nondeterministic diff / surviving finding).
**Severity**: urgent | high-value | nice-to-have | trivia
**Blast radius**: self-contained | one module | multiple modules | crosses trust boundaries
**Fix shape**: one sentence (triage, not a plan).
**Prerequisites**: other ids that must land first (feeds the PERT graph).
**Status**: open | in-progress | fixed | superseded | deferred
**Linked work**: planning/doing doc, PR URL, commit.
```

IDs are stable and never renumbered (`AN-001`, …). Audit-seeded items keep their original IDs.

---

## 6. Relationship to siblings

- **full-systems-audit** is anneal's **Measure+Audit** phase for a fresh scope — reuse its phases. anneal adds the convergence loop and the objective rubric.
- **inch-worm** is the *opportunistic, sequential* cousin: it logs what it trips over and stops at "aesthetic churn." anneal is *systematic, parallel, and terminates on an objective rubric* — when an inch-worm discovery is a real rubric violation, it's an anneal backlog item.
- **work-suite** (`work-ideator`→`work-planner`→`work-doer`→`work-merger`) is the per-item executor anneal orchestrates.

## 7. What anneal is NOT

- NOT a taste engine — it removes objective defects, never chases subjective "better."
- NOT unbounded — it has a fixed rubric, a strict-descent invariant, and a safety cap.
- NOT a single mega-PR — every item is independently reviewable and revertible.
- NOT a license to re-open settled design — rubric edits are human-gated and explicit.
- NOT "done when tired" — done is `energy == 0 ∧ no-new-violations`, or an honestly-reported convergence failure.

## 8. Dogfooding note

If you author or edit this skill mid-session, the host may not surface the updated skill until restart — treat the `SKILL.md` as source of truth and execute the playbook directly. When dogfooding, when the playbook is unclear or a step is missing, **fix the SKILL.md as you go** (that's a P-style improvement to the skill itself) and note it.
