# desk

The generic task-tracking substrate for long-running agents.

desk provides the workspace conventions, lifecycle states, dispatch, friction registers, and engineering posture skills that turn an agent from a one-off helper into a long-running, accountable, learning-over-time worker. The same skills serve:

- **Microsoft worker** (corp engineering with ADO / EMU / ECS / M365) — depends on desk + adds MS-context overlays
- **Ouroboros agents** (slugger, ouroboros itself, personal long-lived agents) — installs desk into the bundle; declares the desk path in psyche
- **Personal coding agents** — installs desk; declares a workspace path in agent preamble

Cross-context portability is enabled by the `$DESK` placeholder convention: each consumer agent's preamble binds `$DESK` to its own workspace directory, and desk skills reference paths via `$DESK` rather than any specific literal.

## Install

### Under Agency CLI

```bash
agency plugin install github:ourostack/ouroboros-skills:plugins/desk --cache-policy auto --cache-ttl 0
```

`work-suite` (the four-phase doing skills) resolves as a transitive dependency automatically.

### Under Copilot CLI

```bash
copilot plugin install ourostack/ouroboros-skills:plugins/desk
copilot plugin install ourostack/ouroboros-skills:plugins/work-suite
```

Copilot CLI doesn't resolve transitive deps; install both explicitly.

### Under Ouroboros

Ouroboros plugin support is implemented in W5 of the worker-generalization rollout. Once available:

```bash
ouro plugin install ourostack/ouroboros-skills:plugins/desk --agent <agent-name>
```

The agent's `bundle.json` gains a `plugins[]` entry; the agent's psyche declares `Your desk: ~/AgentBundles/<agent>.ouro/desk/`.

## What desk gives an agent

### Workspace structure
- `$DESK/<track>/<task>/<iteration>/` directory layout
- `track.md` and `task.md` cards as canonical state (frontmatter + body)
- `$DESK/_meta/`, `$DESK/_archive/`, `$DESK/_friction/`, `$DESK/_planning/` system directories
- Per-iteration `planning.md` + `doing.md` + `feedback.md` (work-suite native)

### Lifecycle
- 8-state machine: drafting → processing → validating → collaborating → paused → blocked → done → cancelled
- Checkpoint-type annotations on each transition (GATE / CHECKPOINT / AUTO / CONFIRM / NOTIFY)
- Session start / resumption / archival workflow

### Dispatch
- `work-orchestration` routes tasks through work-suite's four phases (ideator → planner → doer → merger)
- Non-coding workflow paths supported (execution + completion alternatives for non-code work)

### Engineering posture
- `evidence-discipline` — fixtures-or-refusal, smoke-before-infinity, messages-over-models, etc.
- `preflight-actions` — preflight pattern before irreversible actions
- `runtime-symptom-investigation` — narrow-the-hypothesis-space pattern for runtime issues

### PR craft (for coding agents)
- `pr-self-review`, `pr-review-interrogation`, `pr-surface-hygiene` — pre-open and post-open PR discipline
- `peer-pr-review`, `pr-reviewer-audit` — reviewing others' code

### Friction / learning
- `friction-management` — log + encode pain points
- `lesson-capture` (post-task) — agent self-mines for patterns and proposes skill updates

## Convention: `$DESK` placeholder

Skill bodies reference workspace paths via `$DESK`, not literal `~/desk/` or `~/worker-workspace/`. The host agent's preamble declares the binding:

- Microsoft worker: `Your desk: ~/worker-workspace/` (today; flips to `~/desk/` after coordinated workspace rename)
- Slugger (ouroboros): `Your desk: ~/AgentBundles/slugger.ouro/desk/`
- Personal coding agent: whatever the operator declares

The agent does textual substitution when interpreting skill instructions or running shell commands.

## What desk does NOT provide

- **Agent identity** — that's the consumer agent's job (the wrapper agent declares persona, MCP frontmatter, etc.)
- **Doing-phase mechanics** — those live in `work-suite` (work-doer, work-merger, etc.)
- **MS-specific concerns** — EMU GitHub, ADO work items, ECS portals, etc. live in the Microsoft worker plugin

## Versioning

v0.1.0 ships the first cut: 12 lift-and-shift skills + new `lesson-capture` skill. Subsequent waves add Cat 2 skills (extracted from worker with MS-overlay separation) and refinements.
