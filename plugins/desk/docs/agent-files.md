# desk:worker — agent files

The desk plugin ships a substrate-default engineering agent named `worker`. The same canonical body lands in three formats so the agent works natively on the three major agentic CLIs.

| File | Harness | Format | What it gives you |
|---|---|---|---|
| `worker.md` | Claude Code | YAML frontmatter + markdown body | A discrete agent selectable via plugin loader / marketplace. Invoke `claude --agent desk:worker`. |
| `worker.agent.md` | Copilot CLI | YAML frontmatter (`target: github-copilot`, `user-invocable: true`) + markdown body | A discrete agent that appears in Copilot CLI's agent picker. Invoke `copilot --agent worker`. |
| `worker.toml` | Codex CLI | TOML subagent — `name`, `description`, `developer_instructions` | A subagent invocable via `/agent worker` for an isolated, focused session. **See "Two paths on Codex" below.** |

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
copilot plugin install ourostack/ouroboros-skills:plugins/work-suite
copilot --agent worker
```

Copilot CLI doesn't auto-resolve transitive plugin deps — install both `desk` and `work-suite` explicitly.

### Codex CLI — two paths

Codex plugins ship **skills + MCP + apps + hooks**, but per [Codex's plugin schema](https://developers.openai.com/codex/concepts/customization) they **cannot ship subagents or AGENTS.md content directly**. The agent layer is user-installed. Pick the path that matches what you want:

**Path A — default behavior** (recommended for most operators). Make Codex itself behave like `worker` in every session by appending the canonical body to your `~/.codex/AGENTS.md` (or your project's `AGENTS.md`):

```bash
# Append the body of worker.md (everything after the YAML frontmatter)
# to ~/.codex/AGENTS.md. Substitute the path to your local plugin clone:
PLUGIN=~/plugins/desk

# Strip the frontmatter block (between the first two --- lines) and append:
awk '/^---$/{c++; next} c>=2' "$PLUGIN/agents/worker.md" >> ~/.codex/AGENTS.md
```

Every Codex session after this reads the desk substrate context as part of its always-on guidance. No explicit invocation needed.

**Path B — explicit subagent**. For a power-user setup where you want to keep Codex's default behavior unchanged and spawn `worker` only on demand:

```bash
mkdir -p ~/.codex/agents
cp ~/plugins/desk/agents/worker.toml ~/.codex/agents/worker.toml
```

Then in a Codex session:

```
/agent worker
```

Paths A and B compose — you can install both. AGENTS.md handles default behavior; `/agent worker` handles explicit isolated sessions.

For the full Codex plugin install (marketplace entry, MCP server registration, verification), see `desk:codex-onboarding`.

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
