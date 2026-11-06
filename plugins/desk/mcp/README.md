# desk MCP server

Spawned by consumers (Claude Code, Copilot CLI, ouroboros daemon) to expose a uniform tool surface for working with a desk workspace. Tools include task / track / friction / lesson CRUD and hybrid lexical+semantic search.

## Run it directly

```sh
node ./index.js --root ~/AgentBundles/<agent>.ouro/desk
```

Or via environment:

```sh
DESK=~/<your-workspace> node ./index.js
```

## Tools exposed (12)

**Runtime CRUD:**
- `task_create`, `task_update`, `task_archive`
- `track_create`, `track_update`
- `friction_add`, `lesson_add`

**Search:**
- `desk_search` — hybrid lexical + semantic
- `desk_recall` — semantic-only loose recall with auto-clustering
- `desk_similar` — find docs similar to a given path
- `desk_timeline` — temporal queries
- `desk_thread` — provenance walk via refs_graph

All 12 tools are wired to real implementations.

## How consumers wire this up

The plugin's sibling `.mcp.json` (at `plugins/desk/.mcp.json`) declares the spawn:

```json
{
  "mcpServers": {
    "desk": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp/index.js", "--root", "${DESK:-./desk}"],
      "env": {}
    }
  }
}
```

Claude Code reads this natively. Copilot CLI inherits the same spec. The ouroboros daemon reads `.mcp.json` from plugin manifests in a forthcoming release.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — local SQLite for the search index
- `sqlite-vec` — vector search extension
- `gray-matter` — YAML frontmatter parser

`sqlite-vec` and `better-sqlite3` are native deps; if `npm install` fails on a platform, try `npm install --build-from-source`.

Semantic ranking requires Ollama running locally with `nomic-embed-text` pulled. If Ollama is unavailable, search soft-falls-back to FTS5-only with a `semantic_unavailable` warning in the response.

## Tests

```sh
npm test
```

Boots the server with a temp root and asserts the 12 tool names register, then exercises every tool's real body via the dispatcher and fixture-desks. 103 tests at v1.0.
