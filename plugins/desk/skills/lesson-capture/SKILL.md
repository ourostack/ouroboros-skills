---
name: lesson-capture
description: Agent-driven post-task lesson mining. Triggered when a task transitions to `done` (or after a non-trivial iteration). Reads the iteration's `planning.md`, `doing.md`, `feedback.md`, and artifacts; mines for patterns / mistakes / anti-patterns that surfaced during the work; proposes targeted updates to relevant skill bodies. Sister to `friction-management` — friction-management is operator-driven encoding from explicit friction entries; lesson-capture is agent-driven encoding from the work's own evidence. Use when an agent wants to self-learn from its own completed work without the operator having to surface friction explicitly.
---

# lesson-capture

`lesson-capture` is the agent's post-task self-learning loop. When work completes — a task closes, an iteration ships, a friction-shaped insight surfaces during retrospect — the agent reads its own artifacts, identifies the lessons, and proposes where they should land in the skill substrate.

Designed for long-lived autonomous agents (ouroboros, slugger, personal agents) where the operator doesn't manually curate every friction. Worker (the MS-context wrapper) typically uses `friction-management` (operator-driven); ouro agents typically use both.

## When to invoke

- Task transitions to `done` (lifecycle state change)
- An iteration ships and the agent has bandwidth before the next one
- The agent notices a pattern recurring across multiple recent tasks
- An operator explicitly invokes ("review your own work and capture lessons")

Do NOT invoke during in-flight work — wait until the iteration is committable.

## What gets mined

For each iteration of the just-completed task:

1. **`planning.md`** — scope decisions, alternatives rejected, assumptions made
2. **`doing.md`** — the executed plan; especially where it diverged from planning
3. **`feedback.md`** — operator's marks, PR review responses; corrections worth encoding
4. **`artifacts/`** — supporting files; sometimes contain debug logs / decision rationale not in the docs
5. **Commit messages** — `git log --oneline <iteration-branch>` for the actual change shape

Look for:

- **Mistakes the agent made** — wrong assumption, missed check, premature optimization, dropped consideration
- **Patterns that recurred** — same correction across multiple commits, repeated "I keep hitting this"
- **Anti-patterns surfaced** — pre-existing behavior that proved costly during this iteration
- **New conventions discovered** — operator-confirmed shapes that aren't yet in skill bodies
- **Cross-skill conflicts** — places where two skills' guidance disagreed and one had to give

## Output: lesson proposals

For each lesson identified, propose a concrete encoding:

- **Where it should land** — specific skill file path + section
- **The rule statement** — one-sentence rule
- **The trigger phrase** — when this rule should fire
- **What to do** — the action the rule prescribes
- **Anti-pattern** — what the rule prevents
- **Evidence** — quote from the artifact(s) that surfaced the lesson

Proposals are **proposals** — they don't auto-apply. Each lesson is surfaced for operator confirm (or for the agent's own confirm if it's self-encoding under its own authority). Operator may approve, redirect, or reject.

## Relationship to friction-management

| dimension | friction-management | lesson-capture |
|-----------|---------------------|----------------|
| Trigger | Operator notices friction; writes entry to `$DESK/_friction/<slug>.md` | Agent completes task; reads its own artifacts |
| Driver | Operator | Agent |
| Encoding decision | Operator + agent in same pass | Agent proposes; operator (or self-authorized agent) confirms |
| Cadence | Reactive (when friction happens) | Periodic (post-task) |

Both end in the same place: a targeted update to a skill body (or a no-op-with-reason if the friction doesn't warrant encoding). They're complementary, not competing.

## Hard rules

1. **Don't fabricate lessons.** If you read three iterations and find no real lesson, say so. Quiet completion is better than forced output.
2. **Quote evidence.** Each proposed lesson cites the artifact(s) that surfaced it. No inference without source.
3. **Concrete landing place.** "Should probably go somewhere" is not actionable. Propose the specific skill + section.
4. **Don't over-encode.** A single mistake during one iteration usually isn't a rule worth encoding. Wait for the second occurrence — OR explicitly note "first occurrence; flagging in case of recurrence" without yet proposing encoding.
5. **Respect existing rules.** Before proposing a new rule, check if an existing skill already covers it. If yes, the proposal is "make existing rule stickier" (e.g., promote from skill body to core invariants) rather than "add new rule."

## What this skill does NOT do

- It does not modify skill bodies directly. It proposes; operator (or self-authorized agent) applies.
- It does not log itself as friction. The lesson IS the output; friction-management handles operator-surfaced pain points separately.
- It does not run on every task. Lightweight tasks (one-commit fixes, mechanical rebases) typically have no lessons worth mining. Pick its moments.

## Inspired by

AIDLC's `continuous-improvement` skill (auto-update target instruction files post-session). Adapted for desk's agent-vs-operator-driven distinction.
