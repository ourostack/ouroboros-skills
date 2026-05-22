# desk plugin — changelog

## 1.1.0 — 2026-05-22

**Archive is now searchable.** Reversed the v1.0 Unit 4 decision to skip `_archive/` at index time. Archive content was always meant to be preserved for future recall — making it unsearchable defeated the purpose.

What changed:

- **Indexer**: walks under `_archive/` ancestors. Loose `.md` files there (migrated legacy filenames like `2026-02-23-planning-foo.md`) are also indexed — basename pattern infers kind (`-planning-` → planning, `-doing-` → doing, etc.) or falls back to `kind: archive`. Each indexed doc gets a new `is_archived: bool` flag.
- **Search tools**: all five accept an optional `scope: "active" | "archived" | "all"` parameter. **Per-tool defaults match each tool's purpose:**
  - `desk_search` → `active` (day-to-day signal beats archive noise)
  - `desk_recall` → `all` (this IS the historical lookback tool)
  - `desk_similar` → `all` (similarity has no time/status semantic)
  - `desk_timeline` → `all` (already temporally scoped by window)
  - `desk_thread` → no scope param; always walks across (refs don't respect archive boundaries)
- **DB schema**: new `is_archived` column on `docs` table + index. Migration is idempotent: opening an existing v1.0 DB ALTER-ADDs the column with default 0; next reindex populates correctly.

Operator-visible: `desk_recall("teams bot integration")` now finds archived planning/doing notes from months ago. `desk_search("teams bot")` still defaults to active-only — agents asking "what should I do next" get current work, not archived history. Override per-call with `scope: "all"` when historical breadth matters.

Migration: existing indexes auto-upgrade their schema on next open. To populate archive embeddings, run `ouro desk reindex --force` once per bundle (or `mcp call ... desk_reindex --args '{"force":true}'`).

## 1.0.0 — 2026-05-22

**v1.0 declared.** Substrate validated end-to-end on a real ouroboros agent bundle:

- Phase 0 (standalone MCP server): 37/37 pass, including pure-semantic recall (paraphrase query finds task via Ollama-backed embeddings, zero keyword overlap)
- Phase 1 (daemon discovery + spawn): plugin .mcp.json discovered, server spawned, tools surface
- Phase 2 (CRUD + search via daemon): 12/12 desk operations pass (task/track lifecycle, archive, friction, lesson, search, recall, similar, timeline, thread, reindex)
- Phase 4.2 (cross-machine round-trip): bundle pushed to origin with all artifacts intact

Surface confirmed:

- 13 MCP tools (7 CRUD + 5 search + 1 reindex)
- `schema_version: 1` on every write
- Auto-index-on-read (every search ensures index freshness)
- Hybrid semantic + lexical search with explicit `score_breakdown` (semantic / bm25 / recency / state / pin)
- Soft-fail to FTS-only when Ollama unreachable
- `task_archive` is idempotent (moves dir → `_archive/`, no error on re-archive)

## 0.7.1 — 2026-05-22

- Ship `desk_reindex` MCP tool. Wraps `ensureIndex` (mtime-incremental). `force: true` mode drops the sqlite db before rebuild. 13 tools total (was 12).

## 0.7.0 — 2026-05-22

- Unit 6: `desk_thread` provenance walk.

## 0.6.0 — 2026-05-22

- Unit 5: search tools (`desk_search`, `desk_recall`, `desk_similar`, `desk_timeline`).

## 0.5.0 — 2026-05-22

- Unit 4: SQLite + sqlite-vec + nomic-embed-text indexer (via Ollama).

## 0.4.0 — 2026-05-22

- Unit 3: runtime CRUD (`task_create`, `task_update`, `task_archive`, `track_create`, `track_update`, `friction_add`, `lesson_add`).

## 0.3.0 — 2026-05-22

- Unit 2: MCP server scaffold with `.mcp.json` declaration.

## 0.2.0 — 2026-05-22

- Unit 1: extends task.md schema; adds `schema_version: 1`; drops Execution Mode (spawn-mode).

## 0.1.0 — pre-W6

- Initial skills + skeleton.

## Setup (v1.0)

After `ouro plugin install github:ourostack/ouroboros-skills:plugins/desk --agent <name>`:

1. **Install plugin's MCP deps:** `cd ~/.ouro-cli/plugins/desk/mcp && npm install`
2. **Install Ollama** for full semantic surface (recall / similar). Mac one-time: `curl -L https://github.com/ollama/ollama/releases/latest/download/ollama-darwin.tgz | tar -xz` then add the binary to PATH. Linux: `curl -fsSL https://ollama.com/install.sh | sh`.
3. **Pull the embedding model:** `ollama serve &` then `ollama pull nomic-embed-text` (one-time, ~274MB).
4. **Restart daemon** so plugin MCP discovery picks up the new server: `ouro stop && ouro up`.

Without Ollama, desk_search falls back to FTS5-only (keyword) and desk_recall/desk_similar return empty. Substrate works; semantic surface is degraded.

## Known limitations (v1.0)

These do NOT block v1.0 use but are tracked for follow-ups:

- **Plugin install does not run `npm install`.** After `ouro plugin install ...`, the operator (or a v1.1 install hook) needs to `cd ~/.ouro-cli/plugins/desk/mcp && npm install`. Otherwise the server can't spawn (`@modelcontextprotocol/sdk`, `better-sqlite3`, `sqlite-vec`, `gray-matter` missing). v1.1: either auto-run install on plugin install OR vendor deps OR ship as a bundled single-file build.
- **Tool input schemas are loose.** `inputSchema: { type: "object", properties: {}, additionalProperties: true }` — agents have to infer from descriptions. Works but agents occasionally pass wrong field names on first attempt. v1.1: define explicit JSON Schema per tool.
- **`mcp__ouro-<agent>__send_message` response wrapper hangs at 600s** when the agent makes multi-tool sequences via desk MCP, even though the agent finishes successfully (artifacts on disk). This is in the **ouro MCP** comms layer, not desk. Tracked separately.
- **Ollama is a soft dep** for full semantic surface. With Ollama down, `desk_search` falls back to FTS-only (still works), `desk_recall` returns empty + a note, `desk_similar` uses stored embeddings only. For the agent-as-substrate promise, the operator should keep Ollama + `nomic-embed-text` available.
- **Daemon must be restarted** after a fresh `ouro plugin install ...` for the new plugin's MCP server to be discovered. v1.1: signal the daemon to reconcile on plugin-list change.

These are upgradable in place — none change the v1.0 wire format or storage schema.
