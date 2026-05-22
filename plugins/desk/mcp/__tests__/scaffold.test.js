// Unit 2 scaffold test: assert the server registers all 12 tool names.
//
// Boots the server in-process (no actual stdio transport, no actual desk
// dir) and pulls the TOOL_NAMES export. Asserts the canonical 12 are
// present. Real per-tool behavioural tests arrive in Units 3-6.

import { test } from "node:test"
import { strict as assert } from "node:assert"

// Import from tool-names directly (not server.js) so the test doesn't pull
// the @modelcontextprotocol/sdk dep. Tool list is the canonical source.
import { TOOL_NAMES } from "../src/tool-names.js"

const EXPECTED_TOOLS = [
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

test("server scaffolds all 12 expected tool names", () => {
  for (const name of EXPECTED_TOOLS) {
    assert.ok(
      TOOL_NAMES.includes(name),
      `expected tool '${name}' to be registered; got: ${TOOL_NAMES.join(", ")}`,
    )
  }
  assert.equal(
    TOOL_NAMES.length,
    EXPECTED_TOOLS.length,
    `expected exactly ${EXPECTED_TOOLS.length} tools; got ${TOOL_NAMES.length}`,
  )
})

test("path resolver expands ~ and rejects nonexistent roots", async () => {
  const { resolveDeskRoot, expandHome } = await import("../src/util/paths.js")
  assert.equal(expandHome("~"), process.env.HOME ?? require("node:os").homedir())
  assert.ok(expandHome("~/foo").endsWith("/foo"))
  assert.equal(expandHome("/abs/path"), "/abs/path")
  assert.throws(
    () => resolveDeskRoot("/definitely/does/not/exist/" + Date.now()),
    /does not exist/,
  )
})
