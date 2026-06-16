# Codex Smoke Evidence

Status: PASS

## Codex CLI Activation Smoke

Status: PASS

Command: codex exec --json --ephemeral --cd <temp-workspace>

Harness: `plugins/desk/mcp/src/activation/codex-smoke.js`

Test: `node --test plugins/desk/mcp/__tests__/activation/codex_smoke.test.js`

Temp profile proof:

- CODEX_HOME: PASS
- HOME: PASS
- DESK: PASS
- No real Codex config touched: PASS

Activation artifact proof:

- Temp `CODEX_HOME/config.toml` is materialized before the Codex runner starts.
- Temp `CODEX_HOME/AGENTS.md` is materialized before the Codex runner starts.
- The generated config enables `plugins."desk@ourostack"` and `plugins."desk@ourostack".mcp_servers.desk`.
- The generated instructions include `You are the desk worker by default.`
- The generated instructions include `desk:session-start`.

Runtime proof:

- The smoke result reports `CODEX_HOME/AGENTS.md` in instruction sources.
- The smoke result reports `desk_status` in available tools.
- The smoke result includes a `desk_status` response with `status: ok`.
- The `desk_status` root path is the temp Desk root.
- The runtime proof reports source-mirror loading.

Manual setup proof:

- No `codex mcp add` healthy-path step.
- No copied custom agent file under a host agents directory.
- No uncontrolled AGENTS append/copy/edit.

Official documentation anchors used for the contract:

- https://developers.openai.com/codex/cli/reference#codex-exec
- https://developers.openai.com/codex/config-reference#configtoml
- https://developers.openai.com/codex/guides/agents-md

## Codex Desktop App Activation Surface

Status: UNSUPPORTED

Unsupported primitive: codex-desktop-scriptable-activation-smoke

Fallback: Codex Desktop lacks a stable scriptable activation-smoke primitive; use temp-profile Codex CLI `codex exec --json` smoke plus owned global/project activation artifacts, with experimental app-server protocol evidence as the fallback when Desktop automation is needed.

Rationale:

- The documented `codex app` command opens Codex Desktop on a workspace path; it is not a stable activation-smoke API that returns loaded instructions or MCP tool state.
- The documented `codex app-server` and debug app-server flows are experimental local protocol surfaces and can be used for deeper automation evidence, but they are not the Desktop App launch primitive itself.
- The support matrix records the exact unsupported primitive and points back to this evidence artifact.

Official documentation anchors used for the contract:

- https://developers.openai.com/codex/cli/reference#codex-app
- https://developers.openai.com/codex/cli/reference#codex-app-server
- https://developers.openai.com/codex/app-server
