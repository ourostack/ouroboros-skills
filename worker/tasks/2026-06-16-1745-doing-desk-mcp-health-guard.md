## Execution Mode

direct

## Planning Reference

- `worker/tasks/2026-06-16-1745-planning-desk-mcp-health-guard.md`

## Units

### [ ] Unit 1: Add active Desk MCP tool evidence to Codex cache audit

What:
- Extend `scripts/audit-codex-plugin-cache.cjs` with required Desk tool names.
- Add `--active-tools`, `--active-tools-file`, and `--strict-active`.
- Normalize common host prefixes such as `mcp__desk.` and `mcp__desk__`.

Output:
- Audit JSON reports `active_session` with provided/status/present/missing/guidance.
- Existing plugin-level `active_session_visible` remains `not_checked` unless active evidence is supplied.

Acceptance:
- Tests fail before implementation for missing active tools.
- Tests pass for full, prefixed, and file-provided active tool snapshots.

### [ ] Unit 2: Add worker startup health guard

What:
- Update Codex generated instructions in `plugins/desk/mcp/src/activation/adapters/codex.js`.
- Update generated instruction fixtures.
- Update static `plugins/desk/agents/worker.md` and `plugins/desk/agents/worker.toml`.

Output:
- Worker instructions explicitly say expected Desk MCP tools, especially `desk_status`, must be visible before treating session start as healthy.
- Missing tools route to `desk:codex-onboarding`/host repair and fresh session guidance.

Acceptance:
- Codex activation tests assert the guard in generated instructions.
- No manual copy/MCP registration language is introduced.

### [ ] Unit 3: Document absent-vs-degraded repair behavior

What:
- Update `plugins/desk/skills/codex-onboarding/SKILL.md`.
- Update `plugins/desk/README.md`, `plugins/desk/activation/README.md`, and `plugins/desk/docs/agent-files.md`.

Output:
- Docs distinguish repo-source-current, installed-cache-current, active-session-visible, MCP absent, and MCP degraded.
- Downstream overlay inheritance behavior is explicit.

Acceptance:
- Docs tell consumer plugin authors to inherit Desk's guard rather than copy setup.
- Docs preserve the no-bespoke-CLI/no-manual-MCP healthy path.

### [ ] Unit 4: Reviewer gates and verification

What:
- Run harsh sub-agent review on gap coverage and implementation.
- Run targeted tests and coverage.
- Address BLOCKER/MAJOR findings.

Output:
- Reviewer findings captured in the progress log or artifacts.
- Test output captured in adjacent artifacts directory if needed.

Acceptance:
- No unresolved BLOCKER/MAJOR findings.
- `npm run test:coverage` passes in `plugins/desk/mcp`.
- `node scripts/validate-skills.cjs` passes.

## Progress Log

- 2026-06-16 17:45 Created doing doc from planning doc.
