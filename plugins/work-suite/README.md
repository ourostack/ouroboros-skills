# work-suite

This branch previews Work Suite 4 for **Agentic Engineering V2: rebasing the inner loop**. New implementation work starts with substantive alignment and explicit go-ahead; already-approved work resumes without ceremony. After go, the agent uses native capabilities and Ponytail to deliver the smallest complete result, preserving repository quality policy, risk-graded review, and durable continuity.

The preview replaces a universal changed-code coverage percentage with the repository owner's required coverage and explicit semantic acceptance evidence. Test-first work, error-path coverage, independent review, and consuming-surface proof remain. A green test suite or review cannot substitute for the agreed behavior, and a smaller or faster regression is still a failure.

| Skill | Purpose |
|-------|---------|
| `work-ideator` | Agree intent, constraints, definition of done, and explicit go before new implementation |
| `work-planner` | Plan coordinated or risky work; skip planning when the change is already clear |
| `work-doer` | Implement the smallest correct vertical slice and validate the changed behavior |
| `work-merger` | Reach the agreed delivery boundary without promoting a preview or PR-only task beyond its scope |
| `visual-qa-dogfood` | Use screenshot-backed dogfooding for UI/rendering work |
| `autopilot` | Keep authorized long-horizon work moving until terminal state |
| `stay-in-turn` | Keep CI, deploy, smoke, and multi-PR waits inside the same turn |
| `inch-worm` | Repeat an open-ended improvement loop while each next step remains justified |

## Ponytail dependency

Work Suite uses Plain Language v0.2.0 for human-readable output and the packaged `ponytail-upstream` plugin, pinned to Ponytail v4.9.0. Coding work follows Ponytail's ladder: question whether code needs to exist, reuse the codebase, prefer standard-library/native/already-installed capabilities, choose the simplest viable approach, and write custom machinery only when necessary.

Ponytail applies to coding work, including implementation, refactoring, debugging, tests, and code review. It does not truncate requested research, documentation, analysis, or operational work. Plain Language remains the authority for human-readable output.

The upstream files are vendored unmodified and hash-locked in `upstream-sources.lock.json`; Ourostack owns only the provider manifests and integration.

## Autopilot mode

When the principal delegates sustained autonomy, `autopilot` keeps selecting ready work until the requested outcome is terminal. An explicit producer state named `needs-human-approval` is a hard exception; `needs reviewer gate` is reserved for producers that explicitly permit machine review.

Terminal state comes from the alignment receipt. Normal merge-and-deliver work includes merged changes, green required checks, applicable release/install/deploy and smoke evidence, current durable state, and no stale branch, PR, or worktree from the run. Intentional previews keep their branch and rollback path; they do not silently become main-branch promotions. Reviews are risk-driven: cross-cutting, novel, or high-risk planning uses fresh **Tinfoil Hat** and **Stranger With Candy** reviews; coordinated doing-only work uses one risk-selected cold reviewer; already-approved clear work skips Planner.

### Runtime visibility audit

The work-suite contract includes a small source/runtime audit:

```bash
node scripts/audit-work-suite-runtime.cjs --repo-root /path/to/ouroboros-skills \
  --skill-root ~/.agents/skills \
  --skill-root ~/.codex/skills \
  --active-skills autopilot,deep-research,inch-worm,stay-in-turn,visual-qa-dogfood,watchdog-mode,work-doer,work-ideator,work-merger,work-planner
```

Use it when a skill was installed or updated but the current host menu may be stale. Source drift is a hard failure. Installed-root drift and active-menu gaps are explicit runtime evidence: read the installed `SKILL.md` directly for the current run, record the mismatch in durable state, and refresh or restart the host before relying on menu discovery.

### Autopilot state audit

Before a final response under autopilot, run the durable-state preflight when this repo tooling is available:

```bash
node scripts/audit-autopilot-state.cjs --state-file /path/to/AUTOPILOT-STATE.md
```

The state file must record `Current Item`, `Terminal Evidence`, `Continuation Scan`, and `Stop Condition`. The continuation scan table uses `candidate`, `classification`, `evidence`, and `disposition`; final-state audits fail while any candidate remains `ready` or `needs reviewer gate`. Use a single `none` sentinel row when the scan found no candidates at all.

## Install

Pick the command for your engine:

```bash
# Anthropic Claude Code (native)
# Needs a marketplace manifest. Add one alongside this plugin, or consume via the
# top-level skills/ directory using the skill-management flow instead.
```

Copilot-compatible hosts normally receive Work Suite through Desk's generated flattened bundle metadata. A direct Copilot load of this preview must explicitly include Work Suite 4.0.0-alpha.1, Plain Language v0.2.0, and Ponytail v4.9.0 because the root Copilot manifest does not resolve plugin dependencies.

## Relationship to `skills/`

These SKILL.md files are **copies** of the matching top-level `ouroboros-skills/skills/*/SKILL.md` workflow skills. The top-level `skills/` directory remains the canonical edit surface for the `skill-management` flow and for direct-curl consumers. This plugin exists to make the same workflow suite installable across plugin-managed sessions.

**Keep in sync**: when you edit a skill at the top level, also update its copy here (and vice versa). CI fails when any bundled Work Suite skill copy differs from its canonical top-level skill.

## Why a plugin, not just loose skills

- Claude Code's loose skill path is `~/.claude/skills/` — Claude-only.
- Copilot CLI has **no loose-skill path**; skills reach Copilot only via installed plugins.

Shipping this bundle as a plugin is the only way to deliver the full workflow suite to plugin-only operators. Operators who only use Claude Code and are already on the `skill-management` flow can ignore this plugin entirely.

## Vendor-neutral by design

The `.claude-plugin/plugin.json` manifest is the shared cross-vendor format (originated by Anthropic's Claude Code spec, accepted verbatim by Copilot CLI).
