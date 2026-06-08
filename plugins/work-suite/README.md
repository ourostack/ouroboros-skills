# work-suite

A portable plugin bundle of the core workflow skills from `ouroboros-skills`:

| Skill | Purpose |
|-------|---------|
| `work-ideator` | Explore ambiguous ideas before planning (Tinfoil Hat + Stranger With Candy scrutiny) |
| `work-planner` | Planning doc → doing doc conversion with sub-agent reviewer gates by default |
| `work-doer` | Execute doing-doc units sequentially with strict TDD and unit review |
| `work-merger` | Fetch / merge / PR / wait for CI / merge-to-main cleanup |
| `autopilot` | Long-horizon full-delivery mode: no human gates, harsh reviewer gates, explicit terminal validation |
| `inch-worm` | Open-ended improvement loop: seed → fix → log side discoveries → repeat |

## Autopilot mode

When the principal says "do not return control until everything is done," "fully deployed and validated," "no human gates," or equivalent, `autopilot` defines the mode contract for the whole suite:

- human gates are disabled except for true human-only credentials/capabilities or unrecoverable destructive shared-state actions;
- sub-agent reviewer gates are mandatory and harsh;
- planning/doer/merger "human-judgment categories" become reviewer lenses, not human stops;
- terminal state must be explicit: merged, checks green, release/publish/deploy/install/smoke validation completed when applicable, and no stale PR/branch/worktree from the run;
- Arc / Flight Recorder / `AUTOPILOT-STATE.md` continuity must stay current so a fresh agent can resume after context loss.

## Install

Pick the command for your engine:

```bash
# GitHub Copilot CLI
copilot plugin install ourostack/ouroboros-skills:plugins/work-suite

# Anthropic Claude Code (native)
# Needs a marketplace manifest. Add one alongside this plugin, or consume via the
# top-level skills/ directory using the skill-management flow instead.
```

## Relationship to `skills/`

These SKILL.md files are **copies** of the matching top-level `ouroboros-skills/skills/*/SKILL.md` workflow skills. The top-level `skills/` directory remains the canonical edit surface for the `skill-management` flow and for direct-curl consumers. This plugin exists to make the same workflow suite installable across plugin-managed sessions.

**Keep in sync**: when you edit a skill at the top level, also update its copy here (and vice versa). A CI check or sync script is a reasonable follow-up.

## Why a plugin, not just loose skills

- Claude Code's loose skill path is `~/.claude/skills/` — Claude-only.
- Copilot CLI has **no loose-skill path**; skills reach Copilot only via installed plugins.

Shipping this bundle as a plugin is the only way to deliver the full workflow suite to plugin-only operators. Operators who only use Claude Code and are already on the `skill-management` flow can ignore this plugin entirely.

## Vendor-neutral by design

The `.claude-plugin/plugin.json` manifest is the shared cross-vendor format (originated by Anthropic's Claude Code spec, accepted verbatim by Copilot CLI).
