# session-start-migrations — plugin-author quick reference

This skill is a framework. The framework lives here in `desk`; the actual migrations live in each plugin's `migrations/` dir.

## Adding a migration to your plugin

Drop a file at `<your-plugin-root>/migrations/<NN>-<slug>.md`. Pick the next available `NN` across every active plugin (alphabetical sort by filename gives global ordering — coordinate by reading current migrations on `main` before picking a number). The slug is short kebab-case describing what the migration does (e.g. `workspace-to-ms-desk`, `plugin-rename-worker-to-ms-desk`).

The file has YAML frontmatter (`id`, `description`, `safety`, `needs_restart`) and four required body sections — each a level-2 heading followed by a fenced bash code block: `## Detect`, `## Safety check`, `## Migrate`, `## Announce`. The first three contain bash that exits 0/non-zero; the fourth is plain text shown to the operator on success. See `SKILL.md` in this directory for the full schema and driver semantics.

**Two hard constraints worth saying upfront:**

- **The `id` frontmatter must match the filename stem.** A file named `01-workspace-to-ms-desk.md` must declare `id: 01-workspace-to-ms-desk`. The driver uses `id` in announcements and logging; a mismatch corrupts the operator's view of which migration is running.
- **Your `Detect` block must self-evidence from machine state.** Inspect what's on disk right now — `[ -d ~/old-dir ]`, `[ -L ~/some-symlink ] && readlink ~/some-symlink | grep -q old-target`, `grep -q 'old-value' ~/.config/some-file`. Do NOT rely on any external marker. See the worked example below.

## Worked example — a path-rename migration

This is `01-workspace-to-ms-desk.md` (in `desk/migrations/`, shipped alongside this framework):

```markdown
---
id: 01-workspace-to-ms-desk
description: Renames the operator's workspace dir from `~/worker-workspace/` or `~/desk/` to `~/ms-desk/` and repoints `~/agency.toml`.
safety: safe
needs_restart: true
---

## Detect

# Migration is needed iff the new path doesn't exist and at least one of the old paths does.
[ ! -d "$HOME/ms-desk" ] && { [ -d "$HOME/worker-workspace" ] || [ -d "$HOME/desk" ]; }

## Safety check

# Refuse if there's uncommitted work in whichever old dir exists — never sweep-stage.
OLD=""
[ -d "$HOME/desk" ] && OLD="$HOME/desk"
[ -d "$HOME/worker-workspace" ] && OLD="$HOME/worker-workspace"
if [ -n "$(git -C "$OLD" status --porcelain 2>/dev/null)" ]; then
  echo "Uncommitted work in $OLD; please commit or stash, then restart the session."
  exit 1
fi
exit 0

## Migrate

OLD=""
[ -d "$HOME/desk" ] && OLD="$HOME/desk"
[ -d "$HOME/worker-workspace" ] && OLD="$HOME/worker-workspace"
git -C "$OLD" remote set-url origin https://github.com/$(git -C "$OLD" config user.email | cut -d@ -f1)_microsoft/desk.git 2>/dev/null || true
mv "$OLD" "$HOME/ms-desk"
if [ -L "$HOME/agency.toml" ]; then
  rm "$HOME/agency.toml"
  ln -s "$HOME/ms-desk/agency.toml" "$HOME/agency.toml"
fi

## Announce

I detected this machine still had `~/worker-workspace/` or `~/desk/` from the pre-2026-05-22 rename. I ran the cutover:
- mv the old dir → `~/ms-desk/`
- repointed `~/agency.toml` symlink
- updated git remote URL to canonical name

Please start a new session so my preamble loads against `~/ms-desk/`.
```

Three things this example demonstrates:

- **Detect is a pure predicate** — one bash conjunction, no side effects, returns 0 if-and-only-if migration is needed
- **Safety check prints its reason on failure** — operator reads the message and knows exactly what to clean up
- **Migrate is idempotent** — re-running converges (the `OLD` lookup picks whichever path still exists; once `~/ms-desk/` exists and the old ones don't, Detect returns non-zero and the migration is skipped silently forever)

## Design choices worth knowing

The framework deliberately has no central "I ran this" marker — each `Detect` block is responsible for inspecting actual machine state (a dir's existence, a symlink's target, a config file's value) and answering "does this machine need this migration?" That makes the system robust against restored backups, partial Time Machine snapshots, and any other path where a marker file could desync from reality. The cost is that every Detect block runs on every session start; the upside is that there's no marker file to maintain or migrate when the framework itself changes shape.

The framework lives in the `desk` substrate plugin, not in any overlay like `ms-desk`. Overlays can rename themselves (and historically have); a migration framework hosted inside the overlay being renamed has to rename itself mid-execution, which is fragile. Substrate-resident means the framework survives any overlay churn.
