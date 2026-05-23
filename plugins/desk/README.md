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
copilot plugin install ourostack/ouroboros-skills:plugins/work-suite
```

Copilot CLI doesn't resolve transitive deps; install both explicitly.

### Under Ouroboros

```bash
ouro plugin install ourostack/ouroboros-skills:plugins/desk --agent <agent-name>
```

The agent's `bundle.json` gains a `plugins[]` entry; the agent's preamble declares `Your desk: ~/AgentBundles/<agent>.ouro/desk/`.

### Under Claude Code

The plugin uses the standard `.claude-plugin/plugin.json` manifest. Reference it from a marketplace manifest, or consume the top-level `skills/` directory directly via the `skill-management` flow.

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

- **agent identity** — that's the consumer agent's job (the wrapper agent declares persona, MCP frontmatter, etc.)
- **doing-phase mechanics** — those live in `work-suite` (work-doer, work-merger, etc.)
- **organization-specific concerns** — auth systems, work-item trackers, internal portals, etc. live in a consumer overlay (one of several possible overlays — others can be built the same way)

## versioning

v0.1.0 ships the first cut: 12 core skills + the `lesson-capture` skill. Subsequent releases add further skills with cleaner substrate-vs-overlay separation, and refinements.
