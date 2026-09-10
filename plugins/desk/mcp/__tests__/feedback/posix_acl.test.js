import { test } from "node:test"
import { strict as assert } from "node:assert"
import { execFileSync } from "node:child_process"
import childProcess from "node:child_process"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { mkFeedbackFixture, useStateHome, cleanup } from "./_helpers.js"

const nativeMac = { skip: process.platform !== "darwin" }

function aclListing(target) {
  return execFileSync("/bin/ls", ["-ldeq", target], { encoding: "utf8", timeout: 5000 })
}

test("private store clears inherited macOS ACL grants before creating feedback", nativeMac, async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await fs.mkdir(fixture.stateHome)
    execFileSync("/bin/chmod", [
      "+a", "everyone allow list,search,readattr,readextattr,readsecurity,file_inherit,directory_inherit",
      fixture.stateHome,
    ], { timeout: 5000 })
    assert.match(aclListing(fixture.stateHome), /everyone allow/u)
    await withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
      store.capture({ text: "private despite inherited sharing", taskRef: null }))
    const { storeDir, dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot })
    for (const target of [path.join(fixture.stateHome, "ouroboros-skills"), storeDir, dbPath]) {
      assert.doesNotMatch(aclListing(target), /^\s*\d+:/mu, `${target} must have no extended ACL`)
    }
    assert.match(aclListing(fixture.stateHome), /everyone allow/u, "the shared state home is not ours to reconfigure")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store removes a later macOS ACL grant on the existing database", nativeMac, async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
      store.capture({ text: "existing private entry", taskRef: null }))
    const { dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot })
    execFileSync("/bin/chmod", ["+a", "everyone allow read,write", dbPath], { timeout: 5000 })
    assert.match(aclListing(dbPath), /everyone allow/u)
    const listed = await withPrivateStore({ deskRoot: fixture.deskRoot }, (store) => store.list({ limit: 20 }))
    assert.equal(listed.total, 1)
    assert.doesNotMatch(aclListing(dbPath), /^\s*\d+:/mu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("macOS protection fails closed if the native provider fails or retains an ACL", async (t) => {
  for (const outcome of ["unavailable", "retained"]) {
    const fixture = await mkFeedbackFixture()
    const restore = useStateHome(fixture.stateHome)
    const failure = new Error("native ACL provider unavailable")
    const mocked = t.mock.method(childProcess, "execFileSync", (command, args, options) => {
      assert.ok(["/bin/chmod", "/bin/ls"].includes(command))
      assert.equal(path.basename(args.at(-1)), "ouroboros-skills")
      assert.equal(options.timeout, 5000)
      assert.equal(options.maxBuffer, 65536)
      if (outcome === "unavailable") throw failure
      return command === "/bin/ls" ? "directory\n 0: group:everyone allow read\n" : ""
    })
    try {
      await assert.rejects(
        () => withPrivateStore({ deskRoot: fixture.deskRoot, platform: "darwin" }, () =>
          assert.fail("SQLite must not open with unverified protection")),
        outcome === "unavailable" ? (error) => error === failure : /retains an extended ACL/u,
      )
    } finally {
      mocked.mock.restore()
      restore()
      await cleanup(fixture.base)
    }
  }
})

test("macOS protection passes paths as arguments and verifies the native result", async (t) => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const calls = []
  const mocked = t.mock.method(childProcess, "execFileSync", (command, args) => {
    calls.push([command, args])
    return ""
  })
  try {
    await withPrivateStore({ deskRoot: fixture.deskRoot, platform: "darwin" }, (store) =>
      store.capture({ text: "adapter coverage is not native ACL proof", taskRef: null }))
    assert.equal(calls.length, 10)
    for (let index = 0; index < calls.length; index += 2) {
      const [command, args] = calls[index]
      assert.equal(command, "/bin/chmod")
      assert.deepEqual(args.slice(0, -1), ["-N"])
      assert.deepEqual(calls[index + 1], ["/bin/ls", ["-ldeq", args.at(-1)]])
    }
  } finally {
    mocked.mock.restore()
    restore()
    await cleanup(fixture.base)
  }
})

test("POSIX mode protection on Linux does not require the macOS provider", async (t) => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const mocked = t.mock.method(childProcess, "execFileSync", () => assert.fail("Linux must not use macOS ACL commands"))
  try {
    await withPrivateStore({ deskRoot: fixture.deskRoot, platform: "linux" }, (store) =>
      store.capture({ text: "POSIX owner-only modes", taskRef: null }))
  } finally {
    mocked.mock.restore()
    restore()
    await cleanup(fixture.base)
  }
})
