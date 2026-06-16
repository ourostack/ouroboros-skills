# Task

Make Desk zero-setup for downstream consumers by implementing first-class activation overlays for the ladder: Desk substrate -> generic `desk:worker` -> org overlay such as `ms-desk` -> area-specific overlay.

# Source Planning

- `worker/tasks/2026-06-16-1452-planning-desk-zero-setup-overlays.md`

# Execution Mode

direct

# Completion Criteria

- [ ] A test fixture can express `desk -> ms-desk -> area-plugin` as a dependency and activation overlay chain.
- [ ] The activation validator accepts valid overlay chains that inherit from `desk:worker` or another overlay target.
- [ ] The activation validator rejects overlays with unknown dependencies, unknown inherited targets, cycles, duplicate ids, missing entrypoints or instruction contributions, and ambiguous defaults.
- [ ] The activation contract defines exactly one effective selected target per activation context.
- [ ] Dependency and activation ordering is deterministic and covered by tests.
- [ ] Codex activation materialization can generate owned host config/instructions for a selected overlay target while still enabling Desk, Work Suite, and Desk MCP.
- [ ] Generated Codex instructions name the active overlay identity and preserve Desk session-start/root behavior.
- [ ] A selected-overlay health/evidence path proves `desk_status` is callable and reports resolved root plus active activation id/chain.
- [ ] `manual-only` keeps Desk available as a dependency substrate without installing default worker instructions.
- [ ] `project-local` can bind a repo-local Desk root and overlay identity without mutating global instructions.
- [ ] Docs explain Desk substrate, generic base worker, org overlays, and area overlays.
- [ ] Healthy-path docs contain no `codex mcp add`, `npm install`, or copied-agent-file instructions.
- [ ] Existing Desk activation, artifact, runtime, MCP, and skill validation tests pass.
- [ ] `node scripts/validate-skills.cjs`, `node scripts/test-desk-host-manifests.cjs`, and `node scripts/test-desk-generated-artifacts.cjs` pass.

# Units

## Unit 0 — Red: Overlay Chain Contract

- [x] Add failing tests for multi-level overlay inheritance, deterministic topological activation ordering, cycle rejection, missing overlay entrypoints, and missing overlay instruction contributions.
- [x] Add failing Codex adapter test for selecting an area overlay while preserving Desk config.

Output:
- Red targeted activation test output.

Acceptance:
- Tests fail because current validation only permits overlays to inherit base targets and Codex activation does not expose selected activation metadata.

## Unit 1 — Green: Activation Graph and Selection

- [x] Implement activation graph helpers that resolve activation chains across base targets and overlays.
- [x] Validate overlay entrypoints and instruction contributions.
- [x] Validate unknown inheritance, cycles, duplicate ids, and unknown dependencies.
- [x] Make activation ordering dependency-first and activation-chain aware.

Output:
- Passing activation contract tests.

Acceptance:
- `activation_contract.test.js` passes.

## Unit 2 — Green: Codex Selected Overlay Rendering

- [x] Extend Codex activation input with selected activation id.
- [x] Render active overlay identity and inherited instruction addenda into owned instructions.
- [x] Preserve existing `global-personal`, `project-local`, and `manual-only` behavior.
- [x] Keep generated config unchanged unless selected-overlay config metadata is required.

Output:
- Passing Codex activation tests.

Acceptance:
- `codex_activation.test.js` passes with selected overlay coverage.

## Unit 3 — Green: Health Evidence for Active Activation

- [x] Carry active activation id/chain into Codex smoke/status context.
- [x] Extend `desk_status` output to report activation metadata when provided.
- [x] Add tests proving selected-overlay health evidence without relying on Codex Desktop internals.

Output:
- Passing status and Codex smoke/status tests.

Acceptance:
- Targeted status/smoke tests prove resolved root plus active activation id/chain.

## Unit 4 — Docs and Generated Artifact Freshness

- [ ] Update Desk activation docs with the overlay ladder and dependency guidance.
- [ ] Update plugin author docs so downstream consumers know when to depend on Desk versus an overlay.
- [ ] Regenerate or update generated host/activation artifacts if required.
- [ ] Ensure healthy-path docs do not regress to manual setup.

Output:
- Updated docs and generated artifacts.

Acceptance:
- Host manifest and generated artifact freshness checks pass.

## Unit 5 — Final Gate

- [ ] Run targeted activation/status tests.
- [ ] Run full Desk MCP tests.
- [ ] Run Desk MCP coverage.
- [ ] Run root skill validation.
- [ ] Run host manifest freshness.
- [ ] Run generated artifact freshness.
- [ ] Commit final evidence.

Output:
- Final verification logs or summarized evidence.

Acceptance:
- All required commands pass.

# Progress Log

- 2026-06-16 14:58 Created doing doc for first-class zero-setup Desk overlays.
- 2026-06-16 14:59 Unit 0 complete: red activation tests captured in `2026-06-16-1458-doing-desk-zero-setup-overlays/unit-0-red.log`.
- 2026-06-16 15:02 Unit 1 complete: activation graph validation and ordering green in `2026-06-16-1458-doing-desk-zero-setup-overlays/unit-1-activation-contract-green.log`.
- 2026-06-16 15:04 Unit 2 complete: Codex selected-overlay rendering green in `2026-06-16-1458-doing-desk-zero-setup-overlays/unit-2-codex-activation-green.log`.
- 2026-06-16 15:08 Unit 3 complete: selected-overlay `desk_status` and Codex smoke evidence green in `2026-06-16-1458-doing-desk-zero-setup-overlays/unit-3-status-smoke-green.log`.
