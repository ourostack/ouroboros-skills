# Planning: Desk Dependency Activation

**Status**: approved
**Created**: 2026-06-14 13:36

## Goal
Make Desk behave as an automatically resolved dependency of plugins and custom agents, not as a manually installed user prerequisite. Implement the repo-side primitives for host-native activation, self-preparing Desk MCP startup, shared vector packs, prebuilt snapshot restore, diagnostics, and verification.

## Upstream Work Items
- None

**DO NOT include time estimates (hours/days) — planning should focus on scope and criteria, not duration.**

## Scope

### In Scope
- Define a versioned Desk activation contract that can express Desk as a dependency, Work Suite as a dependency, the `desk:worker` activation target, required MCP servers, desk-root binding, embedding artifact policy, and snapshot artifact policy.
- Add host-specific packaging/adapters for the repo's supported host surfaces: Claude plugin metadata, Codex plugin/config materialization metadata, Copilot/root plugin metadata, Ouroboros/autonomous-agent bundle metadata, and flattened-bundle support where native transitive dependencies are unavailable.
- Keep the user-facing surface host-native. Do not introduce a bespoke everyday Desk CLI.
- Prove host activation with schema validation or smoke tests, not only generated manifest files. In particular, Codex App and Codex CLI must have a clean activation path where a new thread/session sees worker behavior and Desk MCP tools without manual `codex mcp add`, AGENTS appends, or copied agent files.
- Make the Desk MCP startup path self-prepare the local runtime index: resolve root, restore a compatible snapshot, import shared vector packs, reconcile changed docs, and degrade to lexical search when semantic query embeddings are unavailable.
- Make Desk MCP startup cwd-independent and runtime-owned: plugin-root path resolution must be explicit, native dependencies must be bundled/prebuilt/self-prepared in a writable cache, immutable plugin directories must not be mutated, and offline behavior must be defined.
- Bound session-start work: healthy startup should avoid network calls and long repairs, while expensive repairs are deferred, surfaced, or explicitly invoked through MCP maintenance/package/release surfaces.
- Add repo-shared vector-pack support keyed by deterministic chunk keys that include embedding spec, chunker version, and normalized text identity.
- Add prebuilt snapshot support as a warm boot artifact that is copied into `.state/` before mutation and validated against a manifest before use.
- Distinguish snapshot compatibility from freshness. Schema/spec/runtime/path failures reject a snapshot; source tree or document tree mismatch marks it stale and triggers restore-then-reconcile.
- Add tombstone, pruning, or artifact-rotation support so deleted/redacted documents are invalidated from shared vector packs and snapshots.
- Add MCP health/status diagnostics for dependency activation, root resolution, local DB, snapshot restore, vector-pack import, document-vector coverage, query embedding availability, lexical availability, and degraded modes.
- Add MCP maintenance tools or package/release scripts for explicit vector-pack publication, snapshot build, snapshot verification, and artifact validation. These must not be normal user setup commands.
- Update documentation so healthy-path setup is framed as dependency activation through existing host/plugin systems, not manual Desk installation.
- Add tests and CI checks for manifests, host-adapter generation, vector-pack import, snapshot restore/fallback, degraded semantic behavior, privacy exclusions, drift, and no-live-embedding rebuilds when vectors are already bundled.

### Out of Scope
- Shipping host application features that must be implemented upstream by Codex, Claude, Copilot, or other host maintainers.
- Creating a new user-facing Desk CLI or making users learn a new Desk command namespace.
- Mutating repo snapshots in place.
- Auto-publishing embeddings or snapshots during ordinary session startup.
- Deleting desk data during plugin uninstall/deactivation.
- Guaranteeing semantic query ranking without any local or remote query-embedding capability.
- Solving every future host adapter; this plan must make future adapters possible without implementing unknown hosts.
- Executing the implementation work in this planning task.

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

## Open Questions
- [x] Resolved: shared embedding/snapshot publication defaults off for public or sensitive repositories and requires explicit policy approval before writing repo artifacts.
- [x] Resolved: redaction cleanup uses tombstones for immediate invalidation plus artifact pruning/rotation for durable cleanup.
- [x] Resolved: unsupported host primitives are handled by flattened host-specific bundles or documented unsupported status rather than claiming native support.
- [x] Resolved: concrete startup/rebuild performance budget thresholds are set in test configuration or release policy before the implementation units that assert those budgets.

## Decisions Made
- Desk must be a dependency substrate, not a separately installed user prerequisite. Dependent plugins and custom agents carry Desk through host-native dependency or flattened packaging.
- No bespoke everyday Desk CLI will be introduced. Maintenance operations belong in MCP tools, existing package scripts, release automation, or host-native plugin/app surfaces.
- Vector packs are the canonical repo-shared document embeddings; local SQLite remains a disposable runtime index.
- Prebuilt SQLite snapshots are warm boot artifacts only. They are validated, copied into `.state/`, and then mutated locally.
- Snapshot restore must fall back to vector packs, and vector-pack rebuild must fall back to lexical indexing/live missing-vector generation as capabilities allow.
- Query embedding availability is separate from document embedding availability. Bundled document vectors do not remove the need for query embeddings for semantic query ranking.
- Publication of embedding/snapshot artifacts must be explicit and policy-controlled, especially for public or sensitive repositories.
- Codex is treated as the highest-risk host adapter because plugin MCP/skills do not automatically imply default app worker identity; the implementation must prove a durable Codex activation/materialization path.
- For personal Codex use, global worker+Desk default behavior is the desired happy path because Desk is the durable-context backbone. Project-local and manual-only modes are opt-outs for operators who do not want every session to inherit worker+Desk behavior.
- MCP health will be exposed as a named registered tool, provisionally `desk_status`, unless implementation discovers a stronger local naming convention.
- Snapshot compatibility excludes source/document freshness. Freshness mismatch should restore then reconcile; schema/spec/runtime/path mismatch should reject or skip.
- Redaction safety cannot remain "policy only"; implementation must provide a concrete invalidation mechanism and tests.
- Diagnostics are part of the privacy surface. They may identify files, rows, keys, and manifest fields, but must not dump chunk text or sensitive document content.
- Shared embedding/snapshot publication defaults off for public or sensitive repositories and requires explicit repo or organization policy approval before writing artifacts.
- Redaction cleanup uses tombstones for immediate invalidation plus pruning or artifact rotation for durable cleanup.
- Unsupported host primitives must produce flattened host-specific bundles or an explicit unsupported/support-matrix diagnostic, never fake native support.
- Startup and rebuild performance thresholds should be explicit implementation fixtures or release-policy values before budget assertions are added.
- The initial implementation should prefer deterministic, testable primitives over host-specific magic: activation manifest, adapter output, MCP health, vector packs, snapshot manifests, and CI fixtures.

## Context / References
- `plugins/desk/docs/dependency-activation-stories-and-criteria.md` — 150 story stress test and 240 completion criteria that this planning doc condenses into implementation scope.
- `plugins/desk/README.md` — current install docs still describe manual installs, manual MCP registration, Codex worker copying, and Ollama/index setup.
- `plugins/desk/docs/agent-files.md` — current cross-host worker packaging docs and Codex manual agent-layer paths.
- `plugins/desk/plugin.json` — root/Copilot-style plugin manifest; currently version-drifts from Codex manifest.
- `plugins/desk/.codex-plugin/plugin.json` — Codex plugin manifest with skills and MCP metadata.
- `plugins/desk/.claude-plugin/plugin.json` — Claude plugin metadata.
- `plugins/desk/.mcp.json` — current Desk MCP server declaration.
- `plugins/desk/mcp/src/db/schema.sql` — current runtime SQLite schema.
- `plugins/desk/mcp/src/db/init.js` — current local DB open/migration path and `.state/desk-index.sqlite` location.
- `plugins/desk/mcp/src/indexer/index.js` — current discover/chunk/embed/upsert/reconcile path.
- `plugins/desk/mcp/src/indexer/embed.js` — current Ollama embedding integration and semantic soft-failure behavior.
- `plugins/desk/mcp/src/server-helpers.js` — current `ensureIndex` and semantic repair path.
- `plugins/desk/mcp/src/tool-names.js` — current registered tool names; does not yet include a health/status tool.
- `plugins/desk/mcp/src/tools/reindex.js` and `plugins/desk/mcp/src/tools/search.js` — current user-visible index/search behavior to preserve and extend.
- `plugins/desk/mcp/__tests__/` — current MCP test suite to extend.
- `plugins/work-suite/README.md` — Work Suite dependency and cross-host packaging context.
- `plugins/work-suite/.codex-plugin/plugin.json` and `plugins/work-suite/.claude-plugin/plugin.json` — Work Suite host metadata.
- `plugins/desk/README.md` Ouroboros install section — current autonomous-agent/bundle path that must receive a support-matrix disposition.

## Notes
Ideator synthesis: the product surface is dependency activation, not setup. The implementation must make the healthy path boring: install/open the dependent plugin or agent, the host activates Desk, the MCP self-prepares, and search is useful immediately from snapshot or bundled vectors. The weak areas to plan around are Codex App default activation, native MCP dependency bootstrapping, vector privacy/redaction, host dependency flattening, and snapshot portability.

## Progress Log
- 2026-06-14 13:36 Created
- 2026-06-14 13:42 Addressed Round 1 reviewer findings: Codex smoke proof, MCP runtime ownership, bounded startup, artifact integrity, redaction, dependency versions, host support evidence, and health tool visibility
- 2026-06-14 13:46 Addressed Round 2 reviewer findings: performance budget explicitness, permission boundaries, diagnostic privacy, snapshot manifest fields, and Ouroboros/autonomous-agent support disposition
- 2026-06-14 14:07 Set Codex personal activation to global worker+Desk default, with project-local/manual-only opt-outs
- 2026-06-14 14:08 Approved planning and resolved remaining best-judgment decisions before doing-doc conversion
