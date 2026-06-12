# ouroboros-skills

Shared skill repository for the Ouroboros agent ecosystem. Skills are reusable instruction sets (stored as `SKILL.md` files) that teach AI agents how to perform specific workflows -- from task planning and execution to video editing and repository management.

Any agent with the **skill-management** skill installed can browse, install, update, and contribute skills from this repo.

## Repository Structure

```
ouroboros-skills/
  manifest.json              # Machine-readable index of all skills
  README.md
  skills/
    skill-management/        # Bootstrap skill for managing other skills
      SKILL.md
    autopilot/               # Full-delivery execution doctrine
      SKILL.md
    work-ideator/            # Ambiguous-idea exploration before planning
      SKILL.md
    work-planner/            # Reviewer-gated task planner
      SKILL.md
    work-doer/               # Task executor with strict TDD
      SKILL.md
    work-merger/             # Sync-and-merge after execution
      SKILL.md
    inch-worm/               # Open-ended improvement loop
      SKILL.md
    video-editing/           # Remotion-based video production
      SKILL.md
    word-docs/               # Markdown to Word doc conversion
      SKILL.md
      md_to_docx.py
```

Each skill lives in its own directory under `skills/` and contains a `SKILL.md` file with YAML frontmatter (`name`, `description`) followed by the skill's workflow instructions.

## Discovering Skills

The [`manifest.json`](manifest.json) file at the repo root is the machine-readable index. It lists every skill with its name, file path, description, and tags. Agents can fetch it at:

```
https://raw.githubusercontent.com/ourostack/ouroboros-skills/main/manifest.json
```

## Installing a Skill

The **skill-management** skill (`skills/skill-management/SKILL.md`) is the bootstrap skill. Once an agent has it installed, it can self-serve all other skills. The workflow:

1. Fetch `manifest.json` to discover available skills.
2. Fetch the desired skill's `SKILL.md` via raw GitHub URL.
3. Save it to the agent's local skills directory.
4. Track provenance in a local `_registry.json` file.

For full installation, update, and contribution instructions, see [`skills/skill-management/SKILL.md`](skills/skill-management/SKILL.md).

## Contributing a New Skill

1. Fork this repository.
2. Create a new directory: `skills/<your-skill-name>/`
3. Add a `SKILL.md` with YAML frontmatter (`name`, `description`) and clear workflow instructions.
4. Add an entry to `manifest.json`.
5. Open a pull request.

See the **Contribute** section in [`skills/skill-management/SKILL.md`](skills/skill-management/SKILL.md) for detailed guidance.

## Available Skills

| Skill | Description |
|-------|-------------|
| **skill-management** | Browse, install, update, and contribute skills from this repo. |
| **autopilot** | Full-delivery doctrine: no human gates, harsh sub-agent reviewer gates, explicit terminal validation, Arc/resume continuity. |
| **stay-in-turn** | Keep long-running work in the same turn with monitor-style waiting instead of background wakeup deferral. |
| **work-ideator** | Explore ambiguous product, architecture, workflow, or coding ideas before planning. |
| **work-planner** | Reviewer-gated task planner. Generates planning docs and converts to doing docs after the correct gate clears. |
| **work-doer** | Executes doing.md units sequentially with strict TDD. |
| **work-merger** | Sync-and-merge agent. Creates PRs, waits for CI, merges to main. |
| **workbench-operator** | Use Ouro Workbench as the native control room for terminal/TUI agents, Desk mirrors, and boss-agent check-ins. |
| **inch-worm** | Open-ended codebase improvement loop. Seed → fix → log side discoveries → pick next. Each fix is its own PR. |

Work-suite autopilot includes an exit preflight: before an agent reports done, it must verify terminal merge/deploy/install/smoke state, refresh durable state, write down the continuation scan, and start any ready or reviewer-gated next item. This keeps "what's next?" from becoming a manual operator loop.
| **full-systems-audit** | End-to-end repo audit that produces an audit report plus a routed backlog for the rest of the skill ecosystem. |
| **dragon-hunt** | Adversarial end-to-end bug hunt across product, backend, auth, data, integrations, MCP/agent surfaces, and deployment assumptions. |
| **design** | Design and build production-grade frontend interfaces from scratch. |
| **frontend-design** | Create distinctive, production-grade frontend interfaces with high design quality. |
| **seo-titles** | Write HTML title tags that rank and get clicked. |
| **book-fetch** | Search for ebooks on libgen, download EPUBs, and optionally deliver them to an e-reader or Calibre library. |
| **video-editing** | Build and edit videos using Remotion with kinetic typography and VO-synced timing. |
| **word-docs** | Convert markdown drafts into shareable Word documents using a bundled helper script. |
