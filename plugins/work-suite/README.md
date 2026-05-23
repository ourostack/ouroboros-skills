# work-suite

A portable plugin bundle of the four core workflow skills from `ouroboros-skills`:

| Skill | Purpose |
|-------|---------|
| `work-ideator` | Explore ambiguous ideas before planning (Tinfoil Hat + Stranger With Candy scrutiny) |
| `work-planner` | Planning doc → doing doc conversion with fresh sub-agent reviewer gates by default |
| `work-doer` | Execute doing-doc units sequentially with strict TDD |
| `work-merger` | Fetch / merge / PR / wait for CI / merge-to-main cleanup |

## Install

Pick the command for your engine:

```bash
# Microsoft Agency
agency plugin install github:ouroborosbot/ouroboros-skills:plugins/work-suite

# GitHub Copilot CLI
copilot plugin install ouroborosbot/ouroboros-skills:plugins/work-suite

# Anthropic Claude Code (native)
# Needs a marketplace manifest. Add one alongside this plugin, or consume via the
# top-level skills/ directory using the skill-management flow instead.
```

## Relationship to `skills/`

These SKILL.md files are **copies** of `ouroboros-skills/skills/work-{ideator,planner,doer,merger}/SKILL.md`. The top-level `skills/` directory remains the canonical edit surface for the `skill-management` flow and for direct-curl consumers. This plugin exists to make the same four skills installable across Agency- and Copilot-managed sessions.

**Keep in sync**: when you edit a skill at the top level, also update its copy here (and vice versa). A CI check or sync script is a reasonable follow-up.

## Why a plugin, not just loose skills

- Claude Code's loose skill path is `~/.claude/skills/` — Claude-only.
- Copilot CLI has **no loose-skill path**; skills reach Copilot only via installed plugins.
- Microsoft Agency installs are cached and cross-engine but require a plugin manifest.

Shipping this bundle as a plugin is the only way to deliver the four skills to Copilot operators and to Agency's managed-install flow. Operators who only use Claude Code and are already on the `skill-management` flow can ignore this plugin entirely.

## Vendor-neutral by design

This plugin has no `agency.json` — it doesn't declare any Microsoft-specific features. The `.claude-plugin/plugin.json` manifest is the shared cross-vendor format (originated by Anthropic's Claude Code spec, accepted verbatim by Copilot CLI and Agency).
