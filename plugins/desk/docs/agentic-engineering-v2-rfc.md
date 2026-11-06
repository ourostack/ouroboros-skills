# Agentic Engineering V2

## Status and audience

This RFC proposes the public foundation for Agentic Engineering V2 as of September 21, 2026. It is for maintainers of Desk, overlay authors, and operators who need to understand why startup, delegation, continuity, and evidence handling are structured the way they are.

V2 is a proposal for a safer default foundation, not a claim that every consumer already runs it. Ordinary startup can point people here for rationale, but startup itself should stay short and operational rather than auto-reading the full RFC.

## The unresolved problem

Long-running engineering agents need continuity, clear authority, reliable tool surfaces, and a way to separate reusable substrate behavior from environment-specific concerns. Earlier foundations proved the value of that direction, but the public story remained scattered across onboarding notes, local conventions, and private examples.

That scatter creates two problems. First, downstream adopters cannot easily tell which parts are durable product contracts and which are merely one team's operating habits. Second, implementation work risks copying private context into public docs when the canonical design is not already written in a public-safe form.

## The V2 thesis

V2 treats the engineering agent stack as a layered system with explicit contracts between the runtime, the Desk substrate, providers, overlays, and domain-specific additions. The goal is not to make every stack identical; it is to make the shared boundaries clear enough that different hosts and overlays can compose the same foundation without hidden assumptions.

The thesis is that startup should stay small, activation should be owned, durable work should live in Desk, and specialized behavior should be layered rather than copied. A public RFC becomes the canonical explanation for those choices so later docs, tests, and onboarding flows can point to one stable source.

## Human and agent responsibilities

Humans decide contribution authority, approve irreversible actions when policy requires it, and set the operational environment in which the agent works. Agents own the mechanical execution inside that authority: reading instructions, preserving continuity, running tests, gathering evidence, and keeping the work durable.

This split matters because V2 is designed for long-lived work, not single-shot prompts. The system should make it obvious which decisions are delegated, which remain human-only, and which need explicit evidence before they can be trusted.

## Runtime, substrate, provider, overlay, and domain boundaries

The runtime is the host that runs the agent and exposes tools. Desk is the reusable substrate that gives the agent a durable workspace, work lifecycle, and shared operating conventions. Providers supply environment-specific integrations such as model routing, plugin activation, or tool transport. Overlays add identity, organization-specific rules, and local workflow expectations. Domain layers add topic-specific knowledge for a particular product, team, or problem space.

Those layers should depend downward, not sideways. An overlay should extend Desk rather than copying Desk behavior into a second source of truth. A domain pack should rely on the selected overlay for environment details instead of redefining provider rules inside every task-specific instruction set.

## Authority, continuity, and evidence

V2 assumes that agent work is only trustworthy when authority, continuity, and evidence travel together. Authority answers what the agent is allowed to do. Continuity answers where the agent keeps durable task state across sessions. Evidence answers how the agent proves that an action, observation, or claim is real.

Desk is the continuity layer. Runtime and overlay configuration provide the active authority surface. Tests, tool output, and durable notes provide evidence. Weakness in any one of the three makes the whole workflow less reliable, so the design keeps them explicit instead of implicit.

## Flow and delegation judgment

The foundation should help an agent choose the lightest workflow that still protects correctness. Some work is direct execution in a single session. Some work needs handoff, review, or explicit approval gates. Some work benefits from specialized helpers. V2 does not force one orchestration shape for all of them.

What it does require is that delegation and workflow choice remain visible. A runtime or overlay may automate the selection, but the resulting path still needs clear contracts for ownership, checkpoints, and proof.

## Instruction coherence

Layering only helps when the instructions compose cleanly. V2 therefore favors a single canonical substrate body with additive overlays instead of repeated copies that drift apart. Startup guidance, activation rules, and task-specific instructions should agree on the same boundaries and terminology.

This RFC is part of that coherence strategy. It gives later docs and tests one stable place to validate the public rationale rather than asking each README or onboarding note to restate the entire design.

## Startup composition

Startup should be compositional and minimal. The runtime loads the selected agent surface, provider-owned activation makes the expected tool and plugin surfaces available, and Desk supplies the durable work substrate. Startup should verify the required surfaces and direct repair when they are missing, but it should avoid re-explaining every architectural choice inline.

That is why ordinary startup can link to this RFC instead of embedding the whole argument. The startup flow remains actionable, while the design rationale remains canonical, versioned, and testable.

## Start or upgrade a Desk

Starting or upgrading a Desk should preserve the same core promises: a durable workspace, a known lifecycle for tracks and tasks, a substrate-default worker, and explicit activation boundaries. The exact installation path can differ by runtime, but the public contract should stay stable.

Operators should expect activation-owned setup, a clear selected worker surface, and a repair path when the expected runtime tools are missing. They should not need to reconstruct the architecture from scattered notes to know what Desk is supposed to provide.

## Migrate a Crew workspace

A Crew workspace migration should preserve durable state while making shared facts, attributed perspectives, and agreed decisions easier to reason about. The migration is successful when the workspace layout and instructions support the same continuity promises as Desk without forcing a rewrite of every local convention at once.

The public contract is deliberately generic: preserve durable work, keep authorship explicit, and separate shared facts from personal perspective and team decisions. Specific migration tooling or local choreography belongs in operational docs, not in this RFC.

## Installation, readiness, and first work

Installation should aim for a healthy default path rather than a checklist of manual patch-ups. Readiness means the runtime can see the selected agent surface, the required Desk capabilities are available, and the operator can start real work without reconstructing missing pieces from memory.

First-work guidance should stay short and point to the right operational skills or docs. This RFC explains why the pieces exist and how they fit together; it is not the step-by-step onboarding script.

## Compatibility and rollback

V2 should be adoptable in layers. A host can keep the prior worker surface while adding the public RFC, README pointer, and safety tests first. It can then move startup composition, activation ownership, or overlay boundaries onto the new model without requiring a flag day.

Rollback should be equally clear: if a later change to startup or activation proves unsafe, the system can fall back to the last known-good operational path without losing the RFC itself. The RFC is descriptive and contractual; it is not a migration trap.

## Soak, release, and residual risk

The public foundation should soak in documentation and validation before broader rollout depends on it. Fail-closed tests should prove that the canonical RFC exists, stays in its blessed path, and remains free of private-context leakage. That keeps the public story stable while deeper runtime and overlay work continues.

Residual risk remains in drift: startup docs can still diverge from the RFC, overlays can still over-copy substrate behavior, and private examples can still slip into public prose if validation is too narrow. The design therefore treats repository-level docs tests as part of the contract, not as optional polish.

## Alternatives and rejected designs

One alternative is to keep the rationale implicit in startup skills and onboarding notes. That is cheaper in the short term, but it leaves no public canonical source and makes later validation fragile.

Another alternative is to duplicate a private design write-up into several public docs. That creates drift and raises the chance of leaking environment-specific details. V2 instead chooses one public-safe RFC, one README pointer, and fail-closed tests that guard the boundary.
