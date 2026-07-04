---
name: work-ideator
description: Explore ambiguous product, architecture, workflow, or coding ideas before invoking work-planner. Use when the user asks to ideate, think through, investigate, flesh out, compare prior art, run Tinfoil Hat and Stranger With Candy scrutiny passes, or prepare a better planning handoff before $work-planner; especially for harness changes where naming, scope, mental model, or implementation shape is still unsettled.
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
- Use named scrutiny stances. Language guides behavior: `Tinfoil Hat` looks for omissions, and `Stranger With Candy` looks for plausible-but-wrong traps.

## Workflow

The ideator authors generative passes (Steps 1, 2, 3, 5, 7) and dispatches fresh sub-agents for adversarial scrutiny passes (Steps 4 and 6). The same agent doing both generation and skepticism is honest but limited; a fresh-context sub-agent is more likely to catch what the original frame missed. Each scrutiny pass uses its own sub-agent — no continuation between passes.

1. **Restate The Spark**
   Capture the user's desired felt experience in one or two sentences. Include any strong language or metaphors that should constrain the design.

2. **Probe The Terrain**
   Inspect the actual codebase, docs, or external prior art needed to avoid armchair design. Use local search first. Browse only when the relevant facts may have changed or the user asked for current external research.

3. **Divergent Pass**
   Generate multiple plausible shapes. Include the boring version, the ambitious version, and the weird-but-possibly-right version.

4. **Tinfoil Hat (fresh sub-agent dispatched): "what am I not seeing?"**

   Spawn a fresh, no-context sub-agent. Brief:
   - The ideation report so far (write it to a temp file and pass the path; or paste inline if compact)
   - Absolute paths to relevant source files / prior art the report references
   - Lens — omissions:
     - What gap in scope, state, or execution would make each idea fall apart?
     - What hidden dependency or ordering constraint is being ignored?
     - What would make this merely cosmetic?
     - What existing primitive already covers this?
     - What behavior would prove each idea is real?
   - Output format: list of objections per idea, severity per item (`BLOCKER / MAJOR / MINOR / NIT`)
   - Time-box: report under ~500 words

   Ideator addresses findings with judgment and rolls them into Synthesis Pass A.

5. **Synthesis Pass A**
   Keep only the parts that survive Tinfoil Hat. Collapse overlapping objects. Prefer one clear primitive over several vibes.

6. **Stranger With Candy (fresh sub-agent dispatched): "what here looks correct but is actually wrong?"**

   Spawn a NEW fresh, no-context sub-agent (not the same one as Step 4). Brief:
   - The post-Synthesis-A report
   - Absolute paths to relevant source files / prior art
   - Lens — deception (plausible surface, wrong shape):
     - What word is lying?
     - What module, package, helper, or prior-art primitive looks right but belongs somewhere else?
     - Where would this actually run?
     - What blocks on what?
     - What state is canonical?
     - What fails, times out, or goes stale?
     - What should not be added yet?
   - Output format: list of objections, severity per item
   - Time-box: report under ~500 words

   Ideator addresses findings with judgment and rolls them into Synthesis Pass B.

7. **Synthesis Pass B**
   Convert the surviving idea into a small architecture. Identify the thin slice, the explicit non-goals, and the follow-up seams.

8. **Reviewer Decision Check (five-category gate, mirrors work-planner)**

   Default path is sub-agent convergence + a clean Planner Handoff section. When one of the same five judgment categories fires, use it as a named reviewer lens rather than a human approval gate:

   1. **Voice and relationships.** The ideation involves drafting operator-voice content, naming conventions readers will encounter for years, or relationship dynamics with humans/agents.
   2. **Durably-shaping state.** New track slugs, schema choices, naming decisions that propagate through downstream consumers.
   3. **Irreversible operations.** Destructive ops, force-pushes, irreversible API calls.
   4. **Genuine ambiguity.** Worker has tried, can't pick the right framing, doesn't have context the user has.
   5. **Cross-org / cross-team posture.** What to say to one peer vs another, how to frame an escalation.

   When a trigger fires, dispatch the relevant harsh reviewer lens, address findings, and record the decision instead of pretending consensus. Surface only when the user explicitly asked to decide, a human-only credential/capability is required, or a genuinely unrecoverable destructive shared-state action is present. Otherwise produce the planner handoff and continue to planning when the workflow calls for it.

## Output Shape

Use a compact report with these sections when preparing to invoke `work-planner`:

- **Spark:** the felt experience or problem being designed for.
- **Observed Terrain:** source-grounded facts from code, docs, or prior art.
- **Surviving Shape:** the recommended primitive and why it is not just theater.
- **Scrutiny Notes:** Tinfoil Hat and Stranger With Candy objections that changed the design.
- **Thin Slice:** the first buildable version.
- **Non-Goals:** attractive things explicitly left out.
- **Open Questions:** only questions that need human direction before planning.
- **Planner Handoff:** goal, constraints, likely files or modules, acceptance signals, and risks.

If the user asks to continue into planning, invoke `work-planner` after the handoff and let the repo's planning gates take over.

## Quality Bar

Good ideation produces a planner handoff that feels inevitable but not prematurely rigid. It should make the eventual plan easier, smaller, and truer.

Bad ideation produces a mood board, a list of features, or a plan that hides unresolved philosophical or architectural choices.
