# desk MCP server

Spawned by consumers (Claude Code, Copilot CLI, ouroboros daemon) to expose a uniform tool surface for working with a desk workspace. Tools include task / track / friction / lesson CRUD and hybrid lexical+semantic search.

## Run it directly

```sh
node ./index.js --root ~/AgentBundles/slugger.ouro/desk
```

Or via environment:

```sh
DESK=~/worker-workspace node ./index.js
```

## Tools exposed (12)

**Runtime CRUD (Unit 3):**
- `task_create`, `task_update`, `task_archive`
- `track_create`, `track_update`
- `friction_add`, `lesson_add`

**Search (Units 4–6):**
- `desk_search` — hybrid lexical + semantic
- `desk_recall` — semantic-only loose recall with auto-clustering
- `desk_similar` — find docs similar to a given path
- `desk_timeline` — temporal queries
- `desk_thread` — provenance walk via refs_graph

All 12 tools are wired to real implementations as of Unit 6 — Unit 3 wired runtime CRUD, Unit 4 built the indexer, Unit 5 wired the four search tools, Unit 6 wired `desk_thread`.

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

Claude Code reads this natively. Copilot CLI inherits the same spec. The ouroboros daemon learns to read `.mcp.json` from plugin manifests in W6 Unit 9.

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `better-sqlite3` — local SQLite for the search index
- `sqlite-vec` — vector search extension (Unit 4)
- `gray-matter` — YAML frontmatter parser (Unit 3)

`sqlite-vec` and `better-sqlite3` are native deps; if `npm install` fails on a platform, try `npm install --build-from-source`.

Semantic ranking requires Ollama running locally with `nomic-embed-text` pulled. If Ollama is unavailable, search soft-falls-back to FTS5-only with a `semantic_unavailable` warning in the response. Unit 4 enforces this.

## Tests

```sh
npm test
```

Boots the server with a temp root and asserts the 12 tool names register, then exercises every tool's real body via the dispatcher and fixture-desks. 103 tests as of Unit 6.
