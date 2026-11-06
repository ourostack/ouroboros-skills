// desk MCP server registration.
//
// Registers all 12 tools as stdio MCP handlers. In this scaffold unit
// (W6 Unit 2), every tool body returns a `not_implemented` stub. Real
// bodies arrive in Units 3 (runtime CRUD), 4 (indexer), 5 (search),
// 6 (thread).
//
// The 12 tools:
//   Runtime CRUD (Unit 3):
//     - task_create, task_update, task_archive
//     - track_create, track_update
//     - friction_add, lesson_add
//   Search (Units 4-6):
//     - desk_search, desk_recall, desk_similar, desk_timeline, desk_thread

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import { TOOL_NAMES, TOOL_DESCRIPTIONS } from "./tool-names.js"

export { TOOL_NAMES, TOOL_DESCRIPTIONS }

export async function startServer({ deskRoot }) {
  const server = new Server(
    {
      name: "desk-mcp",
      version: "0.3.0",
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
    if (!TOOL_NAMES.includes(name)) {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      }
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "not_implemented",
            tool: name,
            note: `Stub. Real body lands in W6 Unit 3/4/5/6. desk root = ${deskRoot}`,
          }),
        },
      ],
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
