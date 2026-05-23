---
name: session-start-migrations
description: Auto-heal a machine's local state when it's stale relative to canonical names (workspace dir renamed, plugin moved, symlink target changed, etc.). Walks every enabled plugin's `migrations/` dir at session start; for each migration whose Detect block fires, runs Safety check + Migrate + Announce, then halts the session for restart. Self-evidencing predicates (no marker file). Used by `desk:session-start` early in its flow, before any path-dependent work.
---

# Session-start migrations

plugins evolve faster than operator machines do. when a plugin renames its canonical workspace dir, moves its on-disk clone, or otherwise changes a name a long-running session expects to find, the affected machine is silently broken until the operator notices a confused error two layers downstream. the cost of "operator notices" climbs steeply with fleet size — across personal machines, headless VMs, and remote fleet hosts, even one wrong default snowballs.

this skill is the auto-heal lane. every plugin can drop `migrations/<NN>-<slug>.md` files into its plugin root. at session start, this skill walks every enabled plugin's `migrations/` dir, runs each migration's `Detect` block, and — for the ones whose Detect fires — runs `Safety check` + `Migrate` + `Announce`, then hard-stops the session for restart so the new preamble loads against canonical paths. small ceremony, run every time, silent on the happy path.

**lives in `desk` (substrate), not in any overlay plugin.** if this framework lived in an overlay (e.g. `ms-desk`), the overlay's own rename migration would have to rename the framework out from under itself mid-execution. substrate-resident means the framework outlives any overlay's identity churn.

**self-evidencing predicates, no marker file.** a migration's `Detect` block answers "is this machine still in the pre-migration state?" by inspecting the actual state — `[ -d ~/old-dir ]`, `[ -L ~/some-symlink ] && readlink ~/some-symlink | grep -q old-target`, etc. there's no "I've already run" cookie that can desync from reality on a restored backup, a partially-restored Time Machine snapshot, or a borrowed home dir. if the predicate says "needed," it's needed; if it says "not needed," it's truly already done.

## When this skill fires

- at the top of `desk:session-start`, before any other path-dependent skill work — specifically before Step 1's prereq probes (which assume `$DESK/` resolves correctly), Step 2's workspace sync, and any of the later scans.
- re-runs on every session start. idempotent: a migration that already ran returns non-zero from its `Detect` block on the next session, so the skill skips it silently.

## Migration file format

Every migration file lives at `<plugin-root>/migrations/<NN>-<slug>.md`. `NN` is a 2-digit sequence within that plugin; the slug is a short kebab-case description. Examples:

```
plugins/desk/migrations/01-workspace-to-ms-desk.md
plugins/ms-desk/migrations/02-plugin-rename-worker-to-ms-desk.md
```

### Frontmatter (YAML)

```yaml
---
id: 01-workspace-to-ms-desk
description: one-liner of what this migration does + when it was added
safety: safe              # only "safe" is implemented today; future values: confirm, manual
needs_restart: true       # after running, halt the session and ask operator to restart
---
```

Field semantics:

- `id` — must match the filename stem. Used in announcements and logging.
- `description` — one line, surfaces in announcement output when something fails.
- `safety` — see the **Safety semantics** section below.
- `needs_restart` — if `true`, after a successful migration the session hard-stops with a "please restart" message. If `false`, the session continues into the next migration / normal session-start flow.

### Body: four required fenced bash code blocks

Each section is a level-2 markdown heading followed by exactly one fenced bash code block.

```
## Detect
<bash that exits 0 if migration is NEEDED on this machine, non-zero otherwise>

## Safety check
<bash that exits 0 if it's SAFE to run the Migrate block right now, non-zero if not (and prints why)>

## Migrate
<bash that performs the migration; should be idempotent against partial runs>

## Announce
<plain text — the message the operator sees after the migration runs successfully>
```

The `## Announce` block is plain markdown text, not a code fence. The driver reads everything between `## Announce` and end-of-file (trimmed) and prints it verbatim.

### Why exactly four sections

each section maps cleanly to one concern:

- **Detect**: "does this machine need the migration?" — pure predicate, no side effects.
- **Safety check**: "is it safe to run RIGHT NOW?" — guards against partial state, mid-flight processes, uncommitted work. prints a human-readable reason on non-zero so the operator knows what to clean up.
- **Migrate**: "do the thing." idempotent against partial runs so a re-invocation after a recovered failure converges.
- **Announce**: "tell the operator what just happened." operator-facing text only; the driver pipes it to stdout after a successful Migrate.

splitting these out means the driver can run Detect cheaply against every migration on every session-start (the common case is "all detects return non-zero, skill exits silently"), surface Safety failures distinct from Migrate failures, and keep the operator-facing announcement separate from the imperative bash.

## Driver flow

1. **discover migrations across every enabled plugin.**
   - walk every plugin root. the skill is engine-agnostic — it queries the filesystem rather than asking the harness — so the same logic works under Claude Code, Copilot CLI, and any future engine.
   - **canonical plugin roots to walk (in order):**
     - `~/.claude/plugins/` — Claude Code's user-level plugin install dir
     - `~/.claude-plugin/plugins/` — older Claude Code convention; check if present
     - `~/.copilot/plugins/` — Copilot CLI's user-level plugin install dir
     - `~/.ouro-cli/plugins/` — ouro daemon's per-machine plugin install dir (relevant when this skill runs in an ouro-agent context)
     - `~/code/<plugin-id>/` and `~/code/<plugin-id>.ouro/` — local dev clones the operator symlinks into a plugin engine (Microsoft engineers frequently develop plugins out of `~/code/`)
     - any plugin root surfaced by `agency plugin list --json` if `agency` is on PATH (parse the JSON; the `path` field gives the install dir per plugin)
   - for each plugin root, the rule is: if a `migrations/` subdir exists, every `*.md` file inside it is a candidate migration. dedupe by absolute path in case the same plugin is found under multiple roots (e.g. installed system-wide AND symlinked from `~/code/`).
   - across plugins, sort the full migration list alphabetically by filename. with the `<NN>-<slug>.md` convention, this gives global ordering by `NN` regardless of which plugin owns each file. (implementation note: sort by the leaf filename, not the full path, so a migration named `02-plugin-rename.md` in plugin B sorts after `01-workspace-to-ms-desk.md` in plugin A.)

2. **for each migration in id-order across all plugins:**
   - parse the frontmatter and the four body code blocks.
   - run **Detect**. exit 0 = migration is needed; non-zero = skip silently.
   - run **Safety check**. exit 0 = safe. non-zero = surface the printed reason to the operator and **hard-stop** (do NOT run Migrate; do NOT continue to subsequent migrations — the operator needs to resolve the safety issue first).
   - run **Migrate**. if it exits non-zero, surface the stdout+stderr and **hard-stop** with a clear "Migration `<id>` failed mid-run; manual intervention needed" message.
   - on Migrate success, print the **Announce** text verbatim.
   - if frontmatter `needs_restart: true`, **hard-stop the session** with a clean "please restart this session" message after the announcement.

3. **after all applicable migrations applied (or none needed)**, continue with normal `desk:session-start` flow.

## Safety semantics

- `safety: safe` — auto-run with announcement. **this is the only value implemented today.**
- `safety: confirm` — would ask the operator before running. not implemented today; if encountered, surface a one-line "migration `<id>` requires `safety: confirm` which is not yet implemented; skipping" and continue.
- `safety: manual` — would just announce that the operator should run something manually. not implemented today; if encountered, surface the announcement and continue without running Migrate.

future implementations of `confirm` and `manual` extend this skill; today's contract is "if it's not `safe`, the driver skips with a clear message."

## Cross-plugin ordering

alphabetical sort across all plugins' migration filenames. plugins coordinate by choosing each new migration's `NN` to lexically reflect intended global order. there's no central registry; the convention is the coordination.

for example, if `desk` ships `01-workspace-to-ms-desk.md` and the overlay plugin then ships `02-plugin-rename-worker-to-ms-desk.md`, sorting by filename gives `01`-then-`02` — even though they live in different plugin roots. subsequent migrations pick `03`, `04`, etc. by convention.

the 2-digit NN handles realistic plugin-lifetime migration counts (up to 99 per migration cohort). if a plugin needs 100+ migrations someday, it switches to a 3-digit prefix and the alphabetical sort still works (because `100-foo` sorts after `099-bar` lexically as well as numerically — as long as everyone agrees on the digit width going forward).

## Restart UX

- "hard-stop" means an explicit error/exit that the engine's skill-invocation harness treats as terminating the current turn cleanly. the exact mechanism depends on the engine — for a skill, this means the agent stops calling more tools and yields to the operator.
- print the **Announce** text first, **then** halt. the operator needs to see what changed before they're told to restart.
- the halt message should tell the operator literally: "Please start a new session so my preamble loads against the migrated paths." operators on multi-host setups may need to restart the session per-host; that's expected — each host needs its own migration pass.

## What this skill does NOT do

- it does NOT touch any centralized registry of "has run" markers. predicates are self-evidencing.
- it does NOT cross-talk between machines. each host runs its own migrations against its own state.
- it does NOT attempt to "preview" a migration. if a migration's Detect returns 0 and Safety is green, the Migrate block runs. migrations are responsible for being idempotent and reversible-where-possible (e.g. by using `mv` rather than `rm` + recreate).
- it does NOT enforce that overlay plugins ship migrations. a plugin with no `migrations/` dir is fine — the skill just finds nothing to do for that plugin.

## Adding a migration (plugin-author quick reference)

see the `README.md` next to this skill for the plugin-author quick reference. the 30-second version: drop `migrations/<NN>-<slug>.md` in your plugin root with the four code blocks above; pick the next available `NN` across all active plugins; mark `safety: safe` and `needs_restart: true` for any path-rename migration.
