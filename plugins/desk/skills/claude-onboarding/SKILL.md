---
name: claude-onboarding
description: Install and verify the desk plugin under Claude Code, including the marketplace registration, `$DESK` workspace binding, desk MCP server, and companion work-suite plugin. Mirrors codex-onboarding for the Claude Code harness.
---

# Claude Code onboarding

Use this when a Claude Code session needs to install or repair desk support on a machine.

## Target shape

- Local workspace: `$DESK`, commonly `~/desk` for a personal Claude Code workspace.
- Local plugin source: `~/plugins/desk` (shared with Codex if both agents live here).
- Companion workflow plugin: `~/plugins/work-suite`.
- A Claude-format marketplace manifest covering both plugins — typically at `~/plugins/.claude-plugin/marketplace.json` when sharing on-disk source with Codex, or fetched directly from the upstream `ouroboros-skills` repo's `.claude-plugin/marketplace.json`.
- `~/.claude/plugins/known_marketplaces.json` has the marketplace registered.
- `~/.claude/plugins/installed_plugins.json` has `desk@<marketplace>` and `work-suite@<marketplace>` entries.
- `~/.zshrc` (or equivalent shell rc) exports `DESK=/path/to/desk` so the bundled `.mcp.json` resolves the right workspace root.

Claude Code does not retroactively load plugin skills or MCP servers into an active session — a fresh session is required after install.

## Install path A — upstream marketplace (preferred)

If the desk is installing fresh and doesn't yet share `~/plugins/` with another agent:

```
# 1. Register the upstream marketplace
/plugin marketplace add ourostack/ouroboros-skills

# 2. Install both plugins
/plugin install desk@ourostack
/plugin install work-suite@ourostack

# 3. Export $DESK in your shell rc (one-line, idempotent append)
grep -q '^export DESK=' ~/.zshrc || echo 'export DESK="$HOME/desk"' >> ~/.zshrc

# 4. Open a fresh Claude Code session.
```

This relies on the top-level `.claude-plugin/marketplace.json` in the `ouroboros-skills` repo. If the slash command reports the marketplace can't be found, the upstream may not have that manifest yet — fall through to path B.

## Install path B — local marketplace (shared with Codex)

Use this when both Codex and Claude Code consume from the same on-disk plugin source.

1. Clone or copy the plugin directories:

```bash
mkdir -p ~/plugins
rsync -a --delete /path/to/ouroboros-skills/plugins/desk/ ~/plugins/desk/
rsync -a --delete /path/to/ouroboros-skills/plugins/work-suite/ ~/plugins/work-suite/
```

2. Install the desk MCP dependencies:

```bash
cd ~/plugins/desk/mcp && npm install
```

3. Write a Claude-format marketplace manifest at `~/plugins/.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "ourostack-local",
  "description": "Local copy of the ourostack plugin marketplace shared with Codex.",
  "owner": { "name": "ourostack", "url": "https://github.com/ourostack/ouroboros-skills" },
  "plugins": [
    { "name": "desk", "description": "...", "source": "./desk", "category": "productivity" },
    { "name": "work-suite", "description": "...", "source": "./work-suite", "category": "development" }
  ]
}
```

4. Register the marketplace and install both plugins:

```
/plugin marketplace add ~/plugins
/plugin install desk@ourostack-local
/plugin install work-suite@ourostack-local
```

5. Export `$DESK` in your shell rc (see path A step 3).

6. Open a fresh Claude Code session.

## Install path C — direct harness-state edits (fallback)

When the `/plugin` interactive flow is unavailable (e.g. a non-interactive agent self-installing without operator input), edit the harness state directly. This requires that `~/plugins/desk/` and `~/plugins/work-suite/` already exist.

```bash
# Stage marketplace + cache symlinks
mkdir -p ~/.claude/plugins/marketplaces/ourostack-local/.claude-plugin \
         ~/.claude/plugins/marketplaces/ourostack-local/plugins \
         ~/.claude/plugins/cache/ourostack-local/desk \
         ~/.claude/plugins/cache/ourostack-local/work-suite
ln -sfn ~/plugins/.claude-plugin/marketplace.json \
        ~/.claude/plugins/marketplaces/ourostack-local/.claude-plugin/marketplace.json
ln -sfn ~/plugins/desk        ~/.claude/plugins/marketplaces/ourostack-local/plugins/desk
ln -sfn ~/plugins/work-suite  ~/.claude/plugins/marketplaces/ourostack-local/plugins/work-suite
ln -sfn ~/plugins/desk        ~/.claude/plugins/cache/ourostack-local/desk/$(jq -r .version ~/plugins/desk/.claude-plugin/plugin.json)
ln -sfn ~/plugins/work-suite  ~/.claude/plugins/cache/ourostack-local/work-suite/$(jq -r .version ~/plugins/work-suite/.claude-plugin/plugin.json)
```

Then merge entries into `~/.claude/plugins/known_marketplaces.json`:

```json
"ourostack-local": {
  "source": { "source": "local", "path": "/Users/<operator>/plugins" },
  "installLocation": "/Users/<operator>/.claude/plugins/marketplaces/ourostack-local",
  "lastUpdated": "<ISO8601>"
}
```

And into `~/.claude/plugins/installed_plugins.json` (replace `<version>` from each plugin's `plugin.json`):

```json
"desk@ourostack-local": [{
  "scope": "user",
  "installPath": "/Users/<operator>/.claude/plugins/cache/ourostack-local/desk/<version>",
  "version": "<version>",
  "installedAt": "<ISO8601>",
  "lastUpdated": "<ISO8601>"
}],
"work-suite@ourostack-local": [{
  "scope": "user",
  "installPath": "/Users/<operator>/.claude/plugins/cache/ourostack-local/work-suite/<version>",
  "version": "<version>",
  "installedAt": "<ISO8601>",
  "lastUpdated": "<ISO8601>"
}]
```

Then open a fresh Claude Code session.

## Verify

After session restart, expect:

1. Desk skills in the available-skills list: `desk:start-task`, `desk:status`, `desk:session-start`, `desk:friction-management`, `desk:directory-structure`, `desk:lesson-capture`, etc.
2. Work-suite skills (or equivalents) visible: `work-ideator`, `work-planner`, `work-doer`, `work-merger`.
3. The desk MCP tools available, prefixed `mcp__desk__*` (search-notes, get-task, etc.).
4. `$DESK` exported in the current shell: `echo $DESK` should print the desk path.

End-to-end MCP smoke (from the plugin source):

```bash
cd ~/plugins/desk/mcp && npm test
```

If you want to confirm the live MCP surface separately from the test suite, the same stdio handshake works as for Codex onboarding — adapt the snippet in `codex-onboarding`'s verify section.

## Friction rule

If onboarding reveals a missing Claude Code instruction, broken manifest, stale path convention, or dependency trap, patch the plugin source first and reinstall locally from that patched source. A desk that future agents cannot reliably enter is not finished.

## See also

- `codex-onboarding` — the equivalent install/repair playbook under Codex.
- `first-run-bootstrap` — scaffolds `$DESK/` itself when the workspace directory doesn't exist yet.
- `session-start` — the per-session ritual once the plugin is in place.
