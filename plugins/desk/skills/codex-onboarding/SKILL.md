---
name: codex-onboarding
description: Verify and repair Codex host-native Desk activation, including plugin source/marketplace exposure, Desk + Work Suite enablement, plugin-scoped Desk MCP, runtime dependency pack health, `$DESK` binding, and owned worker-default activation blocks.
---

# Codex onboarding

Use this when a Codex agent needs to verify or repair Desk activation on a machine.

## Target shape

- Local workspace: `$DESK`, commonly `~/desk` for a personal Codex workspace.
- Desk and Work Suite are installed or exposed through the host's plugin loading surface.
- Codex config has:
  - a marketplace/plugin source that exposes Desk and Work Suite.
  - `desk@<marketplace-name>` enabled.
  - `work-suite@<marketplace-name>` enabled.
  - plugin-scoped Desk MCP enabled from Desk's bundled `.mcp.json`.
- The `worker` agent layer is materialized by an owned activation block:
  - **global-personal** (default): every Codex session reads the desk substrate as always-on context.
  - **project-local**: a repo/session owns its local Desk binding.
  - **manual-only**: Desk remains available without default worker behavior.

Codex plugin and MCP changes generally require a new Codex session before the tools and skills appear in the active tool list.

## Verify or repair

1. If this is a local development install, sync the plugin directories through the host's plugin source. For example, a local marketplace may point at a directory containing both plugins:

```bash
mkdir -p ~/plugins
rsync -a --delete /path/to/ouroboros-skills/plugins/desk/ ~/plugins/desk/
rsync -a --delete /path/to/ouroboros-skills/plugins/work-suite/ ~/plugins/work-suite/
```

2. Ensure the plugin source/marketplace includes `desk` and `work-suite`.

3. Ensure `~/.codex/config.toml` has an owned Desk activation block equivalent to the adapter output for the selected mode:

```toml
[marketplaces.ourostack-local]
source_type = "local"
source = "/Users/<operator>"

[plugins."desk@ourostack-local"]
enabled = true

[plugins."work-suite@ourostack-local"]
enabled = true

[plugins."desk@ourostack-local".mcp_servers.desk]
enabled = true
default_tools_approval_mode = "prompt"
```

The plugin-scoped MCP declaration should come from Desk's bundled `.mcp.json`, whose entrypoint arg materializes `${pluginRoot}/mcp/index.js`. Do not add a separate healthy-path `mcp_servers.desk` entry unless the selected mode intentionally needs a project-local root override.

4. Do not install MCP dependencies inside the plugin and do not register the MCP manually. The healthy path uses the committed runtime dependency pack and a writable runtime cache. Verify the committed pack instead:

```bash
cd "$HOME/plugins/desk/mcp" && npm run runtime:deps-pack:verify
```

5. For an end-to-end stdio smoke, list the server's tool surface with an explicit temporary runtime cache:

```bash
cd "$HOME/plugins/desk/mcp" && node --input-type=module <<'EOF'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const root = process.env.DESK || `${process.env.HOME}/desk`
const client = new Client({ name: "desk-smoke", version: "0.0.0" }, { capabilities: {} })
const transport = new StdioClientTransport({
  command: "node",
  args: [`${process.env.HOME}/plugins/desk/mcp/index.js`, "--root", root],
  env: {
    ...process.env,
    DESK_RUNTIME_CACHE_DIR: `${process.env.HOME}/.cache/ouroboros-skills/desk-smoke`,
  },
  stderr: "pipe",
})

await client.connect(transport)
const tools = await client.listTools()
console.log(tools.tools.map((tool) => tool.name).sort().join("\n"))
await client.close()
EOF
```

The active Codex session will not gain new plugin skills retroactively. Restart Codex or open a fresh session to confirm that `desk` and `work-suite` appear in the available plugins/skills list.

## Worker layer

For `global-personal`, activation owns a delimited `AGENTS.md` block that makes Codex behave like `worker` by default. Repair should replace only the owned block and preserve user-authored instructions. For `manual-only`, the block is absent by design. If an explicit subagent surface is available in the host, it can be layered on separately, but it is not the healthy-path requirement for default worker behavior.

## Friction rule

If onboarding reveals a missing Codex instruction, broken manifest, stale path convention, or dependency trap, patch the plugin source first and then reinstall locally from that patched source. A desk that future agents cannot reliably enter is not finished.
