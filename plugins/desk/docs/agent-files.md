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

The generated worker block includes a Desk MCP health guard. Before treating session start as healthy, the agent checks whether the active host exposes Desk MCP tools, especially `desk_status`. Missing tools are not silently treated as local-only mode: `session-start` explains what Desk MCP provides, asks whether to fix/reload now or continue without reminders, and routes repair to `desk:codex-onboarding` or the Codex repair checklist. Callable `desk_status` means the MCP is present and any degraded index/vector/snapshot state should be repaired through Desk runtime tooling.

Use `manual-only` when Desk should remain available as a plugin/MCP substrate without changing default behavior. Use `project-local` when a repo should own its own Desk binding. If a Codex host exposes an explicit subagent surface, `agents/worker.toml` is the source format for that optional layer, but copied agent files are not part of the healthy path.

No bespoke Desk CLI is required for the default worker path; the host plugin profile, activation adapter, and bundled MCP metadata carry the setup.

For verification and repair of marketplace/plugin exposure, plugin-scoped MCP, runtime-pack health, and owned worker-default blocks, see `desk:codex-onboarding`.

## What if I want a context-specific overlay?

The `worker` agent here is the substrate-default — generic, applicable to any engineering context. If you want corporate-engineering, autonomous-agent, or personal-coding flavored extensions (org-specific auth, work-item trackers, tooling conventions), author a sibling plugin that:

1. Depends on `desk` (so all the substrate skills + MCP are inherited)
2. Ships its own `agents/<name>.md` with extended skills/invariants/tooling
3. Optionally adds its own context-specific skills

The substrate stays generic so it can serve any overlay; overlays carry the parts that depend on whose desk it is.

The first-class dependency ladder is:

```text
desk substrate -> desk:worker -> ms-desk:worker -> area overlay
```

`desk:worker` remains the standalone default. A downstream plugin such as `ms-desk` should not copy Desk skills, Desk MCP config, or the worker body; it should declare an overlay agent that inherits `desk:worker`, adds its own identity/instructions, and becomes the selected activation in the user's global or project profile. A narrower area overlay should depend on `ms-desk` and inherit `ms-desk:worker` so the chain stays explicit. Codex activation enables the selected overlay's plugin dependencies together with Desk and Work Suite while preserving a single Desk MCP server.

`desk_status` reports the active selected activation and chain when the host passes activation context. For Codex cache/debugging, distinguish `repo-source-current`, `installed-cache-current`, and `active-session-visible`: the first two can be checked by the read-only cache audit, while active session visibility requires a host/session reload proof or an active tool-list snapshot supplied to the cache audit.

## `$DESK` binding

The agent body uses a `$DESK` placeholder for the workspace directory. The consumer agent's preamble declares the binding — substitute textually when interpreting skill instructions or running shell commands. Defaults are:

- Standalone Codex install: `$DESK = ~/desk/`
- Autonomous-agent overlay: `$DESK = ~/AgentBundles/<agent>.ouro/desk/`
- Personal-coding overlay: whatever the operator declares
- Corporate-engineering overlay: whatever the org's convention is

One canonical body. Many rooms.
