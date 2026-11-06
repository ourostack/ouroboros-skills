# desk

a quiet room for a long-running agent's work — the universal substrate underneath whichever overlay (ms-worker, slugger, a personal coding agent) sits on top.

the desk is where the agent does its thinking and keeps its things. drawers for tracks, manilla envelopes for tasks, a corkboard for friction notes, a small reference shelf for lessons earned. archive lives at the back of the room — still browsable, still mine. the same desk serves every consumer because the layout and ceremonies don't depend on whose desk it is:

- **microsoft worker** (corp engineering with ADO / EMU / ECS / M365) — installs desk underneath, then layers MS-context overlays on top
- **ouroboros agents** (slugger, ouroboros itself, personal long-lived agents) — installs desk into the bundle; declares the desk path in psyche
- **personal coding agents** — installs desk; declares a workspace path in agent preamble

cross-context portability runs on the `$DESK` placeholder convention: each consumer agent's preamble binds `$DESK` to its own workspace directory, and desk skills reference paths via `$DESK` rather than any specific literal. one substrate, many overlays.

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

skill bodies reference workspace paths via `$DESK`, not literal `~/desk/` or `~/worker-workspace/`. the host agent's preamble declares the binding — same skills, different rooms:

- Microsoft worker: `Your desk: ~/worker-workspace/` (today; flips to `~/desk/` after coordinated workspace rename)
- Slugger (ouroboros): `Your desk: ~/AgentBundles/slugger.ouro/desk/`
- Personal coding agent: whatever the operator declares

The agent does textual substitution when interpreting skill instructions or running shell commands.

## what desk does NOT provide

the substrate stays general. the overlay handles everything situational.

- **agent identity** — that's the consumer agent's job (the wrapper agent declares persona, MCP frontmatter, etc.)
- **doing-phase mechanics** — those live in `work-suite` (work-doer, work-merger, etc.)
- **MS-specific concerns** — EMU GitHub, ADO work items, ECS portals, etc. live in the Microsoft worker overlay (one of several possible overlays — others can be built the same way)

## versioning

v0.1.0 ships the first cut: 12 lift-and-shift skills + new `lesson-capture` skill. Subsequent waves add Cat 2 skills (extracted from worker with MS-overlay separation) and refinements.
