---
name: codex-onboarding
description: Verify Codex Desk alpha activation, including the selected Superpowers provider, owned MCP bridge and instruction block, runtime dependencies and Desk binding.
---

# Codex onboarding

Invoke `desk:superpowers-integration` for the selected method and compatibility boundary. Preserve operator-owned instructions; reject an enabled competing lifecycle instead of rewriting the operator's configuration. Manual-only remains an intentional opt-out.

Use this when a Codex agent needs to verify or repair Desk activation on a machine.

## Target shape

- Local workspace: `$DESK`, commonly `~/desk` for a personal Codex workspace.
- Desk and Superpowers are installed or exposed through the host's plugin loading surface.
- Codex config has:
  - an admitted alpha plugin source that exposes Desk and Superpowers.
  - `desk@<marketplace-name>` enabled.
  - `superpowers@<marketplace-name>` enabled, with no active Work Suite lifecycle.
  - an activation-owned Desk MCP bridge that launches Desk's bundled MCP entrypoint with the activation config.
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

1. For an authorized alpha repair, use the host's admitted source checkout, not a canonical main checkout or stale plugin snapshot. Keep existing profiles unchanged unless repairing them is in scope. The common Codex implicit marketplace is `~/.agents/plugins/marketplace.json`; local paths are resolved relative to `$HOME`. The source-shape example below must refer to the admitted alpha checkout:

```json
{
  "name": "ourostack",
  "plugins": [
    {
      "name": "desk",
      "source": { "source": "local", "path": "./Projects/ouroboros-skills/plugins/desk" }
    },
    {
      "name": "superpowers",
      "source": { "source": "local", "path": "./Projects/ouroboros-skills/plugins/superpowers" }
    },
    {
      "name": "plain-language",
      "source": { "source": "local", "path": "./Projects/ouroboros-skills/plugins/plain-language" }
    },
    {
      "name": "ponytail-upstream",
      "source": { "source": "local", "path": "./Projects/ouroboros-skills/plugins/ponytail-upstream" }
    }
  ]
}
```

Avoid stale copies of Desk, Superpowers and companion plugins. A cache or source label alone does not prove the active artifact; inspect the selected loaded roots and content identity.

2. Ensure the selected source includes `desk`, `superpowers`, `plain-language` and `ponytail-upstream`. Use its actual marketplace namespace, not a hard-coded label. The selected source must be the admitted alpha artifact, not a canonical main checkout substituted because it is convenient.

Run the source/cache/implicit-marketplace audit after repairs:

```bash
node "${ALPHA_SOURCE:?Select the admitted alpha source}/scripts/audit-codex-plugin-cache.cjs" --repo-root "$ALPHA_SOURCE" --plugins desk,superpowers,plain-language,ponytail-upstream --strict
```

This read-only audit explicitly selects the alpha plugin set; its omitted-option default remains the legacy set. It checks source, cache and host-marketplace metadata, not method-following behavior. Add the selected consumer plugins to that explicit list when auditing an overlay. Cache metadata alone does not establish active-session source identity.

3. Ensure `~/.codex/config.toml` has an owned Desk activation block equivalent to the adapter output for the selected mode:

```toml
[marketplaces.ourostack-local]
source_type = "local"
source = "/Users/<operator>"

[plugins."desk@ourostack-local"]
enabled = true

[plugins."superpowers@ourostack-local"]
enabled = true

[plugins."plain-language@ourostack-local"]
enabled = true

[plugins."ponytail-upstream@ourostack-local"]
enabled = true

[plugins."desk@ourostack-local".mcp_servers.desk]
enabled = true
default_tools_approval_mode = "prompt"

[mcp_servers.desk]
command = "node"
args = ["/Users/<operator>/.codex/plugins/cache/ourostack-local/desk/<version>/mcp/index.js", "--activation-config", "/Users/<operator>/.codex/desk.activation.json"]
enabled = true
default_tools_approval_mode = "prompt"
```

The activation-owned top-level `mcp_servers.desk` bridge is generated by the adapter, not by a user running `codex mcp add`. It points at the installed Desk plugin root and passes `--activation-config`, so `desk_status` can report the selected worker/overlay chain. Keep Desk's bundled `.mcp.json` host-neutral for hosts that correctly resolve plugin-relative MCP entries; Codex global activation still writes the direct bridge because current Codex CLI sessions expose plugin MCP entries without the plugin-root cwd.

4. Do not install MCP dependencies inside the plugin and do not register the MCP manually. The healthy path uses the committed runtime dependency pack and a writable runtime cache. Verify the committed pack instead. Set `DESK_PLUGIN_ROOT` explicitly to the canonical repo-backed Desk source (`$REPO/plugins/desk`) or the installed Codex cache path (`$HOME/.codex/plugins/cache/ourostack/desk/<version>`). Do not use durable `~/plugins` snapshots here; they are exactly the stale-source class this repair path is meant to catch.

```bash
DESK_PLUGIN_ROOT="${DESK_PLUGIN_ROOT:?Set DESK_PLUGIN_ROOT to the repo-backed Desk plugin source or installed Codex cache path; do not use ~/plugins snapshots.}"
cd "$DESK_PLUGIN_ROOT/mcp" && npm run runtime:deps-pack:verify
```

5. For an end-to-end stdio smoke, list the server's tool surface with an explicit temporary runtime cache:

```bash
node --input-type=module <<'EOF'
import { spawn } from "node:child_process"

const root = process.env.DESK || `${process.env.HOME}/desk`
if (!process.env.DESK_PLUGIN_ROOT) {
  throw new Error("Set DESK_PLUGIN_ROOT to the repo-backed Desk plugin source or installed Codex cache path; do not use ~/plugins snapshots.")
}
const mcpRoot = `${process.env.DESK_PLUGIN_ROOT}/mcp`
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

The active Codex session will not gain new plugin skills retroactively. Restart Codex or open a fresh session to confirm that `desk`, `superpowers`, `plain-language`, and `ponytail-upstream` appear in the available plugins/skills list.

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
