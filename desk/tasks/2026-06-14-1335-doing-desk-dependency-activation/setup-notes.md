# Unit 0 Setup Notes

Date: 2026-06-14
Branch: `desk/dependency-activation-plan`

## Source Baseline

Current source paths inspected at HEAD:

- `desk/tasks/2026-06-14-1335-planning-desk-dependency-activation.md` - approved design scope and decisions.
- `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation.md` - executable unit list, artifact layout, and commands.
- `plugins/desk/docs/dependency-activation-stories-and-criteria.md` - 150 user/harness stories and completion criteria that drove this plan.
- `plugins/desk/README.md` - current user-facing install and invocation docs.
- `plugins/desk/agents/README.md` - current `desk:worker` host guidance.
- `plugins/desk/plugin.json` - root/Copilot-style plugin metadata.
- `plugins/desk/.codex-plugin/plugin.json` - Codex plugin metadata.
- `plugins/desk/.claude-plugin/plugin.json` - Claude plugin metadata.
- `plugins/desk/.mcp.json` - current Desk MCP stdio launch declaration.
- `plugins/work-suite/.codex-plugin/plugin.json` - Work Suite Codex plugin metadata.
- `plugins/work-suite/.claude-plugin/plugin.json` - Work Suite Claude plugin metadata.
- `plugins/desk/hooks/hooks.json` and `plugins/desk/hooks/session-start.sh` - current Claude SessionStart hook surface.
- `plugins/desk/mcp/package.json` and `plugins/desk/mcp/package-lock.json` - current MCP package, scripts, dependencies, and lock source.
- `plugins/desk/mcp/index.js` - MCP entrypoint and CLI argument parsing.
- `plugins/desk/mcp/src/server.js` - MCP server/tool registration and boot-time `ensureIndex`.
- `plugins/desk/mcp/src/server-helpers.js` - index freshness/repair path.
- `plugins/desk/mcp/src/util/paths.js` - desk-root and `--person` resolution.
- `plugins/desk/mcp/src/db/init.js` and `plugins/desk/mcp/src/db/schema.sql` - `.state/desk-index.sqlite` creation, migrations, FTS, and `sqlite-vec`.
- `plugins/desk/mcp/src/indexer/index.js`, `plugins/desk/mcp/src/indexer/discover.js`, `plugins/desk/mcp/src/indexer/chunk.js`, and `plugins/desk/mcp/src/indexer/embed.js` - current indexer, discovery, chunking, and embedding behavior.
- `plugins/desk/mcp/src/tool-names.js` - current MCP tool list, which does not include `desk_status`.
- `plugins/desk/mcp/scripts/rebuild-index.js` - current maintenance script.
- `.github/workflows/desk-mcp-tests.yml` and `.github/workflows/validate-skills.yml` - current CI entry points.
- `scripts/validate-skills.cjs`, `scripts/audit-autopilot-state.cjs`, `scripts/audit-work-suite-runtime.cjs`, `scripts/test-autopilot-state-audit.cjs`, and `scripts/test-work-suite-runtime-audit.cjs` - current root validation/audit scripts.

The current Desk MCP package-lock SHA-256 is:

```text
9d427577ed4ebf81b02d100b3e48ea3f39f3392b62ba6e83134344147acce0c0  plugins/desk/mcp/package-lock.json
```

That hash is useful input for the future production runtime dependency pack path, but it is not yet a prod-only dependency-lock hash.

## Current Host Surfaces

Desk currently has three host metadata surfaces:

- Root/Copilot-style `plugins/desk/plugin.json` exposes `agents`, `skills`, and `mcpServers`, but its version is `1.5.3`.
- Codex `plugins/desk/.codex-plugin/plugin.json` exposes `skills` and `mcpServers`, but no native agent/default-worker activation; its version is `1.7.3`.
- Claude `plugins/desk/.claude-plugin/plugin.json` is minimal metadata only and does not expose the richer root/Codex surface directly; its version is `1.7.3`.

Work Suite currently has Codex and Claude manifests at `plugins/work-suite/.codex-plugin/plugin.json` and `plugins/work-suite/.claude-plugin/plugin.json`, both versioned `1.4.9`. There is no root `plugins/work-suite/plugin.json` in the current tree.

The Desk docs still describe manual setup:

- Codex docs tell users to copy plugin directories, run `npm install`, run `codex mcp add`, append worker body to `~/.codex/AGENTS.md`, or copy `worker.toml`.
- Claude docs tell users to install `desk` and `work-suite` separately.
- Copilot docs tell users to install `desk` and `work-suite` separately.

That is the baseline this task should replace with dependency activation, host-native materialization, and explicit fallbacks.

## Current MCP Launch Assumptions

The current `.mcp.json` launch is:

```json
{
  "mcpServers": {
    "desk": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/index.js"],
      "env": {}
    }
  }
}
```

Important consequences:

- The launch path is relative and depends on the host choosing a plugin-root current working directory.
- It does not pass `--root`, so `plugins/desk/mcp/src/util/paths.js` resolves the desk root from `--root`, then `$DESK`, then `$HOME/ms-desk`, `$HOME/desk`, and `$HOME/worker-workspace`.
- Startup imports MCP source directly from `plugins/desk/mcp/index.js`; there is no runtime dependency cache, source mirror, or verified prebuilt dependency pack.
- `plugins/desk/mcp/package.json` has only a `test` script and production dependencies on `@modelcontextprotocol/sdk`, `better-sqlite3`, `gray-matter`, and `sqlite-vec`.
- `plugins/desk/mcp/index.js` statically imports `./src/server.js`, so missing `node_modules` prevents startup before Desk can self-repair.

## Current Index And Embedding Behavior

The MCP index path today is local mutable state only:

- `openDb` creates `<desk-root>/.state/desk-index.sqlite` and loads `sqlite-vec`.
- `server.js` calls `ensureIndex(deskRoot)` before accepting traffic.
- A missing DB is treated as rebuild reason `missing`; a stale DB is reason `stale`; a fresh DB may still repair missing embeddings when the embedding service is available.
- `discover` indexes Desk markdown content and skips `node_modules`, `.state`, and `.git`. It includes archived docs and `_shared` markdown content.
- `chunkBody` uses H2/paragraph chunking with an 800-character target.
- `embed.js` uses Ollama-compatible `/api/embeddings`, default model `nomic-embed-text`, dimension `768`, and falls back across `DESK_EMBED_ENDPOINT`, `DESK_OLLAMA_ENDPOINT`, `OLLAMA_HOST`, `127.0.0.1`, and `localhost`.
- If embeddings are unavailable, indexing soft-fails to lexical-only FTS with semantic warnings.

Missing from current code:

- No activation schema or canonical activation manifest.
- No host support matrix generation.
- No runtime dependency pack restore.
- No `desk_status` MCP tool.
- No snapshot restore module.
- No vector-pack import/export/verification module.
- No artifact publication policy or tombstone schemas.
- No performance-budget config.
- No health summary in `session-start.sh` beyond quick task scan context.

## Commands

Current commands observed:

```bash
npm --prefix plugins/desk/mcp test
node plugins/desk/mcp/scripts/rebuild-index.js --root <desk-root>
node scripts/validate-skills.cjs
node scripts/test-autopilot-state-audit.cjs
node scripts/test-work-suite-runtime-audit.cjs
```

Doing-doc target commands:

```bash
npm --prefix plugins/desk/mcp run test:coverage
npm --prefix plugins/desk/mcp test
npm --prefix plugins/desk/mcp run activation:support-matrix:generate
```

Expected future artifact commands, implemented as package scripts or MCP maintenance tools rather than a user-facing Desk CLI:

```bash
npm --prefix plugins/desk/mcp run runtime:deps-pack:build
npm --prefix plugins/desk/mcp run runtime:deps-pack:verify
npm --prefix plugins/desk/mcp run artifact:vector-pack:build
npm --prefix plugins/desk/mcp run artifact:vector-pack:verify
npm --prefix plugins/desk/mcp run artifact:snapshot:build
npm --prefix plugins/desk/mcp run artifact:snapshot:verify
npm --prefix plugins/desk/mcp run artifact:validate
```

Baseline command results in this checkout:

- `npm --prefix plugins/desk/mcp test` fails because `node_modules` is absent; representative missing packages are `better-sqlite3`, `gray-matter`, and `@modelcontextprotocol/sdk`.
- `npm --prefix plugins/desk/mcp run test:coverage` fails with `Missing script: "test:coverage"`.

## Artifact Layout

Task evidence lives in:

```text
desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/
```

Planned repo-shared artifact layout from the doing doc:

```text
plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.jsonl
plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.manifest.json
plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.sha256

plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sqlite.zst
plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.manifest.json
plugins/desk/artifacts/snapshots/<embedding-spec-id>/<snapshot-id>.sha256

plugins/desk/artifacts/publication-policy.json
plugins/desk/artifacts/publication-policy.schema.json
plugins/desk/artifacts/tombstones/tombstones.jsonl
plugins/desk/artifacts/tombstones/tombstone.schema.json

plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.tgz
plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.manifest.json
plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/runtime-deps.sha256
```

Those artifact roots do not exist at Unit 0 start:

- `plugins/desk/artifacts/` is absent.
- `plugins/desk/mcp/artifacts/` is absent.

Local mutable runtime state remains under:

```text
<desk-root>/.state/
```

The runtime dependency cache should resolve in this order:

1. Activation config `runtimeCacheDir`.
2. `DESK_RUNTIME_CACHE_DIR`.
3. `${XDG_CACHE_HOME:-$HOME/.cache}/ouroboros-skills/desk/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/`.

Startup should restore runtime dependencies into that writable cache, sync current MCP source into a cache `source-mirror/<source-hash>/`, and import from the mirror so installed plugin/cache directories are not mutated.

## Performance-Budget Fixture Source

Chosen fixture source:

```text
plugins/desk/mcp/config/performance-budgets.json
```

The file does not exist yet. Unit 0a/0b should introduce it as the single source for startup and rebuild budgets used by tests, local coverage, and CI. The coverage gate should treat budget configuration as test configuration/release policy, not as a user-facing CLI contract.

Recommended initial budget keys:

- `mcp_startup_without_local_state_ms`
- `mcp_startup_from_compatible_snapshot_ms`
- `mcp_startup_from_vector_pack_ms`
- `mcp_rebuild_from_docs_and_full_vector_coverage_ms`
- `mcp_rebuild_with_missing_vectors_deferred_ms`

Exact values should be intentionally conservative at first and tightened only after the snapshot/vector-pack fixtures exist.

## Immediate Gap Inventory

- Host metadata versions drift across Desk root/Codex/Claude surfaces.
- Codex healthy path is still manual for MCP registration and worker/default behavior.
- Claude/Copilot docs still require explicit Work Suite installation.
- Current `.mcp.json` is cwd-sensitive.
- MCP startup cannot run without local `node_modules`.
- CI installs dependencies and runs `npm test`, but there is no coverage script or coverage threshold.
- The current test command fails in this checkout when dependencies have not been installed.
- No Desk activation manifest/schema exists.
- No support matrix generator exists.
- No repo-shared vector/snapshot artifact roots exist.
- No publication policy or tombstone schema exists.
- No health/status MCP tool exists.
- No generated-artifact ownership model exists.

## Unit 0 Verification

- Production code changed: no.
- Setup notes created: yes.
- Current source paths cited above exist at HEAD.
- Baseline command findings recorded for the next units.
