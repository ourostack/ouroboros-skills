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
    work-planner/            # Interactive task planner
      SKILL.md
    work-doer/               # Task executor with strict TDD
      SKILL.md
    work-merger/             # Sync-and-merge after execution
      SKILL.md
    video-editing/           # Remotion-based video production
      SKILL.md
```

Each skill lives in its own directory under `skills/` and contains a `SKILL.md` file with YAML frontmatter (`name`, `description`) followed by the skill's workflow instructions.

## Discovering Skills

The [`manifest.json`](manifest.json) file at the repo root is the machine-readable index. It lists every skill with its name, file path, description, and tags. Agents can fetch it at:

```
https://raw.githubusercontent.com/ouroborosbot/ouroboros-skills/main/manifest.json
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
| **work-planner** | Interactive task planner. Generates planning docs with human conversation. |
| **work-doer** | Executes doing.md units sequentially with strict TDD. |
| **work-merger** | Sync-and-merge agent. Creates PRs, waits for CI, merges to main. |
| **video-editing** | Build and edit videos using Remotion with kinetic typography and VO-synced timing. |
