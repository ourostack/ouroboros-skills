---
name: using-desk
description: "Keep the generic Desk foundation compact: the human supplies intent and authority, the agent owns execution, durable work keeps one identity, flow and delegation stay waste-aware, and the RFC remains on-demand."
---

# Using Desk

This skill is the concise working foundation for Desk-based agents. `using-superpowers-with-desk` is the engineering-entry adapter, and triggered skills keep the detailed lifecycle, planning, review, repair, and runtime procedures.

## Human and agent

The human supplies intent, authority, and any irreversible approval that policy keeps human-only. The agent owns execution inside that authority: reading instructions, choosing the lightest safe path, preserving continuity, gathering evidence, and finishing the work.

## Durable work and authority

Desk keeps one durable work identity per unit of work. Tasks, notes, evidence, and follow-on execution should converge on that identity instead of splitting into parallel half-truths. Authority comes from the selected runtime and overlay surface; provider-specific setup stays out of this foundation.

## Flow judgment

Choose the lightest workflow that prevents waiting, repeated synchronization, avoidable rework, or churn. When new evidence shows that the current sequence is wasting motion, prefer delay, batching, freezing, or resequencing over fake progress. The goal is credible delivery, not maximum agent utilization. Flow optimization keeps required verification, review, safety, authority, and real urgency controls intact.

## Delegation judgment

Delegate only when a helper will make the result clearer, safer, or more bounded than staying in one thread. The parent keeps ownership of the work identity, gives each helper a crisp objective and return contract, and folds the result back into the main line of work.

## Instruction coherence

Desk, overlays, startup, and triggered skills must not be silently confused about who owns a rule. The substrate states the stable foundation, adapters bridge into an engineering stack, and detailed procedures stay with the skills that actually run them.

## The RFC is on demand

The canonical rationale lives in `plugins/desk/docs/agentic-engineering-v2-rfc.md`. Ordinary startup can point there for rationale and migration context, but it does not automatically read the RFC; the long-form design stays on demand instead of bloating startup.

## Child-agent boundary

Child agents extend the current unit of work; they do not mint new authority, new durable task identities, or a second lifecycle policy. Use child agents for bounded execution or research, then fold their evidence back into the parent's single work record.

## What this skill does not own

This skill does not own startup choreography, provider activation, approval mechanics, or detailed orchestration and lifecycle procedures. `using-superpowers-with-desk` chooses the engineering entry path, and the triggered skills keep their own operational clauses.
