---
name: add-workspace-mcp
description: Add a new MCP to the operator's workspace runtime config so it auto-loads on every agent session via the workspace-config link. Use when the operator asks to "add an MCP", "configure an MCP", "I want to use the X tool" (where X is an MCP server), or otherwise needs a tool that isn't currently loaded. Covers both runtime-native builtin MCPs (under `[mcps.builtins.<alias>]`) and external npm-distributed stdio MCPs (under `[mcps.servers.<alias>]`). Handles the TOML schema choice, the comment convention, the verification step, and the commit-push-relaunch flow.
---

# Add a workspace MCP

> This skill assumes a runtime whose workspace MCP config is a TOML
> file at the workspace root (named, by convention, after the runtime
> — e.g. `<runtime>.toml`) and which auto-discovers it via walk-up
> from CWD with a `$HOME`-linked copy as fallback. Runtimes with
> different config conventions need a consumer overlay's equivalent
> skill instead. The examples below use a placeholder filename
> `<runtime>.toml`; substitute your runtime's actual filename.

The runtime loads MCPs from: (1) the agent's frontmatter `mcp-servers:` block (plugin defaults), (2) the operator's workspace `<runtime>.toml` (auto-discovered via the `~/<runtime>.toml` link that session-start creates), and (3) optional `--mcp-config` flag overrides (rarely needed).

This skill governs (2) — the operator's portable, machine-agnostic, git-tracked surface for MCPs they want loaded on every session.

> **Overlay users adding org-specific MCPs (analytics, work-item tracker, chat, document store, incident-management, etc.):** consumer overlays typically ship their own inventory + recommended configurations for the org's MCP servers.

## When to invoke

Operator says any of:
- "I want to add an MCP for X" / "add the X MCP" / "configure X"
- "I need access to [tool/service]" where the answer is an MCP
- "What MCPs do I have?" → read-only variant; just read the file and list
- "Remove the X MCP" → inverse; same file, delete the block

If the operator asks about an MCP that's **already in the agent's frontmatter defaults**, they don't need to add it; surface that fact and stop.

## Startup-safety classification — persistent means boot-critical

Every MCP in agent frontmatter or auto-discovered workspace config is a startup dependency. Some hosts initialize the entire set before delivering the first user prompt and retry failed servers aggressively. A persistent entry that is unavailable can therefore prevent prompt readiness or flood the session before the agent can explain the problem.

Persist an MCP only when its initialization path is available in every environment where the agent is expected to launch. A service that depends on a conditional network, machine-local daemon, optional credential, device class, or other environmental prerequisite belongs behind explicit launch-time enablement unless its launcher can initialize a truthful local diagnostic surface while the downstream is unavailable. That degraded surface may explain the prerequisite and block unavailable tools; it must not turn authentication, authorization, or protocol failures into success-shaped responses.

This applies equally to plugin defaults and operator workspace config: both auto-load before the session is usable. "It works on this machine now" is insufficient. Before persisting an entry, identify the least-capable supported launch environment and prove prompt readiness there; otherwise keep the MCP one-off.

## Procedure

### 1. Confirm the `~/<runtime>.toml` link is in place

This is `desk:session-start` Step 4.7's job (symlink → hardlink → copy fallback per platform). Detect current state:

```bash
readlink "$HOME/<runtime>.toml" 2>/dev/null
stat -c '%i' "$HOME/<runtime>.toml" 2>/dev/null
stat -c '%i' "$DESK/<runtime>.toml" 2>/dev/null
diff "$HOME/<runtime>.toml" "$DESK/<runtime>.toml" >/dev/null && echo "content matches"
```

- **Symlink** (readlink returns the workspace path) → ideal; edits propagate.
- **Hardlink** (no readlink output, same inode) → also fine.
- **Copy** (different inode, same content) → degraded. Edit the workspace file directly; next session-start re-syncs.
- **Missing/different** → flag to operator; the workspace edit is still durable, but won't load until the link lands.

### 2. Read the existing `<runtime>.toml`

```bash
cat "$DESK/<runtime>.toml"
```

Pick a non-colliding alias under both `[mcps.builtins.<alias>]` and `[mcps.servers.<alias>]`. Conventions:

- **Builtins**: short, descriptive (`metrics`, `telemetry`). If multiple instances of the same builtin exist, prefix-namespace by purpose: `prod-metrics`, `staging-metrics`.
- **External stdio MCPs**: name after the package's purpose, not the package name. `playwright` not `@playwright/mcp`.

### 3. Pick the schema: builtin (proxied) or servers (raw stdio)

#### A. `[mcps.builtins.<alias>]` — runtime-native builtin MCPs

Use when the MCP is one of the runtime's **structured builtins**. These take named flags, benefit from the runtime's token injection, and emit per-call telemetry.

Discover candidates via the runtime's MCP-help surface:

```bash
<runtime> mcp --help          # list all builtins
<runtime> mcp <name> --help   # show args for a specific builtin
```

```toml
[mcps.builtins.example-builtin]
# Added 2026-05-18 — needed for <project> telemetry queries.
type = "example-builtin-type"
service_uri = "<your-cluster>"
```

TOML field names use **snake_case** (e.g., `service_uri` for the CLI's `--service-uri`).

#### B. `[mcps.servers.<alias>]` — external stdio MCPs (npx-distributed)

Use for anything not in the runtime's builtin list: Playwright, third-party npm packages, anything you'd otherwise launch as `npx -y <pkg> [args]`. The runtime launches these directly as stdio MCPs — no proxy layer.

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

A silent `trailing_var_arg` trap (specific to runtimes that proxy builtins through an npx wrapper): the spawner appends `--transport http` AFTER the `args` list. The npx subcommand's `[ARGS]...` clap field is `trailing_var_arg = true`, so any non-empty `args` swallows the trailing pair into the package's positional arg list. The proxy stays in stdio mode, never emits an HTTP port, and the harness fails at startup with:

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
cd "$DESK" && <runtime> config list
```

Expected: the new entry appears under its section alongside existing entries. If the listing errors out (e.g. `Invalid builtin MCP '<alias>': missing "type" field`), re-read Step 3 / `<runtime> mcp <name> --help`, fix, re-verify.

**Launch-time prompt-readiness check** (catches the `trailing_var_arg` trap and other startup failures the config-list path won't surface):

```bash
output_file="$(mktemp)"
if <runtime> launch -a <plugin>:<agent> --print "ack" >"$output_file" 2>&1; then
  launch_status=0
else
  launch_status=$?
fi
cat "$output_file"
ack_count="$(grep -icE '^[[:space:]]*ack[[:space:]]*$' "$output_file" || true)"
failure_count="$(grep -icE 'fail(ed|ure|ing)?|error|unauthori[sz]ed|forbidden|permission denied|respawn|retry' "$output_file" || true)"
rm -f "$output_file"
test "$launch_status" -eq 0 &&
  test "$ack_count" -eq 1 &&
  test "$failure_count" -eq 0
```

Expected: exactly one successful `ack`, no startup-failure or respawn lines, and a zero exit status. Inspect the full captured output; do not pipe the live launch through `head`, because a retry loop can appear after the first success-shaped line. Run this check from the least-capable environment the agent is expected to support. If the MCP cannot initialize there, remove the persistent entry and use explicit launch-time enablement instead. If the failure is the `trailing_var_arg` trap, move the npx-distributed MCP from `[mcps.builtins.<alias>] type = "npx"` to `[mcps.servers.<alias>] type = "stdio"`.

### 6. Commit + push to workspace

Standard `desk:git-hygiene` — commit + push immediately so other machines pick up. Message format:

```
<runtime>.toml: add <alias> MCP (<one-line reason>)
```

### 7. Tell the operator about the relaunch

The new MCP loads on the **next** agent launch — the runtime reads `<runtime>.toml` at agent-load time. The current session's MCP set is fixed.

```
Added [<alias>] to $DESK/<runtime>.toml. Next launch will load it.
```

## Hard rules

- **Never edit the plugin's `agents/<agent>.md` frontmatter to add operator MCPs.** That block is for plugin-default MCPs that ship to every operator. Operator-specific MCPs go in workspace `<runtime>.toml`.
- **Never use the `--mcp-config` flag as a long-term solution.** Workspace `<runtime>.toml` + link is the convention.
- **Never use `[mcps.builtins.<alias>] type = "npx"` for external npm-distributed MCPs.** Use `[mcps.servers.<alias>] type = "stdio"`.
- **Treat every persistent MCP as boot-critical.** Conditional dependencies stay behind explicit launch-time enablement unless they can initialize a truthful local diagnostic surface everywhere the agent must boot.
- **Never hide authentication, authorization, or protocol failures behind success-shaped fallbacks.** Prompt readiness does not justify lying about downstream availability.
- **Always include the date + reason comment.** No exceptions.
- **Run both verification checks before committing.**

## Cross-references

- `desk:session-start` Step 4.7 — `~/<runtime>.toml` link auto-creation + platform fallback.
- `desk:git-hygiene` — commit + push cadence.
- `<runtime> mcp <name> --help` (runtime CLI) — per-builtin arg surface, source of truth for builtin schema.
