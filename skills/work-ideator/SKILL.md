---
name: work-ideator
description: Explore ambiguous product, architecture, workflow, or coding ideas before invoking work-planner. Use when the user asks to ideate, think through, investigate, flesh out, compare prior art, run skepticism passes, or prepare a better planning handoff before $work-planner; especially for harness changes where naming, scope, mental model, or implementation shape is still unsettled.
---

# Work Ideator

Use this skill before `work-planner` when the idea is still alive and should not be frozen into a task plan yet.

The goal is real exploration: understand the desired felt experience, inspect the actual system or sources, alternate generative and skeptical passes, then produce a concise planner handoff only when the shape is strong enough.

## Ground Rules

- Keep the exploration honest. Separate what exists, what is inferred, and what is taste.
- Prefer source-grounded discovery over imagination when code, docs, prior art, or artifacts are available.
- Do not turn the first plausible design into a plan. Let the idea breathe first.
- Steal nutrition, not the whole van: extract useful primitives from prior art without importing its worldview by default.
- Name things according to what they are architecturally, not what is convenient product language.
- Treat helpers, workers, and model calls as mechanisms. Do not personify them as agents unless they truly need autonomy, identity, persistence, and broad responsibility.
- Preserve the user's live values and phrasing when they carry design truth.

## Workflow

1. **Restate The Spark**
   Capture the user's desired felt experience in one or two sentences. Include any strong language or metaphors that should constrain the design.

2. **Probe The Terrain**
   Inspect the actual codebase, docs, or external prior art needed to avoid armchair design. Use local search first. Browse only when the relevant facts may have changed or the user asked for current external research.

3. **Divergent Pass**
   Generate multiple plausible shapes. Include the boring version, the ambitious version, and the weird-but-possibly-right version.

4. **Skepticism Pass A: Is This Fake?**
   Assume each idea is prompt theater, naming confusion, or imported fashion. Ask:
   - What would make this merely cosmetic?
   - What existing primitive already covers this?
   - What word is lying?
   - What behavior would prove this is real?

5. **Synthesis Pass A**
   Keep only the parts that survive. Collapse overlapping objects. Prefer one clear primitive over several vibes.

6. **Skepticism Pass B: Will This Fit The Harness?**
   Assume the implementation will fight the current architecture. Ask:
   - Where would this actually run?
   - What blocks on what?
   - What state is canonical?
   - What fails, times out, or goes stale?
   - What should not be added yet?

7. **Synthesis Pass B**
   Convert the surviving idea into a small architecture. Identify the thin slice, the explicit non-goals, and the follow-up seams.

8. **Human Decision Check**
   If scope, naming, ownership, or workflow remains genuinely unresolved, stop with options instead of pretending consensus. Otherwise proceed to a planner handoff.

## Output Shape

Use a compact report with these sections when preparing to invoke `work-planner`:

- **Spark:** the felt experience or problem being designed for.
- **Observed Terrain:** source-grounded facts from code, docs, or prior art.
- **Surviving Shape:** the recommended primitive and why it is not just theater.
- **Skepticism Notes:** objections that changed the design.
- **Thin Slice:** the first buildable version.
- **Non-Goals:** attractive things explicitly left out.
- **Open Questions:** only questions that need human direction before planning.
- **Planner Handoff:** goal, constraints, likely files or modules, acceptance signals, and risks.

If the user asks to continue into planning, invoke `work-planner` after the handoff and let the repo's planning gates take over.

## Quality Bar

Good ideation produces a planner handoff that feels inevitable but not prematurely rigid. It should make the eventual plan easier, smaller, and truer.

Bad ideation produces a mood board, a list of features, or a plan that hides unresolved philosophical or architectural choices.
