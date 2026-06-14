# Doing: Desk Dependency Activation

**Status**: drafting
**Execution Mode**: direct
**Created**: 2026-06-14 14:11
**Planning**: ./2026-06-14-1335-planning-desk-dependency-activation.md
**Artifacts**: desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (non-autopilot interactive mode only; autopilot must convert this to `spawn` or `direct` unless a hard exception is present)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make Desk behave as an automatically resolved dependency of plugins and custom agents, not as a manually installed user prerequisite. Implement the repo-side primitives for host-native activation, self-preparing Desk MCP startup, shared vector packs, prebuilt snapshot restore, diagnostics, and verification.

## Upstream Work Items
- None

## Completion Criteria
- [ ] A versioned Desk activation manifest/schema exists and is documented.
- [ ] The activation schema can declare Desk as a substrate dependency.
- [ ] The activation schema can declare Work Suite as a dependency.
- [ ] Dependency entries include dependency ID, semver range or exact pin, resolved provenance/lock data, and incompatible-version diagnostics.
- [ ] The activation schema can declare `desk:worker` as a provided activation target.
- [ ] The activation schema can declare overlay agents that depend on Desk without launching as `desk:worker`.
- [ ] The activation schema can declare required MCP servers.
- [ ] The activation schema can declare desk-root binding policy.
- [ ] The activation schema can declare shared embedding artifact policy.
- [ ] The activation schema can declare snapshot artifact policy.
- [ ] The activation schema can declare host support, host fallbacks, and flattened bundle requirements.
- [ ] Unknown activation schema versions fail closed with actionable diagnostics.
- [ ] Plugin dependency order and activation order are deterministic.
- [ ] Generated activation artifacts are owned/tracked so they can be updated or removed safely.
- [ ] Activation declares host permissions/capabilities and cannot silently elevate beyond the host plugin model.
- [ ] Claude packaging exposes Desk skills, MCP, hooks, and `desk:worker` through native plugin surfaces.
- [ ] Claude packaging declares Work Suite as a dependency when the support matrix marks dependency metadata native for the host format.
- [ ] Claude Agent View/background-session inheritance is validated or explicitly documented as unsupported for the current host version.
- [ ] Copilot packaging exposes the expected worker agent through native agent/plugin metadata.
- [ ] Copilot packaging has a flattened dependency strategy for hosts without transitive dependency resolution.
- [ ] Codex packaging exposes Desk skills through Codex plugin metadata.
- [ ] Codex packaging exposes Desk MCP through Codex plugin metadata.
- [ ] Codex activation implements global personal worker+Desk default behavior as the primary happy path, with project-local and manual-only invocation modes available as opt-outs.
- [ ] Codex CLI smoke tests prove that a new session sees worker behavior and Desk MCP tools after activation.
- [ ] Codex App support is proven by a real smoke artifact when the app exposes a testable activation surface, or the support matrix records the exact unsupported primitive and fallback behavior.
- [ ] Codex smoke tests prove there is no healthy-path `codex mcp add`, copied agent file, or AGENTS append/copy step.
- [ ] Host adapters preserve and merge user-authored instructions/config safely instead of overwriting them.
- [ ] Host adapters document and test their permission/capability boundary.
- [ ] Generated activation artifacts respect host permission/capability boundaries.
- [ ] Host adapters never require healthy-path manual MCP registration.
- [ ] Host adapters never require healthy-path manual `npm install` inside plugin directories.
- [ ] Host adapters never require healthy-path hand-editing of JSON or TOML.
- [ ] Host support matrix is generated from real schema validation or smoke evidence.
- [ ] Host support matrix includes a disposition for Claude, Codex, Copilot/root plugin packaging, Ouroboros/autonomous-agent bundle wiring, and generic stdio MCP use.
- [ ] Host support docs describe limitations and fallback behavior in host-native language.
- [ ] Desk MCP startup can run from an installed plugin without manual native-dependency installation.
- [ ] Native MCP runtime dependencies are bundled, prebuilt, or self-prepared using this writable cache precedence: activation config `runtimeCacheDir`, then `DESK_RUNTIME_CACHE_DIR`, then `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/`.
- [ ] Native prebuild artifacts live at `plugins/desk/mcp/artifacts/native-runtime/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/native-runtime.tgz` with adjacent manifest and checksum files.
- [ ] Desk MCP launch works from arbitrary current working directories and resolves plugin-relative paths explicitly.
- [ ] Desk MCP startup does not mutate immutable plugin source/cache directories.
- [ ] Host-specific MCP launch smoke tests cover Claude, Codex, Copilot/root plugin packaging, and generic stdio launch.
- [ ] Desk MCP offline startup behavior is tested for snapshot restore, vector-pack import, and lexical fallback.
- [ ] Desk MCP resolves the desk root deterministically from explicit host/session root, activation default config, environment, and safe defaults.
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
- [ ] Snapshot manifest includes source commit or source tree hash, document tree hash, included pack IDs, sqlite-vec/runtime compatibility, creation timestamp, artifact checksum, and provenance.
- [ ] Snapshot restore validates checksum, DB schema, embedding spec, chunker ID, sqlite-vec/runtime compatibility, manifest creation timestamp, provenance, source/document hashes, included pack IDs, and artifact format.
- [ ] Snapshot restore treats source tree or document tree mismatch as freshness information, not compatibility failure.
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
- [ ] Documentation states that embeddings and snapshots are derivative data and may carry privacy risk.
- [ ] Health output, logs, snapshot errors, and vector-pack validation errors avoid dumping chunk text or sensitive document content.
- [ ] Vector-pack validation errors report file, row, and chunk key without dumping full text.
- [ ] Gitignored secret files are excluded from indexing and artifact publication by default.
- [ ] Artifact publication requires explicit approval when repository or organization policy requires it.
- [ ] Deleted/redacted documents are invalidated through tombstone metadata plus artifact rotation cleanup.
- [ ] CI validates that deleted/redacted docs are no longer represented in active vector packs or snapshots.
- [ ] Existing active/archived search scope behavior is preserved after snapshot restore and vector import.
- [ ] Existing refs graph behavior is preserved after snapshot restore and vector import.
- [ ] Search responses distinguish semantic, lexical, and hybrid result modes.
- [ ] Query embedding failure does not imply document vectors are missing.
- [ ] Document-vector absence does not prevent lexical search.
- [ ] Manifest version drift between root, Claude, Codex, and Work Suite-related plugin metadata is tested or intentionally documented.
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
- [ ] Tests cover repeated startup idempotence.
- [ ] Tests cover deactivation/uninstall artifact ownership.
- [ ] Tests cover global personal default, project-local opt-out, and manual-only Codex activation policy.
- [ ] Tests cover generated artifact upgrade/merge behavior preserving user-authored config.
- [ ] Tests cover snapshot/vector-pack performance budgets for startup and rebuild paths.
- [ ] Tests cover permission/capability boundaries for generated activation artifacts.
- [ ] Tests cover diagnostic and validation errors avoiding sensitive text leakage.
- [ ] Tests cover support-matrix disposition for the Ouroboros/autonomous-agent path.
- [ ] Release/CI automation can fail when generated artifacts are stale.
- [ ] Release/CI automation can build and verify native runtime packs, vector packs, and snapshots without introducing a user-facing Desk CLI.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

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
- Native runtime prebuilds: `plugins/desk/mcp/artifacts/native-runtime/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/native-runtime.tgz`, `native-runtime.manifest.json`, and `native-runtime.sha256`
- Artifact fixtures: `plugins/desk/mcp/__tests__/fixtures/artifacts/`
- Host launch fixtures: `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/`
- Local mutable state: `.state/` only; startup copies compatible repo artifacts into `.state/` before mutation
- Coverage command: `npm --prefix plugins/desk/mcp run test:coverage`
- Full Desk MCP command: `npm --prefix plugins/desk/mcp test`

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ⬜ Unit 0: Setup/Research
**What**: Read the planning doc, story matrix, current plugin manifests, MCP server/indexer code, and CI workflows. Create `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md` covering current host surfaces, current MCP launch assumptions, exact commands, artifact layout, coverage command, and the chosen performance-budget fixture source.  
**Output**: `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.  
**Acceptance**: Notes exist, cited source paths exist at HEAD, and no production code changed in this unit.

### ⬜ Unit 0a: Coverage Gate Baseline - Tests
**What**: Write failing checks for a coverage command that enforces 100% coverage on new Desk MCP files and scripts added by this task. Include fixtures for uncovered new files, missing reports, excluded files, and CI/local command mismatch.  
**Output**: `plugins/desk/mcp/__tests__/coverage/coverage_gate.test.js` and expected coverage command documentation in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.  
**Acceptance**: Tests fail until coverage tooling, thresholds, and the `test:coverage` command exist.

### ⬜ Unit 0b: Coverage Gate Baseline - Implementation
**What**: Add coverage tooling and CI wiring before feature work begins, with 100% thresholds for new Desk MCP files introduced by this task.  
**Output**: Updated `plugins/desk/mcp/package.json`, coverage configuration, `.github/workflows/desk-mcp-tests.yml`, validation scripts, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/setup-notes.md`.  
**Acceptance**: Unit 0a tests pass, `npm --prefix plugins/desk/mcp run test:coverage` exists, and CI fails when new code coverage drops below 100%.

### ⬜ Unit 0c: Coverage Gate Baseline - Coverage & Refactor
**What**: Add edge-case coverage for missing coverage reports, uncovered new files, files intentionally excluded by policy, root/MCP command mismatch, and CI/local command drift.  
**Output**: Hardened coverage gate implementation.  
**Acceptance**: Coverage gate tests pass locally, and every later `c` unit can run `npm --prefix plugins/desk/mcp run test:coverage` without inventing a command.

### ⬜ Unit 1a: Activation Contract - Tests
**What**: Write failing tests for a versioned activation manifest/schema and validator. Cover dependency ID, semver/pin, provenance/lock fields, host support/fallback fields, permissions/capabilities, `desk:worker`, overlay agents, MCP requirements, desk-root binding, embedding policy, snapshot policy, unknown schema versions, deterministic dependency order, and unsupported-host diagnostics.  
**Output**: `plugins/desk/mcp/__tests__/activation/activation_contract.test.js`.  
**Acceptance**: Tests fail because `plugins/desk/mcp/src/activation/schema.js`, `plugins/desk/mcp/src/activation/validate.js`, and canonical activation fixtures do not exist or do not satisfy the expected contract.

### ⬜ Unit 1b: Activation Contract - Implementation
**What**: Add the activation schema, canonical Desk activation manifest, validator, and fixture manifests. Keep the contract host-neutral and avoid a user-facing Desk CLI.  
**Output**: `plugins/desk/mcp/src/activation/schema.js`, `plugins/desk/mcp/src/activation/validate.js`, `plugins/desk/activation/desk.activation.json`, and `plugins/desk/activation/README.md`.  
**Acceptance**: Unit 1a tests pass, unsupported or unknown schemas fail closed with actionable diagnostics, and dependency ordering is deterministic.

### ⬜ Unit 1c: Activation Contract - Coverage & Refactor
**What**: Refactor the activation contract code for maintainability, add missing branches and edge cases, and document the manifest fields.  
**Output**: Clean contract implementation and docs.  
**Acceptance**: 100% coverage on new activation-contract code, all activation-contract tests pass, and no warnings.

### ⬜ Unit 2a: Codex Global Activation - Tests
**What**: Write failing tests for Codex global personal worker+Desk default activation, project-local opt-out, manual-only opt-out, safe merge/preservation of user-authored config, no uncontrolled `AGENTS.md` append/copy, no manual `codex mcp add`, and permission/capability boundaries.  
**Output**: `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml`, and `plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml`.  
**Acceptance**: Tests fail because Codex activation materialization does not yet exist or still relies on manual setup assumptions.

### ⬜ Unit 2b: Codex Global Activation - Implementation
**What**: Implement the Codex adapter/materialization path for global personal default worker+Desk activation, plus project-local and manual-only opt-outs. Ensure generated artifacts are owned/tracked and preserve user-authored config.  
**Output**: `plugins/desk/mcp/src/activation/adapters/codex.js`, `plugins/desk/.codex-plugin/plugin.json`, `plugins/work-suite/.codex-plugin/plugin.json`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml`, `plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml`, and `plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml`.  
**Acceptance**: Unit 2a tests pass and generated output proves Codex activation config can be materialized without manual MCP registration or copied worker files; real session smoke proof waits for Units 10d-10f after `desk_status` exists.

### ⬜ Unit 2c: Codex Global Activation - Coverage & Refactor
**What**: Add edge-case coverage for existing config, disabled Desk, changed activation version, malformed config, and repeated activation.  
**Output**: Hardened `plugins/desk/mcp/src/activation/adapters/codex.js` and `plugins/desk/mcp/__tests__/activation/codex_activation.test.js`.  
**Acceptance**: 100% coverage on new Codex adapter code, repeated activation is idempotent, and all Codex adapter tests pass.

### ⬜ Unit 2d: Activation Artifact Ownership - Tests
**What**: Write failing tests for an owned-artifact ledger, generated artifact upgrade replacement, deactivation cleanup, preservation of user-authored config, and never deleting desk data.  
**Output**: `plugins/desk/mcp/__tests__/activation/artifact_ownership.test.js` and fixtures under `plugins/desk/mcp/__tests__/fixtures/activation/ownership/`.  
**Acceptance**: Tests fail until activation writes an ownership ledger and deactivation removes only owned generated artifacts.

### ⬜ Unit 2e: Activation Artifact Ownership - Implementation
**What**: Implement ownership ledger creation, upgrade replacement, deactivation cleanup, and user-config preservation for generated activation artifacts.  
**Output**: `plugins/desk/mcp/src/activation/artifact-ledger.js`, updates to `plugins/desk/mcp/src/activation/adapters/codex.js`, and ownership fixtures.  
**Acceptance**: Unit 2d tests pass, generated artifacts can be updated or removed safely, and desk data is never deleted.

### ⬜ Unit 2f: Activation Artifact Ownership - Coverage & Refactor
**What**: Add coverage for missing ledger, corrupt ledger, user-edited generated files, repeated deactivate, and partial activation failure.  
**Output**: Hardened activation artifact ownership implementation.  
**Acceptance**: 100% coverage on new artifact ownership code and all ownership tests pass.

### ⬜ Unit 3a: Support Matrix Generator - Tests
**What**: Write failing tests for a generated support matrix with one row each for Claude, Codex, Copilot/root plugin packaging, Ouroboros/autonomous-agent bundle wiring, and generic stdio MCP use.  
**Output**: `plugins/desk/mcp/__tests__/activation/support_matrix.test.js` and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md`.  
**Acceptance**: Tests fail until the generated matrix validates against the evidence artifact, and the evidence artifact has columns `host_id`, `surface`, `disposition`, `source_paths`, `evidence_command_or_doc`, `unsupported_primitives`, and `fallback_behavior`, with rows for `claude`, `codex`, `copilot-root`, `ouroboros-autonomous-agent`, and `generic-stdio`.

### ⬜ Unit 3b: Support Matrix Generator - Implementation
**What**: Implement support-matrix generation and validation from activation metadata plus the evidence artifact.  
**Output**: Updated `plugins/desk/mcp/src/activation/support-matrix.js`, `plugins/desk/activation/support-matrix.json`, and `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md`.  
**Acceptance**: Unit 3a tests pass and generated support matrix matches the evidence artifact exactly.

### ⬜ Unit 3c: Support Matrix Generator - Coverage & Refactor
**What**: Add edge-case coverage for unknown hosts, missing evidence rows, unsupported primitive diagnostics, and conflicting native/flattened dispositions.  
**Output**: Hardened support-matrix validation.  
**Acceptance**: 100% coverage on new support-matrix code and all support-matrix tests pass.

### ⬜ Unit 4a: Claude And Work Suite Packaging - Tests
**What**: Write failing tests for Claude plugin metadata, Work Suite dependency declaration when host metadata supports it, Agent View/background-session support disposition, manifest version consistency, and permission/capability boundaries.  
**Output**: `plugins/desk/mcp/__tests__/activation/claude_packaging.test.js`.  
**Acceptance**: Tests fail on missing or stale Claude/Work Suite dependency and support metadata.

### ⬜ Unit 4b: Claude And Work Suite Packaging - Implementation
**What**: Update Claude-facing Desk and Work Suite metadata plus `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` rows to match the Claude disposition. Do not edit the generated support matrix directly.  
**Output**: Updated `plugins/desk/.claude-plugin/plugin.json`, `plugins/work-suite/.claude-plugin/plugin.json`, and Claude evidence rows.  
**Acceptance**: Unit 4a tests pass and unsupported Claude primitives are documented instead of claimed.

### ⬜ Unit 4c: Claude And Work Suite Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing Work Suite dependency, stale version, missing worker agent exposure, and unsupported Agent View assumptions.  
**Output**: Hardened Claude packaging validation.  
**Acceptance**: 100% coverage on new Claude packaging validation code and all Claude packaging tests pass.

### ⬜ Unit 5a: Copilot Root Packaging - Tests
**What**: Write failing tests for `plugins/desk/plugin.json`, `plugins/work-suite/plugin.json`, Work Suite metadata, root agent exposure, flattened dependency support, no hand-edited JSON/TOML, and manifest version consistency.  
**Output**: `plugins/desk/mcp/__tests__/activation/copilot_packaging.test.js`.  
**Acceptance**: Tests fail on current root manifest drift or missing flattened dependency metadata.

### ⬜ Unit 5b: Copilot Root Packaging - Implementation
**What**: Update root/Copilot plugin metadata, add or update Work Suite root plugin metadata, generate flattened-bundle metadata for Desk plus Work Suite, and update `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` rows. Do not edit the generated support matrix directly.  
**Output**: Updated `plugins/desk/plugin.json`, `plugins/work-suite/plugin.json`, generated flattened-bundle metadata, and Copilot/root evidence rows.  
**Acceptance**: Unit 5a tests pass and Copilot/root plugin packaging exposes worker behavior without a separate manual Work Suite install in flattened mode.

### ⬜ Unit 5c: Copilot Root Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing agents path, missing skills path, missing MCP declaration, stale version, and missing flattened dependency closure.  
**Output**: Hardened Copilot/root packaging validation.  
**Acceptance**: 100% coverage on new Copilot packaging validation code and all Copilot packaging tests pass.

### ⬜ Unit 6a: Ouroboros And Generic Stdio Packaging - Tests
**What**: Write failing tests for the Ouroboros/autonomous-agent bundle disposition and generic stdio MCP launch disposition. Cover `bundle.json` expectation docs, `$DESK` preamble binding, and flattened or unsupported status.  
**Output**: `plugins/desk/mcp/__tests__/activation/ouroboros_stdio_packaging.test.js`.  
**Acceptance**: Tests fail until evidence rows, generated support-matrix output, and docs give explicit dispositions for Ouroboros/autonomous-agent and generic stdio paths.

### ⬜ Unit 6b: Ouroboros And Generic Stdio Packaging - Implementation
**What**: Add `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md` and docs entries for Ouroboros/autonomous-agent bundle wiring and generic stdio MCP launch, then regenerate support-matrix output through the Unit 3 generator.  
**Output**: Updated evidence rows, generated `plugins/desk/activation/support-matrix.json`, `plugins/desk/README.md`, and activation docs.  
**Acceptance**: Unit 6a tests pass and the docs no longer leave the Ouroboros path out of the activation story.

### ⬜ Unit 6c: Ouroboros And Generic Stdio Packaging - Coverage & Refactor
**What**: Add edge-case tests for missing `$DESK` binding, missing bundle metadata, and generic stdio launch without host dependency support.  
**Output**: Hardened Ouroboros/generic stdio validation.  
**Acceptance**: 100% coverage on new validation code and all Ouroboros/generic stdio packaging tests pass.

### ⬜ Unit 6d: Native Runtime Prebuild Artifacts - Tests
**What**: Write failing tests for native runtime prebuild artifact discovery, manifest schema, lock metadata, platform/arch/Node ABI/native package version matrix, checksum verification, unsupported platform diagnostics, and CI build/verify script declarations.  
**Output**: `plugins/desk/mcp/__tests__/runtime/native_prebuilds.test.js`, fixtures under `plugins/desk/mcp/__tests__/fixtures/runtime/native-prebuilds/`, and expected artifact paths under `plugins/desk/mcp/artifacts/native-runtime/`.  
**Acceptance**: Tests fail until native prebuild artifacts have exact paths, manifests, checksums, and verification scripts for `better-sqlite3` and `sqlite-vec`.

### ⬜ Unit 6e: Native Runtime Prebuild Artifacts - Implementation
**What**: Implement native runtime prebuild metadata, build/verify scripts, and artifact consumption helpers. Scripts are release/CI maintenance surfaces, not user setup commands.  
**Output**: `plugins/desk/mcp/src/runtime/native-prebuilds.js`, `plugins/desk/mcp/scripts/build-native-runtime-pack.js`, `plugins/desk/mcp/scripts/verify-native-runtime-pack.js`, `plugins/desk/mcp/artifacts/native-runtime/README.md`, package scripts `runtime:native-pack:build` and `runtime:native-pack:verify`, and CI wiring.  
**Acceptance**: Unit 6d tests pass and the manifest at `plugins/desk/mcp/artifacts/native-runtime/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/native-runtime.manifest.json` proves archive contents, package versions, checksums, source lockfile, and build provenance.

### ⬜ Unit 6f: Native Runtime Prebuild Artifacts - Coverage & Refactor
**What**: Add coverage for absent archive, corrupt archive, checksum mismatch, unsupported ABI, package-version mismatch, stale lock metadata, missing CI job, and repeated verification.  
**Output**: Hardened native prebuild artifact code and scripts.  
**Acceptance**: 100% coverage on new native prebuild code and scripts, and all native runtime prebuild tests pass.

### ⬜ Unit 7a: Dependency-Light MCP Entrypoint - Tests
**What**: Write failing tests proving `plugins/desk/mcp/index.js` can start dependency preparation before importing `src/server.js` or any native/server dependencies. Cover missing `node_modules`, native ABI mismatch, offline restore from `plugins/desk/mcp/artifacts/native-runtime/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/native-runtime.tgz`, and no healthy-path manual `npm install`.  
**Output**: `plugins/desk/mcp/__tests__/runtime/dependency_light_entrypoint.test.js`.  
**Acceptance**: Tests fail until the entrypoint can run its bootstrap path without statically importing the MCP SDK, `better-sqlite3`, or `sqlite-vec`.

### ⬜ Unit 7b: Dependency-Light MCP Entrypoint - Implementation
**What**: Refactor `plugins/desk/mcp/index.js` into a dependency-light entrypoint that prepares or verifies the writable runtime cache from native prebuild artifacts or self-prep, then dynamically imports `plugins/desk/mcp/src/server.js`.  
**Output**: Updated `plugins/desk/mcp/index.js`, new `plugins/desk/mcp/src/runtime/bootstrap.js`, and runtime bootstrap fixtures.  
**Acceptance**: Unit 7a tests pass, missing native dependencies produce actionable non-leaking diagnostics, and no plugin source directory is mutated.

### ⬜ Unit 7c: Dependency-Light MCP Entrypoint - Coverage & Refactor
**What**: Add coverage for absent cache, corrupt cache metadata, offline prebuilt unavailable, unsupported platform, native package version mismatch, and repeated startup.  
**Output**: Hardened dependency-light bootstrap implementation.  
**Acceptance**: 100% coverage on new bootstrap code and all dependency-light entrypoint tests pass.

### ⬜ Unit 8a: Activation Config And Root Resolution - Tests
**What**: Write failing tests for activation-config loading, root binding precedence, malformed config diagnostics, root source reporting, and shared use of the existing root resolver.  
**Output**: `plugins/desk/mcp/__tests__/runtime/activation_config.test.js`.  
**Acceptance**: Tests fail until explicit `--root` or host/session root overrides activation default config, activation default config precedes `$DESK` and home fallbacks, and `plugins/desk/mcp/index.js`, server startup, and activation config use the same resolver in `plugins/desk/mcp/src/util/paths.js`.

### ⬜ Unit 8b: Activation Config And Root Resolution - Implementation
**What**: Extend `plugins/desk/mcp/src/util/paths.js` as the canonical path/root module. Add activation-config loading and root-source diagnostics without creating a competing runtime paths module.  
**Output**: Updated `plugins/desk/mcp/src/util/paths.js` and activation config helpers used by `index.js` and status/startup code.  
**Acceptance**: Unit 8a tests pass and root resolution order is explicit `--root` or host/session root, activation default config, `$DESK`, then existing home fallbacks.

### ⬜ Unit 8c: Activation Config And Root Resolution - Coverage & Refactor
**What**: Add coverage for missing config, invalid JSON, nonexistent root, tilde expansion, relative roots, and diagnostic output listing every source attempted.  
**Output**: Hardened activation config/root resolution implementation.  
**Acceptance**: 100% coverage on new root/config code and all activation-config tests pass.

### ⬜ Unit 9a: Runtime Cache And Host MCP Launch - Tests
**What**: Write failing tests for cwd-independent launch, host MCP declarations launched from a temp cwd, plugin-relative or absolute installed paths, immutable plugin directory protection, runtime cache precedence, and native cache key compatibility.  
**Output**: `plugins/desk/mcp/__tests__/runtime/cache_and_launch.test.js` and host launch fixtures under `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/`.  
**Acceptance**: Tests fail until runtime cache resolution uses activation config `runtimeCacheDir`, then `DESK_RUNTIME_CACHE_DIR`, then `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<native-package-versions>/`, startup rejects incompatible cached native artifacts, and temp-cwd smoke tests inspect and launch each declaration shape from `plugins/desk/.mcp.json`, `plugins/desk/.codex-plugin/plugin.json`, `plugins/desk/.claude-plugin/plugin.json`, `plugins/desk/plugin.json`, and `plugins/desk/mcp/__tests__/fixtures/runtime/host-launch/generic-stdio.mcp.json` without relying on caller cwd. Startup never writes under `plugins/desk/`, `plugins/desk/.codex-plugin/`, `plugins/desk/.claude-plugin/`, `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/plugin-source/`, `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/host-cache-source/`, or `plugins/desk/mcp/__tests__/fixtures/runtime/immutable/readonly-plugin-cache/`.

### ⬜ Unit 9b: Runtime Cache And Host MCP Launch - Implementation
**What**: Implement runtime cache helpers, native cache key metadata, host MCP declaration path fixes, and cwd-independent launch behavior.  
**Output**: `plugins/desk/mcp/src/runtime/cache.js`, updated `plugins/desk/.mcp.json`, updated host adapter MCP declarations, updated `index.js`, host launch fixtures, and cache metadata fixtures.  
**Acceptance**: Unit 9a tests pass from arbitrary current working directories, incompatible native caches are rejected, and immutable plugin/source dirs remain untouched.

### ⬜ Unit 9c: Runtime Cache And Host MCP Launch - Coverage & Refactor
**What**: Add edge-case coverage for unset home/cache env vars, relative activation cache dirs, unwritable cache dirs, platform/arch/Node ABI mismatch, native package version mismatch, and repeated startup.  
**Output**: Hardened runtime cache and host launch implementation.  
**Acceptance**: 100% coverage on new runtime cache/launch code and all runtime cache tests pass.

### ⬜ Unit 10a: Early `desk_status` Skeleton - Tests
**What**: Write failing tests for registered `desk_status`, tool description, dispatch from `server.js`, root/runtime/local DB fields, root-source diagnostics, and session-start-safe summary output that does not require vector-pack or snapshot modules yet.  
**Output**: `plugins/desk/mcp/__tests__/tools/status.test.js`.  
**Acceptance**: Tests fail until `desk_status` is registered in `plugins/desk/mcp/src/tool-names.js`, wired in `plugins/desk/mcp/src/server.js`, and returns early health fields without expensive repair work.

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
**Output**: Updated smoke harness, `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/codex-smoke-evidence.md`, and Codex support-matrix evidence rows.  
**Acceptance**: Unit 10d tests/evidence pass, CLI activation sees worker instructions and `desk_status`, and Codex App is either smoke-proven or explicitly unsupported with fallback evidence.

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
**What**: Write failing tests for snapshot path `plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sqlite.zst` and manifest fields: source commit or source tree hash, document tree hash, included pack IDs, sqlite-vec/runtime compatibility, creation timestamp, artifact checksum, provenance, DB schema, embedding spec, chunker ID, and artifact format.  
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
**What**: Write failing tests for public/sensitive repo publication defaults, explicit repo/org policy approval, ordinary startup not writing artifacts, and artifact write attempts without approval.  
**Output**: `plugins/desk/mcp/__tests__/artifacts/publication_policy.test.js`.  
**Acceptance**: Tests fail until artifact publication policy checks exist.

### ⬜ Unit 18b: Publication Policy And Approval - Implementation
**What**: Implement publication policy checks and approval requirements for vector-pack writes to `plugins/desk/artifacts/vector-packs/` and snapshot writes to `plugins/desk/artifacts/snapshots/`.  
**Output**: `plugins/desk/mcp/src/artifacts/policy.js` and updated artifact write paths.  
**Acceptance**: Unit 18a tests pass, public/sensitive repos default to no publication, and ordinary startup never dirties the worktree.

### ⬜ Unit 18c: Publication Policy And Approval - Coverage & Refactor
**What**: Add coverage for missing policy, explicit allow, explicit deny, unknown repo sensitivity, and organization policy override.  
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
**What**: Write failing tests for tombstone invalidation, active artifact exclusion of deleted/redacted docs, artifact rotation cleanup, repeated tombstones, and deleted archived docs.  
**Output**: `plugins/desk/mcp/__tests__/artifacts/redaction_cleanup.test.js`.  
**Acceptance**: Tests fail until tombstone and cleanup behavior exists.

### ⬜ Unit 20b: Tombstones And Redaction Cleanup - Implementation
**What**: Implement tombstone metadata, artifact invalidation, and artifact rotation cleanup for vector packs under `plugins/desk/artifacts/vector-packs/` and snapshots under `plugins/desk/artifacts/snapshots/`.  
**Output**: Redaction/tombstone modules and artifact rotation cleanup integration.  
**Acceptance**: Unit 20a tests pass and deleted/redacted docs are not represented in active vector packs or snapshots.

### ⬜ Unit 20c: Tombstones And Redaction Cleanup - Coverage & Refactor
**What**: Add coverage for missing tombstone files, corrupt tombstones, cleanup after compaction validation, cleanup after snapshot rotation, and stale local DB rebuild after redaction.  
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
**What**: Update `plugins/desk/README.md`, `plugins/desk/agents/README.md`, `plugins/desk/mcp/README.md`, `plugins/desk/activation/README.md`, `plugins/desk/docs/dependency-activation-stories-and-criteria.md`, and `desk/tasks/2026-06-14-1335-planning-desk-dependency-activation.md` to reflect dependency activation, global Codex personal default, opt-outs, privacy, and no bespoke CLI.  
**Output**: Updated documentation and docs validation script.  
**Acceptance**: Unit 22a tests pass and docs no longer present manual Desk install as the healthy path.

### ⬜ Unit 22c: Healthy-Path Docs - Coverage & Refactor
**What**: Add docs validation coverage for Codex, Claude, Copilot/root, Ouroboros/autonomous-agent, generic stdio, vector packs, snapshots, redaction, and publication policy.  
**Output**: Hardened docs validation.  
**Acceptance**: All docs validation tests pass and generated docs remain stable.

### ⬜ Unit 23a: CI And Generated Artifact Freshness - Tests
**What**: Write failing checks for activation support matrix freshness, host manifest drift, worker-content drift, artifact script availability, and generated fixture freshness.  
**Output**: `scripts/test-desk-generated-artifacts.cjs`, `scripts/test-desk-host-manifests.cjs`, updates to `scripts/validate-skills.cjs`, `.github/workflows/validate-skills.yml`, and `.github/workflows/desk-mcp-tests.yml`.  
**Acceptance**: Tests fail on stale generated artifacts or current manifest drift.

### ⬜ Unit 23b: CI And Generated Artifact Freshness - Implementation
**What**: Wire validation scripts into `.github/workflows/desk-mcp-tests.yml`. Include artifact scripts and support-matrix checks.  
**Output**: Updated `scripts/test-desk-generated-artifacts.cjs`, `scripts/test-desk-host-manifests.cjs`, `scripts/validate-skills.cjs`, `.github/workflows/validate-skills.yml`, and `.github/workflows/desk-mcp-tests.yml`.  
**Acceptance**: Unit 23a tests pass and CI fails when generated artifacts are stale.

### ⬜ Unit 23c: CI And Generated Artifact Freshness - Coverage & Refactor
**What**: Add coverage for stale generated support matrix, missing artifact scripts, manifest version drift, and worker-format drift.  
**Output**: Hardened CI/freshness validation.  
**Acceptance**: All CI/freshness tests pass locally.

### ⬜ Unit 24a1: Integration Tests - Cold Start And Snapshot Restore
**What**: Write failing integration checks for full cold start and compatible snapshot restore.  
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.  
**Acceptance**: Cold-start snapshot restore tests fail until the paired Unit 24b1 implementation.

### ⬜ Unit 24a2: Integration Tests - Vector-Pack Rebuild Without Embeddings
**What**: Write failing integration checks for vector-pack rebuild with embedding endpoint disabled.  
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.  
**Acceptance**: Vector-pack rebuild tests fail until the paired Unit 24b2 implementation.

### ⬜ Unit 24a3: Integration Tests - Missing-Vector Live Generation
**What**: Write failing integration checks for missing-vector live generation with a mocked embedding endpoint.  
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.  
**Acceptance**: Missing-vector live generation tests fail until the paired Unit 24b3 implementation.

### ⬜ Unit 24a4: Integration Tests - Scope And Refs Preservation
**What**: Write failing integration checks for active/archived scope preservation and refs graph preservation.  
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.  
**Acceptance**: Scope and refs preservation tests fail until the paired Unit 24b4 implementation.

### ⬜ Unit 24a5: Integration Tests - Idempotence And Degraded Semantic Mode
**What**: Write failing integration checks for repeated startup idempotence and degraded semantic mode.  
**Output**: `plugins/desk/mcp/__tests__/integration/dependency_activation_flow.test.js`.  
**Acceptance**: Idempotence and degraded semantic tests fail until the paired Unit 24b5 implementation.

### ⬜ Unit 24b1: Integration - Cold Start And Snapshot Restore
**What**: Wire the integration flow for cold start plus compatible snapshot restore.  
**Output**: Updates to snapshot/startup modules required by `dependency_activation_flow.test.js` cold-start snapshot cases.  
**Acceptance**: Paired Unit 24a1 tests pass; earlier integration subsets remain green; later subsets may still fail.

### ⬜ Unit 24b2: Integration - Vector-Pack Rebuild Without Embeddings
**What**: Wire the integration flow for rebuilding from docs plus vector packs with embedding endpoint disabled.  
**Output**: Updates to vector-pack/indexer modules required by the no-embedding rebuild cases.  
**Acceptance**: Paired Unit 24a2 tests pass; earlier integration subsets remain green; later subsets may still fail.

### ⬜ Unit 24b3: Integration - Missing-Vector Live Generation
**What**: Wire the integration flow for generating only missing vectors with a mocked embedding endpoint.  
**Output**: Updates to vector-pack/indexer/embed modules required by missing-vector generation cases.  
**Acceptance**: Paired Unit 24a3 tests pass; earlier integration subsets remain green; later subsets may still fail.

### ⬜ Unit 24b4: Integration - Scope And Refs Preservation
**What**: Wire the integration flow for active/archived search scope and refs graph preservation after restore/import/rebuild.  
**Output**: Updates to search/indexer/refs modules required by scope and refs preservation cases.  
**Acceptance**: Paired Unit 24a4 tests pass; earlier integration subsets remain green; later subsets may still fail.

### ⬜ Unit 24b5: Integration - Idempotence And Degraded Semantic Mode
**What**: Wire the integration flow for repeated startup idempotence and degraded semantic mode.  
**Output**: Updates to startup/status/search modules required by idempotence and degraded semantic cases.  
**Acceptance**: Paired Unit 24a5 tests pass; earlier integration subsets remain green.

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
- 2026-06-14 14:54 Addressed second scrutiny findings: early coverage gate, explicit artifact paths, native runtime prebuild ownership, post-status Codex smoke, privacy-before-publication ordering, root precedence, host launch fixtures, and red-test semantics
- 2026-06-14 14:54 Committed second scrutiny fixes as `376ddc7`
