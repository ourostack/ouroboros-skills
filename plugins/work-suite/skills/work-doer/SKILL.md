---
name: work-doer
description: Execute an approved engineering task test-first, preserve its quality and compatibility contract, and deliver the smallest complete change with primary evidence.
---

# Work Doer

Read the task or doing document, current source, and repository instructions. Work in the task branch/worktree and keep durable state current.

## Before writes

Verify that the request authorizes writes to this repository and that an approved contribution path and required identity exist before editing. Read-only requests, unapproved repositories, and identity mismatches make no writes. First-person future wording such as "I'll send it" preserves operator ownership; it does not delegate a live send.

Consume the alignment receipt: intended outcome, constraints, definition of done, contribution scope, and explicit go-ahead. New work without that agreement returns to `work-ideator`; an obvious fix or a completed plan is not a substitute. Already-approved work resumes under its existing receipt without another approval round.

### Place behavior at its owner

Before editing, identify the canonical owner of each material responsibility and ground that placement in repository evidence. Extend the existing owner or extension point instead of putting logic in the nearest caller or currently open file.

Keep every new type, member, and contract at the narrowest visibility required by current production consumers. Do not widen visibility solely for tests or anticipated reuse.

## Build each slice

For every behavior change:

1. Trace the real flow and callers before editing.
2. Write the smallest falsifiable test or deterministic fixture first.
3. Run it and observe the intended red, then freeze the test.
4. Apply Ponytail's ladder and implement the minimal green vertical change.
5. Refactor only while the frozen test remains green.

Every behavior change uses strict TDD: test first, record the observed red, freeze the test, implement the minimal green, then refactor while green. Declarative skill or manifest behavior starts with a failing contract or behavioral fixture rather than a manufactured production module.

### Contain configuration-gated behavior

For a default-off feature or optional configuration-gated behavior, derive every inactive state from the owning contract and characterize it at the real routing boundary before testing activation. Explicit false, missing, malformed, unavailable, stale, and unsupported configuration preserve the pre-change behavior when that contract defines them as inactive. Mutation-test the characterization so it fails when the preserved route changes.

Do not manufacture the red by weakening production code. A test that only mocks the shared boundary or calls the new code directly is not containment evidence. Any edit beyond the activation seam to code that runs for inactive configuration is exceptional and requires regression evidence for every existing consumer it can affect.

### Prove changed-boundary failure contracts

For every changed boundary, prove what callers observe on success and, when applicable, invalid input, dependency failure, timeout, cancellation, partial mutation, retry, duplication, and error translation. Translate errors at the boundary that owns the outgoing contract.

Meet repository-required coverage for new and modified production logic, including error, null, empty, boundary, and negative paths. Do not replace the owner's policy with a universal percentage. Do not exclude a changed production file from coverage to satisfy a gate. For outbound adapters, capture and assert the actual request shape separately from response handling. UI and rendered-output changes also invoke `visual-qa-dogfood`.

### Prove the primary outcome

Test the agreed primary outcome at its real owner and consuming boundary. Challenge the most consequential input-domain or compatibility assumption with a counterexample beyond the examples that drove implementation. Derive the expected behavior from the agreed contract and pre-change behavior, not from what the new code happens to do.

Make this falsification observable. Give the fresh reviewer the intended behavior and compatibility contract before the author's test summary, and ask for a runnable probe from a materially different input class or state transition, not another example of the class already tested. Execute the proposed probe through the real owner or consuming route and retain its expectation, result, and limits in the existing confidence packet. An approving review without such a challenge cannot stand in for semantic evidence. If the primary claim remains untested, report that gap rather than declaring it complete.

Passing tests, a coverage number, a clean commit, and an approving review are not proof of complete behavior. Keep deterministic results, semantic review, and consuming-surface evidence distinct. A regression in the quality or compatibility contract fails the change regardless of reduced code, tokens, or runtime. Do not fix an adjacent concern by silently expanding the agreed scope.

Never simplify away requested scope, error handling, validation, accessibility, evidence, or terminal delivery. Never create an abstraction for one implementation or a dependency for a few clear lines. Commit meaningful behavior changes, not process-only or no-change checkpoints.

## Finish

Keep durable state current at meaningful checkpoints: update the doing document when one exists; otherwise update the task card.

Retain a concise confidence packet in that existing artifact: agreed intent and go-ahead, chosen design and material alternatives, changed surface, exact source and workflow version, model and runtime identity when available, independent review and closure, primary outcome evidence, known gaps, and applicable rollout/rollback. This is inspectable evidence, not a numeric self-grade, a new database, or a mandatory long-form document.

At the branch boundary, record the exact build and full suite commands and results, confirm no new warnings, and run one fresh branch review. Fix blocker and major findings once and rerun affected proof. Then invoke `work-merger` and keep control through the agreed terminal state: PR, CI repair, merge, release/install, consuming-surface smoke, cleanup, and continuation scan as authorized. A preview-only contract does not authorize main-branch promotion.
