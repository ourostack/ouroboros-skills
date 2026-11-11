<!-- ourostack:brand:start -->
<p align="center">
  <a href="https://github.com/ourostack"><img src="https://raw.githubusercontent.com/ourostack/.github/main/brand/headers/ouroboros-skills.webp" alt="Ouro handing a ribboned scroll from a bookcase of skills to a small robot while another robot reads" width="100%"></a>
</p>
<!-- ourostack:brand:end -->

# Ouroboros skills

**Skills that teach Ouro agents whole workflows, from planning a task to shipping it.**

[ouroboros.bot/lab](https://ouroboros.bot/lab/) · [`manifest.json`](manifest.json) · [All skills](#available-skills) · [More from Ouro](https://github.com/ourostack)

Start here: give your agent [`skills/skill-management/SKILL.md`](skills/skill-management/SKILL.md). With it, the agent can browse `manifest.json` and install the rest itself.

Shared skill repository for the Ouroboros agent ecosystem. Skills are reusable instruction sets (stored as `SKILL.md` files) that teach agents how to perform specific workflows -- from task planning and execution to video editing and repository management.

Any agent with the **skill-management** skill installed can browse, install, update, and contribute skills from this repo.

## Repository Structure

```
ouroboros-skills/
  manifest.json              # Machine-readable index of all skills
  README.md
  skills/
    skill-management/        # Bootstrap skill for managing other skills
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
| **core-meeting-capture** | Source-backed substantive meeting recaps and transcript-guided visual evidence; provider access stays in thin adapters. |
| **ouro-check** | Deterministic design, layout, accessibility, jank and HTTPS findings for any site, read as JSON instead of screenshots. |
| **dragon-hunt** | Adversarial end-to-end bug hunt across product, backend, auth, data, integrations, MCP/agent surfaces, and deployment assumptions. |
| **design** | Design and build production-grade frontend interfaces from scratch. |
| **frontend-design** | Create distinctive, production-grade frontend interfaces with high design quality. |
| **build-native-apple-app** | Plan, build, audit, and ship native Apple apps for iOS, iPadOS, macOS, watchOS, tvOS, and visionOS. |
| **seo-titles** | Write HTML title tags that rank and get clicked. |
| **book-fetch** | Search for ebooks on libgen, download EPUBs, and optionally deliver them to an e-reader or Calibre library. |
| **video-editing** | Build and edit videos using Remotion with kinetic typography and VO-synced timing. |
| **word-docs** | Convert markdown drafts into shareable Word documents using a bundled helper script. |
| **product-cloner** | Clone an existing app's look, feel, and behavior from shipped source as ground truth. |

## What moved

Plugins are how we share agent capabilities now. This repository's plugin copies are gone:

- **Desk, Crew and Plain Language** moved to [`ourostack/desk`](https://github.com/ourostack/desk), which ships them as plugins: `github:ourostack/desk:plugins/desk`, `…:plugins/crew` and `…:plugins/plain-language`. The copies here had fallen behind (Desk 3.2.2 here, against 3.2.84 there).
- **Work Suite** (`work-ideator`, `work-planner`, `work-doer`, `work-merger`, `autopilot` and the rest), its pinned **Ponytail** upstream and its companions (`anneal`, `full-systems-audit`, `deep-research`, `inch-worm`, `stay-in-turn`, `watchdog-mode`, `visual-qa-dogfood`) are retired. Desk retired them in favour of Superpowers' process skills ([Desk's small removals](https://github.com/ourostack/desk/blob/main/docs/roadmap/small-removals.md)), and we ship small increments on `main` instead of planning and doing milestones.
- **`draining-issues`** lives in Desk ([`plugins/desk/skills/draining-issues`](https://github.com/ourostack/desk/tree/main/plugins/desk/skills/draining-issues)); the copy here was byte-identical.

`workbench-operator` is retired with Ouro Workbench, which is superseded. This repository's old `desk/` and `worker/` task folders are gone too; Git history keeps them.

New work goes to the plugin that owns it, not here. The skills still listed above are moving into plugins next.
