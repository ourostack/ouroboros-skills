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
  task_create: "Create a new task.md under <root>/<track>/<slug>/. Stub until Unit 3.",
  task_update: "Update a task's frontmatter or body. Stub until Unit 3.",
  task_archive: "Move a task to <root>/<track>/_archive/. Stub until Unit 3.",
  track_create: "Create a new track.md under <root>/<slug>/. Stub until Unit 3.",
  track_update: "Update a track's frontmatter. Stub until Unit 3.",
  friction_add: "Append a friction note. Stub until Unit 3.",
  lesson_add: "Append a lesson. Stub until Unit 3.",
  desk_search:
    "Hybrid lexical+semantic search across desk. Stub until Unit 5.",
  desk_recall:
    "Semantic-only loose recall with auto-clustering. Stub until Unit 5.",
  desk_similar: "Find docs similar to a given path. Stub until Unit 5.",
  desk_timeline: "Temporal queries. Stub until Unit 5.",
  desk_thread: "Provenance walk via refs_graph. Stub until Unit 6.",
}
