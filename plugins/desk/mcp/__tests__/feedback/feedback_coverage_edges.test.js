import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import path from "node:path"
import { protectWindowsPaths } from "../../src/feedback/windows-acl.js"
import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { mkFeedbackFixture, writePosixNodeProvider, cleanup } from "./_helpers.js"

const posix = { skip: process.platform === "win32" ? "POSIX stand-in and permission-race witnesses" : false }

test("Windows protection's omitted options use the ambient provider and default real runner", posix, async (t) => {
  const fixture = await mkFeedbackFixture()
  t.after(() => cleanup(fixture.base))
  const provider = path.join(fixture.base, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  await fs.mkdir(path.dirname(provider), { recursive: true })
  await writePosixNodeProvider(provider, `
const request = JSON.parse(require("node:fs").readFileSync(0, "utf8"))
process.stdout.write(JSON.stringify({ status: "ok", results: request.paths.map(entry => ({
  ...entry, owner_sid: "S-1-5-21-1-2-3-1001", owner_reassigned: false, protected: true, rule_count: 1
})) }))
`)
  const previous = process.env.SystemRoot
  process.env.SystemRoot = fixture.base
  t.after(() => {
    if (previous === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = previous
  })
  const entry = { path: "C:\\fixture\\private", kind: "directory", created: true }
  assert.deepEqual(await protectWindowsPaths([entry]), [{
    path: entry.path, kind: entry.kind,
    owner_sid: "S-1-5-21-1-2-3-1001", owner_reassigned: false,
  }])
})

test("a real SQLite constructor failure after file inspection never reaches the store callback", posix, async (t) => {
  const fixture = await mkFeedbackFixture()
  t.after(() => cleanup(fixture.base))
  const binding = { deskRoot: fixture.deskRoot, env: { XDG_STATE_HOME: fixture.stateHome } }
  const { dbPath } = await resolvePrivateStore(binding)
  const chmod = fs.chmod.bind(fs)
  let raced = false
  t.mock.method(fs, "chmod", async (target, mode) => {
    await chmod(target, mode)
    if (target === dbPath) {
      assert.equal(raced, false)
      raced = true
      await fs.rename(dbPath, `${dbPath}.before-race`)
      await fs.mkdir(dbPath)
    }
  })
  let callbackReached = false
  await assert.rejects(
    () => withPrivateStore(binding, () => { callbackReached = true }),
    (error) => {
      assert.ok(error.message.startsWith(`desk_feedback: private feedback store at ${dbPath} could not be opened:`))
      assert.match(error.message, /unable to open database file/u)
      return true
    },
  )
  assert.equal(raced, true)
  assert.equal(callbackReached, false)
  assert.equal((await fs.stat(dbPath)).isDirectory(), true)
  assert.equal((await fs.stat(`${dbPath}.before-race`)).size, 0)
})
