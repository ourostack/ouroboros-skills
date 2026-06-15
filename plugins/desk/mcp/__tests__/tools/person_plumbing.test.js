// person_plumbing — Unit 1.1: the `--person <alias>` flag's TRANSPORT.
//
// Phase 1 of the shared-workspace capability threads a `person` value from the
// CLI entry through dispatch to each tool impl. This test file covers ONLY the
// transport (1.1): arg-parse reads `--person`, and callTool forwards `person`
// to the impl. The write-PREFIX semantics (path remap) are Unit 1.2.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseArgs, resolveStartupRuntimeCacheDir } from "../../index.js"
import { callTool, TOOL_IMPLS } from "../../src/server.js"
import { mkTempDeskRoot } from "./_helpers.js"

// ── arg-parse ───────────────────────────────────────────────────────────────

test("parseArgs reads --person <alias> into args.person", () => {
  const args = parseArgs(["--root", "/tmp/desk", "--person", "ari"])
  assert.equal(args.root, "/tmp/desk")
  assert.equal(args.person, "ari")
})

test("parseArgs defaults person to null when --person absent", () => {
  const args = parseArgs(["--root", "/tmp/desk"])
  assert.equal(args.person, null)
})

test("parseArgs ignores --person with no value (trailing flag)", () => {
  const args = parseArgs(["--root", "/tmp/desk", "--person"])
  assert.equal(args.person, null)
})

test("parseArgs accepts --person before --root (order-independent)", () => {
  const args = parseArgs(["--person", "bob", "--root", "/tmp/desk"])
  assert.equal(args.person, "bob")
  assert.equal(args.root, "/tmp/desk")
})

test("parseArgs and runtime cache resolution handle activation-config edge cases", () => {
  assert.deepEqual(
    parseArgs(["--root", "/tmp/desk", "--host-session-root"]),
    {
      person: null,
      root: "/tmp/desk",
    },
  )
  assert.deepEqual(
    parseArgs(["--root", "/tmp/desk", "--activation-config"]),
    {
      person: null,
      root: "/tmp/desk",
    },
  )

  const root = mkdtempSync(path.join(tmpdir(), "desk-person-activation-config-"))
  const configPath = path.join(root, "desk.activation-config.json")
  writeFileSync(
    configPath,
    JSON.stringify({
      schema_version: 1,
      desk: { root },
      runtimeCacheDir: "runtime-cache",
    }),
    "utf8",
  )
  try {
    assert.equal(
      resolveStartupRuntimeCacheDir({
        args: parseArgs(["--activation-config", configPath]),
        cwd: root,
        homeDir: root,
      }),
      path.join(root, "runtime-cache"),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── dispatch threading ────────────────────────────────────────────────────────

test("callTool forwards `person` to the tool impl alongside deskRoot+input", async () => {
  const root = await mkTempDeskRoot()
  let received
  // Register a probe impl on the live dispatch table. We name it after a real
  // tool so TOOL_NAMES accepts it, then restore the original afterwards.
  const original = TOOL_IMPLS.task_create
  TOOL_IMPLS.task_create = async (arg) => {
    received = arg
    return { status: "probed" }
  }
  try {
    await callTool({
      deskRoot: root,
      name: "task_create",
      input: { track: "t", slug: "s", title: "T" },
      person: "ari",
    })
  } finally {
    TOOL_IMPLS.task_create = original
  }
  assert.ok(received, "probe impl should have been invoked")
  assert.equal(received.person, "ari", "callTool must forward person to the impl")
  assert.equal(received.deskRoot, root)
  assert.deepEqual(received.input, { track: "t", slug: "s", title: "T" })
})

test("callTool forwards person:null when no person passed (default-OFF transport)", async () => {
  const root = await mkTempDeskRoot()
  let received
  const original = TOOL_IMPLS.task_create
  TOOL_IMPLS.task_create = async (arg) => {
    received = arg
    return { status: "probed" }
  }
  try {
    await callTool({
      deskRoot: root,
      name: "task_create",
      input: { track: "t", slug: "s", title: "T" },
    })
  } finally {
    TOOL_IMPLS.task_create = original
  }
  assert.ok(received)
  assert.equal(received.person, null, "absent person must arrive as null, not undefined")
})
