// Scaffold test: assert the server registers all 13 tool names.
//
// Boots the server in-process (no actual stdio transport, no actual desk
// dir) and pulls the TOOL_NAMES export. Asserts the canonical 13 are
// present. Real per-tool behavioural tests live alongside in tools/.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { homedir, tmpdir } from "node:os"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import * as path from "node:path"

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
  // Index management
  "desk_reindex",
]

test("server scaffolds all 13 expected tool names", () => {
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
  assert.equal(expandHome("~"), homedir())
  assert.ok(expandHome("~/foo").endsWith("/foo"))
  assert.equal(expandHome("/abs/path"), "/abs/path")
  assert.throws(
    () => resolveDeskRoot("/definitely/does/not/exist/" + Date.now()),
    /does not exist/,
  )
})

test("path resolver — explicit --root wins over env + fallbacks", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const explicit = path.join(tmp, "explicit")
    mkdirSync(explicit)
    const prevDesk = process.env.DESK
    process.env.DESK = "/nonexistent/should/be/ignored"
    try {
      assert.equal(resolveDeskRoot(explicit), explicit)
    } finally {
      if (prevDesk === undefined) delete process.env.DESK
      else process.env.DESK = prevDesk
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("path resolver — $DESK env var used when --root absent", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const envRoot = path.join(tmp, "env-root")
    mkdirSync(envRoot)
    const prevDesk = process.env.DESK
    const prevHome = process.env.HOME
    process.env.DESK = envRoot
    // Point HOME at a fresh empty dir so the fallback chain finds nothing
    // and $DESK is what wins.
    process.env.HOME = path.join(tmp, "empty-home")
    mkdirSync(process.env.HOME)
    try {
      assert.equal(resolveDeskRoot(null), envRoot)
    } finally {
      if (prevDesk === undefined) delete process.env.DESK
      else process.env.DESK = prevDesk
      process.env.HOME = prevHome
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("path resolver — falls through $HOME canonical locations when env unset", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const fakeHome = path.join(tmp, "home")
    mkdirSync(fakeHome)
    // Create ~/desk but NOT ~/ms-desk — verify ~/desk is found.
    mkdirSync(path.join(fakeHome, "desk"))
    const prevDesk = process.env.DESK
    const prevHome = process.env.HOME
    delete process.env.DESK
    process.env.HOME = fakeHome
    try {
      assert.equal(resolveDeskRoot(null), path.join(fakeHome, "desk"))
    } finally {
      if (prevDesk !== undefined) process.env.DESK = prevDesk
      process.env.HOME = prevHome
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("path resolver — prefers ms-desk over desk over worker-workspace", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const fakeHome = path.join(tmp, "home")
    mkdirSync(fakeHome)
    // Create all three — ms-desk should win per order.
    mkdirSync(path.join(fakeHome, "ms-desk"))
    mkdirSync(path.join(fakeHome, "desk"))
    mkdirSync(path.join(fakeHome, "worker-workspace"))
    const prevDesk = process.env.DESK
    const prevHome = process.env.HOME
    delete process.env.DESK
    process.env.HOME = fakeHome
    try {
      assert.equal(resolveDeskRoot(null), path.join(fakeHome, "ms-desk"))
    } finally {
      if (prevDesk !== undefined) process.env.DESK = prevDesk
      process.env.HOME = prevHome
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("path resolver — falls back to worker-workspace as last resort", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const fakeHome = path.join(tmp, "home")
    mkdirSync(fakeHome)
    mkdirSync(path.join(fakeHome, "worker-workspace"))
    const prevDesk = process.env.DESK
    const prevHome = process.env.HOME
    delete process.env.DESK
    process.env.HOME = fakeHome
    try {
      assert.equal(resolveDeskRoot(null), path.join(fakeHome, "worker-workspace"))
    } finally {
      if (prevDesk !== undefined) process.env.DESK = prevDesk
      process.env.HOME = prevHome
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("path resolver — fatal error lists every path tried", async () => {
  const { resolveDeskRoot } = await import("../src/util/paths.js")
  const tmp = mkdtempSync(path.join(tmpdir(), "desk-paths-"))
  try {
    const fakeHome = path.join(tmp, "home-empty")
    mkdirSync(fakeHome)
    const prevDesk = process.env.DESK
    const prevHome = process.env.HOME
    process.env.DESK = path.join(tmp, "missing-env-desk")
    process.env.HOME = fakeHome
    try {
      assert.throws(
        () => resolveDeskRoot(null),
        (err) => {
          assert.match(err.message, /no desk workspace found/)
          assert.match(err.message, /\$DESK=/)
          assert.match(err.message, /ms-desk/)
          assert.match(err.message, /worker-workspace/)
          return true
        },
      )
    } finally {
      if (prevDesk === undefined) delete process.env.DESK
      else process.env.DESK = prevDesk
      process.env.HOME = prevHome
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
