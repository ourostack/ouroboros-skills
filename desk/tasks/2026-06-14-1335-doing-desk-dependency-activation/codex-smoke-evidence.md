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

Real-process validation:

- Temp-profile direct MCP smoke: PASS. A fresh MCP process launched with `--activation-config ~/.codex/desk.activation.json` exposes 14 tools, including `desk_status`, and resolves the Desk root from activation-config.
- Temp-profile Codex CLI smoke: PASS. A fresh `codex exec --json --ephemeral --strict-config` session calls `desk_status` and reports `status: ok`, `root.source: activation-config`, and `activation.selected_id: desk:worker`.
- Temp-profile worker-instructions smoke: PASS. A fresh `codex exec` session reports the activation-owned global instructions contain the default Desk worker behavior, `desk:session-start`, and the Desk MCP health guard.
- Actual installed-profile Codex CLI smoke: PASS. A fresh ephemeral `codex exec --strict-config` session on this machine calls `desk_status` and reports `status: ok`, `root.source: activation-config`, `activation.selected_id: desk:worker`, `chunks_total: 363`, `vectors_indexed: 363`, `missing_vectors: 0`, and `degraded_modes: []`. The compact machine-readable proof is recorded in `codex-installed-profile-smoke.json`.
- Empty temp profiles may warn that `desk@ourostack` and `work-suite@ourostack` are not installed in that temporary `CODEX_HOME`. That warning is distinct from Desk MCP absence: the activation-owned top-level `mcp_servers.desk` bridge still proves direct MCP startup. The actual installed profile has the plugin entries and the same direct bridge.
- Actual installed-profile warning note: the final `codex exec` run also printed unrelated manifest warnings for an installed `ngs-analysis` plugin outside this repository. Desk and Work Suite plugin manifests did not produce those warnings, and Desk MCP still launched with full vector coverage and no degraded modes.

Personal Desk artifact proof:

- `$DESK` direct updated-source reindex: PASS. Rebuilt `$DESK/.state/desk-index.sqlite` with the updated indexer and verified 38 docs, 363 chunks, 363 active vectors, 0 missing vectors, and 0 null chunk identity fields.
- `$DESK` vector-pack build: PASS. `ari-desk-2026-06-17` wrote 363 rows under `$DESK/artifacts/vector-packs/<embedding-spec-id>/`.
- `$DESK` snapshot build: PASS. `ari-desk-2026-06-17` snapshot includes pack `ari-desk-2026-06-17`, represents 38 docs, and verifies fresh against artifact source scope and document tree.
- `$DESK` artifact validation: PASS. `artifact:validate` reports one vector pack with 363 rows and one fresh snapshot.
- Cold snapshot restore smoke: PASS. A temp clone of `$DESK` without `.state/` restored snapshot `ari-desk-2026-06-17` with `built: false`, `reason: snapshot_restored`, 363 chunks, 363 vectors, 0 missing vectors, and 0 null chunk identity fields while `skipEmbed: true`.
- Cold vector-pack-only smoke: PASS. A temp clone of `$DESK` without `.state/` and without snapshots rebuilt from vector pack `ari-desk-2026-06-17` with live embedding disabled, imported 363 rows, and ended with 363 chunks, 363 vectors, 0 missing vectors, and 0 null chunk identity fields.

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
