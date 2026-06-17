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

### [x] Unit 4: Reviewer gates and verification

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
- 2026-06-16 18:22 Added coverage-hardening tests for overlay dependency filtering, missing `depends_on`, active tool snapshot merge/file/error paths, canonical tool-name fallback, and home-relative active tool files.
- 2026-06-16 18:24 Verification passed:
  - `node --test plugins/desk/mcp/__tests__/scripts/codex_plugin_cache_audit.test.js`
  - `node --test plugins/desk/mcp/__tests__/activation/codex_activation.test.js plugins/desk/mcp/__tests__/activation/codex_smoke.test.js`
  - `npm run test:coverage` in `plugins/desk/mcp` (653 tests; changed production files at 100% line/branch/function coverage)
  - `node scripts/test-codex-plugin-cache-audit.cjs`
  - `node scripts/test-desk-host-manifests.cjs`
  - `node scripts/validate-skills.cjs`
- 2026-06-16 18:25 Spawned final harsh reviewer gate `019ed31e-9c67-7200-8bf2-0779bd41201d` to review the diff for unresolved zero-setup/health-guard gaps.
- 2026-06-16 18:29 Final harsh reviewer gate passed with no BLOCKER, MAJOR, or MINOR findings.
