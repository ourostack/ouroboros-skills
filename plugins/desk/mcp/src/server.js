// desk MCP server registration.
//
// Registers all 12 tools as stdio MCP handlers. Unit 3 (this commit) wires
// the 7 runtime-CRUD tools — task_create, task_update, task_archive,
// track_create, track_update, friction_add, lesson_add — to real
// implementations under `./tools/`. The remaining 5 search/thread tools
// (desk_search, desk_recall, desk_similar, desk_timeline, desk_thread)
// still return a `not_implemented` stub until Units 4-6.

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

export async function startServer({ deskRoot }) {
  const server = new Server(
    {
      name: "desk-mcp",
      version: "0.4.0",
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
