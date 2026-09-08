// Single source of truth for the 16 MCP tools desk-mcp exposes.
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
  // Private, non-Git qualitative feedback about the preview build
  "desk_feedback",
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
  "desk_doctor",
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
  desk_feedback:
    "Private qualitative feedback about the preview build, stored in the OS user's own state directory — never in the desk Git workspace, the search index, or telemetry. Explicit capture only; never inferred from tasks or conversation. Actions: `capture` (text, optional task_ref), `list` (optional limit and offset), `correct` (entry_id, expected_revision, text), `delete` (entry_id). Scoped to the session's desk root and --person binding; it cannot read or write another participant's feedback. Results return to this caller only — there is no share or export action; writing anything to a desk is a separate, visible, opted-in step.",
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
  desk_doctor:
    "Report whether Desk MCP started in healthy runtime mode and describe the active runtime target. In diagnostic mode, reports the precise startup failure and offline remediation. Optional format:'preview' returns only a local-on-demand, nine-field package/process snapshot with no task or feedback records.",
}
