# Doing: Desk Dependency Activation

**Status**: drafting
**Execution Mode**: direct
**Created**: pending initial commit
**Planning**: ./2026-06-14-1335-planning-desk-dependency-activation.md
**Artifacts**: ./2026-06-14-1335-doing-desk-dependency-activation/

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
- [ ] Claude packaging declares Work Suite as a dependency where supported by the host format.
- [ ] Claude Agent View/background-session inheritance is validated or explicitly documented as unsupported for the current host version.
- [ ] Copilot packaging exposes the expected worker agent through native agent/plugin metadata.
- [ ] Copilot packaging has a flattened dependency strategy for hosts without transitive dependency resolution.
- [ ] Codex packaging exposes Desk skills through Codex plugin metadata.
- [ ] Codex packaging exposes Desk MCP through Codex plugin metadata.
- [ ] Codex activation implements global personal worker+Desk default behavior as the primary happy path, with project-local and manual-only invocation modes available as opt-outs.
- [ ] Codex App and Codex CLI smoke tests prove that a new thread/session sees worker behavior and Desk MCP tools after activation.
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
- [ ] Native MCP runtime dependencies are bundled, prebuilt, or self-prepared in a host-appropriate writable data/cache location.
- [ ] Desk MCP launch works from arbitrary current working directories and resolves plugin-relative paths explicitly.
- [ ] Desk MCP startup does not mutate immutable plugin source/cache directories.
- [ ] Host-specific MCP launch smoke tests cover Claude, Codex, Copilot/root plugin packaging, and generic stdio launch.
- [ ] Desk MCP offline startup behavior is tested for snapshot restore, vector-pack import, and lexical fallback.
- [ ] Desk MCP resolves the desk root deterministically from activation config, environment, and safe defaults.
- [ ] Desk MCP health/status reports the resolved root.
- [ ] Desk MCP health/status reports plugin/runtime version.
- [ ] Desk MCP health/status reports DB schema ID/version.
- [ ] Desk MCP health/status reports active embedding spec.
- [ ] Desk MCP health/status reports snapshot restore state.
- [ ] Desk MCP health/status reports vector-pack import state.
- [ ] Desk MCP health/status reports document-vector coverage.
- [ ] Desk MCP health/status reports query embedding availability separately from document-vector availability.
- [ ] Desk MCP health/status reports lexical index availability.
- [ ] A registered `desk_status` or `desk_health` MCP tool exposes the health/status schema.
- [ ] Session-start context can surface concise health/status without running expensive repair work.
- [ ] Missing local `.state/desk-index.sqlite` is treated as a normal first-run state.
- [ ] Healthy startup has a bounded fast path and avoids network calls when snapshot/vector-pack artifacts are sufficient.
- [ ] Long-running repairs are deferred, explicitly surfaced, or explicitly invoked rather than silently blocking session start.
- [ ] Startup and rebuild performance budget values are declared in test configuration or release policy, and CI fails when those budgets are exceeded.
- [ ] Compatible snapshots are copied into `.state/` before mutation.
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
- [ ] Vector packs live outside `.state/` in a documented repo artifact path.
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
- [ ] Explicit artifact publication can write new vector packs only through MCP maintenance tools or existing package/release scripts.
- [ ] Explicit snapshot build/verify can run through MCP maintenance tools or existing package/release scripts.
- [ ] Public or sensitive repo policy can disable embedding/snapshot publication.
- [ ] Documentation states that embeddings and snapshots are derivative data and may carry privacy risk.
- [ ] Health output, logs, snapshot errors, and vector-pack validation errors avoid dumping chunk text or sensitive document content.
- [ ] Vector-pack validation errors report file, row, and chunk key without dumping full text.
- [ ] Gitignored secret files are excluded from indexing and artifact publication by default.
- [ ] Artifact publication requires explicit approval when repository or organization policy requires it.
- [ ] Deleted/redacted documents are invalidated through tombstones, pruning, or artifact rotation.
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
- [ ] Release/CI automation can build and verify vector packs and snapshots without introducing a user-facing Desk CLI.
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

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ⬜ Unit 0: Setup/Research
**What**: Read the planning doc, story matrix, current plugin manifests, MCP server/indexer code, and CI workflows. Create concise implementation notes in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/` covering current host surfaces, current MCP launch assumptions, and the chosen performance-budget fixture source.  
**Output**: A setup note in the artifacts directory naming the exact files and commands to use for this task.  
**Acceptance**: Notes exist, cited source paths exist at HEAD, and no production code changed in this unit.

### ⬜ Unit 1a: Activation Contract - Tests
**What**: Write failing tests for a versioned activation manifest/schema and validator. Cover dependency ID, semver/pin, provenance/lock fields, host support/fallback fields, permissions/capabilities, `desk:worker`, overlay agents, MCP requirements, desk-root binding, embedding policy, snapshot policy, unknown schema versions, deterministic dependency order, and unsupported-host diagnostics.  
**Output**: Failing tests under a repo-appropriate test location such as `plugins/desk/__tests__/activation/` or a root `scripts/` validation test if no package harness exists yet.  
**Acceptance**: Tests fail because the schema/validator/fixtures do not exist or do not satisfy the expected contract.

### ⬜ Unit 1b: Activation Contract - Implementation
**What**: Add the activation schema, canonical Desk activation manifest, validator, fixture manifests, and generated/validated support-matrix data. Keep the contract host-neutral and avoid a user-facing Desk CLI.  
**Output**: New activation contract files under `plugins/desk/activation/` or an equivalent documented plugin-owned path, plus validation code wired into tests.  
**Acceptance**: Unit 1a tests pass, unsupported or unknown schemas fail closed with actionable diagnostics, and dependency ordering is deterministic.

### ⬜ Unit 1c: Activation Contract - Coverage & Refactor
**What**: Refactor the activation contract code for maintainability, add missing branches and edge cases, and document the manifest fields.  
**Output**: Clean contract implementation and docs.  
**Acceptance**: 100% coverage on new activation-contract code, all activation-contract tests pass, and no warnings.

### ⬜ Unit 2a: Codex Global Activation - Tests
**What**: Write failing tests for Codex global personal worker+Desk default activation, project-local opt-out, manual-only opt-out, safe merge/preservation of user-authored config, no uncontrolled `AGENTS.md` append/copy, no manual `codex mcp add`, and permission/capability boundaries.  
**Output**: Failing adapter/materialization tests with temp Codex homes/projects and fixture user config.  
**Acceptance**: Tests fail because Codex activation materialization does not yet exist or still relies on manual setup assumptions.

### ⬜ Unit 2b: Codex Global Activation - Implementation
**What**: Implement the Codex adapter/materialization path for global personal default worker+Desk activation, plus project-local and manual-only opt-outs. Ensure generated artifacts are owned/tracked and preserve user-authored config.  
**Output**: Codex adapter code and fixture output for global, project-local, and manual-only modes.  
**Acceptance**: Unit 2a tests pass and generated output proves a new Codex App/CLI session can be configured without manual MCP registration or copied worker files.

### ⬜ Unit 2c: Codex Global Activation - Coverage & Refactor
**What**: Add edge-case coverage for existing config, disabled Desk, changed activation version, malformed config, and repeated activation.  
**Output**: Hardened Codex adapter implementation and tests.  
**Acceptance**: 100% coverage on new Codex adapter code, repeated activation is idempotent, and all Codex adapter tests pass.

### ⬜ Unit 3a: Host Packaging And Support Matrix - Tests
**What**: Write failing tests for Claude, Copilot/root plugin, Ouroboros/autonomous-agent bundle, generic stdio MCP, and flattened-bundle support-matrix disposition. Cover manifest version drift, Work Suite dependency declarations where supported, unsupported primitive diagnostics, no hand-edited JSON/TOML requirement, and host permission/capability boundaries.  
**Output**: Failing manifest/support-matrix tests that inspect `plugins/desk/plugin.json`, `plugins/desk/.claude-plugin/plugin.json`, `plugins/desk/.codex-plugin/plugin.json`, `plugins/work-suite/*`, and generated host fixtures.  
**Acceptance**: Tests fail on current manifest drift and missing dependency/support-matrix data.

### ⬜ Unit 3b: Host Packaging And Support Matrix - Implementation
**What**: Update host manifests, support-matrix generation/validation, flattened-bundle metadata, and host docs so native support, flattened fallback, and unsupported status are explicit and evidence-backed.  
**Output**: Updated manifests, generated support matrix, and host packaging metadata.  
**Acceptance**: Unit 3a tests pass, version drift is eliminated or intentionally recorded, and unsupported primitives produce explicit diagnostics.

### ⬜ Unit 3c: Host Packaging And Support Matrix - Coverage & Refactor
**What**: Refactor host packaging validation for clarity and add missing edge cases for missing dependencies, invalid versions, and unsupported host features.  
**Output**: Clean host validation/generation code.  
**Acceptance**: 100% coverage on new host validation/generation code, all host packaging tests pass, and generated docs/fixtures are stable.

### ⬜ Unit 4a: MCP Status And Runtime Bootstrap - Tests
**What**: Write failing tests for `desk_status` or `desk_health` registration in `plugins/desk/mcp/src/tool-names.js` and `server.js`, health schema fields, root resolution, cwd-independent launch, immutable plugin-dir protection, offline startup, bounded startup, deferred repair surfacing, and diagnostic non-leak behavior.  
**Output**: Failing tests under `plugins/desk/mcp/__tests__/tools/`, `plugins/desk/mcp/__tests__/db/`, or `plugins/desk/mcp/__tests__/runtime/`.  
**Acceptance**: Tests fail because the health tool/runtime bootstrap fields and launch guarantees do not exist yet.

### ⬜ Unit 4b: MCP Status And Runtime Bootstrap - Implementation
**What**: Implement registered health/status tooling, root/runtime resolution helpers, cwd-independent plugin path resolution, safe writable runtime/cache behavior for native dependencies, bounded startup/deferred repair state, and session-start-friendly health summaries.  
**Output**: Updated MCP server helpers, tool registration, runtime helpers, and health output schema.  
**Acceptance**: Unit 4a tests pass, health output separates document-vector availability from query embedding availability, and errors do not dump chunk text.

### ⬜ Unit 4c: MCP Status And Runtime Bootstrap - Coverage & Refactor
**What**: Add branch coverage for missing root, missing local DB, unavailable embedding endpoint, failed runtime bootstrap, arbitrary cwd, repeated startup, and disabled repair.  
**Output**: Hardened MCP startup/status implementation.  
**Acceptance**: 100% coverage on new MCP status/bootstrap code, all MCP status/bootstrap tests pass, and no warnings.

### ⬜ Unit 5a: Shared Vector Packs - Tests
**What**: Write failing tests for deterministic chunk keys, embedding spec IDs, vector-pack row schema, pack checksums, row validation, wrong spec/dimension/hash rejection, malformed vector encodings, idempotent import, multiple append-only packs, inactive-spec ignore, no live embedding calls when packs fully cover chunks, and missing-vector live generation with a mocked endpoint.  
**Output**: Failing vector-pack tests under `plugins/desk/mcp/__tests__/indexer/` and fixtures under that test tree.  
**Acceptance**: Tests fail because vector-pack import/export/chunk-key support does not yet exist.

### ⬜ Unit 5b: Shared Vector Packs - Implementation
**What**: Implement embedding spec handling, deterministic chunk keys, vector-pack import, validation, idempotent dedupe, inactive-spec ignore, no-live-embedding covered rebuilds, and missing-vector generation order.  
**Output**: New or updated indexer modules, DB schema/migrations for chunk keys/spec metadata, and test fixtures.  
**Acceptance**: Unit 5a tests pass, local DB rebuild works from docs plus vector packs with embedding endpoint disabled when chunks are covered, and missing vectors are generated only after pack import.

### ⬜ Unit 5c: Shared Vector Packs - Coverage & Refactor
**What**: Add coverage for empty packs, duplicate rows, checksum mismatch, bad base64/float encodings, stale spec directories, and pack merge/no-conflict simulation.  
**Output**: Hardened vector-pack modules.  
**Acceptance**: 100% coverage on new vector-pack code, all vector-pack tests pass, and search scope/refs behavior remains unchanged.

### ⬜ Unit 6a: Snapshot Restore And Build - Tests
**What**: Write failing tests for snapshot manifest schema, compressed artifact handling, restore-copy-then-mutate behavior, checksum validation, DB schema/spec/chunker/runtime validation, absolute/unexpected source path rejection, compatibility versus freshness, newest-compatible selection, inactive-spec ignore, corruption fallback to vector packs, stale snapshot reconcile, and snapshot build/verify surfaces.  
**Output**: Failing snapshot tests under `plugins/desk/mcp/__tests__/indexer/` or `plugins/desk/mcp/__tests__/snapshots/` with fixture snapshots.  
**Acceptance**: Tests fail because snapshot restore/build/verify support does not yet exist.

### ⬜ Unit 6b: Snapshot Restore And Build - Implementation
**What**: Implement snapshot manifest parsing/validation, compressed artifact restore into `.state/`, freshness classification, fallback to vector packs, stale reconcile, build/verify maintenance surfaces, and protection against in-place repo snapshot mutation.  
**Output**: Snapshot modules, MCP maintenance/package-script surfaces, and fixtures.  
**Acceptance**: Unit 6a tests pass, corrupt or incompatible snapshots are cache misses, stale compatible snapshots restore then reconcile, and repo snapshots are never opened in place for mutation.

### ⬜ Unit 6c: Snapshot Restore And Build - Coverage & Refactor
**What**: Add coverage for missing manifest fields, checksum mismatch, sqlite-vec/runtime mismatch, document tree mismatch, source commit mismatch, missing pack IDs, repeated restore, and performance-budget fixture cases.  
**Output**: Hardened snapshot modules and budget tests.  
**Acceptance**: 100% coverage on new snapshot code, all snapshot tests pass, and startup/rebuild budget tests fail when configured thresholds are exceeded.

### ⬜ Unit 7a: Privacy, Redaction, And Publication Policy - Tests
**What**: Write failing tests for public/sensitive repo publication defaults, explicit policy approval before artifact writes, gitignored secret exclusion, sensitive-path exclusion, tombstone invalidation, pruning or rotation cleanup, active artifact exclusion of deleted/redacted docs, and diagnostics that report file/row/key without dumping text.  
**Output**: Failing privacy/redaction tests with fixture desks containing deleted, redacted, gitignored, and sensitive-path content.  
**Acceptance**: Tests fail because policy, tombstones, cleanup, and non-leak validation are not implemented yet.

### ⬜ Unit 7b: Privacy, Redaction, And Publication Policy - Implementation
**What**: Implement repo/org publication policy checks, artifact write approval gates, gitignore-aware exclusion behavior, tombstone invalidation, pruning or artifact rotation surfaces, and non-leaking diagnostics for health/logs/pack/snapshot errors.  
**Output**: Policy modules, redaction/tombstone handling, cleanup surfaces, and updated diagnostics.  
**Acceptance**: Unit 7a tests pass, deleted/redacted docs are not represented in active vector packs or snapshots, and error output avoids sensitive text.

### ⬜ Unit 7c: Privacy, Redaction, And Publication Policy - Coverage & Refactor
**What**: Add edge-case coverage for nested gitignore rules, archived redactions, repeated tombstones, missing policy files, public repo detection failures, and cleanup after pack compaction or snapshot rotation.  
**Output**: Hardened privacy/redaction implementation.  
**Acceptance**: 100% coverage on new privacy/redaction code, all privacy tests pass, and no sensitive text appears in diagnostic snapshots.

### ⬜ Unit 8a: Integration, Docs, And CI - Tests
**What**: Write failing integration/CI checks for full cold start, snapshot restore, vector-pack rebuild without embeddings, missing-vector live generation with mocked endpoint, active/archived scope preservation, refs graph preservation, repeated startup idempotence, generated artifact freshness, worker-content drift, manifest drift, and host support-matrix freshness.  
**Output**: Failing integration tests and CI validation scripts/workflow updates.  
**Acceptance**: Tests fail on current repo state or stale generated artifacts.

### ⬜ Unit 8b: Integration, Docs, And CI - Implementation
**What**: Wire integration tests, generated-artifact freshness checks, host support docs, healthy-path setup docs, artifact privacy docs, package/release scripts, and CI workflow updates. Remove or demote obsolete manual-install docs to troubleshooting/developer notes.  
**Output**: Updated docs, scripts, generated files, and CI workflows.  
**Acceptance**: Unit 8a tests pass, docs no longer present manual Desk install as the healthy path, and release/CI can build and verify vector packs and snapshots without a user-facing Desk CLI.

### ⬜ Unit 8c: Final Verification And Handoff
**What**: Run the full Desk MCP test suite, root validation scripts, host/package validation scripts, generated-artifact freshness checks, and any new coverage commands. Update planning/doing checklists only for criteria with evidence.  
**Output**: Verification notes in the artifacts directory and updated task docs.  
**Acceptance**: All tests pass, coverage requirements are met for new code, no warnings remain, branch is clean except intentional task-doc updates, and results are committed and pushed.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-14-1335-doing-desk-dependency-activation/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- pending initial commit Created from planning doc
