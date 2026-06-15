# desk:worker — agent files

The desk plugin ships a substrate-default engineering agent named `worker`. The same canonical body lands in three formats so the agent works natively on the three major agentic CLIs.

| File | Harness | Format | What it gives you |
|---|---|---|---|
| `worker.md` | Claude Code | YAML frontmatter + markdown body | A discrete agent selectable via plugin loader / marketplace. Invoke `claude --agent desk:worker`. |
| `worker.agent.md` | Copilot CLI | YAML frontmatter (`target: github-copilot`, `user-invocable: true`) + markdown body | A discrete agent that appears in Copilot CLI's agent picker. Invoke `copilot --agent worker`. |
| `worker.toml` | Codex CLI | TOML subagent — `name`, `description`, `developer_instructions` | Source format for hosts that expose explicit subagents; Codex's healthy path is activation-owned default behavior. |

## Install + invoke per harness

### Claude Code

The plugin's `.claude-plugin/plugin.json` and `agents/` directory are picked up by the standard plugin loader. Reference the plugin from a marketplace manifest, or install it through whichever tool you use to manage Claude Code plugins. Once installed:

```bash
claude --agent desk:worker
```

### Copilot CLI

The plugin's root `plugin.json` (Copilot CLI's expected location) names `agents/` as the agents directory. After installing:

```bash
copilot plugin install ourostack/ouroboros-skills:plugins/desk
copilot --agent worker
```

The root package carries generated flattened Work Suite metadata for Copilot-compatible hosts, so no separate Work Suite install is part of the healthy path.

### Codex CLI / Codex App

Codex plugins ship skills, MCP servers, apps, and hooks. Desk's healthy Codex path is activation-owned: the adapter enables Desk and Work Suite together, enables the bundled plugin-scoped MCP, and materializes a delimited worker-default instruction block. The default mode is `global-personal`, so every fresh Codex session starts with worker+Desk behavior.

Use `manual-only` when Desk should remain available as a plugin/MCP substrate without changing default behavior. Use `project-local` when a repo should own its own Desk binding. If a Codex host exposes an explicit subagent surface, `agents/worker.toml` is the source format for that optional layer, but copied agent files are not part of the healthy path.

For verification and repair of marketplace/plugin exposure, plugin-scoped MCP, runtime-pack health, and owned worker-default blocks, see `desk:codex-onboarding`.

## What if I want a context-specific overlay?

The `worker` agent here is the substrate-default — generic, applicable to any engineering context. If you want corporate-engineering, autonomous-agent, or personal-coding flavored extensions (org-specific auth, work-item trackers, tooling conventions), author a sibling plugin that:

1. Depends on `desk` (so all the substrate skills + MCP are inherited)
2. Ships its own `agents/<name>.md` with extended skills/invariants/tooling
3. Optionally adds its own context-specific skills

The substrate stays generic so it can serve any overlay; overlays carry the parts that depend on whose desk it is.

## `$DESK` binding

The agent body uses a `$DESK` placeholder for the workspace directory. The consumer agent's preamble declares the binding — substitute textually when interpreting skill instructions or running shell commands. Defaults are:

- Standalone Codex install: `$DESK = ~/desk/`
- Autonomous-agent overlay: `$DESK = ~/AgentBundles/<agent>.ouro/desk/`
- Personal-coding overlay: whatever the operator declares
- Corporate-engineering overlay: whatever the org's convention is

One canonical body. Many rooms.
