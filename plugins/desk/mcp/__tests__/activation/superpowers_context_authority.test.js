import { test, beforeEach, afterEach } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { resolveWriteTarget } from "../../src/util/paths.js"

let fixtureRoot
let deskRoot
beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "desk-no-create-"))
  deskRoot = path.join(fixtureRoot, "desk")
  mkdirSync(deskRoot)
})
afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }))

const target = (overrides = {}) => ({
  deskRoot,
  person: "member",
  segments: ["track", "outcome", "task.md"],
  ...overrides,
})

test("default write-target behavior still provisions a missing person root", async () => {
  const result = await resolveWriteTarget(target())
  assert.equal(result, path.join(deskRoot, "desks", "member", "track", "outcome", "task.md"))
  assert.equal(existsSync(path.join(deskRoot, "desks", "member")), true)
})

test("no-create resolution rejects a missing person root without creating any directory", async () => {
  let failure
  try {
    await resolveWriteTarget(target({ createPersonRoot: false }))
  } catch (error) {
    failure = error
  }
  assert.deepEqual(readdirSync(deskRoot), [], "read-only resolution must not provision desks or person directories")
  assert.match(failure?.message ?? "", /root.*(?:missing|exist)|(?:missing|exist).*root/iu)
})

test("no-create resolution accepts an existing person root without creating target directories", async () => {
  const personRoot = path.join(deskRoot, "desks", "member")
  mkdirSync(personRoot, { recursive: true })
  const result = await resolveWriteTarget(target({ createPersonRoot: false }))
  assert.equal(result, path.join(personRoot, "track", "outcome", "task.md"))
  assert.deepEqual(readdirSync(personRoot), [])
})

test("no-create resolution preserves the person-off path", async () => {
  const result = await resolveWriteTarget(target({ person: null, createPersonRoot: false }))
  assert.equal(result, path.join(deskRoot, "track", "outcome", "task.md"))
  assert.deepEqual(readdirSync(deskRoot), [])
})

test("no-create resolution retains canonical person-root symlink refusal", async () => {
  mkdirSync(path.join(deskRoot, "desks"))
  mkdirSync(path.join(fixtureRoot, "elsewhere"))
  symlinkSync(path.join(fixtureRoot, "elsewhere"), path.join(deskRoot, "desks", "member"), "dir")
  await assert.rejects(() => resolveWriteTarget(target({ createPersonRoot: false })), /effective write root resolves outside/u)
})

test("no-create resolution retains escaping target symlink refusal", async () => {
  const personRoot = path.join(deskRoot, "desks", "member")
  mkdirSync(personRoot, { recursive: true })
  mkdirSync(path.join(fixtureRoot, "elsewhere"))
  symlinkSync(path.join(fixtureRoot, "elsewhere"), path.join(personRoot, "track"), "dir")
  await assert.rejects(() => resolveWriteTarget(target({ createPersonRoot: false })), /write target resolves outside/u)
})

test("no-create resolution retains alias traversal refusal", async () => {
  await assert.rejects(() => resolveWriteTarget(target({ person: "../member", createPersonRoot: false })), /invalid --person alias/u)
  assert.deepEqual(readdirSync(deskRoot), [])
})
