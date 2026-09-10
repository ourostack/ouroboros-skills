// desk_feedback — private qualitative-feedback CRUD exercised through the real
// MCP dispatch boundary (src/server.js callTool + startServer registration),
// not by calling the tool module directly.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { callTool, startServer, TOOL_NAMES } from "../../src/server.js"
import { desk_feedback } from "../../src/tools/feedback.js"
import { resolvePrivateStore } from "../../src/feedback/store.js"
import { mkFeedbackFixture, useStateHome, cleanup } from "../feedback/_helpers.js"

function body(result) {
  return JSON.parse(result.content[0].text)
}

async function feedback({ deskRoot, person = null, input }) {
  return callTool({ deskRoot, name: "desk_feedback", input, person })
}

test("desk_feedback captures, lists, corrects, and deletes a private entry", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const captured = await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: {
        action: "capture",
        text: "The planning step felt heavier than the work it produced.",
        task_ref: "delivery/refactor-intake",
      },
    })
    assert.equal(captured.isError, undefined)
    const capturedBody = body(captured)
    assert.equal(capturedBody.status, "captured")
    assert.equal(
      capturedBody.entry.text,
      "The planning step felt heavier than the work it produced.",
    )
    assert.equal(capturedBody.entry.task_ref, "delivery/refactor-intake")
    assert.equal(capturedBody.entry.revision, 1)
    assert.match(capturedBody.entry.entry_id, /^[0-9a-f-]{36}$/u)
    assert.match(capturedBody.entry.preview_version, /^\d+\.\d+\.\d+/u)

    const listed = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list" },
      }),
    )
    assert.equal(listed.status, "ok")
    assert.equal(listed.total, 1)
    assert.equal(listed.entries.length, 1)
    assert.equal(listed.entries[0].entry_id, capturedBody.entry.entry_id)

    const corrected = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: {
          action: "correct",
          entry_id: capturedBody.entry.entry_id,
          expected_revision: 1,
          text: "Planning felt heavy, but the doing document paid it back.",
        },
      }),
    )
    assert.equal(corrected.status, "corrected")
    assert.equal(corrected.entry.revision, 2)
    assert.equal(
      corrected.entry.text,
      "Planning felt heavy, but the doing document paid it back.",
    )

    const deleted = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "delete", entry_id: capturedBody.entry.entry_id },
      }),
    )
    assert.equal(deleted.status, "deleted")
    assert.equal(deleted.entry_id, capturedBody.entry.entry_id)

    const emptied = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list" },
      }),
    )
    assert.equal(emptied.total, 0)
    assert.deepEqual(emptied.entries, [])
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback attributes a mirrored runtime to its internal installed-plugin binding", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const pluginRoot = path.join(fixture.base, "installed-plugin")
  try {
    await fs.mkdir(pluginRoot)
    await fs.writeFile(path.join(pluginRoot, "plugin.json"), JSON.stringify({ version: "9.8.7-alpha.2" }))
    const input = { action: "capture", text: "bound to the installed Desk release" }
    const captured = await callTool({
      deskRoot: fixture.deskRoot,
      name: "desk_feedback",
      input,
      statusContext: { runtime: { plugin_root: pluginRoot } },
    })
    assert.equal(captured.isError, undefined)
    assert.equal(body(captured).entry.preview_version, "9.8.7-alpha.2")

    const spoofed = await callTool({
      deskRoot: fixture.deskRoot,
      name: "desk_feedback",
      input: { ...input, plugin_root: pluginRoot },
    })
    assert.equal(spoofed.isError, true)
    assert.match(spoofed.content[0].text, /unknown input field.*plugin_root/u)
    const listed = body(await feedback({ deskRoot: fixture.deskRoot, input: { action: "list" } }))
    assert.equal(listed.total, 1)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback keeps each person binding isolated from the others", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "capture", text: "rowan's private note" },
    })
    const otherPerson = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "juniper",
        input: { action: "list" },
      }),
    )
    assert.equal(otherPerson.total, 0)
    assert.deepEqual(otherPerson.entries, [])
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback is registered on the real MCP tool surface", async () => {
  const fixture = await mkFeedbackFixture()
  const handlers = []
  const server = {
    setRequestHandler(schema, handler) {
      handlers.push(handler)
    },
    async connect() {},
  }
  try {
    await startServer({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      server,
      transport: { kind: "fake-stdio" },
    })
    const listed = await handlers[0]()
    const tool = listed.tools.find((entry) => entry.name === "desk_feedback")
    assert.ok(tool, "desk_feedback must be advertised by tools/list")
    assert.match(tool.description, /private/iu)
    assert.equal(TOOL_NAMES.filter((name) => name === "desk_feedback").length, 1)
  } finally {
    await cleanup(fixture.base)
  }
})

test("desk_feedback rejects unknown actions instead of guessing", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const unknown = await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "share" },
    })
    assert.ok(unknown.isError)
    assert.match(body(unknown).message, /unknown action "share"/u)

    const missing = await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: {},
    })
    assert.ok(missing.isError)
    assert.match(body(missing).message, /unknown action null/u)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback rejects unknown input fields rather than opening arbitrary controls", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    for (const input of [
      { action: "capture", text: "note", db_path: "/etc/passwd" },
      { action: "list", person: "someone-else" },
      { action: "delete", entry_id: "id", cascade: true },
      { action: "correct", entry_id: "id", expected_revision: 1, text: "t", force: true },
    ]) {
      const result = await feedback({ deskRoot: fixture.deskRoot, person: "rowan", input })
      assert.ok(result.isError, `${JSON.stringify(input)} must be rejected`)
      assert.match(body(result).message, /unknown input field/u)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback validates capture text and task_ref", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const cases = [
      [{ action: "capture" }, /`text` is required/u],
      [{ action: "capture", text: "   " }, /`text` is required/u],
      [{ action: "capture", text: 42 }, /`text` is required/u],
      [{ action: "capture", text: "x".repeat(4001) }, /the limit is 4000/u],
      [{ action: "capture", text: "ok", task_ref: "" }, /`task_ref` must be a non-empty string/u],
      [{ action: "capture", text: "ok", task_ref: 7 }, /`task_ref` must be a non-empty string/u],
      [{ action: "capture", text: "ok", task_ref: "r".repeat(201) }, /the limit is 200/u],
    ]
    for (const [input, expected] of cases) {
      const result = await feedback({ deskRoot: fixture.deskRoot, person: "rowan", input })
      assert.ok(result.isError, `${JSON.stringify(input)} must be rejected`)
      assert.match(body(result).message, expected)
    }

    const trimmed = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "capture", text: "  edges matter  ", task_ref: null },
      }),
    )
    assert.equal(trimmed.entry.text, "edges matter")
    assert.equal(trimmed.entry.task_ref, null)

    const maxLength = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "capture", text: "y".repeat(4000), task_ref: "r".repeat(200) },
      }),
    )
    assert.equal(maxLength.entry.text.length, 4000)
    assert.equal(maxLength.entry.task_ref.length, 200)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback bounds list results and validates limit", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    for (const limit of [0, 101, 1.5, "5"]) {
      const result = await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list", limit },
      })
      assert.ok(result.isError, `limit ${limit} must be rejected`)
      assert.match(body(result).message, /`limit` must be an integer between 1 and 100/u)
    }

    for (const text of ["first note", "second note", "third note"]) {
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "capture", text },
      })
    }

    const bounded = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list", limit: 2 },
      }),
    )
    assert.equal(bounded.count, 2)
    assert.equal(bounded.entries.length, 2)
    assert.equal(bounded.total, 3)
    assert.equal(bounded.limit, 2)

    const defaulted = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list", limit: null },
      }),
    )
    assert.equal(defaulted.limit, 20)
    assert.equal(defaulted.count, 3)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback refuses a correction written against a stale revision", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const entry = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "capture", text: "original wording" },
      }),
    ).entry

    await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: {
        action: "correct",
        entry_id: entry.entry_id,
        expected_revision: 1,
        text: "wording the participant kept",
      },
    })

    const stale = await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: {
        action: "correct",
        entry_id: entry.entry_id,
        expected_revision: 1,
        text: "wording from a stale read",
      },
    })
    assert.ok(stale.isError)
    assert.match(body(stale).message, /changed since it was read/u)
    assert.match(body(stale).message, /current revision 2/u)

    const surviving = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list" },
      }),
    ).entries[0]
    assert.equal(surviving.text, "wording the participant kept")
    assert.equal(surviving.revision, 2)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback errors on missing entry ids instead of reporting success", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const cases = [
      [{ action: "delete", entry_id: "00000000-0000-0000-0000-000000000000" }, /no feedback entry/u],
      [
        {
          action: "correct",
          entry_id: "00000000-0000-0000-0000-000000000000",
          expected_revision: 1,
          text: "x",
        },
        /no feedback entry/u,
      ],
      [{ action: "delete" }, /`entry_id` is required/u],
      [{ action: "delete", entry_id: "  " }, /`entry_id` is required/u],
      [{ action: "correct", entry_id: 5, expected_revision: 1, text: "x" }, /`entry_id` is required/u],
      [{ action: "correct", entry_id: "id", text: "x" }, /`expected_revision` is required/u],
      [
        { action: "correct", entry_id: "id", expected_revision: 0, text: "x" },
        /`expected_revision` is required/u,
      ],
      [
        { action: "correct", entry_id: "id", expected_revision: "1", text: "x" },
        /`expected_revision` is required/u,
      ],
    ]
    for (const [input, expected] of cases) {
      const result = await feedback({ deskRoot: fixture.deskRoot, person: "rowan", input })
      assert.ok(result.isError, `${JSON.stringify(input)} must be rejected`)
      assert.match(body(result).message, expected)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback deletion drops the words from the reopened store", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const secret = "phrase-that-must-not-survive-deletion"
    const entry = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "capture", text: secret },
      }),
    ).entry

    const { dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    assert.ok((await fs.readFile(dbPath)).includes(Buffer.from(secret)))

    await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "delete", entry_id: entry.entry_id },
    })

    const reopened = body(
      await feedback({
        deskRoot: fixture.deskRoot,
        person: "rowan",
        input: { action: "list" },
      }),
    )
    assert.equal(reopened.total, 0)
    assert.ok(
      !(await fs.readFile(dbPath)).includes(Buffer.from(secret)),
      "secure_delete must remove the text from the store file, not soft-delete it",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback keeps unbound sessions and separate desk roots in separate stores", async () => {
  const fixture = await mkFeedbackFixture()
  const otherDeskRoot = path.join(fixture.base, "other-workspace")
  await fs.mkdir(otherDeskRoot, { recursive: true })
  const restore = useStateHome(fixture.stateHome)
  try {
    await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "capture", text: "bound to a person" },
    })
    await feedback({
      deskRoot: fixture.deskRoot,
      person: null,
      input: { action: "capture", text: "unbound session note" },
    })

    const unbound = body(
      await feedback({ deskRoot: fixture.deskRoot, person: null, input: { action: "list" } }),
    )
    assert.equal(unbound.total, 1)
    assert.equal(unbound.entries[0].text, "unbound session note")

    const otherRoot = body(
      await feedback({ deskRoot: otherDeskRoot, person: "rowan", input: { action: "list" } }),
    )
    assert.equal(otherRoot.total, 0)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback rejects an unsafe person binding", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const result = await feedback({
      deskRoot: fixture.deskRoot,
      person: "../escape",
      input: { action: "capture", text: "should never be stored" },
    })
    assert.ok(result.isError)
    assert.match(body(result).message, /alias/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback defaults omitted input and person when called directly", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await assert.rejects(
      () => desk_feedback({ deskRoot: fixture.deskRoot }),
      /unknown action null/u,
    )
    const captured = await desk_feedback({
      deskRoot: fixture.deskRoot,
      input: { action: "capture", text: "captured without a person binding" },
    })
    assert.equal(captured.status, "captured")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback reports an unavailable Windows provider while other tools remain routable", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const realPlatform = process.platform
  const systemRoot = process.env.SystemRoot
  delete process.env.SystemRoot
  Object.defineProperty(process, "platform", { value: "win32", configurable: true })
  try {
    const result = await feedback({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "capture", text: "typed on a shipped Windows host" },
    })

    assert.ok(result.isError, "Windows must fail loudly, not store an unprotected file")
    const failed = body(result)
    assert.equal(failed.status, "error")
    assert.equal(failed.tool, "desk_feedback")
    assert.match(failed.message, /Windows ACL protection.*SystemRoot/u)

    await assert.rejects(
      () => fs.stat(path.join(fixture.stateHome, "ouroboros-skills", "desk", "feedback")),
      /ENOENT/u,
      "no store directory may be created without the native provider",
    )

    const unrelated = await callTool({
      deskRoot: fixture.deskRoot,
      name: "task_create",
      input: { track: "delivery", slug: "intake", title: "Intake" },
    })
    assert.equal(unrelated.isError, undefined, "the Windows gap is scoped to desk_feedback")
    assert.equal(JSON.parse(unrelated.content[0].text).status, "created")
  } finally {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true })
    if (systemRoot !== undefined) process.env.SystemRoot = systemRoot
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_feedback can inspect older entries beyond the first bounded page", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    for (const text of ["one", "two", "three"]) {
      const result = await feedback({ deskRoot: fixture.deskRoot, input: { action: "capture", text } })
      assert.equal(result.isError, undefined)
    }
    const all = body(await feedback({ deskRoot: fixture.deskRoot, input: { action: "list" } }))
    const result = await feedback({
      deskRoot: fixture.deskRoot,
      input: { action: "list", limit: 1, offset: 2 },
    })
    assert.equal(result.isError, undefined)
    const last = body(result)
    assert.equal(last.offset, 2)
    assert.equal(last.total, 3)
    assert.equal(last.next_offset, null)
    assert.equal(last.entries[0].entry_id, all.entries[2].entry_id)

    const first = body(await feedback({
      deskRoot: fixture.deskRoot,
      input: { action: "list", limit: 1 },
    }))
    assert.equal(first.offset, 0)
    assert.equal(first.next_offset, 1)
    for (const offset of [-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await feedback({
        deskRoot: fixture.deskRoot, input: { action: "list", offset },
      })
      assert.equal(invalid.isError, true)
      assert.match(body(invalid).message, /`offset`/u)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
