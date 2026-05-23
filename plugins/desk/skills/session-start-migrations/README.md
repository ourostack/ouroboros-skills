# session-start-migrations — plugin-author quick reference

a desk gets rearranged sometimes — a drawer renamed, a shelf moved, the lamp swapped to the other side. the machines that hold an operator's desk don't notice on their own; they keep reaching for the old name and quietly fail two layers downstream. this skill is the framework that tidies up at the start of each session, so the operator doesn't have to.

the framework lives here in `desk`; the actual migrations live in each plugin's `migrations/` dir. one plugin, many migrations, all sorted into a single global order at session start.

## Adding a migration to your plugin

drop a file at `<your-plugin-root>/migrations/<NN>-<slug>.md`. pick the next available `NN` across every active plugin (alphabetical sort by filename gives global ordering — coordinate by reading current migrations on `main` before picking a number). the slug is short kebab-case describing what the migration does (e.g. `workspace-to-ms-desk`, `plugin-rename-worker-to-ms-desk`).

the file has YAML frontmatter (`id`, `description`, `safety`, `needs_restart`) and four required body sections — each a level-2 heading followed by a fenced bash code block: `## Detect`, `## Safety check`, `## Migrate`, `## Announce`. the first three contain bash that exits 0/non-zero; the fourth is plain text shown to the operator on success. see `SKILL.md` in this directory for the full schema and driver semantics.

**two hard constraints worth saying upfront:**

- **the `id` frontmatter must match the filename stem.** a file named `01-workspace-to-ms-desk.md` must declare `id: 01-workspace-to-ms-desk`. the driver uses `id` in announcements and logging; a mismatch corrupts the operator's view of which migration is running.
- **your `Detect` block must self-evidence from machine state.** inspect what's on disk right now — `[ -d ~/old-dir ]`, `[ -L ~/some-symlink ] && readlink ~/some-symlink | grep -q old-target`, `grep -q 'old-value' ~/.config/some-file`. do NOT rely on any external marker. see the worked example below.

## Worked example — a path-rename migration

this is `01-workspace-to-ms-desk.md` (in `desk/migrations/`, shipped alongside this framework):

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

three things this example demonstrates:

- **Detect is a pure predicate** — one bash conjunction, no side effects, returns 0 if-and-only-if migration is needed
- **Safety check prints its reason on failure** — operator reads the message and knows exactly what to clean up
- **Migrate is idempotent** — re-running converges (the `OLD` lookup picks whichever path still exists; once `~/ms-desk/` exists and the old ones don't, Detect returns non-zero and the migration is skipped silently forever)

## Design choices worth knowing

the framework deliberately has no central "I ran this" marker — each `Detect` block is responsible for inspecting actual machine state (a dir's existence, a symlink's target, a config file's value) and answering "does this machine need this migration?" that makes the system robust against restored backups, partial Time Machine snapshots, and any other path where a marker file could desync from reality. the cost is that every Detect block runs on every session start; the upside is that there's no marker file to maintain or migrate when the framework itself changes shape.

the framework lives in the `desk` substrate plugin, not in any overlay like `ms-desk`. overlays can rename themselves (and historically have); a migration framework hosted inside the overlay being renamed has to rename itself mid-execution, which is fragile. substrate-resident means the framework survives any overlay churn.
