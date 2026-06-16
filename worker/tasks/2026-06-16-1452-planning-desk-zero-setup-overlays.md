# Goal

Make Desk zero-setup for downstream consumers by turning Desk activation into a first-class dependency/overlay contract. A consumer such as `ms-desk`, and plugins layered on top of `ms-desk`, must get Desk MCP, Desk skills, Work Suite, worker behavior, artifact bootstrap, and health diagnostics without manually installing Desk, registering MCP, copying worker files, or running a bespoke Desk CLI.

This task continues the merged dependency-activation work from PR #113 by modeling the real ladder: Desk substrate -> generic `desk:worker` -> org overlay such as `ms-desk` -> area-specific overlay.

# Scope

## In Scope

- Clarify and encode the dependency model for Desk substrate, generic worker activation, org overlays, and area overlays.
- Extend the activation contract so overlays can depend on Desk/Work Suite, inherit a base activation target, contribute their own agent identity/instructions, and optionally become the selected/default activation.
- Make activation order deterministic across substrate dependencies, base activation targets, and overlay activation targets.
- Extend validation and tests with realistic `ms-desk` and area-overlay fixtures.
- Extend the Codex activation adapter so generated config/instructions can represent a selected overlay target rather than always hard-coding only `desk:worker`.
- Preserve standalone Desk behavior: installing Desk alone still exposes `desk:worker` as the default base worker.
- Preserve opt-outs: global personal default, project-local, and manual-only modes remain available and do not delete Desk root data.
- Keep healthy-path setup host-native: no new Desk CLI, no manual MCP registration, no manual `npm install`, no copied worker file instructions.
- Update docs so downstream plugin authors know which layer to depend on and how overlays should compose.
- Add verification that the current repo can prove the dependency/overlay chain without relying on Codex Desktop internals that are unavailable to tests.

## Out of Scope

- Building or publishing the private `ms-desk` plugin itself.
- Adding Microsoft-specific secrets, auth flows, internal URLs, or work content to this public repo.
- Implementing new Codex Desktop plugin-manager internals outside this repository.
- Removing the existing generic `desk:worker` activation target.
- Publishing private Desk embedding packs or snapshots.
- Adding a bespoke `desk setup` command.

# Completion Criteria

- A test fixture can express `desk -> ms-desk -> area-plugin` as a dependency and activation overlay chain.
- The activation validator accepts valid overlay chains that inherit from `desk:worker` or another overlay target.
- The activation validator rejects overlays with unknown dependencies, unknown inherited targets, cycles, duplicate ids, missing entrypoints or instruction contributions, and ambiguous defaults.
- Dependency and activation ordering is deterministic and covered by tests.
- Codex activation materialization can generate owned host config/instructions for a selected overlay target while still enabling Desk, Work Suite, and Desk MCP.
- Generated Codex instructions clearly name the active overlay identity and preserve the Desk session-start/root behavior.
- `manual-only` mode keeps Desk available as a dependency substrate without installing default worker instructions.
- `project-local` mode can bind a repo-local Desk root and overlay identity without mutating global instructions.
- Docs explain that Desk is the substrate, `desk:worker` is the generic base worker, org plugins such as `ms-desk` are overlays, and area plugins can extend org overlays.
- Docs explain when a consumer should depend on Desk directly versus depend on an overlay.
- Healthy-path docs contain no `codex mcp add`, `npm install`, or copied-agent-file instructions.
- Existing Desk activation, artifact, runtime, MCP, and skill validation tests still pass.
- New tests are included in `npm --prefix plugins/desk/mcp test` and covered by the existing coverage gate.
- `node scripts/validate-skills.cjs`, `node scripts/test-desk-host-manifests.cjs`, and `node scripts/test-desk-generated-artifacts.cjs` pass.

# Code Coverage Requirements

- New activation schema and validator branches must be covered by Node tests.
- New Codex adapter rendering behavior must be covered for global-personal, project-local, and manual-only modes where relevant.
- Overlay chain errors must include negative tests for duplicate ids, unknown inherited targets, unknown dependencies, and cycles.
- Documentation guard tests must ensure healthy-path docs do not regress into manual setup instructions.
- Coverage gate must remain at the repository's current standard for changed Desk MCP production files.

# Open Questions

- None requiring human judgment for this task. The chosen best-judgment model is: keep `desk:worker` bundled with Desk for standalone use, but treat it as a base activation target that downstream overlays inherit from rather than copy.

# Decisions Made

- The operator's desired default is global personal Desk/worker activation with opt-out modes, not manual invocation by default.
- Desk remains the substrate and healthy-path installer target for standalone use.
- `desk:worker` remains the generic base worker activation target.
- Downstream plugins such as `ms-desk` should be activation overlays that depend on Desk and inherit `desk:worker`.
- Deeper plugins should depend on the most specific overlay they need, such as `ms-desk`, not re-declare or copy the whole Desk setup.
- Host-native activation and plugin dependency metadata are the setup surface; no bespoke Desk CLI will be added.
- Private/org-specific overlay examples in this public repo must be synthetic fixtures only.

# Context / References

- PR #113: `feat: make Desk a host-native dependency substrate`
- `plugins/desk/activation/desk.activation.json`
- `plugins/desk/.codex-plugin/plugin.json`
- `plugins/work-suite/.codex-plugin/plugin.json`
- `plugins/desk/mcp/src/activation/validate.js`
- `plugins/desk/mcp/src/activation/adapters/codex.js`
- `plugins/desk/mcp/__tests__/activation/activation_contract.test.js`
- `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`
- `plugins/desk/docs/dependency-activation-stories-and-criteria.md`

# Notes

- Current implementation already has `provides.overlay_agents`, but it only validates overlays against base activation targets and does not yet prove multi-level overlay inheritance.
- Current Codex adapter hard-codes generated worker wording around `desk:worker`; selected overlays need first-class rendering while preserving Desk root/session-start behavior.
- Codex Desktop cache refresh/reload is partly host/plugin-manager work outside this repo, but this repo can make the activation contract and generated artifacts precise enough for the host to consume.

# Progress Log

- 2026-06-16 14:52 Created planning doc for zero-setup Desk overlay activation.
