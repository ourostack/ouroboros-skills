# Desk Dependency Activation - User Stories And Completion Criteria

Status: ideation artifact.

This document stress-tests the current Desk dependency design against human and harness/agent stories. It assumes the latest design direction from discussion:

- Desk is a dependency, not a thing users manually install.
- No bespoke Desk CLI is introduced.
- Existing host surfaces carry the user experience: plugin dependency resolution, marketplace install, agent launch/default selection, project/app config, MCP lifecycle, hooks, and release automation.
- The Desk MCP self-prepares its runtime index.
- Repo-shared document embeddings are committed as canonical vector packs.
- Prebuilt SQLite snapshots are also shipped as warm boot artifacts, but copied into local `.state/` before mutation.
- Host-specific packaging/adapters may materialize native files when a host lacks a first-class dependency or default-agent mechanism.

## Current Stack-Up

The proposed design has the right product shape for "Desk is just there" because it moves setup into host-native dependency activation and MCP startup. It avoids the wrong product move: asking users to learn a new Desk command surface.

The current implementation is being judged against that shape. The activation contract, host adapters, runtime pack, vector-pack and snapshot paths, diagnostics, publication policy, and redaction cleanup are landing as repo-side primitives. Remaining documentation and artifact-publication work should keep manual setup commands out of healthy-path prose and reserve repair details for troubleshooting or developer notes.

The most important conclusion from the stories below: the design should be judged by whether a dependent plugin or agent can carry Desk along with it. If the human has to think "now I must install Desk," the story fails.

## Fit Legend

- Strong: the proposed design directly supports the story once implemented.
- Partial: the proposed design points in the right direction, but a policy, host adapter, or implementation detail is still unresolved.
- Weak: the proposed design needs an additional primitive or sharper decision.

## Human User Stories

| ID | Story | Fit | Design implication |
|---|---|---|---|
| H001 | As a first-time Codex Desktop user, I install a custom worker plugin and Desk becomes available without me installing Desk separately. | Partial | Codex needs dependency materialization for plugin MCP, skills, worker identity, and config/profile artifacts. |
| H002 | As a first-time Claude Code user, I install a worker plugin and its Desk dependency installs automatically. | Strong | Rely on Claude plugin dependency resolution where available and test dependency closure. |
| H003 | As a Copilot CLI user, I run the host-native agent launch command and get the Desk-backed worker. | Partial | Copilot packaging must expose the expected agent name and flatten dependencies if transitive deps are unavailable. |
| H004 | As a user opening Codex App from the dock, I want the right Desk-backed worker behavior without remembering flags. | Partial | Need project/app config or generated profile activation, not a one-off command. |
| H005 | As a user opening a repo in Codex App, I want the repo to select its Desk dependency behavior when appropriate. | Partial | Project-local activation should beat global guesswork and be visible in diagnostics. |
| H006 | As a user with several workspaces, I want each repo to bind the correct `$DESK` root automatically. | Partial | Activation must bind desk root per workspace, not only per user home. |
| H007 | As a user with a personal desk at `~/desk`, I want a default that works without configuration. | Strong | MCP root discovery can default safely while still reporting what root was chosen. |
| H008 | As a user with a corporate desk path, I want the corporate overlay to own the path convention. | Strong | Overlay manifests need a root-binding field or host-native equivalent. |
| H009 | As a user who never asked for Desk directly, I want a dependent agent to feel complete on first launch. | Strong | Desk must behave like a runtime dependency of the dependent agent. |
| H010 | As a user, I do not want install docs that say "now copy this file into your home directory." | Strong | Manual file-copy install paths should become troubleshooting/developer notes only. |
| H011 | As a user, I do not want to run `npm install` inside a plugin directory. | Strong | MCP entrypoint must self-bootstrap or ship prebuilt runtime artifacts. |
| H012 | As a user, I do not want to manually register an MCP server after installing a plugin. | Strong | Plugin manifests and host adapters must register/enable the Desk MCP. |
| H013 | As a user, I want a clear message when a host cannot support automatic activation. | Partial | Diagnostics must say which host primitive is missing and what fallback was applied. |
| H014 | As a user, I want Desk search to work right after opening a repo on a new machine. | Strong | Snapshot restore should seed the local index before live indexing. |
| H015 | As a user, I want a new machine not to re-embed every document. | Strong | Vector packs are canonical shared document embeddings. |
| H016 | As a user, I want startup to be fast even when the desk repo is large. | Strong | Snapshot warm boot plus incremental reconcile is required. |
| H017 | As a user, I want new or edited docs to be indexed without rebuilding everything. | Strong | Reconcile must chunk/hash and update only changed content. |
| H018 | As a user on a plane, I want lexical search and existing semantic vectors to work offline. | Strong | Local snapshot/vector packs should be enough for document-side semantics; query embedding may degrade. |
| H019 | As a user without Ollama running, I want Desk to degrade gracefully. | Strong | Current soft-fallback exists, but startup should also import existing vectors and report query limits. |
| H020 | As a user without the embedding model installed, I want old document embeddings to be reused. | Strong | Index restore/import must not require live model for document vectors. |
| H021 | As a user, I want a clear explanation if semantic query ranking is unavailable. | Strong | Diagnostics should distinguish missing query embedding from missing document embeddings. |
| H022 | As a user, I want the worker to know when Desk is unhealthy and fix what it can. | Strong | Health status should be an MCP tool/result surfaced on session start. |
| H023 | As a user, I want the worker to ask before doing expensive or privacy-sensitive embedding publication. | Partial | Publication policy must distinguish local repair from repo writes. |
| H024 | As a user, I want a dependent plugin to define whether shared embeddings are enabled. | Strong | Activation manifest needs embedding policy. |
| H025 | As a user of a public repo, I want embeddings/snapshots disabled unless explicitly approved. | Partial | Need a privacy default or repository classification policy. |
| H026 | As a user of a private team repo, I want embeddings/snapshots committed so teammates avoid wasted setup. | Strong | Repo artifact paths and release/CI rules should support this directly. |
| H027 | As a user, I want binary snapshot churn not to wreck Git history. | Strong | Snapshots should be generated intentionally, compressed, and treated as warm boot artifacts. |
| H028 | As a user, I want vector-pack merge conflicts to be rare. | Strong | Use immutable append-only packs with unique names and optional compaction. |
| H029 | As a user, I want two teammates publishing embeddings at the same time not to break the repo. | Strong | Distinct pack IDs avoid direct conflicts; compaction can be later. |
| H030 | As a user, I want a stale snapshot to still be useful. | Strong | Restore then reconcile changed docs rather than rejecting all staleness. |
| H031 | As a user, I want an incompatible snapshot to be skipped safely. | Strong | Snapshot manifest compatibility checks must be strict. |
| H032 | As a user, I want a snapshot produced on macOS to be usable on Linux if compatible. | Partial | SQLite/runtime compatibility and extension assumptions need explicit validation. |
| H033 | As a user, I want a snapshot that cannot be used to fall back to vector packs automatically. | Strong | Snapshot restore cannot be a single point of failure. |
| H034 | As a user, I want the local index to stay out of Git. | Strong | `.state/desk-index.sqlite` remains machine-local. |
| H035 | As a user, I want the committed artifacts to be auditable text where possible. | Strong | Vector packs and manifests should be JSON/JSONL; snapshots are the only binary artifact. |
| H036 | As a user, I want to see exactly which embedding model/spec my repo uses. | Strong | `embedding-spec.json` is required and pinned. |
| H037 | As a user, I want the system to refuse mixing incompatible vector spaces. | Strong | Spec IDs must be part of chunk keys and index metadata. |
| H038 | As a user, I want model upgrades to be deliberate. | Strong | Multiple spec directories can coexist; active spec must be declared. |
| H039 | As a user, I want old embeddings retained until migration is complete. | Strong | Versioned artifact directories support staged migration. |
| H040 | As a user, I want stale model aliases like `latest` not to silently change my search space. | Strong | Spec must record exact model identity/digest where possible. |
| H041 | As a user, I want to know whether a dependent agent is using Desk's worker or its own overlay. | Partial | Activation status should expose agent identity and inherited dependencies. |
| H042 | As a user, I want overlays to customize behavior without forking Desk. | Strong | Desk remains substrate; overlays declare their own agent identity and dependencies. |
| H043 | As a user, I want a default `desk:worker` to exist for standalone use. | Strong | Keep substrate-default worker as a dependency-provided activation target. |
| H044 | As a user, I want a corporate overlay to depend on Desk but launch as the corporate agent. | Strong | Dependency and activation are separate: Desk provides substrate; overlay provides identity. |
| H045 | As a user, I want project instructions and worker instructions not to fight each other. | Partial | Host adapters must define precedence and conflict diagnostics. |
| H046 | As a user, I want to uninstall a dependent plugin cleanly. | Partial | Host adapter must remove or deactivate generated activation artifacts it owns. |
| H047 | As a user, I want uninstalling an overlay not to delete my desk data. | Strong | Desk root and repo artifacts are data, not plugin cache. |
| H048 | As a user, I want enabling a plugin not to mutate my repo without consent. | Strong | Startup can restore local state; publishing artifacts requires explicit policy/automation. |
| H049 | As a user, I want session start to be quick even if index repair is needed. | Partial | Startup should restore synchronously only when cheap and defer expensive repair. |
| H050 | As a user, I want the worker to continue if index repair fails. | Strong | MCP health can degrade without blocking the whole agent. |
| H051 | As a user, I want a "what happened" status after first launch. | Partial | Need host-visible diagnostics or MCP status surfaced by session-start context. |
| H052 | As a user, I want a host's native plugin UI to show Desk as a dependency, not as a separate task I must remember. | Partial | Marketplace metadata and dependency declarations need to be right. |
| H053 | As a user, I want the same desk repo to work across Codex, Claude, and Copilot. | Partial | Shared artifact format plus host-native adapters must be validated across hosts. |
| H054 | As a user, I want not to care whether the worker is loaded by agent file, profile, or hook. | Strong | Those are adapter implementation details. |
| H055 | As a user, I want the same worker content not to drift across host formats. | Strong | Canonical body plus generated host files, with drift tests. |
| H056 | As a user, I want host-specific limitations documented as limitations, not mysterious setup failures. | Strong | Diagnostics and docs should state host support matrix. |
| H057 | As a user, I want Desk to repair itself after package upgrades. | Partial | MCP startup should run safe migrations and verify artifacts. |
| H058 | As a user, I want old plugin versions not to corrupt new indexes. | Strong | Versioned schema and manifest checks protect local index and artifacts. |
| H059 | As a user, I want a team-maintained snapshot to be rebuilt in CI/release, not by random local sessions. | Strong | Publishing belongs in existing CI/release automation or MCP tools invoked by agents. |
| H060 | As a user, I want no new everyday command namespace. | Strong | No bespoke CLI; maintenance lives in MCP tools/package scripts/host UI. |
| H061 | As a user, I want a simple recovery path if a local index is broken. | Strong | Delete local `.state` and restore from snapshot/packs automatically. |
| H062 | As a user, I want a corrupted committed snapshot not to poison everyone. | Strong | Verify restore in CI; runtime falls back to vector packs. |
| H063 | As a user, I want a corrupted vector pack to be detected before use. | Strong | Pack checksums and row validation are completion criteria. |
| H064 | As a user, I want the search index not to leak unrelated files from my repo. | Partial | Discover rules and artifact manifests must have explicit inclusion/exclusion policy. |
| H065 | As a user, I want multiple desks/personas in one repo to remain isolated. | Partial | Artifact paths and spec manifests may need desk root or namespace keys. |
| H066 | As a user, I want the worker to use archived context only when requested or relevant. | Strong | Existing scope filters should be preserved in rebuilt indexes. |
| H067 | As a user, I want embedding publication not to include deleted private text after a redaction. | Weak | Need redaction/prune/pack tombstone or artifact rotation policy. |
| H068 | As a user, I want snapshots not to contain absolute local paths. | Strong | Snapshot validation must reject host-specific paths. |
| H069 | As a user, I want a clear way to tell whether artifacts are current before committing. | Partial | Existing package scripts or MCP status should report artifact freshness. |
| H070 | As a user, I want all this to feel boring and invisible when things are healthy. | Strong | Success path should be silent except concise readiness context. |

## Harness And Agent User Stories

| ID | Story | Fit | Design implication |
|---|---|---|---|
| A001 | As a dependent plugin, I declare `desk` as a dependency and receive Desk skills without copying them. | Partial | Need host-neutral dependency metadata plus host adapters. |
| A002 | As a dependent plugin, I declare `work-suite` because my Desk-backed worker needs doing-phase skills. | Partial | Dependency closure must include both substrate and doing machinery. |
| A003 | As a host plugin resolver, I install dependencies before activating the dependent agent. | Strong | Activation order is part of the dependency contract. |
| A004 | As a host without transitive deps, I receive a flattened bundle generated at release time. | Strong | Packaging pipeline must emit host-specific bundles. |
| A005 | As a Codex adapter, I enable Desk MCP from plugin metadata. | Partial | Current `.codex-plugin` has MCP metadata, but agent/default activation is missing. |
| A006 | As a Codex adapter, I materialize worker instructions into a native Codex surface when requested by an activation. | Partial | Need generated custom-agent/profile/project-instruction artifact ownership. |
| A007 | As a Codex adapter, I avoid mutating global user instructions unless the activation explicitly targets global default behavior. | Strong | Prefer project-local or profile-owned materialization. |
| A008 | As a Claude adapter, I expose `desk:worker` as a plugin-provided agent. | Strong | Current agent file shape already aligns conceptually. |
| A009 | As a Claude adapter, I use plugin dependencies rather than requiring separate installs. | Partial | Current docs say install Work Suite explicitly; dependency metadata needs updating. |
| A010 | As a Copilot adapter, I expose the expected worker agent name without requiring manual plugin order. | Partial | Root `plugin.json` has agents but dependency flattening is needed. |
| A011 | As a host app, I can ask "what activations does this plugin provide?" | Weak | Need activation manifest or equivalent metadata. |
| A012 | As a host app, I can ask "what dependencies does this activation require?" | Weak | Need explicit dependency closure metadata. |
| A013 | As a host app, I can ask "what files/config did this activation materialize?" | Partial | Needed for uninstall and diagnostics. |
| A014 | As a host app, I can disable Desk dependency activation without deleting data. | Partial | Activation state must be separate from desk root data. |
| A015 | As the Desk MCP, I resolve the desk root deterministically. | Strong | Root resolution exists, but should be manifest/profile aware. |
| A016 | As the Desk MCP, I report the resolved root in health output. | Strong | Add explicit status surface. |
| A017 | As the Desk MCP, I create `.state/` if missing. | Strong | Current DB opener already does this. |
| A018 | As the Desk MCP, I look for compatible snapshots before full indexing. | Weak | New snapshot restore module required. |
| A019 | As the Desk MCP, I verify snapshot manifest compatibility before restore. | Strong | Manifest contract must be implemented. |
| A020 | As the Desk MCP, I copy a snapshot into `.state/` rather than opening the repo snapshot in place. | Strong | Protects Git artifact immutability. |
| A021 | As the Desk MCP, I fall back to vector packs when snapshot restore fails. | Strong | Fallback chain must be explicit. |
| A022 | As the Desk MCP, I fall back to lexical indexing when vectors are missing and embeddings are unavailable. | Strong | Existing behavior already supports lexical fallback. |
| A023 | As the Desk MCP, I import vectors by content-addressed chunk key. | Weak | Current schema lacks chunk keys and vector-pack import. |
| A024 | As the Desk MCP, I generate embeddings only for chunks missing from packs. | Weak | Current indexer embeds changed docs directly from Ollama. |
| A025 | As the Desk MCP, I never mix embeddings from incompatible specs. | Partial | Need spec ID in schema, chunk keys, and meta. |
| A026 | As the Desk MCP, I can answer semantic search using imported document vectors. | Partial | Current search can use sqlite-vec once populated; import path missing. |
| A027 | As the Desk MCP, I distinguish document-vector availability from query-vector availability. | Partial | Current diagnostics mostly speak about embedding endpoint availability. |
| A028 | As the Desk MCP, I expose `semantic_unavailable` when query embedding cannot be computed. | Strong | Existing search soft-failure can be refined. |
| A029 | As the Desk MCP, I expose `document_vectors_imported` after vector-pack import. | Weak | New status fields needed. |
| A030 | As the Desk MCP, I expose `snapshot_restored` when warm boot succeeds. | Weak | New status fields needed. |
| A031 | As the Desk MCP, I mark an index stale when docs changed after snapshot source commit/hash. | Strong | Existing freshness checks plus snapshot manifest can support this. |
| A032 | As the Desk MCP, I reconcile only changed docs after snapshot restore. | Strong | Existing dirty detection supports incremental reindex. |
| A033 | As the Desk MCP, I preserve refs graph correctness after restore and reconcile. | Strong | Existing full refs refresh can run after reconcile. |
| A034 | As the Desk MCP, I run migrations on restored DBs. | Strong | Current `openDb` migration path can apply after restore. |
| A035 | As the Desk MCP, I reject snapshots built with an incompatible DB schema. | Strong | Manifest and meta checks required. |
| A036 | As the Desk MCP, I reject snapshots with incompatible sqlite-vec assumptions. | Partial | Need runtime compatibility probe. |
| A037 | As the Desk MCP, I reject snapshots with absolute host paths. | Strong | Snapshot verification can inspect known tables/meta. |
| A038 | As the Desk MCP, I treat corrupted snapshots as cache misses. | Strong | Fallback to packs/full index. |
| A039 | As the Desk MCP, I treat corrupted vector packs as invalid and explain the row/checksum failure. | Partial | Need pack validation. |
| A040 | As the Desk MCP, I avoid network calls during ordinary healthy startup. | Strong | Snapshot/packs should satisfy healthy startup. |
| A041 | As the Desk MCP, I avoid blocking session start on long embedding generation. | Partial | Need background/deferred repair or bounded startup policy. |
| A042 | As the Desk MCP, I can rebuild a local DB entirely from docs and vector packs. | Strong | This is the key canonical recovery path. |
| A043 | As the Desk MCP, I can publish new vector packs when explicitly invoked by an agent or CI. | Partial | Should be MCP tool/package-script callable, not human CLI. |
| A044 | As the Desk MCP, I can build a snapshot when explicitly invoked by an agent or CI. | Partial | Should be MCP tool/package-script callable. |
| A045 | As the Desk MCP, I can verify a snapshot by restoring it into a temp root. | Strong | Required release gate. |
| A046 | As the Desk MCP, I can compact old vector packs without changing vector semantics. | Partial | Later maintenance primitive. |
| A047 | As the Desk MCP, I can prune embeddings for deleted/redacted documents. | Weak | Needs tombstone/redaction policy. |
| A048 | As a worker agent, I can ask Desk MCP for readiness at session start. | Strong | Add/extend status tool; hook/context can summarize. |
| A049 | As a worker agent, I can decide whether search is semantic, lexical, or mixed from MCP output. | Strong | Search responses and health should include mode. |
| A050 | As a worker agent, I can call a maintenance tool to prepare repo artifacts when the user approves. | Strong | MCP tools can handle publication/build/verify. |
| A051 | As a worker agent, I do not need shell instructions for normal Desk setup. | Strong | Setup moves into dependency and MCP lifecycle. |
| A052 | As a worker agent, I can explain a failing dependency in host-native terms. | Partial | Error model should include host adapter context. |
| A053 | As a worker agent, I can avoid promising semantic search when only lexical search is available. | Strong | Current diagnostic pattern supports this. |
| A054 | As a worker agent, I can repair missing vectors when an embedding service becomes available. | Strong | Existing `reembedMissing` behavior is a starting point. |
| A055 | As a worker agent, I import shared vectors before generating new vectors. | Weak | New indexer order required. |
| A056 | As a worker agent, I publish only new missing vectors, not re-pack the world. | Strong | Append-only pack model supports this. |
| A057 | As a worker agent, I know when committing vector packs is inappropriate. | Partial | Need repo privacy/public classification and policy. |
| A058 | As a worker agent, I can ask the user before writing large binary snapshots. | Strong | Publication/build tools should expose size and diff impact. |
| A059 | As a worker agent, I can route packaging work through existing release scripts. | Strong | No bespoke CLI; package scripts or MCP tools are enough. |
| A060 | As a CI harness, I can verify plugin manifests across host formats. | Strong | Add manifest drift/dependency tests. |
| A061 | As a CI harness, I can fail if worker bodies drift across Claude/Copilot/Codex formats. | Strong | Existing three-file model needs generator or checksum test. |
| A062 | As a CI harness, I can fail if activation dependencies are incomplete. | Strong | Activation manifest dependency closure test. |
| A063 | As a CI harness, I can fail if snapshot restore does not produce a usable DB. | Strong | Snapshot verification test. |
| A064 | As a CI harness, I can fail if vector packs contain rows for the wrong spec. | Strong | Pack validation test. |
| A065 | As a CI harness, I can fail if index rebuild calls live embeddings when pack vectors cover all chunks. | Strong | Mock embedding endpoint and assert zero calls. |
| A066 | As a CI harness, I can fail if snapshot artifacts include absolute local paths. | Strong | Inspect restored DB and manifest. |
| A067 | As a CI harness, I can measure first-run startup time from snapshot. | Partial | Need performance budget tests. |
| A068 | As a CI harness, I can test degraded startup with no embedding service. | Strong | Existing soft-failure tests can extend. |
| A069 | As a CI harness, I can test a stale snapshot followed by incremental reconcile. | Strong | Fixture snapshot plus changed doc test. |
| A070 | As a CI harness, I can test two machines producing non-conflicting packs. | Strong | Simulate distinct pack IDs and merge. |
| A071 | As a release harness, I can build host-specific flattened bundles when needed. | Partial | Release packaging layer required. |
| A072 | As a release harness, I can publish updated plugin manifests without stale version drift. | Strong | Current root and Codex plugin versions already drift and need tests. |
| A073 | As a release harness, I can produce a support matrix for each host. | Strong | Generated docs can prevent false expectations. |
| A074 | As a security reviewer, I can inspect exactly what repo artifacts contain. | Partial | Vector/snapshot privacy docs and manifest schema required. |
| A075 | As a security reviewer, I can disable embedding artifact publication by policy. | Partial | Activation/repo policy gate required. |
| A076 | As a security reviewer, I can verify no secrets from ignored files are indexed. | Partial | Discover rules and tests need secret/ignore fixtures. |
| A077 | As an enterprise admin, I can pre-approve Desk dependency activation for a team. | Partial | Host marketplace/config policy must be supported. |
| A078 | As an enterprise admin, I can pin Desk and Work Suite versions. | Strong | Dependency specs need version ranges/pins. |
| A079 | As an enterprise admin, I can audit which projects use shared embedding artifacts. | Partial | Manifest metadata and repo scan support. |
| A080 | As a future host adapter, I can implement Desk activation without changing Desk core. | Strong | Host-neutral contract plus adapter boundary. |

## Completion Criteria

### Product Contract

- C001: A dependent plugin or custom agent can declare Desk as a dependency without copying Desk files.
- C002: A dependent plugin or custom agent can declare Work Suite as a dependency when it relies on doing-phase skills.
- C003: The dependency contract distinguishes substrate dependencies from agent activations.
- C004: The dependency contract can express `desk:worker` as a provided activation target.
- C005: The dependency contract can express an overlay agent that depends on Desk but does not launch as `desk:worker`.
- C006: The dependency contract can express required MCP servers.
- C007: The dependency contract can express desk root binding policy.
- C008: The dependency contract can express embedding artifact policy.
- C009: The dependency contract can express snapshot artifact policy.
- C010: The dependency contract can express host support and fallbacks.
- C011: The contract has a documented schema with examples.
- C012: The schema is versioned.
- C013: Unknown schema versions fail closed with an actionable diagnostic.
- C014: Required dependency versions can be pinned or ranged.
- C015: Dependency resolution order is deterministic.
- C016: Activation order is deterministic.
- C017: Activation state is separate from desk data.
- C018: Uninstall/deactivation does not delete the desk root.
- C019: Generated activation artifacts are owned/tracked so they can be updated or removed.
- C020: No normal user story requires a bespoke Desk CLI.

### Host-Native Activation

- C021: Claude packaging exposes Desk skills, MCP, hooks, and `desk:worker` through native plugin surfaces.
- C022: Claude packaging declares Work Suite as a dependency where supported.
- C023: Claude install of a dependent overlay does not require a separate explicit Desk install where host dependency support exists.
- C024: Claude invocation supports `desk:worker` or the overlay's own native agent name.
- C025: Claude Agent View/background sessions inherit the needed plugin/MCP context.
- C026: Copilot packaging exposes the worker through Copilot's native agent picker/launch mechanism.
- C027: Copilot packaging works even if Copilot does not resolve transitive plugin dependencies.
- C028: Codex packaging exposes Desk skills through Codex plugin skill loading.
- C029: Codex packaging exposes Desk MCP through Codex plugin MCP loading.
- C030: Codex activation can materialize a native custom-agent/profile/project-instruction artifact when needed.
- C031: Codex activation avoids appending uncontrolled duplicate text to global `AGENTS.md`.
- C032: Codex activation can be project-local when the dependency is repo-specific.
- C033: Codex activation can be global only when explicitly chosen by an install/profile policy.
- C034: Codex App first launch can see the activated worker behavior without manual file copy.
- C035: Codex App can report whether Desk activation is active for the current workspace.
- C036: Host adapters expose enough diagnostics for a worker to explain missing primitives.
- C037: Host adapters do not require users to edit JSON/TOML by hand in the healthy path.
- C038: Host adapters do not require users to run `npm install` in plugin folders.
- C039: Host adapters do not require manual MCP registration in the healthy path.
- C040: Host support matrix is generated or tested from real adapter capabilities.

### MCP Runtime Bootstrap

- C041: The Desk MCP entrypoint can start from a plugin install without manual dependency installation.
- C042: Native runtime dependencies are either bundled, prebuilt, or self-prepared in a host-appropriate cache/data location.
- C043: MCP startup never writes into immutable plugin source/cache directories unless that is the host's documented writable data location.
- C044: MCP startup resolves the desk root from activation config, environment, or safe default in a deterministic order.
- C045: MCP health output reports the resolved desk root.
- C046: MCP health output reports the plugin/runtime version.
- C047: MCP health output reports DB schema version.
- C048: MCP health output reports active embedding spec.
- C049: MCP health output reports snapshot status.
- C050: MCP health output reports vector-pack import status.
- C051: MCP health output reports semantic query availability.
- C052: MCP health output reports lexical index availability.
- C053: MCP startup creates `.state/` as needed.
- C054: MCP startup treats missing local DB as a normal first-run state.
- C055: MCP startup restores from a compatible snapshot before full indexing.
- C056: MCP startup imports vector packs before generating document embeddings.
- C057: MCP startup reconciles changed docs incrementally after snapshot restore.
- C058: MCP startup has a bounded fast path for session start.
- C059: Long repair work is deferred, incremental, or clearly surfaced rather than silently blocking startup.
- C060: MCP startup degrades to lexical indexing when semantic dependencies are unavailable.

### Shared Vector Packs

- C061: A repo can include canonical document embeddings as vector packs.
- C062: Vector packs live outside `.state/`.
- C063: Vector packs are content-addressed by embedding spec, chunker version, and normalized text.
- C064: Vector-pack rows include a chunk key.
- C065: Vector-pack rows include text hash or equivalent verification hash.
- C066: Vector-pack rows include embedding spec ID.
- C067: Vector-pack rows include dimension.
- C068: Vector-pack rows include encoding.
- C069: Vector-pack rows include vector data.
- C070: Vector-pack files include or reference a checksum.
- C071: Vector-pack import validates every row before inserting.
- C072: Vector-pack import refuses rows with the wrong dimension.
- C073: Vector-pack import refuses rows with the wrong spec ID.
- C074: Vector-pack import refuses rows whose text hash does not match the current chunk key.
- C075: Vector-pack import is idempotent.
- C076: Vector-pack import deduplicates repeated chunk keys.
- C077: Vector-pack import can tolerate multiple pack files.
- C078: Vector-pack import can tolerate append-only pack growth.
- C079: Two machines can create distinct pack files without merge conflicts.
- C080: A full local DB can be rebuilt from docs plus vector packs without contacting an embedding service when all chunks are covered.
- C081: Missing vectors are generated only for missing chunk keys.
- C082: Generated missing vectors can be written to a new pack only through an explicit publication path.
- C083: Healthy startup never dirties the Git worktree by writing vector packs.
- C084: Pack compaction can be introduced without changing chunk keys.
- C085: Pack compaction preserves semantic equivalence.
- C086: Pack validation can run in CI.
- C087: Pack validation can run at MCP startup and fail soft.
- C088: Public/private repo policy can disable vector-pack publication.
- C089: Redaction/deletion policy exists for vectors derived from removed sensitive text.
- C090: Model/spec migration can keep old and new pack directories side by side.

### Snapshot Artifacts

- C091: A repo can include prebuilt SQLite snapshots as warm boot artifacts.
- C092: Snapshots live outside `.state/`.
- C093: Snapshots are never opened in place for mutation.
- C094: Runtime restores a snapshot by copying it into local `.state/`.
- C095: Snapshot artifacts are compressed or otherwise size-managed.
- C096: Snapshot artifacts have a manifest.
- C097: Snapshot manifest includes snapshot schema version.
- C098: Snapshot manifest includes Desk MCP/runtime version.
- C099: Snapshot manifest includes DB schema ID.
- C100: Snapshot manifest includes embedding spec ID.
- C101: Snapshot manifest includes chunker ID.
- C102: Snapshot manifest includes source commit or source tree hash.
- C103: Snapshot manifest includes document tree hash.
- C104: Snapshot manifest includes included pack IDs or equivalent provenance.
- C105: Snapshot manifest includes sqlite-vec/runtime compatibility data.
- C106: Snapshot manifest includes creation timestamp.
- C107: Snapshot manifest includes checksum of compressed artifact.
- C108: Snapshot restore validates artifact checksum.
- C109: Snapshot restore validates DB schema compatibility.
- C110: Snapshot restore validates embedding spec compatibility.
- C111: Snapshot restore validates sqlite-vec/runtime compatibility enough to avoid crashes.
- C112: Snapshot restore rejects or ignores snapshots containing absolute host paths.
- C113: Snapshot restore treats corruption as a cache miss.
- C114: Snapshot restore falls back to vector packs.
- C115: Snapshot restore followed by reconcile produces correct docs/chunks/refs.
- C116: Stale snapshots are useful when they can be incrementally reconciled.
- C117: Incompatible snapshots are skipped with actionable diagnostics.
- C118: Snapshot build is explicit and policy-controlled.
- C119: Snapshot build does not happen on ordinary session startup.
- C120: Snapshot verification restores into a temp root and runs representative search queries.

### Indexing And Search Semantics

- C121: Local DB remains the runtime index, not the canonical shared artifact.
- C122: Local DB path remains under `<deskRoot>/.state/desk-index.sqlite`.
- C123: `.state/` remains ignored by Git.
- C124: Index metadata records active embedding spec.
- C125: Index metadata records DB schema ID.
- C126: Index metadata records last successful reconcile time.
- C127: Index metadata records source snapshot ID when restored.
- C128: Index metadata records imported pack IDs.
- C129: Chunk table stores stable chunk keys or a joinable equivalent.
- C130: Chunker behavior is deterministic and versioned.
- C131: Normalization behavior is deterministic and versioned.
- C132: Search tools report whether results used semantic ranking, lexical ranking, or hybrid ranking.
- C133: Query embedding failure does not imply document vectors are missing.
- C134: Document vector absence does not prevent lexical results.
- C135: Existing archived/active scope semantics are preserved after restore/import.
- C136: Refs graph is correct after restore/import/reconcile.
- C137: Deleted docs are removed from local runtime index.
- C138: Deleted/redacted docs have an artifact cleanup story.
- C139: Incremental reindex avoids embedding calls when imported vectors satisfy changed chunks.
- C140: Force rebuild can reconstruct local DB from canonical repo artifacts.

### Privacy, Security, And Policy

- C141: The design explicitly states that embeddings are derivative data and may leak information.
- C142: Shared embedding artifacts default to off or require policy approval for public repos.
- C143: Private/team repos can opt into shared embedding artifacts.
- C144: Sensitive-path exclusions are documented.
- C145: Sensitive-path exclusions are tested.
- C146: Gitignored secret files are not indexed by default.
- C147: Snapshot manifests and DBs are checked for absolute local paths.
- C148: Snapshot manifests and DBs are checked for unexpected source paths.
- C149: Artifact publication can be disabled by repository policy.
- C150: Artifact publication can be disabled by organization policy.
- C151: Artifact publication reports expected file size impact.
- C152: Artifact publication reports which docs/chunks are newly represented.
- C153: Artifact publication requires explicit approval when policy says so.
- C154: Runtime restore of already committed artifacts does not require approval.
- C155: Dependency activation cannot silently grant extra host permissions beyond the host's plugin model.
- C156: Host adapters document what generated files/config they own.
- C157: Host adapters do not overwrite user-edited files without preserving or merging user content safely.
- C158: Untrusted vector packs are validated before import.
- C159: Untrusted snapshots are validated before restore.
- C160: Failure diagnostics avoid dumping sensitive document text.

### Upgrade, Migration, And Compatibility

- C161: Plugin manifest versions are consistent across host manifests.
- C162: Root plugin manifest and Codex plugin manifest cannot drift unnoticed.
- C163: Worker content cannot drift across Claude/Copilot/Codex agent formats unnoticed.
- C164: Activation manifest changes are versioned.
- C165: DB migrations run on restored snapshots.
- C166: DB migrations are idempotent.
- C167: DB migrations can reject unsupported old snapshots safely.
- C168: Embedding spec upgrades can run alongside existing specs.
- C169: Snapshot schema upgrades can run alongside existing snapshots.
- C170: Runtime can choose the newest compatible snapshot for the active spec.
- C171: Runtime can ignore snapshots for inactive specs.
- C172: Runtime can ignore vector packs for inactive specs.
- C173: Host adapter upgrades can update generated artifacts they own.
- C174: Host adapter upgrades do not duplicate generated instruction blocks.
- C175: Host adapter upgrades preserve user-authored project instructions.
- C176: Host adapter deactivation removes only owned activation artifacts.
- C177: Host adapter deactivation leaves desk data and repo artifacts untouched.
- C178: Release notes distinguish user-visible host changes from internal index changes.
- C179: Backward compatibility is tested for at least one prior snapshot format once snapshots ship.
- C180: Backward compatibility is tested for at least one prior vector-pack format once packs ship.

### Diagnostics And Recovery

- C181: There is a single MCP health/status surface that reports Desk readiness.
- C182: Health distinguishes dependency activation, MCP runtime, local DB, snapshot, vector packs, document vectors, and query embeddings.
- C183: Health includes actionable repair suggestions.
- C184: Health uses host-native language where possible.
- C185: Search responses include semantic degradation diagnostics.
- C186: Startup logs are concise on success.
- C187: Startup logs are actionable on failure.
- C188: Corrupt local DB recovery is automatic: move aside or rebuild from snapshot/packs.
- C189: Missing snapshot recovery falls back to vector packs.
- C190: Missing vector-pack recovery falls back to lexical or live embedding generation.
- C191: Missing embedding service recovery leaves lexical search operational.
- C192: Missing native dependency recovery reports the exact dependency/runtime issue.
- C193: Root resolution failures report all attempted sources.
- C194: Host activation failures report which host primitive failed.
- C195: Dependency resolution failures report which dependency and version failed.
- C196: Snapshot compatibility failures report the incompatible field.
- C197: Vector-pack validation failures report file and row/key without dumping full text.
- C198: Performance diagnostics report startup path: snapshot, packs, full rebuild, or lexical fallback.
- C199: The worker can surface readiness in session-start context without running expensive work.
- C200: The worker can ask before running expensive publication/repair paths.

### Release, CI, And Test Coverage

- C201: CI tests host manifest validity.
- C202: CI tests dependency closure for every published overlay.
- C203: CI tests root/Codex/Claude/Copilot manifest version consistency or intentionally documented divergence.
- C204: CI tests worker-format drift.
- C205: CI tests activation manifest schema validation.
- C206: CI tests Codex adapter artifact generation.
- C207: CI tests Claude adapter/package metadata.
- C208: CI tests Copilot adapter/package metadata.
- C209: CI tests flattened bundle generation where required.
- C210: CI tests MCP cold start with no local `.state/`.
- C211: CI tests MCP restore from compatible snapshot.
- C212: CI tests MCP fallback from incompatible snapshot to vector packs.
- C213: CI tests MCP rebuild from docs plus vector packs with embedding endpoint disabled.
- C214: CI tests missing-vector live generation with a mocked embedding endpoint.
- C215: CI tests zero live embedding calls when packs fully cover chunks.
- C216: CI tests stale snapshot incremental reconcile.
- C217: CI tests archive/active search scope after restore.
- C218: CI tests refs graph after restore.
- C219: CI tests corrupted snapshot fallback.
- C220: CI tests corrupted pack rejection.
- C221: CI tests pack merge/no-conflict simulation.
- C222: CI tests public-repo policy blocks artifact publication when configured.
- C223: CI tests sensitive-path exclusion.
- C224: CI tests no absolute paths in snapshot artifacts.
- C225: CI tests startup performance budget for snapshot restore.
- C226: CI tests startup performance budget for vector-pack rebuild.
- C227: CI tests health/status output shape.
- C228: CI tests diagnostics do not leak chunk text in errors.
- C229: Release automation can build vector packs from fixtures or a real desk repo.
- C230: Release automation can build and verify snapshots.
- C231: Release automation can fail if generated artifacts are stale.
- C232: Release automation can produce host support documentation.
- C233: Release automation can publish host-specific bundles.
- C234: Release automation can run without bespoke user-facing Desk CLI.
- C235: Test fixtures cover Codex, Claude, Copilot, and generic host paths.
- C236: Tests cover Windows/macOS/Linux path behavior where supported.
- C237: Tests cover worktree dirty-state behavior during healthy startup.
- C238: Tests cover repeated startup idempotence.
- C239: Tests cover deactivation/uninstall artifact ownership.
- C240: Tests cover upgrade from a pre-shared-embedding index to shared artifacts.

## Scrutiny Notes

Tinfoil Hat findings that changed the criteria:

- A snapshot is not enough. If snapshot compatibility fails, a fresh machine still needs vector packs to avoid full re-embedding.
- Vector packs are not enough. If a desk is large, rebuilding SQLite/FTS/refs from packs may still be too slow for first launch, so snapshot warm boot is a real product requirement.
- "No CLI" does not mean "no maintenance operation." The operation surface should be MCP tools, package scripts, release automation, or host-native UI.
- Codex is the hardest host because plugin MCP and plugin skills are not the same as default worker identity. The design needs an adapter/materialization story there.
- Privacy is not optional. Embeddings and snapshots can be sensitive even when they do not contain plain text in the obvious way.
- Deletion/redaction is the weakest area. Append-only vector packs need a tombstone, pruning, or artifact-rotation story before this is safe for sensitive teams.

Stranger With Candy findings that changed the criteria:

- "Dependency" can be a lie if the host does not resolve transitive plugin deps. Release packaging must flatten bundles for those hosts instead of making users manually install prerequisites.
- "Self-bootstrapping MCP" can be a lie if native dependencies are still installed by hand. The entrypoint must handle native runtime availability.
- "Default worker" can be a lie in Codex App if it is only a copied TOML subagent. The default/app activation path must be host-native and durable.
- "Repo snapshot" can be a lie if it is opened and mutated in place. It must be copied into `.state/` before use.
- "Shared embeddings" can be a lie if chunking/model aliases are not pinned. Spec IDs and chunk keys need to include the actual vector-space identity.

## Thin Slice

The first buildable version should prove the full loop in one host plus the MCP artifact model:

1. Add a versioned activation manifest that says Desk provides `desk:worker`, requires the Desk MCP, and supports shared embeddings/snapshots.
2. Add MCP vector-pack import with deterministic chunk keys and an `embedding-spec.json`.
3. Add snapshot restore/copy/validate before full indexing.
4. Add a health/status MCP tool that reports root, snapshot, packs, local DB, document vectors, query embedding, and degraded modes.
5. Add Codex adapter/materialization tests because Codex currently has the largest gap.
6. Add CI fixtures proving a new machine restores from snapshot, falls back to packs, and makes zero embedding calls when vectors are already present.

## Explicit Non-Goals

- No bespoke everyday Desk CLI.
- No requirement that users install Desk manually before installing an overlay.
- No canonical shared SQLite DB that is mutated in place from the repo.
- No automatic repo writes during ordinary session startup.
- No silent publication of embeddings/snapshots for public or sensitive repos.
- No attempt to make all hosts expose identical UX. The UX should be native per host while the dependency contract stays portable.
