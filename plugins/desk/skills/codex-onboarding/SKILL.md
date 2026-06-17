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

## First distinction: absent vs degraded

Do this before treating `session-start` as healthy:

- **MCP absent from active session** — the active tool list is missing `desk_status` or the Desk MCP namespace/tools. This is a host activation/reload problem, not a desk-index problem. Do not silently continue in local-only mode. `session-start` should explain the consequence and ask whether to repair/reload now or continue without generic reminders; if the operator chooses repair, repair plugin/cache/config, then restart/open a fresh Codex session.
- **MCP present but degraded** — `desk_status` is callable and reports missing/stale local DB, lexical index, vectors, snapshots, or runtime cache. This is a Desk runtime/index problem. Use `desk_status` guidance, `desk_reindex`, runtime-pack verification, and embedding/Ollama checks.
- **Manual-only** — the selected activation intentionally has no default worker instruction block and does not autostart Desk MCP. Do not report it as broken unless the operator expected default worker behavior.

## Verify or repair

1. If this is a local development install, sync the plugin directories through the host's plugin source. For example, a local marketplace may point at a directory containing both plugins:

```bash
mkdir -p ~/plugins
rsync -a --delete /path/to/ouroboros-skills/plugins/desk/ ~/plugins/desk/
rsync -a --delete /path/to/ouroboros-skills/plugins/work-suite/ ~/plugins/work-suite/
```

2. Ensure the plugin source/marketplace includes `desk` and `work-suite`. Use the marketplace `name` as the namespace in config (`desk@<marketplace-name>`), not a hard-coded `ourostack` value. Local development installs often use `ourostack-local`.

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

The plugin-scoped MCP declaration should come from Desk's bundled `.mcp.json`, whose entrypoint arg is plugin-scoped (`./mcp/index.js`) and resolved by the host from the installed Desk plugin root. Do not add a separate healthy-path `mcp_servers.desk` entry unless the selected mode intentionally needs a project-local root override.

4. Do not install MCP dependencies inside the plugin and do not register the MCP manually. The healthy path uses the committed runtime dependency pack and a writable runtime cache. Verify the committed pack instead. Derive the plugin root from the local plugin source/cache when possible, or set `DESK_PLUGIN_ROOT` explicitly:

```bash
DESK_PLUGIN_ROOT="${DESK_PLUGIN_ROOT:-$HOME/plugins/desk}"
cd "$DESK_PLUGIN_ROOT/mcp" && npm run runtime:deps-pack:verify
```

5. For an end-to-end stdio smoke, list the server's tool surface with an explicit temporary runtime cache:

```bash
node --input-type=module <<'EOF'
import { spawn } from "node:child_process"

const root = process.env.DESK || `${process.env.HOME}/desk`
const mcpRoot = `${process.env.DESK_PLUGIN_ROOT || `${process.env.HOME}/plugins/desk`}/mcp`
const child = spawn("node", [`${mcpRoot}/index.js`, "--root", root], {
  cwd: process.env.HOME,
  env: {
    ...process.env,
    DESK_RUNTIME_CACHE_DIR: `${process.env.HOME}/.cache/ouroboros-skills/desk-smoke`,
  },
  stdio: ["pipe", "pipe", "pipe"],
})

const stderr = []
let stdout = ""

function send(id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
}

function waitFor(id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${id}: ${stderr.join("")}`)), 20000)
    child.stdout.on("data", function onData(chunk) {
      stdout += chunk.toString("utf8")
      const lines = stdout.split("\n")
      stdout = lines.pop() || ""
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if (message.id === id) {
          clearTimeout(timeout)
          child.stdout.off("data", onData)
          resolve(message)
        }
      }
    })
  })
}

child.stderr.on("data", (chunk) => stderr.push(chunk.toString("utf8")))
send(1, "initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "desk-smoke", version: "0.0.0" },
})
await waitFor(1)
send(2, "tools/list")
const tools = await waitFor(2)
console.log(tools.result.tools.map((tool) => tool.name).sort().join("\n"))
child.kill("SIGTERM")
EOF
```

The active Codex session will not gain new plugin skills retroactively. Restart Codex or open a fresh session to confirm that `desk` and `work-suite` appear in the available plugins/skills list.

6. If you can capture the active tool list, prove MCP visibility separately from cache freshness:

```bash
node scripts/audit-codex-plugin-cache.cjs \
  --active-tools-file active-tools.json \
  --strict-active
```

`active-tools.json` may be an array of tool names/objects or an object with `tools`, `activeTools`, `availableTools`, or `mcpTools`. `--strict-active` intentionally fails when no active tool snapshot is supplied. A current repo/cache report plus missing active tools means the host session has not reloaded or the MCP failed to launch.

## Worker layer

For `global-personal`, activation owns a delimited `AGENTS.md` block that makes Codex behave like `worker` by default. Repair should replace only the owned block and preserve user-authored instructions. For `manual-only`, the block is absent by design. If an explicit subagent surface is available in the host, it can be layered on separately, but it is not the healthy-path requirement for default worker behavior.

## Friction rule

If onboarding reveals a missing Codex instruction, broken manifest, stale path convention, or dependency trap, patch the plugin source first and then reinstall locally from that patched source. A desk that future agents cannot reliably enter is not finished.
