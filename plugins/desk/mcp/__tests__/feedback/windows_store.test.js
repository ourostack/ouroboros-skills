import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { callTool } from "../../src/server.js"
import { mkFeedbackFixture, useStateHome, cleanup, writePosixNodeProvider } from "./_helpers.js"

const isWindows = process.platform === "win32"
const standIn = { skip: isWindows ? "POSIX adapter stand-in; native Windows cases below use the real provider" : false }

async function makeProvider(fixture, failKind = null) {
  const root = path.join(fixture.base, "system")
  const directory = path.join(root, "System32", "WindowsPowerShell", "v1.0")
  const trace = path.join(fixture.base, "provider-calls.jsonl")
  await fs.mkdir(directory, { recursive: true })
  await writePosixNodeProvider(path.join(directory, "powershell.exe"), `
const fs = require("node:fs");
let raw = "";
process.stdin.on("data", chunk => raw += chunk);
process.stdin.on("end", () => {
  const request = JSON.parse(raw);
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(request.paths) + "\\n");
  if (request.paths.some(entry => entry.kind === ${JSON.stringify(failKind)})) {
    process.stdout.write(JSON.stringify({status:"error",message:"native protection refused"}));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({status:"ok",results:request.paths.map(entry => ({
    ...entry, owner_sid:"S-1-5-21-1-2-3-1001", owner_reassigned:false, protected:true, rule_count:1
  }))}));
});
`)
  return {
    binding: { deskRoot: fixture.deskRoot, platform: "win32", env: { SystemRoot: root, XDG_STATE_HOME: fixture.stateHome } },
    trace,
  }
}

test("Windows private storage refuses a missing provider before creating state", async () => {
  const fixture = await mkFeedbackFixture()
  try {
    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, platform: "win32", env: { XDG_STATE_HOME: fixture.stateHome } }),
      /Windows ACL protection.*SystemRoot/u,
    )
    await assert.rejects(() => fs.stat(fixture.stateHome), /ENOENT/u)
  } finally {
    await cleanup(fixture.base)
  }
})

test("Windows storage batches directories and protects the DB before use on every open", standIn, async () => {
  const fixture = await mkFeedbackFixture()
  try {
    const { binding, trace } = await makeProvider(fixture)
    const entry = await withPrivateStore(binding, (store) => store.capture({ text: "private entry", taskRef: null }))
    const listed = await withPrivateStore(binding, (store) => store.list({ limit: 20 }))
    assert.deepEqual(listed.entries, [entry])
    const calls = (await fs.readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    assert.deepEqual(calls.map((entries) => entries.map(({ kind }) => kind)), [
      ["directory", "directory", "directory", "directory"], ["file"],
      ["directory", "directory", "directory", "directory"], ["file"],
    ])
    assert.ok(calls.slice(0, 2).flat().every(({ created }) => created === true))
    assert.ok(calls.slice(2).flat().every(({ created }) => created === false))
    assert.equal(path.basename(calls[1][0].path), "feedback.sqlite")
    assert.doesNotMatch(await fs.readFile(trace, "utf8"), /private entry/u, "the provider gets paths, never feedback text")
  } finally {
    await cleanup(fixture.base)
  }
})

for (const kind of ["directory", "file"]) {
  test(`Windows ${kind} protection failure never reaches SQLite or its callback`, standIn, async () => {
    const fixture = await mkFeedbackFixture()
    try {
      const { binding, trace } = await makeProvider(fixture, kind)
      await assert.rejects(
        () => withPrivateStore(binding, () => assert.fail("must not open SQLite")),
        /native protection refused/u,
      )
      const calls = (await fs.readFile(trace, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
      assert.equal(calls.length, kind === "directory" ? 1 : 2)
      if (kind === "file") {
        assert.equal((await fs.stat(calls[1][0].path)).size, 0, "failed protection leaves no feedback bytes")
      }
    } finally {
      await cleanup(fixture.base)
    }
  })
}

test("native: Windows feedback CRUD preserves content across reopen and rejects stale corrections", {
  skip: isWindows ? false : "requires NTFS and the real Windows ACL provider",
}, async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const input = (value) => callTool({ deskRoot: fixture.deskRoot, person: "rowan", name: "desk_feedback", input: value })
  const body = (response) => {
    assert.equal(response.isError, undefined, JSON.stringify(response.content))
    return JSON.parse(response.content[0].text)
  }
  try {
    const captured = body(await input({ action: "capture", text: "native Windows participant feedback" })).entry
    assert.equal(body(await input({ action: "list" })).entries[0].entry_id, captured.entry_id)
    const corrected = body(await input({
      action: "correct", entry_id: captured.entry_id, expected_revision: 1, text: "corrected native Windows feedback",
    })).entry
    assert.equal(corrected.revision, 2)
    const stale = await input({ action: "correct", entry_id: captured.entry_id, expected_revision: 1, text: "stale text" })
    assert.equal(stale.isError, true)
    assert.equal(body(await input({ action: "list" })).entries[0].text, corrected.text)
    body(await input({ action: "delete", entry_id: captured.entry_id }))
    assert.equal(body(await input({ action: "list" })).total, 0)
    const { dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    const bytes = await fs.readFile(dbPath)
    assert.equal(bytes.includes(Buffer.from(captured.text)), false)
    assert.equal(bytes.includes(Buffer.from(corrected.text)), false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
