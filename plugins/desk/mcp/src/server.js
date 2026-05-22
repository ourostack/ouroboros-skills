// desk MCP server registration.
//
// Registers all 12 tools as stdio MCP handlers. Unit 3 (this commit) wires
// the 7 runtime-CRUD tools — task_create, task_update, task_archive,
// track_create, track_update, friction_add, lesson_add — to real
// implementations under `./tools/`. The remaining 5 search/thread tools
// (desk_search, desk_recall, desk_similar, desk_timeline, desk_thread)
// still return a `not_implemented` stub until Units 4-6.

import { existsSync } from "node:fs"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { TOOL_NAMES, TOOL_DESCRIPTIONS } from "./tool-names.js"
import {
  task_create,
  task_update,
  task_archive,
} from "./tools/task.js"
import { track_create, track_update } from "./tools/track.js"
import { friction_add } from "./tools/friction.js"
import { lesson_add } from "./tools/lesson.js"
import { closeDb, indexDbPath, openDb } from "./db/init.js"
import { isIndexFresh, rebuildIndex } from "./indexer/index.js"

export { TOOL_NAMES, TOOL_DESCRIPTIONS }

// Map tool name → implementation. Unwired tools fall through to the stub.
const TOOL_IMPLS = {
  task_create,
  task_update,
  task_archive,
  track_create,
  track_update,
  friction_add,
  lesson_add,
}

/**
 * Dispatch a single MCP call. Pulled out from startServer so tests can
 * exercise the dispatch table directly (no stdio transport needed).
 */
export async function callTool({ deskRoot, name, input }) {
  if (!TOOL_NAMES.includes(name)) {
    return {
      content: [{ type: "text", text: `unknown tool: ${name}` }],
      isError: true,
    }
  }
  const impl = TOOL_IMPLS[name]
  if (!impl) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "not_implemented",
            tool: name,
            note: `Stub. Real body lands in W6 Unit 4/5/6. desk root = ${deskRoot}`,
          }),
        },
      ],
    }
  }
  try {
    const result = await impl({ deskRoot, input: input ?? {} })
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "error",
            tool: name,
            message: err?.message ?? String(err),
          }),
        },
      ],
      isError: true,
    }
  }
}

/**
 * Bring the on-disk index up to date for `deskRoot`. Called once at server
 * boot. If the DB file doesn't exist, builds from scratch. If it exists and
 * is fresh (no file mtime newer than last_indexed_at), no-ops. Else does an
 * incremental refresh.
 */
export async function ensureIndex(deskRoot) {
  const dbPath = indexDbPath(deskRoot)
  const dbExisted = existsSync(dbPath)
  const db = openDb(deskRoot)
  try {
    if (dbExisted) {
      const fresh = await isIndexFresh(deskRoot, db)
      if (fresh) return { built: false, reason: "fresh" }
    }
    await rebuildIndex(deskRoot, { db })
    return { built: true, reason: dbExisted ? "stale" : "missing" }
  } finally {
    closeDb(db)
  }
}

export async function startServer({ deskRoot }) {
  // Build (or refresh) the index synchronously before accepting traffic, so
  // search tools — once Units 5/6 wire them up — see a consistent view.
  try {
    await ensureIndex(deskRoot)
  } catch (err) {
    console.error("[desk-mcp] ensureIndex failed:", err.message)
  }

  const server = new Server(
    {
      name: "desk-mcp",
      version: "0.5.0",
    },
    {
      capabilities: { tools: {} },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params?.name
    const input = request.params?.arguments ?? {}
    return callTool({ deskRoot, name, input })
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
