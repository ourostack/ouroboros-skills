// Single source of truth for the 14 MCP tools desk-mcp exposes.
//
// Imported by both server.js (registers them) and the tests (asserts the
// list is canonical). Kept in a no-deps file so tests can import without
// the @modelcontextprotocol/sdk dep being installed.

export const TOOL_NAMES = [
  // Runtime CRUD (Unit 3)
  "task_create",
  "task_update",
  "task_archive",
  "track_create",
  "track_update",
  "friction_add",
  "lesson_add",
  // Search (Units 5 + 6)
  "desk_search",
  "desk_recall",
  "desk_similar",
  "desk_timeline",
  "desk_thread",
  // Index management
  "desk_reindex",
  // Health/status
  "desk_status",
]

export const TOOL_DESCRIPTIONS = {
  task_create:
    "Create a new task.md under <root>/<track>/<slug>/ with schema_version:1 frontmatter.",
  task_update:
    "Merge frontmatter or append to the body of an existing task.md; preserves schema_version + created.",
  task_archive:
    "Move <root>/<track>/<slug>/ to <root>/<track>/_archive/<slug>/, marking status=done if non-terminal. Idempotent.",
  track_create:
    "Create a new track.md under <root>/<slug>/ with schema_version:1 frontmatter.",
  track_update:
    "Merge frontmatter or append to the body of an existing track.md; preserves schema_version + created.",
  friction_add:
    "Append a friction entry — cross-cutting to <root>/_meta/friction.md, or track-local to <root>/<track>/_friction/<date>-<theme>.md.",
  lesson_add:
    "Write or append a lesson under <root>/_meta/tips/<topic>.md. Existing file gets an `## Update <date>` section.",
  desk_search:
    "Hybrid lexical+semantic search across desk. Filters: track, status, kind, since, until. Returns ranked chunks with score_breakdown. Soft-fails to FTS-only when Ollama is unreachable. `scope` (optional): 'active' (default), 'archived', or 'all' — desk_search defaults to active because day-to-day signal beats archive noise; pass 'all' to search history too.",
  desk_recall:
    "Semantic-only loose recall — `do I remember anything about X`. Requires Ollama; errors when unreachable. Returns top matches deduped by doc. `scope` (optional): 'active', 'archived', or 'all' (default) — desk_recall IS the historical lookback tool, so it searches everything by default; pass 'active' to scope to current work only.",
  desk_similar:
    "Find docs similar to a given path via centroid of the seed doc's chunk embeddings. Returns ranked similar docs excluding the seed itself. `scope` (optional): 'active', 'archived', or 'all' (default) — similarity has no time/status semantic so the full corpus is searched by default.",
  desk_timeline:
    "Temporal query — filter docs by updated_at window, optionally combined with FTS+semantic. Without `query`: chronological listing. With `query`: hybrid ranking inside the window, ordered by updated_at DESC. `scope` (optional): 'active', 'archived', or 'all' (default) — the window already temporally scopes; archive items in-window are legitimate entries.",
  desk_thread:
    "Provenance walk via refs_graph: BFS along planning/doing/feedback/iteration edges from a starting doc. Returns an ordered chain {path, kind, ref_kind, hop_distance, why_connected, updated_at}. Inputs: start_path (required), depth (optional, default 4), direction (optional: forward|backward|both, default both). Always walks across active + archive — refs don't respect archive boundaries. Errors with not_indexed when start_path isn't in the index.",
  desk_reindex:
    "Rebuild the desk-index sqlite db. Without args, behaves like ensureIndex (mtime-based incremental). With force:true, drops the db and rebuilds from scratch. Returns counts + timing.",
  desk_status:
    "Fast session-start health/status report for the resolved desk root, runtime cache, plugin version, local DB, lexical index, document-vector coverage, snapshots, and vector packs. Does not run expensive repair work or probe live embedding endpoints.",
}
