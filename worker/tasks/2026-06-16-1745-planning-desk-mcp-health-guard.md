## Goal

Make Desk zero-setup robust when the Desk MCP is absent from the active host session, not merely degraded after startup. Agents should naturally notice "Desk tools are missing" and route to Codex onboarding/repair instead of behaving as if durable context is optional.

Host context: `ouroboros-host` / user: `<user>` / cwd: `/Users/<user>/Projects/ouroboros-skills` / OS: `Darwin` / probed: 2026-06-16 17:45 PDT.

## Scope

### In Scope

- Add an explicit Desk MCP health guard to generated Codex worker instructions.
- Mirror the same guard in the static worker agent files so non-generated worker surfaces carry the invariant.
- Update Codex onboarding docs to distinguish MCP absent, MCP running-but-degraded, stale plugin cache, and active session not reloaded.
- Extend the Codex plugin cache audit with optional active MCP tool evidence so `active-session-visible` can be proven when a host/tool-list snapshot is available.
- Add tests for generated instruction text, active-tool pass/fail audit behavior, and docs/fixtures that describe the guard.
- Verify downstream overlays inherit the guard through selected activation instructions rather than copying Desk setup.

### Out of Scope

- Adding a bespoke Desk CLI.
- Changing Codex Desktop host internals.
- Reworking the Desk MCP server protocol.
- Publishing a new plugin release.
- Changing embedding/vector-pack policy beyond preserving the existing artifact story.

## Completion Criteria

- Generated `global-personal` and `project-local` Codex instructions tell agents to check for expected Desk MCP tools, including `desk_status`, before treating session start as healthy.
- Static `worker.md` and `worker.toml` contain the same "missing Desk MCP tool surface" repair invariant.
- `desk:codex-onboarding` gives a deterministic repair path for:
  - Desk skills present but Desk MCP tools absent.
  - Desk MCP tools present but `desk_status` reports degraded local index/vector/snapshot state.
  - Repo/cache manifests current but active session has not reloaded.
  - User-authored manual opt-out.
- `scripts/audit-codex-plugin-cache.cjs` still checks repo-source and installed-cache states read-only by default.
- The audit accepts `--active-tools` and `--active-tools-file` snapshots and reports pass/fail for active-session visibility.
- `--strict-active` exits non-zero when required Desk tools are missing from a provided active-tool snapshot.
- Codex activation renders plugin ids with the selected marketplace namespace, including local development namespaces such as `ourostack-local`.
- Selecting a downstream overlay enables that overlay's plugin dependencies in generated Codex config while preserving a single Desk MCP server.
- Tests cover unprefixed and MCP-prefixed tool names, JSON active-tool files, stale/missing active tools, and unchanged default `not_checked` behavior.
- Existing Desk MCP activation tests and skill validation still pass.
- Harsh reviewer gates converge with no BLOCKER/MAJOR findings.

## Code Coverage Requirements

- Add targeted Node tests for the Codex cache audit active-tool logic.
- Update Codex activation fixture tests to assert the generated MCP guard text.
- Run the relevant Desk MCP test files directly.
- Run `npm run test:coverage` in `plugins/desk/mcp`.
- Run `node scripts/validate-skills.cjs`.

## Open Questions

- None requiring human judgment. The operator explicitly asked for global/default behavior with opt-out and asked worker to take control until gaps are closed.

## Decisions Made

- Treat this as an autopilot/no-human-gates continuation because the operator explicitly objected to returning control while gaps remain.
- Keep the solution host-native: no bespoke CLI and no manual `codex mcp add` path on the happy path.
- Use an optional active-tool snapshot in the read-only audit, matching the existing Work Suite active-skill audit pattern.
- Make the generated instruction guard concrete enough that a future agent can act even when `desk_status` itself is unavailable.
- Treat marketplace namespace and overlay plugin enablement as first-class activation behavior rather than documentation-only promises.

## Context / References

- `plugins/desk/agents/worker.md`
- `plugins/desk/agents/worker.toml`
- `plugins/desk/skills/codex-onboarding/SKILL.md`
- `plugins/desk/mcp/src/activation/adapters/codex.js`
- `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`
- `plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-instructions.md`
- `plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-instructions.md`
- `scripts/audit-codex-plugin-cache.cjs`
- `plugins/desk/mcp/__tests__/scripts/codex_plugin_cache_audit.test.js`
- `scripts/audit-work-suite-runtime.cjs`

## Notes

- The current Codex session exposes several Desk MCP tools but not `desk_status`, which proves the core issue is real: agents need to recognize partial/missing tool surfaces before relying on MCP-based status.
- `desk_status` is still the correct degraded-state tool once the MCP server is loaded.
- Active session visibility is not a filesystem fact; the audit can only verify it when the host provides a current tool-list snapshot.

## Progress Log

- 2026-06-16 17:45 Created planning doc and initial gap inventory.
- 2026-06-16 17:58 Expanded scope after harsh reviewer blockers on namespace handling and downstream overlay dependency enablement.
