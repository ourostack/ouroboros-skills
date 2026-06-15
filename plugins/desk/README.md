# desk

a quiet room for a long-running agent's work — the universal substrate underneath whichever overlay (corporate worker, autonomous agent, personal coding agent) sits on top.

the desk is where the agent does its thinking and keeps its things. drawers for tracks, manilla envelopes for tasks, a corkboard for friction notes, a small reference shelf for lessons earned. archive lives at the back of the room — still browsable, still mine. the same desk serves every consumer because the layout and ceremonies don't depend on whose desk it is:

- **corporate worker overlay** — an enterprise engineer overlay (with whatever work-item tracker, code-review system, and identity provider the org uses) installs desk underneath, then layers org-context overlays on top
- **autonomous agents** (long-lived agents managed by an agent framework) — install desk into the bundle; declare the desk path in the agent's preamble
- **personal coding agents** — install desk; declare a workspace path in agent preamble

cross-context portability runs on the `$DESK` placeholder convention: each consumer agent's preamble binds `$DESK` to its own workspace directory, and desk skills reference paths via `$DESK` rather than any specific literal. one substrate, many overlays.

## Install

### Under Copilot CLI

```bash
copilot plugin install ourostack/ouroboros-skills:plugins/desk
```

The root package carries generated flattened Work Suite metadata for Copilot-compatible hosts, so the normal path installs Desk once and launches `worker`.

### Under Ouroboros

```bash
ouro plugin install ourostack/ouroboros-skills:plugins/desk --agent <agent-name>
```

The agent's `bundle.json` gains a `plugins[]` entry; the agent's preamble declares `Your desk: ~/AgentBundles/<agent>.ouro/desk/`.

Ouroboros treats Desk as bundled substrate instead of a separate user setup step. The agent bundle carries Desk and Work Suite together:

```json
{
  "plugins": [
    "desk",
    "work-suite"
  ]
}
```

The agent preamble binds the placeholder to a concrete workspace path:

```text
$DESK = ~/AgentBundles/<agent>.ouro/desk/
Your desk: ~/AgentBundles/<agent>.ouro/desk/
```

### Under Claude Code

The `ourostack/ouroboros-skills` repo ships a Claude Code marketplace manifest at `.claude-plugin/marketplace.json`, so installation is two slash commands inside a Claude Code session:

```
/plugin marketplace add ourostack/ouroboros-skills
/plugin install desk@ouroboros-skills
/plugin install work-suite@ouroboros-skills
```

Claude Code doesn't auto-resolve plugin deps — install `work-suite` explicitly (it provides the doing-phase skills the desk agent references).

After install, launch the default worker agent:

```bash
claude --agent desk:worker
```

Or inside an existing Claude session: `@desk:worker say hi`. The agent's preamble auto-loads with the cozy library voice and a placeholder `$DESK` binding (typically `~/desk/`). See [`docs/agent-files.md`](./docs/agent-files.md) for the full agent file reference.

### Under Codex

The plugin ships a `.codex-plugin/plugin.json` manifest and a companion `work-suite` plugin manifest. For a home-local install, copy both plugin directories into `~/plugins/`, expose them through a local marketplace rooted at `~/.agents/plugins/marketplace.json`, then enable both plugins from `~/.codex/config.toml`.

Minimum local setup:

```bash
mkdir -p ~/plugins
rsync -a --delete /path/to/ouroboros-skills/plugins/desk/ ~/plugins/desk/
rsync -a --delete /path/to/ouroboros-skills/plugins/work-suite/ ~/plugins/work-suite/
cd ~/plugins/desk/mcp && npm install
codex mcp add desk -- node "$HOME/plugins/desk/mcp/index.js" --root "$HOME/desk"
```

Then add a local Codex marketplace entry whose source is `$HOME`, enable `desk@<marketplace-name>` and `work-suite@<marketplace-name>`, and restart Codex so newly installed skills and MCP tools are loaded.

For semantic search, keep Ollama reachable with `nomic-embed-text` pulled. The MCP honors `OLLAMA_HOST` plus `DESK_EMBED_ENDPOINT` / `DESK_EMBED_MODEL` overrides, and `desk_reindex` without arguments repairs any lexical-only index once embeddings are reachable.

See `desk:codex-onboarding` for the repair checklist and verification steps.

## Invocation — the default `worker` agent

The plugin ships a substrate-default agent named `worker` — a long-running engineering agent that uses the desk (tracks, tasks, friction, lessons) to keep its work coherent across sessions. It's standalone-functional; you don't need to author a consumer overlay to start working.

```bash
# Claude Code (via plugin loader / marketplace)
claude --agent desk:worker

# Copilot CLI
copilot --agent worker
```

**Codex — two paths**. Codex plugins cannot ship agents or AGENTS.md content directly per the plugin schema, so the agent layer is user-installed. Pick one or both:

```bash
# Path A — default behavior (recommended): make Codex itself behave like worker
# every session by appending the canonical body to ~/.codex/AGENTS.md.
awk '/^---$/{c++; next} c>=2' ~/plugins/desk/agents/worker.md >> ~/.codex/AGENTS.md

# Path B — explicit subagent: invoke /agent worker on demand
cp ~/plugins/desk/agents/worker.toml ~/.codex/agents/worker.toml
# then in a Codex session: /agent worker
```

Paths A and B compose. See [`docs/agent-files.md`](./docs/agent-files.md) for the per-harness install reference, and `desk:codex-onboarding` for the full Codex install sequence including the agent layer.

Three agent files (`agents/worker.md`, `agents/worker.agent.md`, `agents/worker.toml`) ship the same canonical body in each harness's expected format. If you want a context-specific overlay (corporate-engineering, autonomous-agent, personal-coding), author it as a sibling plugin that depends on `desk` and provides its own agent file; the substrate stays generic.

## what desk gives an agent

a furnished room, ready to settle into. the layout, the lifecycle, the small ceremonies for tending it.

### workspace structure
- `$DESK/<track>/<task>/<iteration>/` — drawers, folders inside drawers, pages laid open one per work session
- `track.md` and `task.md` cards as canonical state (frontmatter + body)
- `$DESK/_meta/`, `$DESK/_archive/`, `$DESK/_friction/`, `$DESK/_planning/` system directories
- per-iteration `planning.md` + `doing.md` + `feedback.md` (work-suite native)

### lifecycle
- 8-state machine: drafting → processing → validating → collaborating → paused → blocked → done → cancelled. every task moves; some pause along the way
- checkpoint-type annotations on each transition (GATE / CHECKPOINT / AUTO / CONFIRM / NOTIFY)
- session start / resumption / archival workflow

### dispatch
- `work-orchestration` routes tasks through work-suite's four phases (ideator → planner → doer → merger)
- non-coding workflow paths supported (execution + completion alternatives for non-code work)

### engineering posture
- `evidence-discipline` — fixtures-or-refusal, smoke-before-infinity, messages-over-models, etc.
- `preflight-actions` — preflight pattern before irreversible actions
- `runtime-symptom-investigation` — narrow-the-hypothesis-space pattern for runtime issues

### PR craft (for coding agents)
- `pr-self-review`, `pr-review-interrogation`, `pr-surface-hygiene` — pre-open and post-open PR discipline
- `peer-pr-review`, `pr-reviewer-audit` — reviewing others' code

### friction / learning
- `friction-management` — pin a card to the corkboard, then encode the pattern
- `lesson-capture` (post-task) — mine a finished task for patterns and propose what's earned a place on the reference shelf

## convention: the `$DESK` placeholder

skill bodies reference workspace paths via `$DESK`, not literal paths. the host agent's preamble declares the binding — same skills, different rooms:

- Corporate worker overlay: `Your desk: ~/<your-workspace>/` (whatever the overlay's convention is)
- Autonomous agent: `Your desk: ~/AgentBundles/<agent>.ouro/desk/`
- Personal coding agent: whatever the operator declares

The agent does textual substitution when interpreting skill instructions or running shell commands.

## what desk does NOT provide

the substrate stays general. the overlay handles everything situational.

- **org-specific agent identity** — `worker` is the substrate default; consumer overlays (corporate-engineering, autonomous-agent, personal-coding) can ship their own agent with extended skills, invariants, and tooling on top.
- **doing-phase mechanics** — those live in `work-suite` (work-doer, work-merger, etc.)
- **organization-specific concerns** — auth systems, work-item trackers, internal portals, etc. live in a consumer overlay (one of several possible overlays — others can be built the same way)

## versioning

v0.1.0 ships the first cut: 12 core skills + the `lesson-capture` skill. Subsequent releases add further skills with cleaner substrate-vs-overlay separation, and refinements.
