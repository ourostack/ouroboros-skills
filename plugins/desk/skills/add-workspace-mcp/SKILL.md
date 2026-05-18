---
name: add-workspace-mcp
description: Add a new MCP to the operator's workspace `agency.toml` so it auto-loads on every agent session via the `~/agency.toml` link. Use when the operator asks to "add an MCP", "configure an MCP", "I want to use the X tool" (where X is an MCP server), or otherwise needs a tool that isn't currently loaded. Covers both agency builtins (under `[mcps.builtins.<alias>]`) and external npm-distributed stdio MCPs (under `[mcps.servers.<alias>]`). Handles the TOML schema choice, the comment convention, the verification step, and the commit-push-relaunch flow.
---

# Add a workspace MCP

Agency loads MCPs from: (1) the agent's frontmatter `mcp-servers:` block (plugin defaults), (2) the operator's workspace `agency.toml` (auto-discovered via the `~/agency.toml` link that session-start creates), and (3) optional `--mcp-config` flag overrides (rarely needed).

This skill governs (2) — the operator's portable, machine-agnostic, git-tracked surface for MCPs they want loaded on every session.

> **Worker users adding org-specific MCPs (Kusto, ADO, Teams, SharePoint, ICM, etc.):** see the worker plugin README + AGENTS.md for the MS MCP inventory + recommended configurations.

## When to invoke

Operator says any of:
- "I want to add an MCP for X" / "add the X MCP" / "configure X"
- "I need access to [tool/service]" where the answer is an MCP
- "What MCPs do I have?" → read-only variant; just read the file and list
- "Remove the X MCP" → inverse; same file, delete the block

If the operator asks about an MCP that's **already in the agent's frontmatter defaults**, they don't need to add it; surface that fact and stop.

## Procedure

### 1. Confirm the `~/agency.toml` link is in place

This is `desk:session-start` Step 4.7's job (symlink → hardlink → copy fallback per platform). Detect current state:

```bash
readlink "$HOME/agency.toml" 2>/dev/null
stat -c '%i' "$HOME/agency.toml" 2>/dev/null
stat -c '%i' "$DESK/agency.toml" 2>/dev/null
diff "$HOME/agency.toml" "$DESK/agency.toml" >/dev/null && echo "content matches"
```

- **Symlink** (readlink returns the workspace path) → ideal; edits propagate.
- **Hardlink** (no readlink output, same inode) → also fine.
- **Copy** (different inode, same content) → degraded. Edit the workspace file directly; next session-start re-syncs.
- **Missing/different** → flag to operator; the workspace edit is still durable, but won't load until the link lands.

### 2. Read the existing `agency.toml`

```bash
cat "$DESK/agency.toml"
```

Pick a non-colliding alias under both `[mcps.builtins.<alias>]` and `[mcps.servers.<alias>]`. Conventions:

- **Builtins**: short, descriptive (`metrics`, `telemetry`). If multiple instances of the same builtin exist, prefix-namespace by purpose: `prod-metrics`, `staging-metrics`.
- **External stdio MCPs**: name after the package's purpose, not the package name. `playwright` not `@playwright/mcp`.

### 3. Pick the schema: builtin (proxied) or servers (raw stdio)

#### A. `[mcps.builtins.<alias>]` — Agency-native MCPs

Use when the MCP is one of agency's **structured builtins**. These take named flags, benefit from Agency's token injection, and emit per-call telemetry.

Discover candidates:

```bash
agency mcp --help          # list all builtins
agency mcp <name> --help   # show args for a specific builtin
```

```toml
[mcps.builtins.example-builtin]
# Added 2026-05-18 — needed for <project> telemetry queries.
type = "example-builtin-type"
service_uri = "<your-cluster>"
```

TOML field names use **snake_case** (e.g., `service_uri` for the CLI's `--service-uri`).

#### B. `[mcps.servers.<alias>]` — external stdio MCPs (npx-distributed)

Use for anything not in agency's builtin list: Playwright, third-party npm packages, anything you'd otherwise launch as `npx -y <pkg> [args]`. Agency launches these directly as stdio MCPs — no proxy layer.

```toml
[mcps.servers.workspace-playwright]
# Added 2026-05-18 — needed for browser-driven flows.
type = "stdio"
command = "npx"
args = ["-y", "@playwright/mcp@latest"]
# optional: env = { KEY = "value" }
```

Use `@<scope>/<name>@latest` or pin a specific version.

#### Why not `[mcps.builtins.<alias>] type = "npx"` for external MCPs?

A silent `trailing_var_arg` trap: agency's spawner appends `--transport http` AFTER the `args` list. The npx subcommand's `[ARGS]...` clap field is `trailing_var_arg = true`, so any non-empty `args` swallows the trailing pair into the package's positional arg list. The proxy stays in stdio mode, never emits an HTTP port, and the harness fails at startup with:

```
Failed to launch proxy for MCP '<alias>': ... cannot parse integer from empty string
```

Works only by accident when `args = []`. `[mcps.servers.<alias>] type = "stdio"` sidesteps it entirely.

### 4. Comment convention — load-bearing

Every entry **must** carry a comment of the form:

```
# Added YYYY-MM-DD — <reason>.
```

Six months later, the operator (or another agent) needs to answer "is this still needed?" without git archaeology. The comment carries the audit trail. Keep reasons concrete (cluster name, project slug, investigation tag) — vague reasons like `# for telemetry` rot.

### 5. Verify the entry loads cleanly

**Schema parse:**

```bash
cd "$DESK" && agency config list
```

Expected: the new entry appears under its section alongside existing entries. If the listing errors out (e.g. `Invalid builtin MCP '<alias>': missing "type" field`), re-read Step 3 / `agency mcp <name> --help`, fix, re-verify.

**Launch-time check** (catches the `trailing_var_arg` trap and other proxy-startup failures `agency config list` won't surface):

```bash
agency claude -a <plugin>:<agent> --print "ack" 2>&1 | grep -iE "failed to launch|ack" | head
```

Expected: a line containing `ack` with **no** `Failed to launch proxy for MCP '<your-alias>'` warning. If you see that warning, the most common cause is putting an npx-distributed MCP under `[mcps.builtins.<alias>] type = "npx"` with package args; move it to `[mcps.servers.<alias>] type = "stdio"`.

### 6. Commit + push to workspace

Standard `desk:git-hygiene` — commit + push immediately so other machines pick up. Message format:

```
agency.toml: add <alias> MCP (<one-line reason>)
```

### 7. Tell the operator about the relaunch

The new MCP loads on the **next** `agency claude` / `agency copilot` launch — agency reads `agency.toml` at agent-load time. The current session's MCP set is fixed.

```
Added [<alias>] to $DESK/agency.toml. Next launch will load it.
```

## Hard rules

- **Never edit the plugin's `agents/<agent>.md` frontmatter to add operator MCPs.** That block is for plugin-default MCPs that ship to every operator. Operator-specific MCPs go in workspace `agency.toml`.
- **Never use the `--mcp-config` flag as a long-term solution.** Workspace `agency.toml` + link is the convention.
- **Never use `[mcps.builtins.<alias>] type = "npx"` for external npm-distributed MCPs.** Use `[mcps.servers.<alias>] type = "stdio"`.
- **Always include the date + reason comment.** No exceptions.
- **Run both verification checks before committing.**

## Cross-references

- `desk:session-start` Step 4.7 — `~/agency.toml` link auto-creation + platform fallback.
- `desk:git-hygiene` — commit + push cadence.
- `agency mcp <name> --help` (CLI) — per-builtin arg surface, source of truth for builtin schema.
