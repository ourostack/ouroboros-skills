---
name: codex-onboarding
description: Install and verify the desk plugin under Codex, including the local marketplace entry, `$DESK` workspace binding, desk MCP server, companion work-suite plugin, and the `worker` agent layer (AGENTS.md default-behavior path OR subagent TOML path).
---

# Codex onboarding

Use this when a Codex agent needs to install or repair desk support on a machine.

## Target shape

- Local workspace: `$DESK`, commonly `~/desk` for a personal Codex workspace.
- Local plugin source: `~/plugins/desk`.
- Companion workflow plugin: `~/plugins/work-suite`.
- Local marketplace: `~/.agents/plugins/marketplace.json`.
- Codex config has:
  - a local marketplace entry pointing at the home directory.
  - `desk@<marketplace-name>` enabled.
  - `work-suite@<marketplace-name>` enabled.
  - an MCP server named `desk` that launches `node ~/plugins/desk/mcp/index.js --root "$DESK"`.
- The `worker` agent layer installed via one or both paths:
  - **Default behavior** (recommended): the canonical body appended to `~/.codex/AGENTS.md` so every Codex session reads the desk substrate as always-on context.
  - **Explicit subagent** (power-user): `~/.codex/agents/worker.toml` for `/agent worker` invocation.

Codex plugin and MCP changes generally require a new Codex session before the tools and skills appear in the active tool list.

## Install or repair

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

3. Ensure `~/.agents/plugins/marketplace.json` includes `desk` and `work-suite` with local paths under `./plugins/`.

4. Ensure `~/.codex/config.toml` has a local marketplace entry:

```toml
[marketplaces.ourostack-local]
source_type = "local"
source = "/Users/<operator>"

[plugins."desk@ourostack-local"]
enabled = true

[plugins."work-suite@ourostack-local"]
enabled = true
```

5. Register the desk MCP server:

```bash
codex mcp add desk -- node "$HOME/plugins/desk/mcp/index.js" --root "$DESK"
```

If `desk` already exists, inspect it with `codex mcp get desk`; remove and re-add only when it points at the wrong plugin path or workspace root.

6. Verify:

```bash
cd "$HOME/plugins/desk/mcp" && npm test && npm audit --omit=dev
codex mcp get desk
```

For an end-to-end stdio smoke, list the server's tool surface:

```bash
cd "$HOME/plugins/desk/mcp" && node --input-type=module <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const root = process.env.DESK || `${process.env.HOME}/desk`
const client = new Client({ name: "desk-smoke", version: "0.0.0" }, { capabilities: {} })
const transport = new StdioClientTransport({
  command: "node",
  args: [`${process.env.HOME}/plugins/desk/mcp/index.js`, "--root", root],
  stderr: "pipe",
})

await client.connect(transport)
const tools = await client.listTools()
console.log(tools.tools.map((tool) => tool.name).sort().join("\n"))
await client.close()
EOF
```

The active Codex session will not gain new plugin skills retroactively. Restart Codex or open a fresh session to confirm that `desk` and `work-suite` appear in the available plugins/skills list.

## 7. Install the `worker` agent layer

Codex plugins ship skills + MCP + apps + hooks per the plugin schema, but cannot ship subagents or AGENTS.md content directly — the agent layer is user-installed. Pick the path that matches the use case.

**Path A — default behavior (recommended).** Codex itself behaves like `worker` in every session. Append the canonical body to `~/.codex/AGENTS.md`:

```bash
# Strip the YAML frontmatter (between the first two --- lines) and append.
awk '/^---$/{c++; next} c>=2' "$HOME/plugins/desk/agents/worker.md" >> "$HOME/.codex/AGENTS.md"
```

If `~/.codex/AGENTS.md` already contains the body (e.g. a prior install), de-duplicate by trimming the older copy first. The appended body uses `$DESK` placeholders that the consumer agent's preamble resolves at use time.

**Path B — explicit subagent.** Spawn `worker` on demand via `/agent worker` while keeping Codex's default behavior unchanged:

```bash
mkdir -p "$HOME/.codex/agents"
cp "$HOME/plugins/desk/agents/worker.toml" "$HOME/.codex/agents/worker.toml"
```

Paths A and B compose. AGENTS.md = default behavior every session. TOML = isolated subagent session on demand.

Verify Path B is registered:

```bash
codex /agents list  # should include 'worker'
```

(Path A is verified implicitly — the next session reads the appended AGENTS.md and behaves like worker.)

## Friction rule

If onboarding reveals a missing Codex instruction, broken manifest, stale path convention, or dependency trap, patch the plugin source first and then reinstall locally from that patched source. A desk that future agents cannot reliably enter is not finished.
