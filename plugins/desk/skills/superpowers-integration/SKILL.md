---
name: superpowers-integration
description: Bind the selected Superpowers engineering method to existing Desk/Crew state, authority, review and delivery boundaries. Invoke before engineering work in the opt-in alpha.
---

# Superpowers on Desk

Selected engineering lifecycle: Superpowers. Desk owns durable task/iteration state, work identity, authority and the agreed delivery endpoint; Crew adds shared-workspace read-across/write-own rules and main-branch state. Superpowers owns engineering discovery, planning, implementation and verification. Invoke this contract before its skills, including when unchanged standing instructions refer to Work Suite. Interpret those legacy calls through the mapping below, not by loading a second lifecycle.

## Authority and terminal boundary

Prior approval remains valid; do not reopen it without a scope change.

Delegation remains limited by the recorded authority.

An intentional alpha or PR-only delivery endpoint does not authorize main promotion.

One implementation owner handles all remediation and re-review findings.

Read the existing task card, plan, doing record and explicit mandate before selecting the applicable Superpowers skill. Do not infer permission from access, tool availability, a paused historical record, or a skill's default finish options. Later explicit instructions supersede older state; keep that fact attributable in Desk. A required machine-review gate is not a new request for human go. Respect an actual human-only approval boundary.

Superpowers approval checkpoints consume the already-recorded approval when it covers the same outcome and scope. Its worktree and finishing routines cannot change the approved repository/worktree, delegate against a prohibition, promote an intentional alpha to main, publish, install into live profiles, or clean up preserved work without authority.

## One state surface

Keep canonical Git-backed Desk/Crew state on main through its established write protocol. An intentional alpha applies to the approved code artifact, not a competing workspace-state branch.

Use existing Desk task and iteration paths. A single-repository plan belongs in its iteration's `planning.md`; an explicitly chosen cross-repository plan remains at its existing Desk planning path. Do not create a competing `.superpowers/sdd` tree.

Before SDD, invoke the plugin-local helper with explicit existing paths:

```sh
node <loaded-desk-plugin>/mcp/src/activation/superpowers-context.js --desk-root <desk-root> --person <alias> --task-path <task-directory> --iteration-path <iteration-directory> --plan-path <existing-plan> --evidence-root <approved-private-evidence-root> --step <positive-step> --attempt <positive-attempt>
```

Omit `--person` for a single-person Desk. Use the actually loaded, admitted Desk artifact, not a guessed sibling directory or mutable cache path. The helper reuses Desk's path authority without creating missing roots, verifies existing regular `task.md`, plan and `doing.md` files, and returns JSON. Missing paths fail; never replace failure with an inferred plan, a mock receipt, or a fallback workspace.

Apply its outputs in place of upstream SDD's path-producing helpers: `planPath` is the plan input; `progressPath` and `rulingsPath` are the same existing `doing.md`; `briefPath`, `implementationReportPath`, `reviewPackagePath` and `reviewReportPath` are the explicit artifact destinations. Produce the normal Superpowers brief and review contents at those paths, using native file/diff tools under the granted authority rather than invoking upstream helpers that select another state directory. This changes storage binding, not the engineering method.

On interruption, read the canonical doing record, not an upstream shadow ledger. Reuse the recorded step/attempt for reading; allocate an explicit new attempt for new output and preserve earlier evidence. Full task/repository/iteration qualification prevents same-basename plan collisions. The helper returns `cleanupPaths: []`; that is no deletion authority. It writes nothing and does not create, discover or protect an evidence store.

The evidence root must be an explicitly approved private artifact location outside Git-backed Desk. It must never be the reserved `<state home>/ouroboros-skills/desk/work-measurement/` ledger partition. File contents remain subject to the repository's write authority and the selected private-storage policy. A printed path is not proof of protection or permission.

## Review and accounting

Invoke `desk:independent-review` for independent review. A host overlay may supply the reviewer launcher; it may not supply a second fix loop. Superpowers' implementation owner dispositions findings, performs in-scope fixes and requests re-review against fresh frozen inputs.

Use Desk's admitted work-accounting contract for intake, commitment, scope changes and links. Intake identifies an independently assessable outcome; commitment records the explicit go and endpoint separately. Rework remains attributed to the original outcome. Do not place private usage or operational evidence in task cards, invent new parameter shapes, or treat unavailable evidence as measured. Preserve provenance classes and observed coverage cutoffs.

At an agreed evaluation endpoint or observation horizon, or for a requested work-item evaluation or retrospective, invoke `desk:online-evaluation` when it is present in the admitted selected-method composition. Otherwise report evaluation unavailable. Delegate ledger capability checks, recording-off behavior and storage authorization to that skill; invocation grants no collection consent or presumed ledger availability. This is a trigger, not another engine, store or lifecycle.

## Legacy capability mapping

These are compatibility routes, not copied Work Suite skills. Source availability is not runtime qualification. If a required native or consumer capability is unavailable, report that limitation and preserve the unfinished outcome; do not silently drop its acceptance criteria.

| Retired call | Selected capability and owner | Capability and proof |
| --- | --- | --- |
| `work-ideator` | `superpowers:brainstorming`, consuming existing approval. | Pinned skill available; actual method consumption still needs qualification. |
| `work-planner` | `superpowers:writing-plans`, with the Desk plan path. | Pinned skill available; no second plan tree. |
| `work-doer` | `superpowers:subagent-driven-development` when delegation is authorized, otherwise `superpowers:executing-plans`. | Pinned skills available; no automatic delegation grant. |
| `work-merger` | `superpowers:verification-before-completion`, then authorized finishing only. | An alpha endpoint does not become a main merge. |
| `autopilot` | native continuation within recorded authority. Owner: `superpowers:executing-plans`. | Capability: conditional; requires host continuation. Proof: runtime qualification required. |
| `stay-in-turn` | native notifications and bounded waits. Owner: `superpowers:executing-plans`. | Capability: conditional; requires host wait tools. Proof: runtime qualification required. |
| `inch-worm` | Execute the approved backlog without arbitrary outcome splitting. Owner: `desk:start-task`. | Capability: conditional; requires an approved backlog and authorized continuation. Proof: runtime qualification required. |
| `watchdog-mode` | native monitoring when available; bounded diagnosis is distinct from persistent supervision. Owner: `desk:runtime-symptom-investigation`. | Capability: conditional; persistent monitoring is not bundled. Proof: runtime qualification required. |
| `visual-qa-dogfood` | Inspect actual screenshots or the live consuming surface, not just metrics. Owner: `superpowers:verification-before-completion`. | Capability: conditional; requires visual tools and viewing evidence. Proof: runtime qualification required. |
| `deep-research` | Discovery uses firsthand evidence. Owner: `superpowers:brainstorming` for discovery only; exhaustive research requires a consumer-provided entrypoint. | Capability: conditional; use the consumer's existing evidence/thread-completion contract, not a generic replacement research engine. Proof: runtime qualification required. |

Keep historical Work Suite runs and result tables as historical evidence. New source fingerprints identify the current alpha only; they do not retroactively qualify those runs.
