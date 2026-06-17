## Execution Mode

direct

## Planning Reference

- `worker/tasks/2026-06-16-1745-planning-desk-mcp-health-guard.md`

## Units

### [x] Unit 1: Add active Desk MCP tool evidence to Codex cache audit

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

### [x] Unit 2: Add worker startup health guard

What:
- Update Codex generated instructions in `plugins/desk/mcp/src/activation/adapters/codex.js`.
- Update generated instruction fixtures.
- Update static `plugins/desk/agents/worker.md` and `plugins/desk/agents/worker.toml`.
- Make Codex activation namespace-aware (`desk@ourostack-local` when the marketplace is local).
- Enable selected overlay plugin dependencies (`ms-desk`, area overlays) while keeping one Desk MCP.

Output:
- Worker instructions explicitly say expected Desk MCP tools, especially `desk_status`, must be visible before treating session start as healthy.
- Missing tools route to `desk:codex-onboarding`/host repair and fresh session guidance.

Acceptance:
- Codex activation tests assert the guard in generated instructions.
- No manual copy/MCP registration language is introduced.
- Activation tests prove non-default marketplace namespaces and downstream overlay dependency enablement.

### [x] Unit 3: Document absent-vs-degraded repair behavior

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
- 2026-06-16 17:58 Harsh reviewers found BLOCKER gaps: missing MCP self-repair path, hard-coded Codex namespace, and unproven overlay dependency enablement.
- 2026-06-16 18:06 Implemented active Desk MCP tool snapshot audit with `--active-tools`, `--active-tools-file`, `--strict-active`, canonical tool-name derivation, and strict CLI parsing.
- 2026-06-16 18:10 Implemented namespace-aware Codex activation, selected overlay plugin dependency enablement, and worker startup MCP health guard across generated/static worker surfaces.
- 2026-06-16 18:13 Documented absent-vs-degraded repair behavior, active-session evidence, namespace handling, and downstream overlay inheritance.
