// Single source of truth for the 12 MCP tools desk-mcp exposes.
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
  // Search (Units 4-6)
  "desk_search",
  "desk_recall",
  "desk_similar",
  "desk_timeline",
  "desk_thread",
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
    "Hybrid lexical+semantic search across desk. Filters: track, status, kind, since, until. Returns ranked chunks with score_breakdown. Soft-fails to FTS-only when Ollama is unreachable.",
  desk_recall:
    "Semantic-only loose recall — `do I remember anything about X`. Requires Ollama; errors when unreachable. Returns top matches deduped by doc.",
  desk_similar:
    "Find docs similar to a given path via centroid of the seed doc's chunk embeddings. Returns ranked similar docs excluding the seed itself.",
  desk_timeline:
    "Temporal query — filter docs by updated_at window, optionally combined with FTS+semantic. Without `query`: chronological listing. With `query`: hybrid ranking inside the window, ordered by updated_at DESC.",
  desk_thread: "Provenance walk via refs_graph. Stub until Unit 6.",
}
