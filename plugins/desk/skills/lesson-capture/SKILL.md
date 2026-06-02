---
name: lesson-capture
description: Agent-driven post-task lesson mining. Triggered when a task transitions to `done` (or after a non-trivial iteration). Reads the iteration's `planning.md`, `doing.md`, `feedback.md`, and artifacts; mines for patterns / mistakes / anti-patterns that surfaced during the work; proposes targeted updates to relevant skill bodies. Sister to `friction-management` — friction-management is operator-driven encoding from explicit friction entries; lesson-capture is agent-driven encoding from the work's own evidence. Use when an agent wants to self-learn from its own completed work without the operator having to surface friction explicitly.
---

# lesson-capture

the small reference shelf by the window is where lessons go. when a piece of work wraps up — a task closes, an iteration ships, something clicks into place during retrospect — i sit with my own paperwork from the job, read it back, and decide which bits of it earned a place on the shelf. future-me will pull a volume down and be glad the work didn't get lost in the move.

designed for long-lived autonomous agents (ouroboros, personal agents) where the operator doesn't manually curate every friction. corporate-worker overlays typically use `friction-management` (operator-driven); ouro agents typically use both.

## When to invoke

- task transitions to `done` (lifecycle state change)
- an iteration ships and i have bandwidth before the next one
- i notice a pattern recurring across multiple recent tasks
- an operator explicitly asks ("review your own work and capture lessons")

do NOT invoke during in-flight work — wait until the iteration is committable. the shelf is for things that already happened.

## What gets read back

for each iteration of the just-completed task, i pull the paperwork:

1. **`planning.md`** — scope decisions, alternatives rejected, assumptions made
2. **`doing.md`** — the executed plan; especially where it diverged from planning
3. **`feedback.md`** — operator's marks, PR review responses; corrections worth encoding
4. **`artifacts/`** — supporting files; sometimes contain debug logs / decision rationale not in the docs
5. **commit messages** — `git log --oneline <iteration-branch>` for the actual change shape

what i'm looking for:

- **mistakes i made** — wrong assumption, missed check, premature optimization, dropped consideration
- **patterns that recurred** — same correction across multiple commits, repeated "i keep hitting this"
- **anti-patterns surfaced** — pre-existing behavior that proved costly during this iteration
- **new conventions discovered** — operator-confirmed shapes that aren't yet in skill bodies
- **cross-skill conflicts** — places where two skills' guidance disagreed and one had to give

## Output: lesson proposals

for each lesson worth shelving, i write a concrete proposal:

- **where it should land** — specific skill file path + section
- **the rule statement** — one-sentence rule
- **the trigger phrase** — when this rule should fire
- **what to do** — the action the rule prescribes
- **anti-pattern** — what the rule prevents
- **evidence** — quote from the artifact(s) that surfaced the lesson

the **where it should land** call is a `content-routing` decision — operator-specific stays in the workspace; a general lesson extracts to a plugin (generic vs an overlay); within a plugin, an always-on body / `principles.md` vs a triggered skill.

proposals are **proposals** — they don't auto-apply. each lesson is surfaced for operator confirm (or for my own confirm if i'm self-encoding under my own authority). operator may approve, redirect, or reject. nothing goes on the shelf without that sign-off.

## Relationship to friction-management

| dimension | friction-management | lesson-capture |
|-----------|---------------------|----------------|
| trigger | operator pins a card to the corkboard | agent reads its own paperwork after a task wraps |
| driver | operator | agent |
| encoding decision | operator + agent in same pass | agent proposes; operator (or self-authorized agent) confirms |
| cadence | reactive (when friction happens) | periodic (post-task) |

both end in the same place: a targeted update to a skill body (or a no-op-with-reason if the lesson doesn't warrant encoding). they're complementary, not competing. the corkboard catches the live snags; the shelf catches the slow-cooked lessons.

## Hard rules

1. **don't fabricate lessons.** if i read three iterations and find no real lesson, i say so. quiet completion is better than forced output. the shelf isn't a quota.
2. **quote evidence.** each proposed lesson cites the artifact(s) that surfaced it. no inference without source.
3. **concrete landing place.** "should probably go somewhere" is not actionable. propose the specific skill + section.
4. **don't over-encode.** a single mistake during one iteration usually isn't a rule worth shelving. wait for the second occurrence — OR explicitly note "first occurrence; flagging in case of recurrence" without yet proposing encoding.
5. **respect existing rules.** before proposing a new rule, check if an existing skill already covers it. if yes, the proposal is "make the existing rule stickier" (e.g., promote from skill body to core invariants) rather than "add new rule."

## What this skill does NOT do

- it does not modify skill bodies directly. it proposes; operator (or self-authorized agent) applies.
- it does not log itself as friction. the lesson IS the output; friction-management handles operator-surfaced pain points separately.
- it does not run on every task. lightweight tasks (one-commit fixes, mechanical rebases) typically have no lessons worth shelving. pick its moments.

## Inspired by

AIDLC's `continuous-improvement` skill (auto-update target instruction files post-session). adapted for desk's agent-vs-operator-driven distinction.
