# Doing: Desk Dependency Activation

**Status**: IN_PROGRESS
**Execution Mode**: direct
**Created**: 2026-06-14 14:11
**Planning**: ./2026-06-14-1335-planning-desk-dependency-activation.md
**Artifacts**: desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make Desk behave as an automatically resolved dependency of plugins and custom agents, not as a manually installed user prerequisite. Implement the repo-side primitives for host-native activation, verified-prebuild Desk MCP startup, shared vector packs, prebuilt snapshot restore, diagnostics, and verification.

## Upstream Work Items
- None

## Completion Criteria
- [x] A versioned Desk activation manifest/schema exists and is documented.
- [x] The activation schema can declare Desk as a substrate dependency.
- [x] The activation schema can declare Work Suite as a dependency.
- [x] Dependency entries include dependency ID, semver range or exact pin, resolved provenance/lock data, and incompatible-version diagnostics.
- [x] The activation schema can declare `desk:worker` as a provided activation target.
- [x] The activation schema can declare overlay agents that depend on Desk without launching as `desk:worker`.
- [x] The activation schema can declare required MCP servers.
- [x] The activation schema can declare desk-root binding policy.
- [x] The activation schema can declare shared embedding artifact policy.
- [x] The activation schema can declare snapshot artifact policy.
- [x] The activation schema can declare host support, host fallbacks, and flattened bundle requirements.
- [x] Unknown activation schema versions fail closed with actionable diagnostics.
- [x] Plugin dependency order and activation order are deterministic.
- [x] Generated activation artifacts are owned/tracked so they can be updated or removed safely.
- [x] Activation declares host permissions/capabilities and cannot silently elevate beyond the host plugin model.
- [x] Claude packaging exposes Desk skills, MCP, hooks, and `desk:worker` through native plugin surfaces.
- [x] Claude packaging declares Work Suite as a dependency when the support matrix marks dependency metadata native for the host format.
- [x] Claude Agent View/background-session inheritance is validated or explicitly documented as unsupported for the current host version.
- [x] Copilot packaging exposes the expected worker agent through native agent/plugin metadata.
- [x] Copilot packaging has a flattened dependency strategy for hosts without transitive dependency resolution.
- [x] Codex packaging exposes Desk skills through Codex plugin metadata.
- [x] Codex packaging exposes Desk MCP through Codex plugin metadata.
- [x] Codex activation implements global personal worker+Desk default behavior as the primary happy path, with project-local and manual-only invocation modes available as opt-outs.
- [ ] Codex CLI smoke tests prove that a new session sees worker behavior and Desk MCP tools after activation.
- [ ] Codex App support is proven by a real smoke artifact when the app exposes a testable activation surface, or the support matrix records the exact unsupported primitive and fallback behavior.
- [ ] Codex smoke tests prove there is no healthy-path `codex mcp add`, copied agent file, or manual/uncontrolled AGENTS append/copy step.
- [x] Host adapters preserve and merge user-authored instructions/config safely instead of overwriting them.
- [ ] Host adapters document and test their permission/capability boundary.
- [x] Generated activation artifacts respect host permission/capability boundaries.
- [x] Host adapters never require healthy-path manual MCP registration.
- [x] Host adapters never require healthy-path manual `npm install` inside plugin directories.
- [x] Host adapters never require healthy-path hand-editing of JSON or TOML.
- [x] Host support matrix is generated from real schema validation or smoke evidence.
- [x] Host support matrix includes a disposition for Claude, Codex, Copilot/root plugin packaging, Ouroboros/autonomous-agent bundle wiring, and generic stdio MCP use.
- [x] Host support docs describe limitations and fallback behavior in host-native language.
- [x] Desk MCP startup can run from an installed plugin without manual dependency installation.
- [ ] MCP runtime dependencies are restored from a verified pruned production runtime pack into a writable cache using this precedence: activation config `runtimeCacheDir`, then `DESK_RUNTIME_CACHE_DIR`, then `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/`.
- [x] Runtime dependency packs live at `plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.tgz` with adjacent manifest and checksum files, and include every production dependency needed to start the real MCP server with `plugins/desk/mcp/node_modules` absent.
- [ ] Desk MCP launch works from arbitrary current working directories and resolves plugin-relative paths explicitly.
- [x] Desk MCP startup does not mutate immutable plugin source/cache directories.
- [ ] Host-specific MCP launch smoke tests cover Claude, Codex, Copilot/root plugin packaging, and generic stdio launch.
- [ ] Desk MCP offline startup behavior is tested for snapshot restore, vector-pack import, and lexical fallback.
- [x] Desk MCP resolves the desk root deterministically from explicit host/session root, activation default config, environment, and safe defaults.
- [ ] Desk MCP health/status reports the resolved root.
- [ ] Desk MCP health/status reports plugin/runtime version.
- [ ] Desk MCP health/status reports DB schema ID/version.
- [ ] Desk MCP health/status reports active embedding spec.
- [ ] Desk MCP health/status reports snapshot restore state.
- [ ] Desk MCP health/status reports vector-pack import state.
- [ ] Desk MCP health/status reports document-vector coverage.
- [ ] Desk MCP health/status reports query embedding availability separately from document-vector availability.
- [ ] Desk MCP health/status reports lexical index availability.
- [ ] A registered `desk_status` MCP tool exposes the health/status schema.
- [ ] Session-start context can surface concise health/status without running expensive repair work.
- [ ] Missing local `.state/desk-index.sqlite` is treated as a normal first-run state.
- [ ] Healthy startup has a bounded fast path and avoids network calls when snapshot/vector-pack artifacts are sufficient.
- [ ] Long-running repairs are deferred, explicitly surfaced, or explicitly invoked rather than silently blocking session start.
- [ ] Startup and rebuild performance budget values are declared in test configuration or release policy, and CI fails when those budgets are exceeded.
- [ ] Compatible snapshots are copied into `.state/` before mutation.
- [ ] Snapshot artifacts live at `plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sqlite.zst` with adjacent manifest and checksum files.
- [ ] Snapshot manifest includes artifact source-scope hash, document tree hash, included pack IDs, sqlite-vec/runtime compatibility, creation timestamp, artifact checksum, and provenance.
- [ ] Snapshot restore validates checksum, DB schema, embedding spec, chunker ID, sqlite-vec/runtime compatibility, manifest creation timestamp, provenance, artifact source-scope/document hashes, included pack IDs, and artifact format.
- [ ] Snapshot restore treats artifact source-scope or document tree mismatch as freshness information, not compatibility failure.
- [ ] Snapshot restore rejects or skips artifacts with absolute host paths or incompatible manifests.
- [ ] Snapshot restore rejects or skips artifacts with unexpected source paths.
- [ ] Snapshot artifacts are compressed or otherwise size-managed.
- [ ] Runtime chooses the newest compatible snapshot for the active embedding spec and ignores inactive-spec snapshots.
- [ ] Snapshot restore corruption is treated as a cache miss.
- [ ] Snapshot restore falls back to vector packs automatically.
- [ ] Stale but compatible snapshots are reconciled incrementally instead of fully discarded.
- [ ] Vector packs live outside `.state/` at `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.jsonl` with adjacent manifest and checksum files.
- [ ] Vector-pack rows include chunk key, text verification hash, embedding spec ID, dimension, encoding, and vector data.
- [ ] Vector-pack files include or reference checksums.
- [ ] Vector-pack import validates every row before inserting.
- [ ] Vector-pack import refuses wrong spec IDs, wrong dimensions, invalid hashes, and malformed vector encodings.
- [ ] Vector-pack import is idempotent and deduplicates repeated chunk keys.
- [ ] Vector-pack import tolerates multiple append-only pack files.
- [ ] Runtime ignores inactive-spec vector packs.
- [ ] Vector-pack compaction preserves semantic equivalence and is tested before being enabled.
- [ ] A local DB can be rebuilt from docs plus vector packs with the embedding endpoint disabled when all chunks are covered.
- [ ] Live document embedding generation happens only for chunk keys missing from shared packs.
- [ ] Ordinary healthy startup never dirties the Git worktree by writing vector packs or snapshots.
- [ ] Explicit artifact publication can write new vector packs only through MCP maintenance tools or `plugins/desk/mcp/package.json` scripts.
- [ ] Explicit snapshot build/verify can run through MCP maintenance tools or `plugins/desk/mcp/package.json` scripts.
- [ ] Public or sensitive repo policy can disable embedding/snapshot publication.
- [ ] Artifact publication policy lives at `plugins/desk/artifacts/publication-policy.json` and validates against `plugins/desk/artifacts/publication-policy.schema.json`.
- [ ] Documentation states that embeddings and snapshots are derivative data and may carry privacy risk.
- [ ] Health output, logs, snapshot errors, and vector-pack validation errors avoid dumping chunk text or sensitive document content.
- [ ] Vector-pack validation errors report file, row, and chunk key without dumping full text.
- [ ] Gitignored secret files are excluded from indexing and artifact publication by default.
- [ ] Artifact publication requires explicit approval when repository or organization policy requires it.
- [ ] Deleted/redacted documents are invalidated through tombstone metadata at `plugins/desk/artifacts/tombstones/tombstones.jsonl` validated by `plugins/desk/artifacts/tombstones/tombstone.schema.json`, plus artifact rotation cleanup.
- [ ] CI validates that deleted/redacted docs are no longer represented in active vector packs or snapshots.
- [ ] Existing active/archived search scope behavior is preserved after snapshot restore and vector import.
- [ ] Existing refs graph behavior is preserved after snapshot restore and vector import.
- [ ] Search responses distinguish semantic, lexical, and hybrid result modes.
- [ ] Query embedding failure does not imply document vectors are missing.
- [ ] Document-vector absence does not prevent lexical search.
- [x] Manifest version drift between root, Claude, Codex, and Work Suite-related plugin metadata is tested or intentionally documented.
- [ ] Worker content drift across Claude/Copilot/Codex formats is tested or eliminated by generation.
- [ ] Tests cover MCP cold start with no local `.state/`.
- [ ] Tests cover compatible snapshot restore.
- [ ] Tests cover incompatible snapshot fallback to vector packs.
- [ ] Tests cover full rebuild from docs plus vector packs with embedding endpoint disabled.
- [ ] Tests assert zero live embedding calls when vector packs fully cover chunks.
- [ ] Tests cover missing-vector live generation with a mocked embedding endpoint.
- [ ] Tests cover stale snapshot incremental reconcile.
- [ ] Tests cover corrupted snapshot fallback.
- [ ] Tests cover corrupted vector-pack rejection.
- [ ] Tests cover two machines producing non-conflicting append-only packs.
- [ ] Tests cover sensitive-path exclusion and no absolute paths in snapshot artifacts.
- [ ] Tests cover gitignored secret exclusion as product behavior.
- [x] Tests cover repeated startup idempotence.
- [x] Tests cover deactivation/uninstall artifact ownership.
- [x] Tests cover global personal default, project-local opt-out, and manual-only Codex activation policy.
- [x] Tests cover generated artifact upgrade/merge behavior preserving user-authored config.
- [ ] Tests cover snapshot/vector-pack performance budgets for startup and rebuild paths.
- [x] Tests cover permission/capability boundaries for generated activation artifacts.
- [ ] Tests cover diagnostic and validation errors avoiding sensitive text leakage.
- [x] Tests cover support-matrix disposition for the Ouroboros/autonomous-agent path.
- [x] Release/CI automation can fail when generated artifacts are stale.
- [ ] Release/CI automation can build and verify runtime dependency packs, vector packs, and snapshots without introducing a user-facing Desk CLI.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Artifact Layout And Commands
- Task evidence/logs: `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/`
- Vector packs: `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.jsonl`, `<pack-id>.manifest.json`, and `<pack-id>.sha256`
- Snapshots: `plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sqlite.zst`, `<snapshot-id>.manifest.json`, and `<snapshot-id>.sha256`
- Runtime dependency packs: `plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.tgz`, `runtime-deps.manifest.json`, and `runtime-deps.sha256`; archive expands inside the runtime cache to production `node_modules`, `package.json`, lock metadata, and manifest metadata only. Startup syncs current plugin MCP source into a runtime-cache `source-mirror/<source-hash>/` and imports from that mirror so ESM bare imports resolve against cache dependencies without freezing server source into the committed pack.
- Artifact publication policy: `plugins/desk/artifacts/publication-policy.json` validated by `plugins/desk/artifacts/publication-policy.schema.json`; required fields are `schema_version`, `default_publication`, `repo_visibility`, `sensitive_repo`, `approved_artifact_types`, `approval_required`, `approvals`, and `updated_at`
- Artifact tombstones: `plugins/desk/artifacts/tombstones/tombstones.jsonl` validated by `plugins/desk/artifacts/tombstones/tombstone.schema.json`; each row requires `schema_version`, `document_path`, `document_hash`, `reason`, `redacted_at`, `effective_from`, `artifact_rotation_id`, and `actor`
- Artifact freshness scope: artifact source-scope hash includes `plugins/desk/mcp/src/indexer/`, `plugins/desk/mcp/src/snapshots/`, `plugins/desk/mcp/src/artifacts/`, artifact build/verify scripts in `plugins/desk/mcp/scripts/`, active embedding/chunker specs, `plugins/desk/mcp/schema.sql`, `plugins/desk/mcp/package.json`, and `plugins/desk/mcp/package-lock.json`; document tree hash includes indexed desk/document corpus after exclusions. Validation-only root scripts, CI workflows, task evidence under `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/`, and generated freshness-check code do not stale vector/snapshot artifacts unless they are also indexed document inputs.
- Artifact fixtures: `plugins/desk/mcp/__tests__/fixtures/artifacts/`
- Host launch fixtures: `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/`
- Desk data mutable state: `<desk-root>/.state/` only; startup copies/decompresses compatible repo snapshots into `.state/`, while vector packs are read from `plugins/desk/artifacts/vector-packs/` and imported into the local DB under `.state/` without copying or mutating pack files
- Runtime dependency cache: activation config `runtimeCacheDir`, then `DESK_RUNTIME_CACHE_DIR`, then `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/`
- Coverage command: `npm --prefix plugins/desk/mcp run test:coverage`
- Full Desk MCP command: `npm --prefix plugins/desk/mcp test`
- Support matrix generation command: `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Read the planning doc, story matrix, current plugin manifests, MCP server/indexer code, and CI workflows. Create `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md` covering current host surfaces, current MCP launch assumptions, exact commands, artifact layout, coverage command, and the chosen performance-budget fixture source.
**Output**: `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.
**Acceptance**: Notes exist, cited source paths exist at HEAD, and no production code changed in this unit.

### ✅ Unit 0a: Coverage Gate Baseline - Tests
**What**: Write failing checks for coverage commands that enforce 100% coverage on new Desk MCP files, MCP scripts, and root validation scripts added by this task. Include fixtures for uncovered new files, missing reports, excluded files, root `scripts/*.cjs`, and CI/local command mismatch.
**Output**: `plugins/desk/mcp/__tests__/coverage/coverage_gate.test.js` and expected coverage command documentation in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.
**Acceptance**: Tests fail until coverage tooling, thresholds, and the `test:coverage` command exist.

### ✅ Unit 0b: Coverage Gate Baseline - Implementation
**What**: Add coverage tooling and CI wiring before feature work begins, with 100% thresholds for new Desk MCP files, MCP scripts, and root validation scripts introduced by this task.
**Output**: Updated `plugins/desk/mcp/package.json`, coverage configuration, `.github/workflows/desk-mcp-tests.yml`, validation scripts, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.
**Acceptance**: Unit 0a tests pass, `npm --prefix plugins/desk/mcp run test:coverage` exists, and CI fails when new code coverage drops below 100%.

### ✅ Unit 0c: Coverage Gate Baseline - Coverage & Refactor
**What**: Add edge-case coverage for missing coverage reports, uncovered new files, uncovered root validation scripts, files intentionally excluded by policy, root/MCP command mismatch, and CI/local command drift.
**Output**: Hardened coverage gate implementation.
**Acceptance**: Coverage gate tests pass locally, and every later `c` unit can run `npm --prefix plugins/desk/mcp run test:coverage` without inventing a command.

### ✅ Unit 1a: Activation Contract - Tests
**What**: Write failing tests for a versioned activation manifest/schema and validator. Cover dependency ID, semver/pin, provenance/lock fields, host support/fallback fields, permissions/capabilities, `desk:worker`, overlay agents, MCP requirements, desk-root binding, embedding policy, snapshot policy, unknown schema versions, deterministic dependency order, and unsupported-host diagnostics.
**Output**: `plugins/desk/mcp/__tests__/activation/activation_contract.test.js`.
**Acceptance**: Tests fail because `plugins/desk/mcp/src/activation/schema.js`, `plugins/desk/mcp/src/activation/validate.js`, and canonical activation fixtures do not exist or do not satisfy the expected contract.

### ✅ Unit 1b: Activation Contract - Implementation
**What**: Add the activation schema, canonical Desk activation manifest, validator, and fixture manifests. Keep the contract host-neutral and avoid a user-facing Desk CLI.
**Output**: `plugins/desk/mcp/src/activation/schema.js`, `plugins/desk/mcp/src/activation/validate.js`, `plugins/desk/activation/desk.activation.json`, and `plugins/desk/activation/README.md`.
**Acceptance**: Unit 1a tests pass, unsupported or unknown schemas fail closed with actionable diagnostics, and dependency ordering is deterministic.

### ✅ Unit 1c: Activation Contract - Coverage & Refactor
**What**: Refactor the activation contract code for maintainability, add missing branches and edge cases, and document the manifest fields.
**Output**: Clean contract implementation and docs.
**Acceptance**: 100% coverage on new activation-contract code, all activation-contract tests pass, and no warnings.

### ✅ Unit 2a: Codex Global Activation - Tests
**What**: Write failing tests for Codex global personal worker+Desk default activation, project-local opt-out, manual-only opt-out, safe merge/preservation of user-authored config, no uncontrolled `AGENTS.md` append/copy, no manual `codex mcp add`, and permission/capability boundaries.
**Output**: `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml`, and `plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml`.
**Acceptance**: Tests fail because Codex activation materialization does not yet exist or still relies on manual setup assumptions.

### ✅ Unit 2b: Codex Global Activation - Implementation
**What**: Implement the Codex adapter/materialization path for global personal default worker+Desk activation, plus project-local and manual-only opt-outs. Emit generated artifacts in a stable shape later consumed by Units 2d-2f for ownership/ledger tracking, and preserve user-authored config.
**Output**: `plugins/desk/mcp/src/activation/adapters/codex.js`, `plugins/desk/.codex-plugin/plugin.json`, `plugins/work-suite/.codex-plugin/plugin.json`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml`, and `plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml`.
**Acceptance**: Unit 2a tests pass and generated output proves Codex activation config can be materialized without manual MCP registration or copied worker files; real session smoke proof waits for Units 10d-10f after `desk_status` exists.

### ✅ Unit 2c: Codex Global Activation - Coverage & Refactor
**What**: Add edge-case coverage for existing config, disabled Desk, changed activation version, malformed config, and repeated activation.
**Output**: Hardened `plugins/desk/mcp/src/activation/adapters/codex.js` and `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`.
**Acceptance**: 100% coverage on new Codex adapter code, repeated activation is idempotent, and all Codex adapter tests pass.

### ✅ Unit 2d: Activation Artifact Ownership - Tests
**What**: Write failing tests for an owned-artifact ledger, generated artifact upgrade replacement, deactivation cleanup, preservation of user-authored config, and never deleting desk data.
**Output**: `plugins/desk/mcp/__tests__/activation/artifact_ownership.test.js` and fixtures under `plugins/desk/mcp/__tests__/fixtures/activation/ownership/`.
**Acceptance**: Tests fail until activation writes an ownership ledger and deactivation removes only owned generated artifacts.

### ✅ Unit 2e: Activation Artifact Ownership - Implementation
**What**: Implement ownership ledger creation, upgrade replacement, deactivation cleanup, and user-config preservation for generated activation artifacts.
**Output**: `plugins/desk/mcp/src/activation/artifact-ledger.js`, updates to `plugins/desk/mcp/src/activation/adapters/codex.js`, and ownership fixtures.
**Acceptance**: Unit 2d tests pass, generated artifacts can be updated or removed safely, and desk data is never deleted.

### ✅ Unit 2f: Activation Artifact Ownership - Coverage & Refactor
**What**: Add coverage for missing ledger, corrupt ledger, user-edited generated files, repeated deactivate, and partial activation failure.
**Output**: Hardened activation artifact ownership implementation.
**Acceptance**: 100% coverage on new artifact ownership code and all ownership tests pass.

### ✅ Unit 3a: Support Matrix Generator - Tests
**What**: Write failing tests for a generated support matrix with one row each for Claude, Codex, Copilot/root plugin packaging, Ouroboros/autonomous-agent bundle wiring, and generic stdio MCP use.
**Output**: `plugins/desk/mcp/__tests__/activation/support_matrix.test.js` and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md`.
**Acceptance**: Tests fail until the generated matrix validates against the evidence artifact, and the evidence artifact has columns `host_id`, `surface`, `disposition`, `source_paths`, `evidence_command_or_doc`, `unsupported_primitives`, and `fallback_behavior`, with rows for `claude`, `codex`, `copilot-root`, `ouroboros-autonomous-agent`, and `generic-stdio`.

### ✅ Unit 3b: Support Matrix Generator - Implementation
**What**: Implement support-matrix generation and validation from activation metadata plus the evidence artifact.
**Output**: Updated `plugins/desk/mcp/src/activation/support-matrix.js`, `plugins/desk/mcp/scripts/generate-support-matrix.js`, `plugins/desk/mcp/package.json` script `activation:support-matrix:generate`, `plugins/desk/activation/support-matrix.json`, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md`.
**Acceptance**: Unit 3a tests pass, `npm --prefix plugins/desk/mcp run activation:support-matrix:generate` regenerates `plugins/desk/activation/support-matrix.json`, and generated support matrix matches the evidence artifact exactly.

### ✅ Unit 3c: Support Matrix Generator - Coverage & Refactor
**What**: Add edge-case coverage for unknown hosts, missing evidence rows, unsupported primitive diagnostics, and conflicting native/flattened dispositions.
**Output**: Hardened support-matrix validation.
**Acceptance**: 100% coverage on new support-matrix code and all support-matrix tests pass.

### ✅ Unit 4a: Claude And Work Suite Packaging - Tests
**What**: Write failing tests for Claude plugin metadata, Work Suite dependency declaration when host metadata supports it, Agent View/background-session support disposition, manifest version consistency, and permission/capability boundaries.
**Output**: `plugins/desk/mcp/__tests__/activation/claude_packaging.test.js`.
**Acceptance**: Tests fail on missing or stale Claude/Work Suite dependency and support metadata.

### ✅ Unit 4b: Claude And Work Suite Packaging - Implementation
**What**: Update Claude-facing Desk and Work Suite metadata plus `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` rows to match the Claude disposition. Do not edit the generated support matrix directly.
**Output**: Updated `plugins/desk/.claude-plugin/plugin.json`, `plugins/work-suite/.claude-plugin/plugin.json`, Claude evidence rows, and regenerated `plugins/desk/activation/support-matrix.json`.
**Acceptance**: Unit 4a tests pass, unsupported Claude primitives are documented instead of claimed, and `plugins/desk/activation/support-matrix.json` is regenerated through `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`, not hand-edited.

### ✅ Unit 4c: Claude And Work Suite Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing Work Suite dependency, stale version, missing worker agent exposure, and unsupported Agent View assumptions.
**Output**: Hardened Claude packaging validation.
**Acceptance**: 100% coverage on new Claude packaging validation code and all Claude packaging tests pass.

### ✅ Unit 5a: Copilot Root Packaging - Tests
**What**: Write failing tests for `plugins/desk/plugin.json`, `plugins/work-suite/plugin.json`, Work Suite metadata, root agent exposure, flattened dependency support, no hand-edited JSON/TOML, and manifest version consistency.
**Output**: `plugins/desk/mcp/__tests__/activation/copilot_packaging.test.js`.
**Acceptance**: Tests fail on current root manifest drift or missing flattened dependency metadata.

### ✅ Unit 5b: Copilot Root Packaging - Implementation
**What**: Update root/Copilot plugin metadata, add or update Work Suite root plugin metadata, generate flattened-bundle metadata for Desk plus Work Suite, and update `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` rows. Do not edit the generated support matrix directly.
**Output**: Updated `plugins/desk/plugin.json`, `plugins/work-suite/plugin.json`, generated flattened-bundle metadata, Copilot/root evidence rows, and regenerated `plugins/desk/activation/support-matrix.json`.
**Acceptance**: Unit 5a tests pass, Copilot/root plugin packaging exposes worker behavior without a separate manual Work Suite install in flattened mode, and `plugins/desk/activation/support-matrix.json` is regenerated through `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`, not hand-edited.

### ✅ Unit 5c: Copilot Root Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing agents path, missing skills path, missing MCP declaration, stale version, and missing flattened dependency closure.
**Output**: Hardened Copilot/root packaging validation.
**Acceptance**: 100% coverage on new Copilot packaging validation code and all Copilot packaging tests pass.

### ✅ Unit 6a: Ouroboros And Generic Stdio Packaging - Tests
**What**: Write failing tests for the Ouroboros/autonomous-agent bundle disposition and generic stdio MCP launch disposition. Cover `bundle.json` expectation docs, `$DESK` preamble binding, and flattened or unsupported status.
**Output**: `plugins/desk/mcp/__tests__/activation/ouroboros_stdio_packaging.test.js`.
**Acceptance**: Tests fail until evidence rows, generated support-matrix output, and docs give explicit dispositions for Ouroboros/autonomous-agent and generic stdio paths.

### ✅ Unit 6b: Ouroboros And Generic Stdio Packaging - Implementation
**What**: Add `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` and docs entries for Ouroboros/autonomous-agent bundle wiring and generic stdio MCP launch, then regenerate support-matrix output through the Unit 3 generator.
**Output**: Updated evidence rows, generated `plugins/desk/activation/support-matrix.json`, `plugins/desk/README.md`, and activation docs.
**Acceptance**: Unit 6a tests pass, the docs no longer leave the Ouroboros path out of the activation story, and `plugins/desk/activation/support-matrix.json` is regenerated through `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`, not hand-edited.

### ✅ Unit 6c: Ouroboros And Generic Stdio Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing `$DESK` binding, missing bundle metadata, and generic stdio launch without host dependency support.
**Output**: Hardened Ouroboros/generic stdio validation.
**Acceptance**: 100% coverage on new validation code and all Ouroboros/generic stdio packaging tests pass.

### ✅ Unit 6d: Runtime Dependency Pack Artifacts - Tests
**What**: Write failing tests for runtime dependency pack artifact discovery, manifest schema, `plugins/desk/mcp/package-lock.json` provenance, prod dependency lock hash, platform/arch/Node ABI matrix, dependency-only archive shape, checksum verification, unsupported platform diagnostics, missing non-native dependency detection, and CI build/verify script declarations.
**Output**: `plugins/desk/mcp/__tests__/runtime/runtime_dependency_packs.test.js`, fixtures under `plugins/desk/mcp/__tests__/fixtures/runtime/runtime-deps/`, and expected artifact paths under `plugins/desk/mcp/artifacts/runtime-deps/`.
**Acceptance**: Tests fail until runtime dependency packs have exact paths, manifests, checksums, no bundled server source, and verification scripts for every production dependency required to start the real MCP server, including non-native dependencies and native packages such as `better-sqlite3` and `sqlite-vec`.

### ✅ Unit 6e: Runtime Dependency Pack Artifacts - Implementation
**What**: Implement runtime dependency pack metadata, dependency-only pack creation, build/verify scripts, and artifact consumption helpers. Scripts are release/CI maintenance surfaces, not user setup commands.
**Output**: `plugins/desk/mcp/src/runtime/runtime-deps.js`, `plugins/desk/mcp/scripts/build-runtime-deps-pack.js`, `plugins/desk/mcp/scripts/verify-runtime-deps-pack.js`, `plugins/desk/mcp/artifacts/runtime-deps/README.md`, package scripts `runtime:deps-pack:build` and `runtime:deps-pack:verify`, and CI wiring.
**Acceptance**: Unit 6d tests pass and the runtime dependency pack builder can create an archive whose manifest proves production dependency closure, production dependency versions, package-lock hash, platform/arch/ABI, checksums, and build provenance without bundling mutable server source.

### ✅ Unit 6f: Runtime Dependency Pack Artifacts - Coverage & Refactor
**What**: Add coverage for absent archive, corrupt archive, checksum mismatch, unsupported ABI, accidentally bundled server source, missing non-native dependency, package-lock mismatch, stale lock metadata, missing CI job, and repeated verification.
**Output**: Hardened runtime dependency pack code and scripts.
**Acceptance**: 100% coverage on new runtime dependency pack code and scripts, and all runtime dependency pack tests pass.

### ✅ Unit 6g: Production Runtime Dependency Pack Publication - Tests
**What**: Write failing checks that require the current production runtime dependency pack to be committed under `plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/` with archive, manifest, checksum, package-lock provenance, dependency-only archive shape, and freshness metadata.
**Output**: `plugins/desk/mcp/__tests__/runtime/production_runtime_pack.test.js`, updates to `scripts/test-desk-generated-artifacts.cjs`, and expected verification notes in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/runtime-pack-artifacts.md`.
**Acceptance**: Tests fail until production `runtime-deps.tgz`, `runtime-deps.manifest.json`, and `runtime-deps.sha256` exist under the canonical path, not only fixtures.

### ✅ Unit 6h: Production Runtime Dependency Pack Publication - Implementation
**What**: Generate, verify, and commit the current production runtime dependency pack with `plugins/desk/mcp/node_modules` absent from the launch fixture, no network, no `npm install`, no bundled server source, and no plugin-source mutation. Record exact commands, manifest/checksum, package-lock hash, and platform/arch/ABI.
**Output**: Production files under `plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/` and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/runtime-pack-artifacts.md`.
**Acceptance**: Unit 6g tests pass, generated runtime dependency pack artifacts are committed, and the dependency pack can support a runtime-cache current-source mirror without `plugins/desk/mcp/node_modules`.

### ✅ Unit 6i: Production Runtime Dependency Pack Publication - Coverage & Refactor
**What**: Add coverage for missing production pack, stale package-lock hash, accidentally bundled server source, checksum mismatch, stale platform/arch/ABI, fixture-only false positives, and production pack freshness drift.
**Output**: Hardened production runtime pack freshness checks.
**Acceptance**: Production runtime pack checks pass locally, and fixtures alone cannot satisfy the no-manual-install completion criteria.

### ✅ Unit 7a: Dependency-Light MCP Entrypoint - Tests
**What**: Write failing tests proving `plugins/desk/mcp/index.js` can start dependency preparation without pre-bootstrap imports of plugin-source `src/server.js` or any production/server dependencies. Cover `plugins/desk/mcp/node_modules` absent, no network access, no `npm install`, native ABI mismatch, offline restore from `plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.tgz`, source hash change causing runtime-cache `source-mirror/<source-hash>/` resync, and MCP initialize/list-tools from the synced source mirror after restore.
**Output**: `plugins/desk/mcp/__tests__/runtime/dependency_light_entrypoint.test.js`.
**Acceptance**: Tests fail until the entrypoint can run its bootstrap path without statically importing the MCP SDK, `gray-matter`, `better-sqlite3`, `sqlite-vec`, or any production dependency outside the restored runtime cache.

### ✅ Unit 7b: Dependency-Light MCP Entrypoint - Implementation
**What**: Refactor `plugins/desk/mcp/index.js` into a dependency-light entrypoint that restores or verifies the writable runtime cache from production runtime dependency pack artifacts, syncs current plugin MCP source into runtime-cache `source-mirror/<source-hash>/`, and dynamically imports from that mirror so bare imports resolve against cached dependencies. Unsupported platforms or missing packs must fail with actionable diagnostics rather than attempting an implicit install.
**Output**: Updated `plugins/desk/mcp/index.js`, new `plugins/desk/mcp/src/runtime/bootstrap.js`, current-source mirror helpers, and runtime bootstrap fixtures.
**Acceptance**: Unit 7a tests pass, the real server can start with `plugins/desk/mcp/node_modules` absent, missing runtime dependencies produce actionable non-leaking diagnostics, and no plugin source directory is mutated.

### ✅ Unit 7c: Dependency-Light MCP Entrypoint - Coverage & Refactor
**What**: Add coverage for absent cache, corrupt cache metadata, offline runtime pack unavailable, unsupported platform, production dependency mismatch, native package version mismatch, source mirror stale after source change, source mirror cleanup, implicit-install prevention, and repeated startup.
**Output**: Hardened dependency-light bootstrap implementation.
**Acceptance**: 100% coverage on new bootstrap code and all dependency-light entrypoint tests pass.

### ✅ Unit 8a: Activation Config And Root Resolution - Tests
**What**: Write failing tests for activation-config loading, root binding precedence, malformed config diagnostics, root source reporting, and shared use of the existing root resolver.
**Output**: `plugins/desk/mcp/__tests__/runtime/activation_config.test.js`.
**Acceptance**: Tests fail until explicit `--root` or host/session root overrides activation default config, activation default config precedes `$DESK` and home fallbacks, and `plugins/desk/mcp/index.js`, server startup, and activation config use the same resolver in `plugins/desk/mcp/src/util/paths.js`.

### ✅ Unit 8b: Activation Config And Root Resolution - Implementation
**What**: Extend `plugins/desk/mcp/src/util/paths.js` as the canonical path/root module. Add activation-config loading and root-source diagnostics without creating a competing runtime paths module.
**Output**: Updated `plugins/desk/mcp/src/util/paths.js` and activation config helpers used by `index.js` and status/startup code.
**Acceptance**: Unit 8a tests pass and root resolution order is explicit `--root` or host/session root, activation default config, `$DESK`, then existing home fallbacks.

### ✅ Unit 8c: Activation Config And Root Resolution - Coverage & Refactor
**What**: Add coverage for missing config, invalid JSON, nonexistent root, tilde expansion, relative roots, and diagnostic output listing every source attempted.
**Output**: Hardened activation config/root resolution implementation.
**Acceptance**: 100% coverage on new root/config code and all activation-config tests pass.

### ✅ Unit 9a: Runtime Cache And Host MCP Launch - Tests
**What**: Write failing tests for cwd-independent launch, host MCP declarations launched from a temp cwd, plugin-relative or absolute installed paths, immutable plugin directory protection, runtime cache precedence, and runtime dependency cache key compatibility.
**Output**: `plugins/desk/mcp/__tests__/runtime/cache_and_launch.test.js` and host launch fixtures under `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/`.
**Acceptance**: Tests fail until runtime cache resolution uses activation config `runtimeCacheDir`, then `DESK_RUNTIME_CACHE_DIR`, then `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/`, startup rejects incompatible cached runtime dependency artifacts, runtime dependencies write only to the runtime cache and never to `<desk-root>/.state/`, and temp-cwd smoke tests inspect and launch each declaration shape from `plugins/desk/.mcp.json`, `plugins/desk/.codex-plugin/plugin.json`, `plugins/desk/.claude-plugin/plugin.json`, `plugins/desk/plugin.json`, and `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/generic-stdio.mcp.json` without relying on caller cwd. Startup never writes under `plugins/desk/`, `plugins/desk/.codex-plugin/`, `plugins/desk/.claude-plugin/`, `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/plugin-source/`, `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/host-cache-source/`, or `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/readonly-plugin-cache/`.

### ⬜ Unit 9b: Runtime Cache And Host MCP Launch - Implementation
**What**: Implement runtime cache helpers, runtime dependency cache key metadata, host MCP declaration path fixes, and cwd-independent launch behavior.
**Output**: `plugins/desk/mcp/src/runtime/cache.js`, updated `plugins/desk/.mcp.json`, updated host adapter MCP declarations, updated `index.js`, host launch fixtures, and cache metadata fixtures.
**Acceptance**: Unit 9a tests pass from arbitrary current working directories, incompatible runtime dependency caches are rejected, and immutable plugin/source dirs remain untouched.

### ⬜ Unit 9c: Runtime Cache And Host MCP Launch - Coverage & Refactor
**What**: Add edge-case coverage for unset home/cache env vars, relative activation cache dirs, unwritable cache dirs, platform/arch/Node ABI mismatch, production dependency lock mismatch, native package version mismatch, runtime-cache versus desk-state separation, and repeated startup.
**Output**: Hardened runtime cache and host launch implementation.
**Acceptance**: 100% coverage on new runtime cache/launch code and all runtime cache tests pass.

### ⬜ Unit 10a: Early `desk_status` Skeleton - Tests
**What**: Write failing tests for registered `desk_status`, tool description, dispatch through the Unit 7 runtime-cache source mirror, root/runtime/local DB fields, root-source diagnostics, and session-start-safe summary output that does not require vector-pack or snapshot modules yet.
**Output**: `plugins/desk/mcp/__tests__/tools/status.test.js`.
**Acceptance**: Tests fail until `desk_status` is registered in `plugins/desk/mcp/src/tool-names.js`, wired into current plugin source, starts through the Unit 7 runtime-cache source mirror path, and returns early health fields without expensive repair work.

### ⬜ Unit 10b: Early `desk_status` Skeleton - Implementation
**What**: Implement `desk_status` with early health fields only: root, root source, runtime version, DB existence/schema when available, lexical index availability when cheap, and placeholders marked `not_available_until_artifact_modules` for snapshot/vector-pack/spec fields.
**Output**: `plugins/desk/mcp/src/tools/status.js`, updated `tool-names.js`, updated `server.js`, and helper code.
**Acceptance**: Unit 10a tests pass and `desk_status` does not run snapshot restore, vector-pack import, or embedding probes.

### ⬜ Unit 10c: Early `desk_status` Skeleton - Coverage & Refactor
**What**: Add coverage for missing DB, stale DB, no desk root, malformed root config, unavailable embedding endpoint, and no artifact modules installed.
**Output**: Hardened early status implementation.
**Acceptance**: 100% coverage on new early status code and all early status tests pass.

### ⬜ Unit 10d: Codex CLI/App Smoke - Tests
**What**: Write failing smoke tests or evidence harness for a temp Codex home/profile that activates Desk, starts a new Codex CLI session, and asserts worker instructions plus a `desk_status` MCP call are visible. Also record Codex App support evidence without touching the user's real Codex config.
**Output**: `plugins/desk/mcp/__tests__/activation/codex_smoke.test.js` and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/codex-smoke-evidence.md`.
**Acceptance**: Tests/evidence fail until Codex CLI smoke proves worker+Desk activation and Codex App has either a real smoke artifact or a support-matrix row naming the exact unsupported primitive and fallback behavior.

### ⬜ Unit 10e: Codex CLI/App Smoke - Implementation
**What**: Implement the Codex smoke harness and support-matrix evidence updates. Use only temp Codex homes/profiles/sessions and never the user's real Codex config.
**Output**: Updated smoke harness, `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/codex-smoke-evidence.md`, Codex support-matrix evidence rows, and regenerated `plugins/desk/activation/support-matrix.json`.
**Acceptance**: Unit 10d tests/evidence pass, CLI activation sees worker instructions and `desk_status`, Codex App is either smoke-proven or explicitly unsupported with fallback evidence, and `plugins/desk/activation/support-matrix.json` is regenerated through `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`, not hand-edited.

### ⬜ Unit 10f: Codex CLI/App Smoke - Coverage & Refactor
**What**: Add coverage for missing Codex binary/app support, stale generated config, failed MCP launch, manual-only opt-out, project-local opt-out, and cleanup of temp profiles.
**Output**: Hardened Codex smoke harness and evidence generation.
**Acceptance**: 100% coverage on new smoke harness code where it is unit-testable, and all Codex smoke tests/evidence checks pass.

### ⬜ Unit 11a: Chunk Keys And Embedding Spec Schema - Tests
**What**: Write failing tests for deterministic chunk keys, embedding spec IDs, chunker version, normalized text identity, DB schema/migrations for chunk keys/spec metadata, and inactive-spec ignore.
**Output**: `plugins/desk/mcp/__tests__/indexer/chunk_keys.test.js` and migration assertions in existing DB/indexer tests.
**Acceptance**: Tests fail until chunks and index metadata can record stable keys and active specs.

### ⬜ Unit 11b: Chunk Keys And Embedding Spec Schema - Implementation
**What**: Implement embedding spec loading, chunk-key computation, schema migrations, and active-spec metadata.
**Output**: Updated `plugins/desk/mcp/src/indexer/chunk.js`, new spec module, updated `schema.sql`/migrations, and indexer writes.
**Acceptance**: Unit 11a tests pass and unchanged chunks get stable keys across runs.

### ⬜ Unit 11c: Chunk Keys And Embedding Spec Schema - Coverage & Refactor
**What**: Add coverage for empty text, heading changes, normalization changes, spec changes, and migration from older indexes.
**Output**: Hardened chunk key/spec implementation.
**Acceptance**: 100% coverage on new chunk/spec code and all chunk-key tests pass.

### ⬜ Unit 12a: Vector Pack Validation And Import - Tests
**What**: Write failing tests for vector-pack row schema, canonical repo path `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.jsonl`, adjacent manifests/checksums, wrong spec/dimension/hash rejection, malformed vector encodings, idempotent import, duplicate rows, and multiple append-only packs.
**Output**: `plugins/desk/mcp/__tests__/indexer/vector_packs.test.js` with fixtures under `plugins/desk/mcp/__tests__/fixtures/artifacts/vector-packs/`.
**Acceptance**: Tests fail until vector-pack validation/import exists.

### ⬜ Unit 12b: Vector Pack Validation And Import - Implementation
**What**: Implement vector-pack parser, checksum verification, row validation, idempotent import, duplicate handling, and multi-pack import from `plugins/desk/artifacts/vector-packs/`.
**Output**: `plugins/desk/mcp/src/indexer/vector-packs.js`, `plugins/desk/artifacts/vector-packs/README.md`, and fixture data.
**Acceptance**: Unit 12a tests pass, bad packs fail with non-leaking diagnostics, and repeated imports are idempotent.

### ⬜ Unit 12c: Vector Pack Validation And Import - Coverage & Refactor
**What**: Add coverage for empty packs, missing checksum, corrupt JSONL, duplicate chunk keys across packs, and inactive spec packs.
**Output**: Hardened vector-pack validation/import code.
**Acceptance**: 100% coverage on new vector-pack import code and all vector-pack validation tests pass.

### ⬜ Unit 13a: Vector Rebuild And Missing Generation - Tests
**What**: Write failing tests for rebuilding a local DB from docs plus vector packs with embedding endpoint disabled, zero live embedding calls when packs fully cover chunks, and live generation only for missing chunk keys with a mocked endpoint.
**Output**: `plugins/desk/mcp/__tests__/indexer/vector_rebuild.test.js`.
**Acceptance**: Tests fail until rebuild imports packs before live embedding generation.

### ⬜ Unit 13b: Vector Rebuild And Missing Generation - Implementation
**What**: Update `rebuildIndex` and related helpers to import shared vectors before embedding and to generate only missing vectors.
**Output**: Updated `plugins/desk/mcp/src/indexer/index.js`, embedding helpers, and tests.
**Acceptance**: Unit 13a tests pass and covered chunks do not trigger embedding endpoint calls.

### ⬜ Unit 13c: Vector Rebuild And Missing Generation - Coverage & Refactor
**What**: Add coverage for partial pack coverage, embedding endpoint failure after import, stale local DB, and force rebuild.
**Output**: Hardened rebuild/import flow.
**Acceptance**: 100% coverage on new rebuild flow code and all vector rebuild tests pass.

### ⬜ Unit 14a: Vector Compaction And Search Preservation - Tests
**What**: Write failing tests for compaction semantic equivalence, active/archived search scope preservation, refs graph preservation, pack merge/no-conflict simulation, `result_mode` or `search_mode` assertions for `desk_search` and `desk_timeline`, and query/document-vector diagnostic separation after compaction.
**Output**: `plugins/desk/mcp/__tests__/indexer/vector_compaction.test.js`.
**Acceptance**: Tests fail until compaction and preservation checks exist.

### ⬜ Unit 14b: Vector Compaction And Search Preservation - Implementation
**What**: Implement compaction validation hooks only; do not enable pack rewriting in this unit. Preserve search/ref behavior across import/rebuild/validation and add explicit `result_mode` or `search_mode` fields to search responses.
**Output**: Vector-pack compaction validation helpers plus updated search/indexer behavior.
**Acceptance**: Unit 14a tests pass and semantic equivalence checks must pass before any future compaction rewrite can be enabled.

### ⬜ Unit 14c: Vector Compaction And Search Preservation - Coverage & Refactor
**What**: Add coverage for archived docs, removed docs, duplicate chunk keys, and refs graph recomputation after compaction.
**Output**: Hardened compaction/preservation implementation.
**Acceptance**: 100% coverage on new compaction/preservation code and all related tests pass.

### ⬜ Unit 15a: Snapshot Manifest And Validation - Tests
**What**: Write failing tests for snapshot path `plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sqlite.zst` and manifest fields: artifact source-scope hash, document tree hash, included pack IDs, sqlite-vec/runtime compatibility, creation timestamp, artifact checksum, provenance, DB schema, embedding spec, chunker ID, and artifact format.
**Output**: `plugins/desk/mcp/__tests__/snapshots/manifest.test.js`.
**Acceptance**: Tests fail until snapshot manifest parsing and validation exists.

### ⬜ Unit 15b: Snapshot Manifest And Validation - Implementation
**What**: Implement snapshot manifest parser and validation for `plugins/desk/artifacts/snapshots/`. Treat schema/spec/runtime/path failures as compatibility failures.
**Output**: `plugins/desk/mcp/src/snapshots/manifest.js`, `plugins/desk/artifacts/snapshots/README.md`, and fixtures.
**Acceptance**: Unit 15a tests pass and invalid manifests fail with non-leaking diagnostics.

### ⬜ Unit 15c: Snapshot Manifest And Validation - Coverage & Refactor
**What**: Add coverage for missing fields, wrong types, checksum mismatch, sqlite-vec/runtime mismatch, unexpected source paths, and absolute paths.
**Output**: Hardened snapshot manifest validation.
**Acceptance**: 100% coverage on new snapshot manifest code and all manifest tests pass.

### ⬜ Unit 16a: Snapshot Restore Select And Copy - Tests
**What**: Write failing tests for newest-compatible selection from `plugins/desk/artifacts/snapshots/`, inactive-spec ignore, compressed artifact handling, copy into `.state/`, no in-place repo mutation, and repeated restore idempotence.
**Output**: `plugins/desk/mcp/__tests__/snapshots/restore.test.js`.
**Acceptance**: Tests fail until snapshot selection and restore-copy behavior exists.

### ⬜ Unit 16b: Snapshot Restore Select And Copy - Implementation
**What**: Implement snapshot discovery, newest-compatible selection, decompression/copy into local `.state/`, and restore idempotence.
**Output**: `plugins/desk/mcp/src/snapshots/restore.js` and fixtures.
**Acceptance**: Unit 16a tests pass and repo snapshot artifacts are never opened for mutation.

### ⬜ Unit 16c: Snapshot Restore Select And Copy - Coverage & Refactor
**What**: Add coverage for missing snapshot directories, corrupt compressed files, unwritable `.state/`, and multiple compatible snapshots.
**Output**: Hardened snapshot restore code.
**Acceptance**: 100% coverage on new restore code and all restore tests pass.

### ⬜ Unit 17a: Snapshot Fallback And Stale Reconcile - Tests
**What**: Write failing tests for corrupt snapshot fallback to vector packs, incompatible snapshot fallback, source/document tree mismatch as freshness only, stale compatible restore-then-reconcile, and refs/search preservation after reconcile.
**Output**: `plugins/desk/mcp/__tests__/snapshots/fallback_reconcile.test.js`.
**Acceptance**: Tests fail until fallback and freshness/reconcile semantics exist.

### ⬜ Unit 17b: Snapshot Fallback And Stale Reconcile - Implementation
**What**: Wire snapshot restore into index startup/rebuild with vector-pack fallback and stale reconcile.
**Output**: Updated `server-helpers.js`, indexer startup flow, and snapshot helpers.
**Acceptance**: Unit 17a tests pass, incompatible snapshots are cache misses, and stale compatible snapshots restore then reconcile.

### ⬜ Unit 17c: Snapshot Fallback And Stale Reconcile - Coverage & Refactor
**What**: Add coverage for stale docs, deleted docs, archived docs, missing packs, and embedding endpoint disabled during fallback.
**Output**: Hardened snapshot fallback/reconcile flow.
**Acceptance**: 100% coverage on new fallback/reconcile code and all fallback tests pass.

### ⬜ Unit 17d: Full Status And Offline Fallback - Tests
**What**: Write failing tests that extend `desk_status` and startup fallback after vector-pack and snapshot modules exist. Cover embedding spec, snapshot state, vector-pack state, document-vector coverage, query embedding availability, lexical availability, degraded modes, and offline startup with snapshot/vector-pack/lexical fallback.
**Output**: `plugins/desk/mcp/__tests__/tools/status_artifacts.test.js` and extended `plugins/desk/mcp/__tests__/runtime/startup_budget.test.js`.
**Acceptance**: Tests fail until full artifact-aware status and offline fallback are wired after Units 11-17.

### ⬜ Unit 17e: Full Status And Offline Fallback - Implementation
**What**: Wire snapshot, vector-pack, and embedding-spec modules into `desk_status` and bounded startup fallback without making status run expensive repair work.
**Output**: Updated `plugins/desk/mcp/src/tools/status.js`, `plugins/desk/mcp/src/server-helpers.js`, and artifact helper integration.
**Acceptance**: Unit 17d tests pass, full status fields are populated when modules exist, and offline startup falls back through snapshot, vector packs, then lexical indexing.

### ⬜ Unit 17f: Full Status And Offline Fallback - Coverage & Refactor
**What**: Add coverage for missing snapshot, incompatible snapshot, missing vector packs, partial vector coverage, unavailable query embedding endpoint, and stale local DB.
**Output**: Hardened full status/fallback integration.
**Acceptance**: 100% coverage on new full status/fallback code and all status/fallback tests pass.

### ⬜ Unit 18a: Publication Policy And Approval - Tests
**What**: Write failing tests for `plugins/desk/artifacts/publication-policy.json`, `plugins/desk/artifacts/publication-policy.schema.json`, required fields `schema_version`, `default_publication`, `repo_visibility`, `sensitive_repo`, `approved_artifact_types`, `approval_required`, `approvals`, and `updated_at`, public/sensitive repo publication defaults, explicit repo/org policy approval, ordinary startup not writing artifacts, and artifact write attempts without approval.
**Output**: `plugins/desk/mcp/__tests__/artifacts/publication_policy.test.js`.
**Acceptance**: Tests fail until artifact publication policy checks exist.

### ⬜ Unit 18b: Publication Policy And Approval - Implementation
**What**: Implement publication policy schema and checks for vector-pack writes to `plugins/desk/artifacts/vector-packs/` and snapshot writes to `plugins/desk/artifacts/snapshots/`.
**Output**: `plugins/desk/mcp/src/artifacts/policy.js`, `plugins/desk/artifacts/publication-policy.json`, `plugins/desk/artifacts/publication-policy.schema.json`, and updated artifact write paths.
**Acceptance**: Unit 18a tests pass, public/sensitive repos default to no publication, and ordinary startup never dirties the worktree.

### ⬜ Unit 18c: Publication Policy And Approval - Coverage & Refactor
**What**: Add coverage for missing policy, malformed policy, schema version drift, explicit allow, explicit deny, unknown repo sensitivity, and organization policy override.
**Output**: Hardened publication policy module.
**Acceptance**: 100% coverage on new policy code and all publication policy tests pass.

### ⬜ Unit 19a: Indexing Exclusions - Tests
**What**: Write failing tests for gitignored secret exclusion, sensitive-path exclusion, archived sensitive-path handling, and artifact publication respecting exclusions.
**Output**: `plugins/desk/mcp/__tests__/indexer/exclusions.test.js`.
**Acceptance**: Tests fail until discovery/artifact flows honor gitignore and sensitive-path policy.

### ⬜ Unit 19b: Indexing Exclusions - Implementation
**What**: Implement exclusion handling in discovery and artifact publication flows without breaking existing desk discovery behavior. Apply exclusions before any vector-pack or snapshot builder can collect document text.
**Output**: Updated `plugins/desk/mcp/src/indexer/discover.js`, new `plugins/desk/mcp/src/indexer/exclusions.js`, and publication policy wiring.
**Acceptance**: Unit 19a tests pass and gitignored secret files are excluded from indexing and artifacts by default.

### ⬜ Unit 19c: Indexing Exclusions - Coverage & Refactor
**What**: Add coverage for nested gitignore files, negated gitignore rules, symlinks, hidden files, and person-prefix/shared-landscape discovery.
**Output**: Hardened exclusion/discovery code.
**Acceptance**: 100% coverage on new exclusion code and all existing discovery tests remain green.

### ⬜ Unit 20a: Tombstones And Redaction Cleanup - Tests
**What**: Write failing tests for `plugins/desk/artifacts/tombstones/tombstones.jsonl`, `plugins/desk/artifacts/tombstones/tombstone.schema.json`, required row fields `schema_version`, `document_path`, `document_hash`, `reason`, `redacted_at`, `effective_from`, `artifact_rotation_id`, and `actor`, tombstone invalidation, active artifact exclusion of deleted/redacted docs, artifact rotation cleanup, repeated tombstones, and deleted archived docs.
**Output**: `plugins/desk/mcp/__tests__/artifacts/redaction_cleanup.test.js`.
**Acceptance**: Tests fail until tombstone and cleanup behavior exists.

### ⬜ Unit 20b: Tombstones And Redaction Cleanup - Implementation
**What**: Implement tombstone metadata, artifact invalidation, and artifact rotation cleanup for vector packs under `plugins/desk/artifacts/vector-packs/` and snapshots under `plugins/desk/artifacts/snapshots/`.
**Output**: Redaction/tombstone modules, `plugins/desk/artifacts/tombstones/tombstones.jsonl`, `plugins/desk/artifacts/tombstones/tombstone.schema.json`, and artifact rotation cleanup integration.
**Acceptance**: Unit 20a tests pass and deleted/redacted docs are not represented in active vector packs or snapshots.

### ⬜ Unit 20c: Tombstones And Redaction Cleanup - Coverage & Refactor
**What**: Add coverage for missing tombstone files, corrupt tombstones, schema version drift, cleanup after compaction validation, cleanup after snapshot rotation, and stale local DB rebuild after redaction.
**Output**: Hardened redaction cleanup implementation.
**Acceptance**: 100% coverage on new redaction cleanup code and all cleanup tests pass.

### ⬜ Unit 21a: Artifact Scripts And Performance Budgets - Tests
**What**: Write failing tests for exact `plugins/desk/mcp/package.json` scripts: `artifact:vector-pack:build`, `artifact:snapshot:build`, `artifact:snapshot:verify`, and `artifact:validate`. Cover CI invocation, publication-policy enforcement, exclusion/tombstone enforcement, writes only to `plugins/desk/artifacts/vector-packs/` and `plugins/desk/artifacts/snapshots/`, and startup/rebuild budget thresholds from `plugins/desk/mcp/config/performance-budgets.json`.
**Output**: `plugins/desk/mcp/__tests__/artifacts/scripts_and_budgets.test.js`.
**Acceptance**: Tests fail until the package scripts and budget config exist and refuse to publish artifacts that bypass Units 18-20 policy/exclusion/redaction controls.

### ⬜ Unit 21b: Artifact Scripts And Performance Budgets - Implementation
**What**: Implement package scripts and script entrypoints for vector-pack build, snapshot build, snapshot verify, artifact validation, and budget enforcement. Keep scripts as maintenance/release surfaces, not user setup commands.
**Output**: Updated `plugins/desk/mcp/package.json`, `plugins/desk/mcp/scripts/build-vector-pack.js`, `plugins/desk/mcp/scripts/build-snapshot.js`, `plugins/desk/mcp/scripts/verify-snapshot.js`, `plugins/desk/mcp/scripts/validate-artifacts.js`, and `plugins/desk/mcp/config/performance-budgets.json`.
**Acceptance**: Unit 21a tests pass and scripts can be invoked by CI without adding a user-facing Desk CLI.

### ⬜ Unit 21c: Artifact Scripts And Performance Budgets - Coverage & Refactor
**What**: Add coverage for script failures, missing artifacts, stale generated files, forbidden publication, excluded documents, redacted documents, and exceeded startup/rebuild budgets.
**Output**: Hardened artifact scripts and budget checks.
**Acceptance**: 100% coverage on new script helper code and all artifact script tests pass.

### ⬜ Unit 22a: Healthy-Path Docs - Tests
**What**: Write failing docs/freshness checks that reject healthy-path manual Desk install wording, manual `codex mcp add`, manual `npm install`, uncontrolled `AGENTS.md` append/copy, and missing privacy notes.
**Output**: `scripts/test-desk-docs.cjs`, `.github/workflows/validate-skills.yml`, and `.github/workflows/desk-mcp-tests.yml` updates that invoke the docs validation.
**Acceptance**: Tests fail until Desk docs frame setup as dependency activation and move manual steps to troubleshooting/developer notes.

### ⬜ Unit 22b: Healthy-Path Docs - Implementation
**What**: Update `plugins/desk/README.md`, `plugins/desk/docs/agent-files.md`, `plugins/desk/mcp/README.md`, `plugins/desk/activation/README.md`, `plugins/desk/docs/dependency-activation-stories-and-criteria.md`, and `desk/tasks/2026-06-14-1335-planning-desk-dependency-activation.md` to reflect dependency activation, global Codex personal default, opt-outs, privacy, and no bespoke CLI.
**Output**: Updated documentation and docs validation script.
**Acceptance**: Unit 22a tests pass and docs no longer present manual Desk install as the healthy path.

### ⬜ Unit 22c: Healthy-Path Docs - Coverage & Refactor
**What**: Add docs validation coverage for Codex, Claude, Copilot/root, Ouroboros/autonomous-agent, generic stdio, vector packs, snapshots, redaction, and publication policy.
**Output**: Hardened docs validation.
**Acceptance**: All docs validation tests pass, generated docs remain stable, and new or modified root docs validation scripts meet the Unit 0 coverage gate.

### ⬜ Unit 22d: Production Shared Artifact Publication - Tests
**What**: Write failing checks that require at least one current production vector pack and one current production snapshot committed under the canonical repo paths after healthy-path docs are updated, with manifests, checksums, publication-policy approval, exclusion/tombstone validation, and freshness metadata tied to the artifact source-scope hash and document tree hash.
**Output**: `plugins/desk/mcp/__tests__/artifacts/production_artifacts.test.js`, updates to `scripts/test-desk-generated-artifacts.cjs`, and expected verification notes in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Tests fail until production artifacts exist under `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/` and `plugins/desk/artifacts/snapshots/<embedding-spec-id>/`, not only fixtures.

### ⬜ Unit 22e: Production Shared Artifact Publication - Implementation
**What**: Generate, verify, and commit initial production shared vector-pack and snapshot artifacts using the Unit 21 scripts after publication policy, exclusions, tombstones, and healthy-path docs are active. Record exact commands, manifests, checksums, artifact source-scope hash, document tree hash, and approval state.
**Output**: Production files under `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/` and `plugins/desk/artifacts/snapshots/<embedding-spec-id>/`, manifests/checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Unit 22d tests pass, generated artifacts are committed, no gitignored/sensitive/redacted content is represented, and CI freshness checks fail if the committed artifacts drift from the documented source/document tree.

### ⬜ Unit 22f: Production Shared Artifact Publication - Coverage & Refactor
**What**: Add coverage for missing production pack, missing production snapshot, stale artifact source-scope hash, stale document tree, checksum mismatch, policy denial, tombstoned document presence, docs-changing-after-publication detection, and fixture-only false positives.
**Output**: Hardened production artifact freshness checks.
**Acceptance**: Production artifact checks pass locally, and fixtures alone cannot satisfy the shared-artifact completion criteria.

### ⬜ Unit 23a: CI And Generated Artifact Freshness - Tests
**What**: Write failing checks for activation support matrix freshness, host manifest drift, worker-content drift, artifact script availability, generated fixture freshness, production runtime dependency pack freshness, and production vector/snapshot artifact freshness using the explicit artifact source-scope/document tree hash rules.
**Output**: `scripts/test-desk-generated-artifacts.cjs`, `scripts/test-desk-host-manifests.cjs`, updates to `scripts/validate-skills.cjs`, `.github/workflows/validate-skills.yml`, and `.github/workflows/desk-mcp-tests.yml`.
**Acceptance**: Tests fail on stale generated artifacts or current manifest drift.

### ⬜ Unit 23b: CI And Generated Artifact Freshness - Implementation
**What**: Wire validation scripts into `.github/workflows/desk-mcp-tests.yml`. Include artifact scripts, support-matrix checks, runtime dependency pack verification, and production vector/snapshot freshness checks.
**Output**: Updated `scripts/test-desk-generated-artifacts.cjs`, `scripts/test-desk-host-manifests.cjs`, `scripts/validate-skills.cjs`, `.github/workflows/validate-skills.yml`, and `.github/workflows/desk-mcp-tests.yml`.
**Acceptance**: Unit 23a tests pass and CI fails when generated artifacts are stale.

### ⬜ Unit 23c: CI And Generated Artifact Freshness - Coverage & Refactor
**What**: Add coverage for stale generated support matrix, missing artifact scripts, stale production vector/snapshot artifacts, stale runtime dependency packs, manifest version drift, and worker-format drift.
**Output**: Hardened CI/freshness validation.
**Acceptance**: All CI/freshness tests pass locally, and new or modified root validation scripts meet the Unit 0 coverage gate.

### ⬜ Unit 24a1: Integration Tests - Cold Start And Snapshot Restore
**What**: Write failing integration checks for full cold start and compatible snapshot restore from a committed production snapshot under `plugins/desk/artifacts/snapshots/<embedding-spec-id>/`, not only test fixtures.
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.
**Acceptance**: Cold-start snapshot restore tests fail until the paired Unit 24b1 implementation.

### ⬜ Unit 24b1: Integration - Cold Start And Snapshot Restore
**What**: Wire the integration flow for cold start plus compatible snapshot restore.
**Output**: Updates to snapshot/startup modules required by `dependency_activation_flow.test.js` cold-start snapshot cases; if artifact source-scope or indexed document inputs change, regenerated production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Paired Unit 24a1 tests pass, the full Desk MCP suite passes, `npm --prefix plugins/desk/mcp run test:coverage` passes, and production vector/snapshot artifacts are current if this unit changes artifact source-scope or indexed document inputs.

### ⬜ Unit 24a2: Integration Tests - Vector-Pack Rebuild Without Embeddings
**What**: Write failing integration checks for vector-pack rebuild from committed production vector packs under `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/` with embedding endpoint disabled, not only test fixtures.
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.
**Acceptance**: Vector-pack rebuild tests fail until the paired Unit 24b2 implementation, while Unit 24a1 coverage remains green.

### ⬜ Unit 24b2: Integration - Vector-Pack Rebuild Without Embeddings
**What**: Wire the integration flow for rebuilding from docs plus vector packs with embedding endpoint disabled.
**Output**: Updates to vector-pack/indexer modules required by the no-embedding rebuild cases; if artifact source-scope or indexed document inputs change, regenerated production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Paired Unit 24a2 tests pass, Unit 24a1 remains green, the full Desk MCP suite passes, `npm --prefix plugins/desk/mcp run test:coverage` passes, and production vector/snapshot artifacts are current if this unit changes artifact source-scope or indexed document inputs.

### ⬜ Unit 24a3: Integration Tests - Missing-Vector Live Generation
**What**: Write failing integration checks for missing-vector live generation with a mocked embedding endpoint.
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.
**Acceptance**: Missing-vector live generation tests fail until the paired Unit 24b3 implementation, while Units 24a1-24a2 coverage remains green.

### ⬜ Unit 24b3: Integration - Missing-Vector Live Generation
**What**: Wire the integration flow for generating only missing vectors with a mocked embedding endpoint.
**Output**: Updates to vector-pack/indexer/embed modules required by missing-vector generation cases; if artifact source-scope or indexed document inputs change, regenerated production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Paired Unit 24a3 tests pass, Units 24a1-24a2 remain green, the full Desk MCP suite passes, `npm --prefix plugins/desk/mcp run test:coverage` passes, and production vector/snapshot artifacts are current if this unit changes artifact source-scope or indexed document inputs.

### ⬜ Unit 24a4: Integration Tests - Scope And Refs Preservation
**What**: Write failing integration checks for active/archived scope preservation and refs graph preservation.
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.
**Acceptance**: Scope and refs preservation tests fail until the paired Unit 24b4 implementation, while Units 24a1-24a3 coverage remains green.

### ⬜ Unit 24b4: Integration - Scope And Refs Preservation
**What**: Wire the integration flow for active/archived search scope and refs graph preservation after restore/import/rebuild.
**Output**: Updates to search/indexer/refs modules required by scope and refs preservation cases; if artifact source-scope or indexed document inputs change, regenerated production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Paired Unit 24a4 tests pass, Units 24a1-24a3 remain green, the full Desk MCP suite passes, `npm --prefix plugins/desk/mcp run test:coverage` passes, and production vector/snapshot artifacts are current if this unit changes artifact source-scope or indexed document inputs.

### ⬜ Unit 24a5: Integration Tests - Idempotence And Degraded Semantic Mode
**What**: Write failing integration checks for repeated startup idempotence and degraded semantic mode.
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.
**Acceptance**: Idempotence and degraded semantic tests fail until the paired Unit 24b5 implementation, while Units 24a1-24a4 coverage remains green.

### ⬜ Unit 24b5: Integration - Idempotence And Degraded Semantic Mode
**What**: Wire the integration flow for repeated startup idempotence and degraded semantic mode.
**Output**: Updates to startup/status/search modules required by idempotence and degraded semantic cases; if artifact source-scope or indexed document inputs change, regenerated production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.
**Acceptance**: Paired Unit 24a5 tests pass, Units 24a1-24a4 remain green, the full Desk MCP suite passes, `npm --prefix plugins/desk/mcp run test:coverage` passes, and production vector/snapshot artifacts are current if this unit changes artifact source-scope or indexed document inputs.

### ⬜ Unit 24c: Final Verification And Handoff
**What**: Run the full Desk MCP test suite, root validation scripts, host/package validation scripts, generated-artifact freshness checks, and new coverage commands. Update planning/doing checklists only for criteria with evidence.
**Output**: Verification notes in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/final-verification.md` and updated task docs.
**Acceptance**: All tests pass, coverage requirements are met for new code, no warnings remain, branch is clean except intentional task-doc updates, and results are committed and pushed.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- For `a` test units, run/save the targeted red-test output under `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/` and commit the failing tests with an explicit red-state message.
- For paired `b`/implementation and `c`/coverage-refactor units, commit only after the relevant tests are green.
- Push after each green implementation/refactor unit; push red-test commits only when needed for collaboration or audit continuity.
- Run the full Desk MCP suite and `npm --prefix plugins/desk/mcp run test:coverage` before marking each green `b`/`c` unit complete; `a` units require only the targeted red run and saved evidence.
- Any unit that changes `plugins/desk/mcp/package.json`, `plugins/desk/mcp/package-lock.json`, production dependency metadata, or runtime dependency lock inputs must regenerate, verify, and recommit the production runtime dependency pack in the same unit, then run the Unit 6g-6i freshness checks.
- Any unit that changes artifact source-scope files or indexed document inputs after Unit 22e must regenerate, verify, and recommit production vector packs, snapshots, manifests, checksums, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md` in the same unit, then run the Unit 22d-22f freshness checks.
- **All task evidence artifacts**: Save outputs, logs, and data to `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-14 14:11 Created from planning doc
- 2026-06-14 14:24 Addressed granularity and ambiguity pass findings by splitting broad units and fixing exact paths/tool names/scripts
- 2026-06-14 14:25 Validation pass converged
- 2026-06-14 14:25 Quality pass converged
- 2026-06-14 14:28 Addressed Round 2 granularity and ambiguity findings: split final integration implementation and fixed remaining exact targets
- 2026-06-14 14:32 Addressed final granularity and ambiguity findings: split integration tests, clarified ownership, and removed remaining alternatives
- 2026-06-14 14:34 Resolved final redaction cleanup wording to tombstone metadata plus artifact rotation cleanup
- 2026-06-14 14:36 Granularity and ambiguity reviewer gates converged
- 2026-06-14 14:44 Addressed scrutiny findings: dependency-light MCP bootstrap, Codex smoke, activation config, root packaging, artifact ownership/deactivation, search result modes, and coverage gate
- 2026-06-14 14:44 Committed scrutiny fixes as `74832d5`
- 2026-06-14 14:45 Clarified support-matrix ownership: host units update evidence, generator owns generated matrix output
- 2026-06-14 14:45 Committed support-matrix ownership cleanup as `2ac1d80`
- 2026-06-14 14:54 Addressed second scrutiny findings: early coverage gate, explicit artifact paths, runtime dependency pack ownership, post-status Codex smoke, privacy-before-publication ordering, root precedence, host launch fixtures, and red-test semantics
- 2026-06-14 14:54 Committed second scrutiny fixes as `376ddc7`
- 2026-06-14 15:00 Addressed third scrutiny findings: support-matrix regeneration after evidence changes, Codex ownership unit ordering, runtime dependency pack bootstrap semantics, and interleaved integration red/green units
- 2026-06-14 15:00 Committed third scrutiny fixes as `240fc70`
- 2026-06-14 15:08 Addressed fourth scrutiny findings: full runtime dependency packs, production shared vector/snapshot artifact publication, root-script coverage, explicit policy/tombstone schemas, and runtime-cache versus desk-state separation
- 2026-06-14 15:08 Committed fourth scrutiny fixes as `2e164ec`
- 2026-06-14 15:13 Addressed fifth scrutiny findings: dependency-only runtime pack with current-source mirror, production runtime pack publication, Unit 7 list-tools proof before `desk_status`, policy/tombstone required fields, and vector import versus snapshot copy semantics
- 2026-06-14 15:13 Committed fifth scrutiny fixes as `98d244c`
- 2026-06-14 15:21 Addressed sixth scrutiny findings: dependency pack avoids frozen server source and docs land before production vector/snapshot publication to prevent freshness churn
- 2026-06-14 15:21 Committed sixth scrutiny fixes as `6156f6a`
- 2026-06-14 15:25 Addressed seventh scrutiny findings: Unit 10 source-mirror wording, explicit artifact freshness hash scope, and runtime-pack regeneration rule for prod dependency changes
- 2026-06-14 15:25 Committed seventh scrutiny fixes as `bc16ab6`
- 2026-06-14 15:28 Addressed eighth scrutiny finding: Unit 24 implementation units must refresh production vector/snapshot artifacts when artifact source-scope or indexed inputs change
- 2026-06-14 15:28 Committed eighth scrutiny fix as `f7393c5`
- 2026-06-14 15:30 Final Tinfoil Hat and Stranger With Candy scrutiny gates converged; doing doc marked READY_FOR_EXECUTION
- 2026-06-14 15:40 Unit 0 complete: setup research notes written, baseline command failures recorded, and unit review skipped (reason: docs-only research artifact)
- 2026-06-14 15:44 Unit 0a complete: coverage-gate red tests and setup-notes command contract committed; targeted red run saved to `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/unit-0a-coverage-gate-red.log`
- 2026-06-14 16:03 Unit 0b complete: coverage gate implementation, `test:coverage` script, CI wiring, and coverage config landed; `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, and `node scripts/validate-skills.cjs` pass; green logs saved under the task artifact directory
- 2026-06-14 16:16 Unit 0b reviewer fix committed as `6d7d5d8`: removed the runner self-exclusion by moving implementation into covered `plugins/desk/mcp/src/coverage/runner.js`, kept `plugins/desk/mcp/scripts/run-coverage.js` as a covered child-no-op entrypoint, added `scripts/*.cjs` CI path filters, refreshed green logs, and re-verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 16:18 Unit 0b Round 2 cold reviewer gate converged with no findings
- 2026-06-14 16:27 Unit 0c complete: added red/green coverage for CI path-filter parity so `scripts/*.cjs` changes cannot skip the coverage gate; saved `unit-0c-coverage-gate-red.log`, `unit-0c-test-coverage-green.log`, and `unit-0c-npm-test-green.log`; verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 16:29 Unit 0c reviewer fix: Hooke found the path-filter parity check accepted `scripts/*.cjs` anywhere in workflow text; added red evidence in `unit-0c-review-fix-red.log`, replaced the loose string check with `on.pull_request.paths`/`on.push.paths` extraction, covered false positives and one-event-only placement, refreshed green logs, and re-verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, and `node scripts/validate-skills.cjs`
- 2026-06-14 16:31 Unit 0c Round 2 cold reviewer gate converged with no findings
- 2026-06-14 16:35 Unit 1a complete: activation-contract red tests added in `plugins/desk/mcp/__tests__/activation/activation_contract.test.js`; targeted red run saved to `unit-1a-activation-contract-red.log` and fails because `plugins/desk/mcp/src/activation/schema.js` and `plugins/desk/mcp/src/activation/validate.js` do not exist yet
- 2026-06-14 16:42 Unit 1a reviewer fix: Einstein found the red contract under-specified dependency validation, nested policy validation, `desk:worker`/overlay relationship integrity, and schema required-field ordering; strengthened `activation_contract.test.js` with negative cases for IDs, semver ranges, exact pins, lock mismatches, incompatible locks, MCP/root/artifact/host/permission fields, missing/default/duplicate `desk:worker`, unknown dependencies/inherits, shuffled deterministic ordering, and order-insensitive schema required-field checks; refreshed `unit-1a-activation-contract-red.log`
- 2026-06-14 16:44 Unit 1a Round 2 reviewer fix: added missing negative cases for `host_support[].capabilities`, `permissions.requested_capabilities`, and `permissions.generated_artifacts`; refreshed `unit-1a-activation-contract-red.log`
- 2026-06-14 16:46 Unit 1a cold reviewer gate converged with no findings
- 2026-06-14 16:51 Unit 1b complete: activation schema, validator, canonical Desk activation manifest, and docs landed in `820a08e`; corrected Unit 1a fixture overrides that could not actually remove nested fields, added defensive/range branch coverage to reach 100% line/branch/function coverage for new activation code, saved `unit-1b-activation-contract-green.log`, `unit-1b-test-coverage-green.log`, and `unit-1b-npm-test-green.log`, and verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 17:04 Unit 1b reviewer fix: Rawls found MAJOR holes in caret `^0.x` semver handling, duplicate dependency IDs, and fail-closed type/enum checks; Poincare implemented the scoped fix and executor tightened the remaining `mcp_servers[].command`/scalar field checks, empty entrypoints, and coverage; committed as `0d17705`; refreshed `unit-1b-review-fix-activation-contract-green.log`, `unit-1b-review-fix-test-coverage-green.log`, `unit-1b-review-fix-npm-test-green.log`, and `unit-1b-review-fix-validate-skills-green.log`; verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`; deferred Rawls' MINOR host-support status wording to the host support/adapter evidence units because packaging and smoke criteria remain unchecked
- 2026-06-14 17:09 Unit 1b Round 2 reviewer fix: Nietzsche found remaining MAJOR fail-closed shape holes for non-array `provides.overlay_agents` and non-object `activation_targets[].entrypoints`; added explicit shape diagnostics/tests, committed as `172aba8`, refreshed Unit 1b review-fix green logs, and re-verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 17:14 Unit 1b Round 3 reviewer fix: Boole found remaining MAJOR fail-closed shape hole for malformed `overlay_agents[].inherits` and MINOR defensive issue in `diagnoseHostSupport`; added inherits shape diagnostics/tests, hardened malformed host-support diagnostics, saved `unit-1b-review-fix-shape-probe-green.log`, committed as `eb58317`, refreshed Unit 1b review-fix green logs, and re-verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 17:14 Unit 1b cold reviewer gate converged after Round 3; Helmholtz verified prior semver, duplicate dependency, type/enum, malformed shape, inherits, and host-support diagnostic findings are closed, with 13/13 activation tests, direct shape probe, 209/209 MCP package tests, and clean diff check
- 2026-06-14 17:19 Unit 1c complete: polished activation helper defensiveness, added helper edge-case coverage, expanded `plugins/desk/activation/README.md` into a manifest field reference, committed as `ec24455`, saved `unit-1c-activation-contract-green.log`, `unit-1c-test-coverage-green.log`, `unit-1c-npm-test-green.log`, and `unit-1c-validate-skills-green.log`, and verified `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 17:19 Unit 1c cold reviewer gate converged; Anscombe verified activation-focused tests, coverage, skill validation, diff cleanliness, evidence, and doing-doc claims, with only the pre-existing expected Ollama-down semantic diagnostic in the broader suite
- 2026-06-14 17:25 Unit 2a complete: added Codex activation red tests and fixtures in `0821435`; targeted red run saved to `unit-2a-codex-activation-red.log` and fails because Codex activation metadata/materialization is missing and `plugins/desk/agents/worker.toml` still documents manual copy registration; terminal `All tests pass` criterion intentionally unchecked until Unit 2b makes the new tests green
- 2026-06-14 17:28 Unit 2a reviewer fix and convergence: Archimedes found trailing whitespace in the red log and an overbroad permission-boundary test title; fixed both in `4e7f4c3`, kept the targeted red run failing for the intended missing Codex activation materializer/metadata and manual-copy worker text, and Chandrasekhar converged the Unit 2a cold reviewer gate
- 2026-06-14 17:35 Unit 2b complete: implemented Codex host-native activation materialization in `790d0bf`, added Desk/Work Suite Codex activation metadata, removed healthy-path worker copy-registration guidance, saved Unit 2b green logs, and verified `node --test plugins/desk/mcp/__tests__/activation/codex_activation.test.js`, `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`; no Desk MCP build script exists, so no separate build command was available
- 2026-06-14 17:45 Unit 2b reviewer fix: Dirac found a BLOCKER that the first materializer emitted custom `[desk.activation]` TOML rather than Codex-native loading surfaces; tightened the Codex activation tests with red evidence in `unit-2b-review-fix-red.log`, changed materialization to native plugin enablement, plugin-scoped bundled MCP policy, project-local `[mcp_servers.desk]` only where a `.desk` root override is needed, and owned Codex `AGENTS.md` instruction blocks for worker default behavior; committed as `f6c6eee`; refreshed green logs for targeted Codex activation, `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 17:51 Unit 2b reviewer hygiene: Faraday found a NIT that committed Unit 2b evidence logs had trailing whitespace when checking the full `99506fe..72d39ab` review range; scrubbed trailing whitespace from Unit 2b evidence logs in `0a55102` and verified `git diff --check 99506fe..HEAD` and `git diff --check` pass
- 2026-06-14 17:51 Unit 2b cold reviewer gate converged after blocker and hygiene fixes; Huygens verified native Codex activation surfaces, AGENTS worker-default materialization, evidence logs, checklist scope, and clean `git diff --check 99506fe..5642d3d`
- 2026-06-14 18:02 Unit 2c complete: hardened Codex activation owned-block handling in `cb8b301`; red evidence covered repeated activation, old-version replacement, malformed/duplicate owned blocks, user-authored Desk disablement, and empty host files; green evidence saved in `unit-2c-codex-activation-green.log`, `unit-2c-test-coverage-green.log`, `unit-2c-npm-test-green.log`, and `unit-2c-validate-skills-green.log`; verified `node --test plugins/desk/mcp/__tests__/activation/codex_activation.test.js`, `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`; no Desk MCP build script exists, so no separate build command was available
- 2026-06-14 18:15 Unit 2c reviewer fix: Beauvoir found a MAJOR gap where user-authored Desk disablement in legal dotted-key and inline-table TOML could be silently overridden; added coverage for section, dotted-key, quoted/escaped-key, inline-table, and plugin-MCP disable shapes; replaced exact-section scanning with TOML-aware defensive scanning; committed as `ce969d0`; refreshed `unit-2c-review-fix-codex-activation-green.log`, `unit-2c-review-fix-test-coverage-green.log`, `unit-2c-review-fix-npm-test-green.log`, and `unit-2c-review-fix-validate-skills-green.log`; verified targeted Codex activation tests, coverage, full MCP tests, validation, and `git diff --check a65f934`
- 2026-06-14 18:15 Unit 2c evidence hygiene: scrubbed trailing whitespace from review-fix evidence logs in `55c05b6` and verified `git diff --check a65f934..HEAD` plus `git diff --check` pass
- 2026-06-14 18:15 Unit 2c Round 2 cold reviewer gate converged; Beauvoir verified the legal TOML disabled-Desk override gap and evidence whitespace finding are closed
- 2026-06-14 18:20 Unit 2d complete: added activation artifact ownership red tests and fixtures in `113cafc`; targeted red run saved to `unit-2d-artifact-ownership-red.log` and fails because `plugins/desk/mcp/src/activation/artifact-ledger.js` does not exist yet
- 2026-06-14 18:24 Unit 2d reviewer fix: Erdos found the upgrade red test accidentally appended duplicate `.codex/config.toml` artifacts in one activation request and broad pass/coverage checklist boxes stayed checked during an intentional red-test state; fixed the helper so artifact overrides replace the list, made the upgrade request include one v2 config and one v2 instructions artifact, refreshed `unit-2d-artifact-ownership-red.log`, and committed as `7d24e37`
- 2026-06-14 18:24 Unit 2d Round 2 cold reviewer gate converged; Erdos verified the duplicate-path test-contract issue and red-state checklist issue are closed
- 2026-06-14 18:27 Unit 2e complete: implemented `plugins/desk/mcp/src/activation/artifact-ledger.js` in `6134ba1` with ledger creation, artifact upgrade replacement, deactivation block cleanup, user-authored content preservation, and never-delete desk-data skips; saved `unit-2e-artifact-ownership-green.log`, `unit-2e-test-coverage-green.log`, `unit-2e-npm-test-green.log`, and `unit-2e-validate-skills-green.log`; verified targeted ownership tests, `npm --prefix plugins/desk/mcp run test:coverage`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 18:41 Unit 2e reviewer fix: Euclid found a BLOCKER that Codex activation did not route apply/deactivate through the ownership ledger and a MAJOR gap where deactivation trusted caller-supplied never-delete policy; Leibniz implemented the scoped fix in `aff63df` by adding ledger-backed `applyCodexActivation`/`deactivateCodexActivation`, mapping global `~/` artifacts under the host root, and making deactivation read `ledger.never_delete`; saved `unit-2e-review-fix-artifact-ownership-red.log`, `unit-2e-review-fix-codex-activation-red.log`, targeted green logs, coverage/full-test/validation logs, and verified `git diff --check`
- 2026-06-14 18:43 Unit 2e Round 2 cold reviewer gate converged; Euclid verified the ledger-backed Codex apply/deactivate path, persisted never-delete policy, targeted tests, coverage, and clean `git diff --check b0f6599..fe78f19`
- 2026-06-14 18:48 Unit 2f complete: added missing-ledger, corrupt-ledger, user-edited generated artifact, repeated deactivate, and partial-apply rollback coverage in `ac0c9a4`, then hardened `plugins/desk/mcp/src/activation/artifact-ledger.js` in `65c5c02`; saved `unit-2f-artifact-ownership-red.log`, `unit-2f-artifact-ownership-green.log`, `unit-2f-test-coverage-green.log`, `unit-2f-npm-test-green.log`, `unit-2f-validate-skills-green.log`, and `unit-2f-build-unavailable.log`; verified targeted ownership tests, 100% coverage for `artifact-ledger.js`, `npm --prefix plugins/desk/mcp test`, `node scripts/validate-skills.cjs`, and `git diff --check`
- 2026-06-14 18:52 Unit 2f cold reviewer gate converged; Fermat verified all five requested edge cases, safe rollback/user-edit handling, 100% `artifact-ledger.js` coverage, clean range diff, justified doing-doc status, and expected-only `semantic_unavailable` fallback diagnostics
- 2026-06-14 18:55 Unit 3a complete: added `plugins/desk/mcp/__tests__/activation/support_matrix.test.js` and `host-capability-evidence.md` in `1675eb2`; evidence table includes required columns and rows for `claude`, `codex`, `copilot-root`, `ouroboros-autonomous-agent`, and `generic-stdio`; targeted red run saved to `unit-3a-support-matrix-red.log` and fails because `plugins/desk/mcp/src/activation/support-matrix.js` and the generated support-matrix artifact do not exist yet
- 2026-06-14 18:59 Unit 3a cold reviewer gate converged; Meitner verified the evidence columns/host rows, meaningful red test contract, correctly scoped missing-generator failure, clean bookkeeping, and no stale source paths or whitespace issues
- 2026-06-14 19:05 Unit 3b complete: implemented `plugins/desk/mcp/src/activation/support-matrix.js`, `plugins/desk/mcp/scripts/generate-support-matrix.js`, package script `activation:support-matrix:generate`, and generated `plugins/desk/activation/support-matrix.json` in `0d21a6c`; saved `unit-3b-generate-support-matrix-green.log`, `unit-3b-support-matrix-green.log`, `unit-3b-test-coverage-green.log`, `unit-3b-npm-test-green.log`, `unit-3b-validate-skills-green.log`, and `unit-3b-build-unavailable.log`; verified the generator command, targeted support-matrix tests, 100% coverage for support-matrix code and script, full MCP tests, skill validation, and `git diff --check`
- 2026-06-14 19:09 Unit 3b cold reviewer gate converged; Kuhn verified npm-prefix generator reproducibility, generated artifact freshness, all five host dispositions, scoped validation, 100% support-matrix coverage, clean diff check, and accurate no-build-script evidence
- 2026-06-14 19:13 Unit 3c complete: added edge-case coverage for unknown support hosts, missing required evidence rows, unsupported primitive values, and native-or-flattened/transitive-dependency conflicts in `c39457a`, then hardened `plugins/desk/mcp/src/activation/support-matrix.js` in `30b4b9b`; saved `unit-3c-support-matrix-red.log`, `unit-3c-support-matrix-green.log`, `unit-3c-test-coverage-green.log`, `unit-3c-npm-test-green.log`, `unit-3c-validate-skills-green.log`, and `unit-3c-build-unavailable.log`; verified targeted support-matrix tests, 100% coverage for support-matrix code, full MCP tests, skill validation, no build script available, and `git diff --check`
- 2026-06-14 19:17 Unit 3c cold reviewer gate converged; Gauss verified the unknown-host, missing-required-row, unsupported-primitive, and native-or-flattened conflict coverage, support-matrix validation behavior, 100% coverage evidence, passing support-matrix/full-suite logs, and justified doing-doc checklist updates
- 2026-06-14 19:21 Unit 4a complete: added Claude/Work Suite packaging red tests in `47aa564`; targeted red run saved to `unit-4a-claude-packaging-red.log` and fails on missing explicit Claude component metadata, native Work Suite dependency/provider metadata, worker Agent View/background-session disposition, and Claude permission-boundary metadata; terminal green criteria intentionally unchecked until Unit 4b makes the new tests pass
- 2026-06-14 19:31 Unit 4a reviewer fix: James found a BLOCKER that the Agent View/background assertions forced a supported disposition despite the planning contract allowing explicit unsupported/degraded documentation, plus a MAJOR gap tying Claude metadata to evidence/support-matrix freshness; Dewey fixed the red tests in `527a417` to accept documented supported or unsupported dispositions and to assert the Claude-native `agents/worker.md` source across activation manifest, evidence row, and generated support matrix; refreshed `unit-4a-claude-packaging-red.log`
- 2026-06-14 19:35 Unit 4a Round 2 cold reviewer gate converged; Lovelace verified the prior overclaiming and support-matrix/evidence freshness gaps are closed, the red log remains intentional, and the broad green criteria stay unchecked during the red-test state
- 2026-06-14 19:39 Unit 4b complete: added Claude-native Desk plugin metadata, native Work Suite dependency/provider metadata, Claude worker frontmatter, Agent View/background-session support disposition, and permission-boundary documentation in `82066cb`; corrected the activation manifest and evidence row to use `agents/worker.md` for Claude, regenerated `plugins/desk/activation/support-matrix.json` through `npm --prefix plugins/desk/mcp run activation:support-matrix:generate`, and saved `unit-4b-generate-support-matrix-green.log`, `unit-4b-claude-packaging-green.log`, `unit-4b-activation-tests-green.log`, `unit-4b-test-coverage-green.log`, `unit-4b-npm-test-green.log`, `unit-4b-validate-skills-green.log`, `unit-4b-claude-help-evidence.log`, and `unit-4b-build-unavailable.log`; verified targeted Claude packaging tests, activation/support-matrix freshness tests, 100% coverage, full MCP tests, skill validation, Claude CLI support evidence, no build script available, and `git diff --check`
- 2026-06-14 19:55 Unit 4b reviewer fix: Plato found the claimed Claude-native surface did not pass `claude plugin validate`, Agent View/background inheritance was overclaimed from help text only, and the Claude evidence row cited self-asserting tests; Galileo fixed the blocker in `3a3fc54` by making Claude manifests strict-loadable, moving agent-file docs to `plugins/desk/docs/agent-files.md`, quoting malformed skill frontmatter, moving host-specific activation metadata into `desk.activation.json`, downgrading Agent View/background to degraded/unsupported with explicit primitives, citing independent Claude validation/help evidence, regenerating the support matrix, and saving `unit-4b-review-fix-claude-desk-validate-green.log`, `unit-4b-review-fix-claude-work-suite-validate-green.log`, `unit-4b-review-fix-claude-support-green.log`, `unit-4b-review-fix-activation-contract-green.log`, `unit-4b-review-fix-test-coverage-green.log`, `unit-4b-review-fix-npm-test-green.log`, `unit-4b-review-fix-validate-skills-green.log`, and `unit-4b-review-fix-generate-support-matrix-green.log`
- 2026-06-14 19:59 Unit 4b Round 2 cold reviewer gate converged; Ampere verified the strict Claude plugin validations, honest degraded/unsupported Agent View/background metadata, independent Claude evidence row, regenerated support matrix, targeted/full-suite/coverage logs, and justified doing-doc updates
- 2026-06-14 20:05 Unit 4c complete: added red edge tests for missing Work Suite dependency, stale Work Suite dependency/provider versions, missing worker exposure, illegal Claude manifest activation metadata, and unsupported Agent View/background-session claims in `e521c56`, then implemented `plugins/desk/mcp/src/activation/claude-packaging.js` in `fa38d30`; saved `unit-4c-claude-packaging-red.log`, `unit-4c-claude-packaging-green.log`, `unit-4c-test-coverage.log`, `unit-4c-npm-test-green.log`, `unit-4c-diff-check-green.log`, and `unit-4c-build-unavailable.log`; verified targeted Claude packaging tests, 100% coverage for `claude-packaging.js`, full Desk MCP tests, and no build script available. Reviewer cleanup later scrubbed trailing whitespace from Unit 4c logs and refreshed `unit-4c-diff-check-green.log`; root and Work Suite plugin metadata drift remains open pending Unit 5.
- 2026-06-14 20:15 Unit 4c reviewer fix: Ramanujan found a MAJOR doing-doc overclaim on the root/Work Suite manifest-drift checklist and a MINOR whitespace/evidence issue in Unit 4c logs; Popper reversed the checklist item, softened the progress wording, scrubbed Unit 4c log trailing whitespace, refreshed `unit-4c-diff-check-green.log`, and the fix landed in `6f892a1`
- 2026-06-14 20:18 Unit 4c Round 2 cold reviewer gate converged; Heisenberg verified the checklist overclaim and log whitespace findings are closed, `git diff --check 9ea3f97..HEAD` exits 0, targeted Claude packaging tests still pass, full-suite and coverage logs remain credible, and `claude-packaging.js` remains at 100% coverage
- 2026-06-14 20:19 Unit 5a complete: added Copilot/root packaging red tests in `b72784c`; targeted red run saved to `unit-5a-copilot-packaging-red.log` and fails on stale `plugins/desk/plugin.json` version metadata, missing `plugins/work-suite/plugin.json`, missing generated flattened-bundle metadata, planned-not-supported Copilot/root evidence/support-matrix disposition, and healthy-path docs that still require manual Work Suite installation
- 2026-06-14 20:24 Unit 5a reviewer fix: Peirce found the flattened-bundle test could be satisfied by hand-edited JSON and the red log had trailing whitespace; tightened `copilot_packaging.test.js` in `574b699` to require `activation:copilot-bundle:generate`, `scripts/generate-copilot-bundle.js`, and freshness against a manifest-derived expected bundle, then refreshed and scrubbed `unit-5a-copilot-packaging-red.log`
- 2026-06-14 20:26 Unit 5a Round 2 cold reviewer gate converged; Godel verified the generated-bundle freshness/script gap and red-log whitespace finding are closed, `git diff --check 6f892a1..177a10d` exits 0, and the red tests still fail for real current packaging gaps
- 2026-06-14 20:31 Unit 5b complete: added Copilot/root flattened packaging in `cfa1814` by aligning `plugins/desk/plugin.json` to version `1.7.3`, adding `plugins/work-suite/plugin.json`, pointing the activation manifest's Copilot entrypoint to `agents/worker.agent.md`, adding `plugins/desk/mcp/src/activation/copilot-bundle.js` plus `scripts/generate-copilot-bundle.js`, generating `plugins/desk/activation/copilot-root.flattened-bundle.json`, updating the Copilot/root evidence row, regenerating `plugins/desk/activation/support-matrix.json`, and removing healthy-path Copilot Work Suite manual-install docs; saved `unit-5b-generate-copilot-bundle-green.log`, `unit-5b-generate-support-matrix-green.log`, `unit-5b-copilot-packaging-green.log`, `unit-5b-host-packaging-green.log`, `unit-5b-activation-support-green.log`, `unit-5b-test-coverage-green.log`, `unit-5b-npm-test-green.log`, `unit-5b-validate-skills-green.log`, `unit-5b-diff-check-green.log`, and `unit-5b-build-unavailable.log`; verified targeted Copilot packaging tests, host packaging tests, activation/support-matrix tests, 100% coverage for `copilot-bundle.js` and `generate-copilot-bundle.js`, full Desk MCP tests, skill validation, no build script available, and `git diff --check`
- 2026-06-14 20:35 Unit 5b reviewer fix: Aristotle found a MAJOR evidence-hygiene issue where committed Unit 5b logs failed `git diff --check 177a10d..7fe362f`; scrubbed trailing whitespace from the Unit 5b logs in `f0a8445`, refreshed `unit-5b-diff-check-green.log`, and verified `git diff --check 177a10d..HEAD` plus `git diff --check` both exit 0
- 2026-06-14 20:45 Unit 5c complete: hardened Copilot/root packaging validation in `8f64303` after red checkpoints `83578a7` and `unit-5c-defensive-validator-red.log`; `validateCopilotPackagingContract` now reports missing root surfaces, stale Desk/Work Suite versions, missing Work Suite activation locks, missing/incomplete flattened dependency closure, stale bundle metadata, and missing/wrong `desk:worker` source without crashing; saved `unit-5c-copilot-packaging-green.log`, `unit-5c-test-coverage-green.log`, `unit-5c-npm-test-green.log`, `unit-5c-validate-skills-green.log`, `unit-5c-build-unavailable.log`, and `unit-5c-diff-check-green.log`; verified focused Copilot packaging tests, full Desk MCP tests, 100% coverage for `copilot-bundle.js`, skill validation, expected missing build script disposition, and `git diff --check`
- 2026-06-14 20:52 Unit 5c reviewer fix: Descartes found a MAJOR fail-closed gap where malformed Copilot packaging inputs could still throw; `ea4711b` added regression coverage for missing `activation.dependencies`, missing `bundle`, missing `workSuitePlugin`, and malformed closure entries, normalized nested validator inputs, and saved `unit-5c-review-fix-red.log`, `unit-5c-review-fix-green.log`, `unit-5c-review-fix-coverage-green.log`, `unit-5c-review-fix-npm-test-green.log`, `unit-5c-review-fix-validate-skills-green.log`, `unit-5c-review-fix-build-unavailable.log`, and `unit-5c-review-fix-diff-check-green.log`
- 2026-06-14 20:52 Unit 5c Round 2 cold reviewer gate converged; Bohr verified the malformed-input fail-closed finding is closed, original Unit 5c acceptance still holds, coverage/full-suite evidence remains credible, and the expected missing build-script disposition is documented
- 2026-06-14 20:59 Unit 6a complete: added Ouroboros/autonomous-agent and generic stdio packaging red tests in `38dac70`; targeted red run saved to `unit-6a-ouroboros-stdio-packaging-red.log` and fails because the activation manifest lacks an `ouroboros-autonomous-agent` host-support row, Ouroboros docs do not show a concrete `bundle.json` plugin closure with `$DESK` preamble binding, generic stdio evidence still uses `degraded-manual-host` instead of an MCP-only disposition, and the MCP README lacks a generic stdio launch section; terminal `All tests pass` criterion intentionally unchecked until Unit 6b makes the new tests green
- 2026-06-14 21:05 Unit 6a reviewer fix: Pauli found MAJOR gaps where evidence-anchor strings were not proven by real activation README sections and the `$DESK` assertion accepted a circular binding; `c28fb56` added markdown-anchor validation for the Ouroboros and generic stdio activation sections, required those sections to state their dispositions, and changed the Ouroboros README assertion to require `$DESK = ~/AgentBundles/<agent>.ouro/desk/`; refreshed red evidence in `unit-6a-review-fix-ouroboros-stdio-packaging-red.log`
- 2026-06-14 21:05 Unit 6a Round 2 cold reviewer gate converged; Parfit verified the activation-anchor and concrete `$DESK` binding findings are closed, the red tests still target real current gaps, and terminal `All tests pass` remains unchecked while Unit 6a is intentionally red
- 2026-06-14 21:12 Unit 6b complete: implemented Ouroboros/autonomous-agent and generic stdio packaging dispositions in `22fa50d` by adding an `ouroboros-autonomous-agent` activation host-support row, updating generic stdio to `degraded-mcp-only`, adding `plugin-dependency-resolution` to activation/support-matrix unsupported primitive allow-lists, documenting `bundle.json` plus `$DESK = ~/AgentBundles/<agent>.ouro/desk/`, adding activation README anchors, adding generic stdio MCP-only launch docs, updating host-capability evidence, and regenerating `plugins/desk/activation/support-matrix.json`; saved `unit-6b-generate-support-matrix-green.log`, `unit-6b-ouroboros-stdio-packaging-green.log`, `unit-6b-support-matrix-green.log`, `unit-6b-activation-contract-green.log`, `unit-6b-test-coverage-green.log`, `unit-6b-npm-test-green.log`, `unit-6b-validate-skills-green.log`, `unit-6b-build-unavailable.log`, and `unit-6b-diff-check-green.log`; verified targeted packaging, support-matrix, activation-contract, coverage, full MCP suite, skill validation, expected missing build script disposition, and `git diff --check`
- 2026-06-14 21:20 Unit 6b reviewer fix: Hypatia found a MAJOR generic-stdio documentation bug where `DESK=~/desk node ... --root "$DESK"` expands `$DESK` before the inline assignment applies; `2443f0f` added a regression assertion rejecting that one-liner and changed the README to a two-step binding before launch; saved `unit-6b-review-fix-ouroboros-stdio-red.log`, `unit-6b-review-fix-ouroboros-stdio-green.log`, `unit-6b-review-fix-test-coverage-green.log`, `unit-6b-review-fix-npm-test-green.log`, `unit-6b-review-fix-validate-skills-green.log`, `unit-6b-review-fix-build-unavailable.log`, and `unit-6b-review-fix-diff-check-green.log`
- 2026-06-14 21:24 Unit 6b Round 2 cold reviewer gate converged; Curie verified the shell-binding fix, support matrix/evidence/manifest/docs alignment for `ouroboros-autonomous-agent` and `generic-stdio`, local reruns for targeted packaging/support/contract/full-suite/coverage/skill validation, expected missing build-script disposition, and `git diff --check e83e2c5..8884235`
- 2026-06-14 21:32 Unit 6c complete: added `validateOuroborosStdioPackagingContract` in `80225de` after red checkpoint `2201dc9`; the validator now rejects missing Ouroboros `$DESK` preamble binding, missing `bundle.json`/Desk/Work Suite bundle metadata, missing bundle evidence sources, Ouroboros host-support drift, unsafe generic stdio inline `$DESK` binding, missing explicit `--root`, worker-activation claims, generic stdio dependency-support claims, malformed host capability/unsupported-primitive lists, missing fallback text, and missing/malformed host/evidence rows without crashing; saved `unit-6c-ouroboros-stdio-packaging-red.log`, `unit-6c-ouroboros-stdio-packaging-green.log`, `unit-6c-test-coverage-green.log`, `unit-6c-npm-test-green.log`, `unit-6c-validate-skills-green.log`, `unit-6c-build-unavailable.log`, and `unit-6c-diff-check-green.log`; verified targeted packaging tests, 100% line/branch/function coverage for `ouroboros-stdio-packaging.js`, full Desk MCP suite, skill validation, expected missing build script disposition, and `git diff --check`
- 2026-06-14 21:39 Unit 6c reviewer fix: Harvey found P1/P2 overfitting where generic stdio docs could still claim `desk:worker`/agent-defaults/plugin-dependency support with different wording, and Ouroboros bundle metadata checks could be satisfied by prose instead of the fenced `bundle.json` object; `66732d0` added red probes in `74374fd`, parses the actual JSON bundle plugin list, rejects malformed bundle JSON, scans positive generic stdio worker/dependency claims while preserving negative boundary wording, and saved `unit-6c-review-fix-ouroboros-stdio-red.log`, `unit-6c-review-fix-ouroboros-stdio-green.log`, `unit-6c-review-fix-test-coverage-green.log`, `unit-6c-review-fix-npm-test-green.log`, `unit-6c-review-fix-validate-skills-green.log`, `unit-6c-review-fix-build-unavailable.log`, and `unit-6c-review-fix-diff-check-green.log`
- 2026-06-14 21:45 Unit 6c round-two reviewer fix: Singer found P2 gaps where mixed negative/positive generic stdio sentences could hide support claims and malformed bundle JSON could be skipped if a later fenced JSON block had the right plugin list; `b832fa8` added red probes in `5d9f727`, treats the first fenced JSON bundle block as authoritative, emits `Ouroboros bundle metadata must be valid JSON` for malformed bundle metadata, splits generic stdio statements into clauses so negative boundary clauses do not shield later positive claims, preserves the negative-boundary control case, and saved `unit-6c-round2-fix-ouroboros-stdio-red.log`, `unit-6c-round2-fix-ouroboros-stdio-green.log`, `unit-6c-round2-fix-test-coverage-green.log`, `unit-6c-round2-fix-npm-test-green.log`, `unit-6c-round2-fix-validate-skills-green.log`, `unit-6c-round2-fix-build-unavailable.log`, and `unit-6c-round2-fix-diff-check-green.log`
- 2026-06-14 21:53 Unit 6c round-three reviewer fix: Hume found P1/P2 gaps where `no`/`without` after a positive support action suppressed real claims and `will not ...` negation false-positived, plus the activation README generic-stdio section was collected but not validated; `73d9099` added red probes in `7fc2062`, scopes negation to the support action instead of the whole clause, validates generic stdio claims across both MCP README and activation README sections, keeps `will not activate/resolve` as a negative-boundary control, and saved `unit-6c-round3-fix-ouroboros-stdio-red.log`, `unit-6c-round3-fix-ouroboros-stdio-green.log`, `unit-6c-round3-fix-test-coverage-green.log`, `unit-6c-round3-fix-npm-test-green.log`, `unit-6c-round3-fix-validate-skills-green.log`, `unit-6c-round3-fix-build-unavailable.log`, and `unit-6c-round3-fix-diff-check-green.log`
- 2026-06-14 22:00 Unit 6c round-four reviewer fix: Confucius found P1/P2/P3 gaps where canonical identifier spellings (`work-suite`, `plugin-dependency-resolution`, `agent-defaults`), `supports` verbs, and `neither/nor` negatives were not handled; `3d06f45` added red probes in `b372b73`, normalizes markdown/prose identifiers before claim matching, recognizes support/provide/expose/enable verbs, keeps action-scoped negation for `neither`/`nor`, and saved `unit-6c-round4-fix-ouroboros-stdio-red.log`, `unit-6c-round4-fix-ouroboros-stdio-green.log`, `unit-6c-round4-fix-test-coverage-green.log`, `unit-6c-round4-fix-npm-test-green.log`, `unit-6c-round4-fix-validate-skills-green.log`, `unit-6c-round4-fix-build-unavailable.log`, and `unit-6c-round4-fix-diff-check-green.log`
- 2026-06-14 22:10 Unit 6c round-five reviewer fix: Bacon found a MAJOR mixed-claim false-negative for `yet`/`though`/`while` clauses and false positives for `doesn't support desk:worker` plus `starts the MCP server, not worker activation`; `2b0e71a` added red probes in `c3a3430`, splits claim text on additional contrast markers and commas, scans every action/target pair in a clause instead of only the first action, recognizes common contraction negatives, suppresses post-action negative targets, and saved `unit-6c-round5-fix-ouroboros-stdio-red.log`, `unit-6c-round5-fix-ouroboros-stdio-green.log`, `unit-6c-round5-fix-test-coverage-green.log`, `unit-6c-round5-fix-npm-test-green.log`, `unit-6c-round5-fix-validate-skills-green.log`, `unit-6c-round5-fix-build-unavailable.log`, and `unit-6c-round5-fix-diff-check-green.log`
- 2026-06-14 22:16 Unit 6c round-six reviewer fix: Mill found P1/P2 gaps where scoped-section contradictions without the literal phrase `generic stdio` passed and `supports neither ... nor ...` target negation false-positived; `dafc066` added red probes in `a12d76f`, treats generic stdio sections as already scoped for claim scanning, detects unqualified `This path provides ...` contradictions, and checks negation between support actions and targets so `neither`/`nor` target lists remain negative, with evidence in `unit-6c-round6-fix-ouroboros-stdio-red.log`, `unit-6c-round6-fix-ouroboros-stdio-green.log`, `unit-6c-round6-fix-test-coverage-green.log`, `unit-6c-round6-fix-npm-test-green.log`, `unit-6c-round6-fix-validate-skills-green.log`, `unit-6c-round6-fix-build-unavailable.log`, and `unit-6c-round6-fix-diff-check-green.log`
- 2026-06-14 22:22 Unit 6c round-seven reviewer fix: Tesla found a P2 passive target-before-action negation gap where `Neither desk:worker nor Work Suite is supported...`, `Neither worker activation nor Work Suite dependency closure is provided...`, and `No Work Suite dependency closure is enabled here` false-positived; `db80fb7` added red probes in `ead9677`, extends target-prefix negation to cover `neither` and `no` before target terms regardless of action order, and saved `unit-6c-round7-fix-ouroboros-stdio-red.log`, `unit-6c-round7-fix-ouroboros-stdio-green.log`, `unit-6c-round7-fix-test-coverage-green.log`, `unit-6c-round7-fix-npm-test-green.log`, `unit-6c-round7-fix-validate-skills-green.log`, `unit-6c-round7-fix-build-unavailable.log`, and `unit-6c-round7-fix-diff-check-green.log`
- 2026-06-14 22:29 Unit 6c round-eight reviewer fix: Nash found a P1 overcorrection where broad `no`/`neither` target-prefix negation hid positive `because ... supports ...` claims such as `No manual setup is needed because generic stdio supports Work Suite automatically`; `95f246b` added red probes in `98f66ef`, splits support-claim clauses on causal/label boundaries before applying negation, preserves explicit `No worker activation`/`No plugin dependencies`/`Worker activation is not provided` controls, and saved `unit-6c-round8-fix-ouroboros-stdio-red.log`, `unit-6c-round8-fix-ouroboros-stdio-green.log`, `unit-6c-round8-fix-test-coverage-green.log`, `unit-6c-round8-fix-npm-test-green.log`, `unit-6c-round8-fix-validate-skills-green.log`, `unit-6c-round8-fix-build-unavailable.log`, and `unit-6c-round8-fix-diff-check-green.log`
- 2026-06-14 22:37 Unit 6c round-nine reviewer fix: Hilbert found remaining causal-boundary false negatives where `as`, `so`, and spaced dash clauses could still hide positive generic stdio Work Suite/worker activation claims after a negative manual-setup clause; `46b9167` added implementation after red probes in `7545268`, splits support-claim clauses on those additional causal/dash boundaries while preserving scoped negative controls and `desk:worker` identifiers, and saved `unit-6c-round9-fix-ouroboros-stdio-red.log`, `unit-6c-round9-fix-ouroboros-stdio-green.log`, `unit-6c-round9-fix-test-coverage-green.log`, `unit-6c-round9-fix-npm-test-green.log`, `unit-6c-round9-fix-validate-skills-green.log`, `unit-6c-round9-fix-build-unavailable.log`, and `unit-6c-round9-fix-diff-check-green.log`
- 2026-06-14 22:44 Unit 6c round-ten reviewer fix: Herschel found a MAJOR evidence-row drift gap where the generic stdio evidence row could claim a supported/flattened disposition, omit unsupported primitives, and describe worker/dependency support while the validator still passed; `a24b16e` added implementation after red probes in `ea55bfb`, validates generic stdio evidence disposition, required source paths, unsupported primitives, and no-worker-activation fallback wording, preserves 100% coverage with a missing-fallback edge case, and saved `unit-6c-round10-fix-ouroboros-stdio-red.log`, `unit-6c-round10-fix-ouroboros-stdio-green.log`, `unit-6c-round10-fix-test-coverage-green.log`, `unit-6c-round10-fix-npm-test-green.log`, `unit-6c-round10-fix-validate-skills-green.log`, `unit-6c-round10-fix-build-unavailable.log`, and `unit-6c-round10-fix-diff-check-green.log`
- 2026-06-14 22:51 Unit 6c round-eleven reviewer fix: Noether found a MAJOR fallback drift gap where host-support and evidence fallback text could include the required `no worker activation` marker while also claiming automatic plugin dependency resolution; `4f39051` added implementation after red probes in `4620901`, reuses the hardened dependency-claim scanner on otherwise well-formed generic stdio fallback text, preserves earlier missing-fallback diagnostics, and saved `unit-6c-round11-fix-ouroboros-stdio-red.log`, `unit-6c-round11-fix-ouroboros-stdio-green.log`, `unit-6c-round11-fix-test-coverage-green.log`, `unit-6c-round11-fix-npm-test-green.log`, `unit-6c-round11-fix-validate-skills-green.log`, `unit-6c-round11-fix-build-unavailable.log`, and `unit-6c-round11-fix-diff-check-green.log`
- 2026-06-14 22:57 Unit 6c round-twelve reviewer fix: Aquinas found a MAJOR semantic dependency-support gap where generic stdio prose like `provides plugin dependency support automatically` or `provides dependency resolution automatically` avoided the dependency target matcher; `6823429` added implementation after red probes in `fb441a7`, expands dependency target wording to include plugin dependency support, dependency resolution, and dependency support, and saved `unit-6c-round12-fix-ouroboros-stdio-red.log`, `unit-6c-round12-fix-ouroboros-stdio-green.log`, `unit-6c-round12-fix-test-coverage-green.log`, `unit-6c-round12-fix-npm-test-green.log`, `unit-6c-round12-fix-validate-skills-green.log`, `unit-6c-round12-fix-build-unavailable.log`, and `unit-6c-round12-fix-diff-check-green.log`
- 2026-06-14 23:05 Unit 6c round-thirteen reviewer fix: Schrodinger found a MAJOR action-wording gap where generic stdio prose like `handles dependency resolution automatically` or `manages plugin dependencies automatically` avoided the support-action matcher; `5fb34fd` added implementation after red probes in `e54ebe3`, widens worker/dependency support action wording to include common operation verbs such as handles, manages, wires, bootstraps, configures, prepares, supplies, and delivers, and saved `unit-6c-round13-fix-ouroboros-stdio-red.log`, `unit-6c-round13-fix-ouroboros-stdio-green.log`, `unit-6c-round13-fix-test-coverage-green.log`, `unit-6c-round13-fix-npm-test-green.log`, `unit-6c-round13-fix-validate-skills-green.log`, `unit-6c-round13-fix-build-unavailable.log`, and `unit-6c-round13-fix-diff-check-green.log`
- 2026-06-14 23:11 Unit 6c round-fourteen reviewer fix: Epicurus found MAJOR gaps where fallback metadata could include the required `no worker activation` marker while also claiming worker activation, and docs could claim `sets up Work Suite` or `ships worker activation` without matching the action detector; `8f761a7` added implementation after red probes in `5702a0d`, rejects worker-activation contradictions in otherwise well-formed fallback metadata, adds set-up/ship action wording, preserves missing-fallback diagnostics, and saved `unit-6c-round14-fix-ouroboros-stdio-red.log`, `unit-6c-round14-fix-ouroboros-stdio-green.log`, `unit-6c-round14-fix-test-coverage-green.log`, `unit-6c-round14-fix-npm-test-green.log`, `unit-6c-round14-fix-validate-skills-green.log`, `unit-6c-round14-fix-build-unavailable.log`, and `unit-6c-round14-fix-diff-check-green.log`
- 2026-06-14 23:19 Unit 6c round-fifteen reviewer fix: Laplace found MAJOR gaps where `spawns the worker`/`bundles Work Suite` still avoided the action matcher and legitimate `A separate host...` fallback wording false-positived after the action vocabulary widened; `d67bc76` added implementation after red probes in `07e416a`, adds spawn/bundle action wording, ignores support claims explicitly assigned to a separate/external/another host or overlay, and saved `unit-6c-round15-fix-ouroboros-stdio-red.log`, `unit-6c-round15-fix-ouroboros-stdio-green.log`, `unit-6c-round15-fix-test-coverage-green.log`, `unit-6c-round15-fix-npm-test-green.log`, `unit-6c-round15-fix-validate-skills-green.log`, `unit-6c-round15-fix-build-unavailable.log`, and `unit-6c-round15-fix-diff-check-green.log`
- 2026-06-14 23:26 Unit 6c round-sixteen reviewer fix: Copernicus found MAJOR gaps where passive external-host fallback wording like `Work Suite dependency closure must be provided by a separate host or overlay` still false-positived, and Ouroboros evidence rows could drift to unsupported/manual-install wording while preserving required source paths; `56da7b3` added implementation after red probes in `6cadd35`, recognizes passive external support assignments, validates Ouroboros evidence disposition, unsupported primitive, bundled Desk + Work Suite fallback, and `$DESK` binding, preserves 100% coverage with a missing-fallback edge case, and saved `unit-6c-round16-fix-ouroboros-stdio-red.log`, `unit-6c-round16-fix-ouroboros-stdio-green.log`, `unit-6c-round16-fix-test-coverage-green.log`, `unit-6c-round16-fix-npm-test-green.log`, `unit-6c-round16-fix-validate-skills-green.log`, `unit-6c-round16-fix-build-unavailable.log`, and `unit-6c-round16-fix-diff-check-green.log`
- 2026-06-14 23:37 Unit 6c round-seventeen reviewer fix: Volta found MAJOR gaps where progressive support verbs (`launching`, `loading`) were missed, external-host suppression was clause-wide and could hide a real generic stdio worker claim, and adverbial negation like `does not automatically activate` false-positived; `7a07e8f` added implementation after red probes in `32b0c03`, expands progressive action wording, scopes external-host assignment suppression to the specific target, orders compound targets before short targets, and permits common adverbs after negation boundaries; saved `unit-6c-round17-fix-ouroboros-stdio-red.log`, `unit-6c-round17-fix-ouroboros-stdio-green.log`, `unit-6c-round17-fix-test-coverage-green.log`, `unit-6c-round17-fix-npm-test-green.log`, `unit-6c-round17-fix-validate-skills-green.log`, `unit-6c-round17-fix-build-unavailable.log`, and `unit-6c-round17-fix-diff-check-green.log`
- 2026-06-14 23:44 Unit 6c round-eighteen reviewer fix: Ohm found a MAJOR false positive where active degraded-path wording like `Generic stdio requires a separate host to provide Work Suite dependency closure` or `depends on an external overlay to start worker activation` was treated as a generic stdio support claim; `857a86c` added implementation after red probes in `370bd3c`, recognizes target-scoped `requires`/`needs`/`depends on` external host or overlay assignments without broadly suppressing generic stdio positive claims, and saved `unit-6c-round18-fix-ouroboros-stdio-red.log`, `unit-6c-round18-fix-ouroboros-stdio-green.log`, `unit-6c-round18-fix-test-coverage-green.log`, `unit-6c-round18-fix-npm-test-green.log`, `unit-6c-round18-fix-validate-skills-green.log`, `unit-6c-round18-fix-build-unavailable.log`, and `unit-6c-round18-fix-diff-check-green.log`
- 2026-06-14 23:51 Unit 6c round-nineteen reviewer fix: Mencius found a MAJOR follow-on false positive where active external-host assignment with neutral adverbs like `to manually provide Work Suite dependency closure` or `to explicitly start worker activation` was still treated as generic stdio support; `49c7367` added implementation after red probes in `d8c0d63`, allows a bounded neutral-adverb list between `to` and the target-scoped external support verb, preserves the adjacent positive-claim rejection coverage, and saved `unit-6c-round19-fix-ouroboros-stdio-red.log`, `unit-6c-round19-fix-ouroboros-stdio-green.log`, `unit-6c-round19-fix-test-coverage-green.log`, `unit-6c-round19-fix-npm-test-green.log`, `unit-6c-round19-fix-validate-skills-green.log`, `unit-6c-round19-fix-build-unavailable.log`, and `unit-6c-round19-fix-diff-check-green.log`
- 2026-06-14 23:59 Unit 6c round-twenty reviewer fix: Gauss the 2nd found MAJOR scanner gaps where a prefix external-host exemption could hide a later `then generic stdio supports Work Suite automatically` claim, and noun phrasing like `generic stdio support matrix records Work Suite dependency closure as unsupported` false-positived as a support claim; `e728ecb` added implementation after red probes in `eb0e195`, splits claim clauses on `then`, ignores noun uses of `support` in metadata/documentation phrases, preserves positive support-claim rejection, and saved `unit-6c-round20-fix-ouroboros-stdio-red.log`, `unit-6c-round20-fix-ouroboros-stdio-green.log`, `unit-6c-round20-fix-test-coverage-green.log`, `unit-6c-round20-fix-npm-test-green.log`, `unit-6c-round20-fix-validate-skills-green.log`, `unit-6c-round20-fix-build-unavailable.log`, and `unit-6c-round20-fix-diff-check-green.log`
- 2026-06-15 00:06 Unit 6c round-twenty-one reviewer fix: Lorentz the 2nd found MAJOR gaps where worker/agent-default support claims using `include`/`install` verbs were missed and degraded-path wording like `generic stdio relies on a separate host that provides Work Suite dependency closure` false-positived; `2b0278f` added implementation after red probes in `d409e3b`, adds include/install verbs to the worker-support scanner, recognizes target-scoped `relies on ... that/which ...` external host or overlay assignments, preserves the earlier `then generic stdio supports...` positive-claim rejection, and saved `unit-6c-round21-fix-ouroboros-stdio-red.log`, `unit-6c-round21-fix-ouroboros-stdio-green.log`, `unit-6c-round21-fix-test-coverage-green.log`, `unit-6c-round21-fix-npm-test-green.log`, `unit-6c-round21-fix-validate-skills-green.log`, `unit-6c-round21-fix-build-unavailable.log`, and `unit-6c-round21-fix-diff-check-green.log`
- 2026-06-15 00:14 Unit 6c round-twenty-two reviewer fix: Socrates the 2nd found a MAJOR false positive introduced by the include/install scanner where metadata wording like `support matrix includes Work Suite dependency closure as unsupported` and `evidence row includes agent-defaults as unsupported` was treated as a support claim; `a756bd7` added implementation after red probes in `cbdc07e`, preserves `as unsupported` classification during clause splitting, suppresses target matches explicitly classified as unsupported, keeps real positive include/install worker claims rejected, and saved `unit-6c-round22-fix-ouroboros-stdio-red.log`, `unit-6c-round22-fix-ouroboros-stdio-green.log`, `unit-6c-round22-fix-test-coverage-green.log`, `unit-6c-round22-fix-npm-test-green.log`, `unit-6c-round22-fix-validate-skills-green.log`, `unit-6c-round22-fix-build-unavailable.log`, and `unit-6c-round22-fix-diff-check-green.log`
- 2026-06-15 00:20 Unit 6c round-twenty-three reviewer fix: Pauli the 2nd found MAJOR false negatives for idiomatic generic stdio support claims like `brings in Work Suite`, `preloads Work Suite`, `comes with Work Suite`, `has Work Suite built in`, and `gives you desk:worker`; `76d9839` added implementation after red probes in `77d69e2`, extends worker and dependency action detection for bundled-support idioms, gates `has`/`have` claims to the `built in` target suffix, preserves unsupported metadata and external-host controls, and saved `unit-6c-round23-fix-ouroboros-stdio-red.log`, `unit-6c-round23-fix-ouroboros-stdio-green.log`, `unit-6c-round23-fix-test-coverage-green.log`, `unit-6c-round23-fix-npm-test-green.log`, `unit-6c-round23-fix-validate-skills-green.log`, `unit-6c-round23-fix-build-unavailable.log`, and `unit-6c-round23-fix-diff-check-green.log`
- 2026-06-15 00:30 Unit 6c round-twenty-four reviewer fix: Curie the 2nd found MAJOR follow-ons where `has built-in Work Suite` and `has a built-in desk:worker` were missed because `built in` appeared before the target, fallback metadata had the same false negative, and external-host assignment wording did not cover the round-twenty-three idiom verbs; `5b6f769` added implementation after red probes in `e72b634`, accepts `built in` before or after the target for `has`/`have` claims, extends target-scoped external-host assignment verbs for preload/bring in/come with/give you/have built in wording, preserves direct idiom claim rejection and external-host controls, and saved `unit-6c-round24-fix-ouroboros-stdio-red.log`, `unit-6c-round24-fix-ouroboros-stdio-green.log`, `unit-6c-round24-fix-test-coverage-green.log`, `unit-6c-round24-fix-npm-test-green.log`, `unit-6c-round24-fix-validate-skills-green.log`, `unit-6c-round24-fix-build-unavailable.log`, and `unit-6c-round24-fix-diff-check-green.log`
- 2026-06-15 00:40 Unit 6c round-twenty-five reviewer fix: Chandrasekhar the 2nd found MAJOR gaps where passive `is built into generic stdio` support claims were missed and broad `no` target-prefix negation hid positive `No manual setup is needed for Work Suite support` / `No extra host is needed for worker activation support` claims; `1ea31e9` added implementation after red probes in `c31f219`, detects passive `built into` worker/dependency claims, narrows `no` target negation to target-scoped wording while preserving `No Work Suite support is provided...` and `No worker activation support is provided...` controls, and saved `unit-6c-round25-fix-ouroboros-stdio-red.log`, `unit-6c-round25-fix-ouroboros-stdio-green.log`, `unit-6c-round25-coverage.log`, `unit-6c-round25-full-test.log`, `unit-6c-round25-support-matrix-generate.log`, `unit-6c-round25-validate-skills.log`, `unit-6c-round25-build-unavailable.log`, and `unit-6c-round25-diff-check.log`
- 2026-06-15 00:47 Unit 6c round-twenty-six reviewer fix: Ptolemy the 2nd found a MAJOR false positive where passive degraded-path wording like `Work Suite is built into a separate host or overlay` was treated as a generic stdio dependency-resolution claim; `190e89f` added implementation after red probes in `03b3fa7`, classifies passive `built into` assignments to separate/external/another host or overlay as external support assignments, preserves direct `built into generic stdio` claim rejection, and saved `unit-6c-round26-fix-ouroboros-stdio-red.log`, `unit-6c-round26-fix-ouroboros-stdio-green.log`, `unit-6c-round26-coverage.log`, `unit-6c-round26-full-test.log`, `unit-6c-round26-support-matrix-generate.log`, `unit-6c-round26-validate-skills.log`, `unit-6c-round26-build-unavailable.log`, and `unit-6c-round26-diff-check.log`; Ptolemy's MINOR red-log note is addressed going forward by isolating the round-twenty-six red repro, while the round-twenty-five green suite continues to prove the no-manual/no-extra-host behavior
- 2026-06-15 00:53 Unit 6c round-twenty-six cold reviewer gate converged: Avicenna the 2nd verified the red repro, passive external-host fallback allowance, preserved direct `built into generic stdio` rejection, coverage/full-test/generation/validation/build/diff evidence, and doing-doc accuracy
- 2026-06-15 00:57 Unit 6d complete: added runtime dependency pack red tests and fixture/path docs in `0482267`; targeted red run saved to `unit-6d-runtime-dependency-packs-red.log` and fails because `plugins/desk/mcp/src/runtime/runtime-deps.js`, `runtime:deps-pack:build`, `runtime:deps-pack:verify`, and their scripts do not exist yet; terminal `All tests pass` criterion intentionally unchecked until Unit 6e makes the new runtime dependency pack tests green
- 2026-06-15 01:03 Unit 6d reviewer fix: Hooke the 2nd found a BLOCKER that the red tests did not force full production dependency closure, MAJOR gaps in platform/arch/ABI matrix coverage and manifest-schema validation, and a MINOR gap in CI/release script wiring checks; `51d1635` hardened the red contract to derive the exact production closure from `package-lock.json`, cover all supported sqlite-vec targets, validate malformed manifest schema fields, assert full dependency-only archive entries, require workflow wiring, and saved `unit-6d-review-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:10 Unit 6d round-two reviewer fix: Aristotle the 2nd found a BLOCKER that dependency archive shape still allowed package-marker-only archives, plus MAJOR gaps where the production lock hash did not prove transitive/native lock drift and manifest dependency entries did not prove version/lock_path/native provenance; `8ab3a5f` requires representative runtime files for critical packages such as MCP SDK, better-sqlite3, gray-matter, js-yaml, sqlite-vec, sqlite-vec platform packages, and zod, adds transitive/native hash drift probes, checks dependency version/lock_path/native/duplicate/extra-entry manifest errors, upgrades workflow assertions to actual path filters and run commands, and saved `unit-6d-round2-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:17 Unit 6d round-three reviewer fix: Archimedes the 2nd found MAJOR gaps where the green verification path could trust fabricated archive entries and workflow path filters could still be satisfied outside trigger blocks, plus a MINOR no-op script concern; `3edb0c2` changes the red fixture to write a real gzip tar archive, removes injected archive entries from verification calls, adds a checksummed bad-archive case missing an MCP SDK runtime file, scopes workflow path checks to `pull_request.paths` and `push.paths`, requires script `--help` output for maintenance options, and saved `unit-6d-round3-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:26 Unit 6d round-four reviewer fix: Herschel the 2nd found MAJOR gaps where workflow path parsing could still bleed from `push` into `jobs` and maintenance scripts could satisfy help text while doing nothing under normal invocation; `b1728a5` stops event path parsing at top-level workflow keys, adds a malicious-workflow regression, runs `npm run runtime:deps-pack:verify` against valid and invalid fixture packs, requires a nonzero missing-runtime-file failure, and saved `unit-6d-round4-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:35 Unit 6d round-five reviewer fix: Harvey the 2nd found a BLOCKER that most production dependencies could still be represented by `package.json` markers only and a MAJOR gap where `runtime:deps-pack:build` could no-op under normal invocation; `e33c6dd` derives at least one concrete non-marker runtime file for every package in the production closure from installed package metadata/filesystem state, keeps explicit critical-package runtime files, runs the build script into a temp output root, asserts canonical archive/manifest/checksum files exist, verifies the built pack, and saved `unit-6d-round5-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:43 Unit 6d round-six reviewer fix: Hypatia the 2nd found a BLOCKER that inferred runtime files were present in valid fixtures but not required by negative tests or independently checked in built packs; `6470f77` adds a checksummed invalid archive missing `node_modules/section-matter/index.js`, asserts verifier failure for that inferred-only runtime file, independently lists built tar entries for `section-matter`, `@hono/node-server`, and `sqlite-vec` runtime files, and saved `unit-6d-round6-fix-runtime-dependency-packs-red.log`
- 2026-06-15 01:57 Unit 6d round-seven reviewer fix: Dirac the 2nd found a BLOCKER that built-pack inspection still allowed placeholder bytes, plus MAJOR gaps for extra non-production/root archive entries and unbound workflow commands; `0efbe0b` adds tar content extraction and byte-for-byte built-archive checks against installed `section-matter` and native runtime bytes, rejects extra dev-only package/root files, binds runtime pack build/verify commands to the `desk-mcp-tests` job and MCP working directory/prefix, rejects `echo` no-ops, and saved `unit-6d-round7-fix-runtime-dependency-packs-red.log`
- 2026-06-15 02:04 Unit 6d round-eight reviewer fix: Leibniz the 2nd found BLOCKER gaps where the runtime file set and byte checks still sampled package entrypoints instead of full package runtime contents; `e115b65` requires every runtime-bearing file under each production dependency package, adds deep missing-file negatives for MCP SDK `zod-compat.js` and Express `lib/express.js`, checks built archives contain exactly the expected production runtime files, verifies bytes against installed files for every expected archive entry, and saved `unit-6d-round8-fix-runtime-dependency-packs-red.log`
- 2026-06-15 02:11 Unit 6d round-nine reviewer fix: Dewey the 2nd found MAJOR gaps where workflow checks still accepted help/fake/failure-masked commands and verifier tests did not cover stale `manifest.archive.sha256` with a correct sidecar checksum; `b53cafb` makes workflow command matching reject `--help`, `|| true`, fake script suffixes, and other shell-control tails, adds explicit fake-command regressions, adds a stale manifest archive digest fixture, and saved `unit-6d-round9-fix-runtime-dependency-packs-red.log`
- 2026-06-15 02:19 Unit 6d round-ten reviewer fix: Faraday the 2nd found a BLOCKER where transitive dependency resolution flattened nested production packages such as `type-is/node_modules/content-type`, plus a MAJOR gap where embedded archive manifest bytes were skipped; `e17ce7c` resolves dependencies through nearest package-local `node_modules` lock paths, asserts both `content-type` versions and lock paths, compares embedded `runtime-deps.manifest.json` bytes against the sidecar manifest, and saved `unit-6d-round10-fix-runtime-dependency-packs-red.log`
- 2026-06-15 02:29 Unit 6d round-eleven reviewer fix: Nietzsche the 2nd found MAJOR gaps where production lock hashing skipped nested package drift, verifier fixtures still allowed placeholder embedded manifests, and workflow steps could mask real commands with `continue-on-error`; `60be322` adds nested `type-is/node_modules/content-type` hash drift coverage, writes fixture archives with structured embedded manifests, adds an embedded-manifest mismatch verifier failure, treats non-false `continue-on-error` as disqualifying, and saved `unit-6d-round11-fix-runtime-dependency-packs-red.log`
- 2026-06-15 02:30 Unit 6d cold reviewer gate converged: Banach the 2nd verified the runtime dependency pack red contract now covers nested production closure, full runtime file contents, embedded manifest integrity, checksum/provenance validation, archive-shape pruning, concrete build/verify scripts, and workflow command binding
- 2026-06-15 02:50 Unit 6e complete: implemented runtime dependency pack metadata, production dependency closure, dependency-only tar build/verify, embedded manifest sidecar integrity, maintenance scripts, artifact docs, and CI wiring in `34745ce`; targeted runtime-pack tests saved to `unit-6e-runtime-dependency-packs-green.log`, full MCP tests saved to `unit-6e-npm-test-green.log`, build-unavailable check saved to `unit-6e-build-unavailable.log`, and `git diff --check` passed
- 2026-06-15 03:00 Unit 6e reviewer fix: Euclid the 2nd found BLOCKER gaps where verification trusted checkout lock metadata over embedded archive metadata and allowed arbitrary root subdirectories, plus a MAJOR host-native CI target issue; `d1cb61f` adds red probes for tampered embedded `package-lock.json`, missing root archive metadata, unexpected nested root paths, and host-native build target selection, then verifies embedded package metadata against the sidecar and archive shape; saved `unit-6e-review-fix-runtime-dependency-packs-red.log`, `unit-6e-review-fix-runtime-dependency-packs-green.log`, `unit-6e-review-fix-npm-test-green.log`, and `unit-6e-review-fix-coverage-current.log`; coverage remains below 100% for `runtime-deps.js` and is carried into Unit 6f
- 2026-06-15 03:03 Unit 6e cold reviewer gate converged: Ohm the 2nd verified Euclid's metadata-trust, unexpected-root-path, and host-native target findings are closed; remaining coverage work is explicitly Unit 6f scope
- 2026-06-15 03:20 Unit 6f complete: hardened runtime dependency pack coverage/refactor in `bbfe0fd` with malformed lock/input closures, direct manifest drift, package scanner symlink and empty-runtime cases, embedded metadata failures, PAX/GNU/NUL tar headers, long path builder behavior, direct CLI helper branches, and small unreachable-branch simplifications; saved `unit-6f-coverage-red.log`, `unit-6f-runtime-dependency-packs-green.log`, `unit-6f-test-coverage-green.log`, `unit-6f-npm-test-green.log`, and `unit-6f-build-unavailable.log`; focused tests pass 10/10, full MCP tests pass 290/290, and coverage is 100% line/branch/function for all changed production files
- 2026-06-15 03:24 Unit 6f reviewer blocker: Confucius the 2nd found that absent archive/checksum/manifest and corrupt archive handling still threw uncaught stack traces despite Unit 6f claiming coverage; reopening Unit 6f for red tests and clean verifier diagnostics
- 2026-06-15 03:29 Unit 6f reviewer fix: `cb58f9d` adds red tests for missing manifest/archive/checksum, invalid gzip archive bytes, and spawned verify-CLI diagnostics without stack traces, then returns clean validation errors for those states; saved `unit-6f-review-fix-runtime-dependency-packs-red.log`, `unit-6f-review-fix-runtime-dependency-packs-green.log`, `unit-6f-review-fix-test-coverage-green.log`, `unit-6f-review-fix-npm-test-green.log`, and `unit-6f-review-fix-build-unavailable.log`; focused tests pass 11/11, full MCP tests pass 291/291, and coverage remains 100% line/branch/function
- 2026-06-15 03:32 Unit 6f cold reviewer gate converged: Helmholtz the 2nd verified the missing/corrupt artifact blocker is closed, the verify CLI no longer emits stack traces for those cases, focused tests pass 11/11, full MCP/coverage pass 291/291 with 100% runtime-deps coverage, and the worktree is clean
- 2026-06-15 03:39 Unit 6g complete: added production runtime dependency pack publication red tests and generated-artifact verification in `497cb8c`; targeted red logs saved to `unit-6g-production-runtime-pack-red.log` and `unit-6g-generated-artifacts-red.log`, failing because the current `1.3.1/darwin-arm64-node-127/e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be` pack trio is not yet committed; terminal coverage/all-tests criteria intentionally unchecked until Units 6h-6i make the checks green
- 2026-06-15 03:45 Unit 6g reviewer fix: Galileo the 2nd found the workflow-order check could be satisfied by comments/echo/failure-masked text; `4d65dd3` replaces it with step-level workflow parsing, adds a fake-workflow regression, scrubs the original red-log whitespace, and saves review-fix red evidence in `unit-6g-review-fix-production-runtime-pack-red.log` and `unit-6g-review-fix-generated-artifacts-red.log`
- 2026-06-15 03:46 Unit 6g Round 2 cold reviewer gate converged; Galileo the 2nd verified the workflow-order check now parses real steps, the red-log whitespace issue is closed across the unit range, and the remaining red state is the intended missing production runtime pack trio
- 2026-06-15 03:53 Unit 6h complete: published the current production runtime dependency pack in `5ab0f54` under `plugins/desk/mcp/artifacts/runtime-deps/1.3.1/darwin-arm64-node-127/e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be/`, fixed the runtime pack test cleanup so the full suite no longer deletes committed artifacts, and recorded manifest/checksum/command evidence in `runtime-pack-artifacts.md`; verified `runtime:deps-pack:verify`, production runtime pack tests, generated-artifact freshness, no mutable MCP source in the archive, full MCP tests 295/295, coverage 100%, `node scripts/validate-skills.cjs`, and expected missing `npm run build`
- 2026-06-15 04:04 Unit 6h reviewer fix: Epicurus the 2nd found CI would derive `linux-x64-node-127` while only the `darwin-arm64-node-127` pack was committed; `07d9032` makes generated-artifact verification use an explicit published-target list, adds a host-independent archive/manifest verifier for committed packs, preserves host-native `runtime:deps-pack:verify`, and saves green evidence in `unit-6h-review-fix-production-runtime-pack-green.log`, `unit-6h-review-fix-generated-artifacts-green.log`, `unit-6h-review-fix-runtime-pack-verify-green.log`, `unit-6h-review-fix-npm-test-green.log`, `unit-6h-review-fix-test-coverage.log`, and `unit-6h-review-fix-validate-skills-green.log`
- 2026-06-15 04:04 Unit 6h Round 2 cold reviewer gate converged; Epicurus the 2nd verified the CI-target blocker is closed, generated-artifact verification now uses explicit published targets and archive metadata, host-native `runtime:deps-pack:verify` remains green, and no new BLOCKER/MAJOR was introduced
- 2026-06-15 04:10 Unit 6i complete: hardened production runtime pack freshness checks in `f580d30` with temp-pack negative coverage for missing production packs, checksum mismatch, stale package-lock hash, stale production dependency lock hash, stale platform metadata, accidentally bundled MCP source, and fixture-only false positives; verified production runtime pack tests 6/6, generated-artifact freshness, host-native runtime pack verify, full MCP tests 297/297, coverage 100%, `node scripts/validate-skills.cjs`, and expected missing `npm run build`
- 2026-06-15 04:11 Unit 6i cold reviewer gate converged; Dalton the 2nd re-ran diff hygiene, production runtime pack tests, generated-artifact verifier, host-native runtime pack verify, full MCP tests, coverage, validate-skills, and build-unavailable checks, and confirmed fixture-only or wrong-target artifacts cannot satisfy the no-manual-install criteria
- 2026-06-15 04:22 Unit 7a complete: added dependency-light MCP entrypoint red tests in `303b4a1`; targeted red run saved to `unit-7a-dependency-light-entrypoint-red.log` and fails because `index.js` statically imports `./src/server.js`, a copied MCP package without `node_modules` exits before MCP initialize/list-tools with `ERR_MODULE_NOT_FOUND` for `@modelcontextprotocol/sdk`, and the missing/ABI-mismatched runtime-pack path reports a stack trace instead of actionable runtime-pack diagnostics; terminal coverage/all-tests criteria intentionally unchecked until Unit 7b makes the new tests green
- 2026-06-15 04:34 Unit 7a reviewer fixes converged: Locke the 2nd found missing red-contract assertions for cache extraction location, low-level network modules, and actionable ABI diagnostics; Aquinas the 2nd found host-sensitive ABI fixture behavior and stale-source mirror execution ambiguity; `2ed53ea` and `1606aa3` harden the red tests with `DESK_RUNTIME_CACHE_DIR` restore assertions, `http`/`https`/`net`/`tls` interception, visible list-tools source-mirror sentinel checks, host-independent ABI mismatch synthesis, and refreshed red evidence; Hume the 2nd converged the Unit 7a gate
- 2026-06-15 04:34 Unit 7b started: implementing dependency-light MCP entrypoint bootstrap from the converged Unit 7a red contract
- 2026-06-15 04:43 Unit 7b complete: `95e56b5` makes `index.js` dependency-light, restores runtime dependencies from the verified production pack into a writable cache, syncs current MCP source into `source-mirror/<source-hash>/`, dynamically imports `src/server.js` from that mirror, and reports missing/ABI-mismatched packs with actionable non-stack diagnostics; focused dependency-light tests pass 3/3, full MCP tests pass 300/300, generated-artifact and runtime-pack verifiers pass, validate-skills passes, build remains unavailable because no package build script exists, and coverage fails only for new `bootstrap.js` branches carried into Unit 7c
- 2026-06-15 04:44 Unit 7b cold reviewer gate converged: Raman the 2nd verified the dependency-light entrypoint, cache restore, source-mirror dynamic import, no-install/no-network behavior, no plugin mutation, actionable diagnostics, and evidence logs; Unit 7c started to bring `bootstrap.js` to 100% in-process coverage and harden edge cases
- 2026-06-15 05:00 Unit 7c complete: `2628a99` hardens bootstrap verification against corrupt or incomplete runtime archives, embedded package metadata drift, bundled mutable source, unsafe tar paths, stale source mirrors, corrupt cache markers, and runtime cache path fallbacks; focused bootstrap tests pass 7/7, dependency-light entrypoint tests pass 3/3, full MCP tests pass 307/307, coverage is 100% line/branch/function for `bootstrap.js` and all changed production files, generated-artifact and runtime-pack verifiers pass, validate-skills passes, and build remains explicitly unavailable because no package build script exists
- 2026-06-15 05:06 Unit 7c reviewer fix: Hilbert the 2nd found a MAJOR gap where bootstrap parsed the embedded `runtime-deps.manifest.json` but still trusted the sidecar; `c51363f` adds a red embedded-manifest drift probe, updates bootstrap fixtures to embed the release-pack marker form, compares the embedded manifest against the sidecar with `archive.sha256` normalized to `<archive-sha256-recorded-in-sidecar>`, and saves review-fix red/green logs; focused bootstrap tests pass 7/7, dependency-light entrypoint tests pass 3/3, full MCP tests pass 307/307 after one transient unrelated Claude JSON read race, coverage remains 100% line/branch/function, generated-artifact and runtime-pack verifiers pass, validate-skills passes, and build remains explicitly unavailable because no package build script exists
- 2026-06-15 05:07 Unit 7c Round 2 cold reviewer gate converged: Hilbert the 2nd verified the embedded-manifest trust gap is closed, the marker-normalized sidecar comparison is covered by red/green tests, coverage/full-suite/runtime-pack/generated-artifact/validate-skills evidence is green, and no new BLOCKER or MAJOR was introduced
- 2026-06-15 05:07 Unit 8a started: writing activation-config and root-resolution red tests for explicit host/session root precedence, activation default config, `$DESK` and home fallback ordering, malformed config diagnostics, root-source reporting, and shared resolver use through `plugins/desk/mcp/src/util/paths.js`
- 2026-06-15 05:12 Unit 8a complete: `08ede2e` adds activation-config/root-resolution red tests and evidence in `unit-8a-activation-config-red.log`; targeted run fails because `parseArgs` ignores `--activation-config`, `loadActivationConfig`, `resolveDeskRootWithSource`, and `resolveStartupDeskRoot` do not exist yet, and legacy `resolveDeskRoot` does not share an injectable env/home resolver; terminal `All tests pass` criterion intentionally unchecked until Unit 8b makes the new tests green
- 2026-06-15 05:17 Unit 8a reviewer fix: Russell the 2nd found a BLOCKER that helper-only tests could let `index.js` startup continue ignoring activation config; `c46206b` adds a real stdio MCP smoke that starts `plugins/desk/mcp/index.js` with `--activation-config` and conflicting `$DESK`, calls `task_create`, and proves writes must land in the activation-config root; refreshed red evidence in `unit-8a-review-fix-activation-config-red.log` now fails on the real startup path as well as missing helper exports
- 2026-06-15 05:18 Unit 8a Round 2 cold reviewer gate converged: Russell the 2nd verified the real stdio startup smoke closes the helper-only loophole, the red log includes the startup failure, and no new BLOCKER or MAJOR red-contract issue was introduced
- 2026-06-15 05:18 Unit 8b started: implementing activation-config loading and canonical root-source resolution in `plugins/desk/mcp/src/util/paths.js`, then wiring `plugins/desk/mcp/index.js` startup through the shared resolver
- 2026-06-15 05:25 Unit 8b complete: `de9c356` adds activation config parsing to the MCP entrypoint, centralizes root resolution in `plugins/desk/mcp/src/util/paths.js` with explicit/host-session/activation/`$DESK`/home-fallback precedence and source reporting, preserves legacy `resolveDeskRoot` behavior, and proves real stdio startup writes through the activation-config root; saved green evidence in `unit-8b-activation-config-green.log`, `unit-8b-dependency-light-entrypoint-green.log`, `unit-8b-test-coverage.log`, `unit-8b-npm-test-green.log`, `unit-8b-generated-artifacts-green.log`, `unit-8b-runtime-pack-verify-green.log`, `unit-8b-validate-skills-green.log`, and `unit-8b-build-unavailable.log`; full MCP tests pass 313/313 and coverage is 100% line/branch/function for all changed production files
- 2026-06-15 05:35 Unit 8b reviewer fix: Carson the 2nd found MAJOR gaps where root-level `plugins/desk/mcp/index.js` was excluded from the coverage gate and host/session-root precedence was helper-only for real startup, plus a NIT trailing-whitespace issue in captured logs; `18574dc` adds root MCP entrypoints to coverage-required production files, exports/injects entrypoint startup paths for test coverage, adds `--host-session-root` startup wiring, proves real stdio startup writes through host/session root ahead of activation config, refreshes evidence in `unit-8b-review-fix-*.log`, and strips trailing whitespace from Unit 8b logs; full MCP tests pass 317/317 and coverage is 100% line/branch/function including `plugins/desk/mcp/index.js`
- 2026-06-15 05:36 Unit 8b Round 2 cold reviewer gate converged: Noether the 2nd verified the coverage gate now includes `plugins/desk/mcp/index.js`, the review-fix coverage log proves `index.js` at 100% line/branch/function coverage, real startup parses and routes `--host-session-root` ahead of activation config and `$DESK`, activation config validation/redaction remains covered, no competing runtime paths module exists, and `git diff --check` is clean
- 2026-06-15 05:36 Unit 8c started: adding edge-case coverage/refactor for activation config absence, nonexistent roots, tilde and relative root expansion, and diagnostic output listing attempted root sources
- 2026-06-15 05:42 Unit 8c complete: `4affd95` adds edge coverage for absent and unreadable activation configs, malformed JSON redaction, nonexistent explicit/host-session/activation roots, tilde and relative activation config roots with injectable `cwd`, and final fallback diagnostics listing attempted `$DESK` and home fallback paths in order; `loadActivationConfig` now reports unreadable config files separately from invalid JSON; saved green evidence in `unit-8c-activation-config-green.log`, `unit-8c-test-coverage.log`, `unit-8c-npm-test-green.log`, `unit-8c-dependency-light-entrypoint-green.log`, `unit-8c-generated-artifacts-green.log`, `unit-8c-runtime-pack-verify-green.log`, `unit-8c-validate-skills-green.log`, and `unit-8c-build-unavailable.log`; full MCP tests pass 320/320 and coverage is 100% line/branch/function for all changed production files
- 2026-06-15 05:43 Unit 8c cold reviewer gate converged: Popper the 2nd verified missing/invalid config coverage, nonexistent root coverage, tilde and relative path behavior, ordered attempted-source diagnostics, 100% `paths.js` coverage, full MCP tests 320/320, expected build-unavailable capture, and no competing runtime paths module
- 2026-06-15 05:43 Unit 9a started: writing red tests for runtime-cache precedence, cwd-independent host MCP launches, immutable plugin directory protection, and runtime dependency cache compatibility
- 2026-06-15 05:50 Unit 9a red tests landed: `unit-9a-cache-and-launch-red.log` shows activation-config `runtimeCacheDir` ignored, committed host declarations failing from temp cwd because of `./mcp/index.js`, and incompatible runtime cache marker metadata not repaired.
- 2026-06-15 05:58 Unit 9a reviewer gate fix: hardened red tests for manifest-relative host wrappers, non-skipping static launch metadata, whole-plugin-source immutability snapshots, nested `.state`/XDG runtime-artifact checks, and stale dependency artifact repair.
- 2026-06-15 06:04 Unit 9a second reviewer fix: dynamic runtime tests now build and clean a deterministic temporary host pack instead of skipping when a committed platform pack is absent; static launch metadata covers manifest-backed declarations; host smoke uses the literal declared `node` command through a controlled PATH shim.
- 2026-06-15 06:13 Unit 9a final reviewer fix: replaced broad plugin-tree immutability with targeted forbidden runtime/cache path snapshots including existing `plugins/desk/mcp/node_modules`, proved the controlled `node` PATH shim was invoked, and made declaration checks lazy so one broken host wrapper cannot mask another.
