# Codex Smoke Evidence

Status: NEEDS_IMPLEMENTATION

## Codex CLI Activation Smoke

Status: FAIL

This artifact is the Unit 10d red contract for the future Codex smoke harness.
The implementation must record a passing `codex exec --json` run launched with
a temp `CODEX_HOME`, a temp `HOME`, and `DESK` under the temp host root.

Required proof:

- `CODEX_HOME` and `HOME` point under the temp host root.
- The new session loaded `CODEX_HOME/AGENTS.md`.
- The combined instructions include `You are the desk worker by default.`
- The combined instructions include `desk:session-start`.
- The available tools include `desk_status`.
- A `desk_status` call returns `status: ok` and the expected temp Desk root.
- The healthy path does not use imperative MCP registration.
- The healthy path does not copy a custom agent file into a host agents directory.
- The healthy path does not perform uncontrolled AGENTS edits.

Official documentation anchors used for the contract:

- https://developers.openai.com/codex/cli/reference#codex-exec
- https://developers.openai.com/codex/config-reference#configtoml
- https://developers.openai.com/codex/guides/agents-md

## Codex Desktop App Activation Surface

Status: FAIL

The implementation must either add a real Codex Desktop App activation smoke
artifact, or update the Codex support-matrix row with the exact unsupported
primitive `codex-desktop-scriptable-activation-smoke` and fallback behavior.

Official documentation anchors used for the contract:

- https://developers.openai.com/codex/cli/reference#codex-app
- https://developers.openai.com/codex/cli/reference#codex-app-server
- https://developers.openai.com/codex/app-server

