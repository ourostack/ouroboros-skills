# session-start-migrations — plugin-author quick reference

This skill is a framework. The framework lives here in `desk`; the actual migrations live in each plugin's `migrations/` dir.

## Adding a migration to your plugin

Drop a file at `<your-plugin-root>/migrations/<NN>-<slug>.md`. Pick the next available `NN` across every active plugin (alphabetical sort by filename gives global ordering — coordinate by reading current migrations on `main` before picking a number). The slug is short kebab-case describing what the migration does (e.g. `workspace-to-ms-desk`, `plugin-rename-worker-to-ms-desk`).

The file has YAML frontmatter (`id`, `description`, `safety`, `needs_restart`) and four required body sections — each a level-2 heading followed by a fenced bash code block: `## Detect`, `## Safety check`, `## Migrate`, `## Announce`. The first three contain bash that exits 0/non-zero; the fourth is plain text shown to the operator on success. See `SKILL.md` in this directory for the full schema and driver semantics.

## Design choices worth knowing

The framework deliberately has no central "I ran this" marker — each `Detect` block is responsible for inspecting actual machine state (a dir's existence, a symlink's target, a config file's value) and answering "does this machine need this migration?" That makes the system robust against restored backups, partial Time Machine snapshots, and any other path where a marker file could desync from reality. The cost is that every Detect block runs on every session start; the upside is that there's no marker file to maintain or migrate when the framework itself changes shape.

The framework lives in the `desk` substrate plugin, not in any overlay like `ms-desk`. Overlays can rename themselves (and historically have); a migration framework hosted inside the overlay being renamed has to rename itself mid-execution, which is fragile. Substrate-resident means the framework survives any overlay churn.
