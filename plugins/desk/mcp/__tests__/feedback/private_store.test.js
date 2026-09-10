// Private feedback store — the storage contract behind desk_feedback.
//
// Permission assertions exercise real directories and SQLite files. Fault injection covers creation errors and races without substituting permission proof.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { mkFeedbackFixture, useStateHome, useHome, cleanup } from "./_helpers.js"

async function modeOf(target) {
  return (await fs.stat(target)).mode & 0o777
}

test("private store lives outside the desk workspace under owner-only modes", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { storeDir, dbPath } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    assert.ok(
      !storeDir.startsWith(await fs.realpath(fixture.deskRoot)),
      "the private store must not live inside the desk workspace",
    )
    assert.equal(path.basename(dbPath), "feedback.sqlite")
    assert.equal(await modeOf(storeDir), 0o700)

    await withPrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }, (store) =>
      store.capture({ text: "a note", taskRef: null }),
    )
    assert.equal(await modeOf(dbPath), 0o600)

    let ancestor = await fs.realpath(fixture.stateHome)
    for (const segment of ["ouroboros-skills", "desk", "feedback"]) {
      ancestor = path.join(ancestor, segment)
      assert.equal(await modeOf(ancestor), 0o700, `${ancestor} must be owner-only`)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store tightens a loosened directory before reuse", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { storeDir } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    await fs.chmod(storeDir, 0o777)
    assert.equal(await modeOf(storeDir), 0o777)

    await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    assert.equal(await modeOf(storeDir), 0o700)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses a symlinked path component", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { storeDir } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    const elsewhere = path.join(fixture.base, "elsewhere")
    await fs.mkdir(elsewhere, { recursive: true })
    await fs.rm(storeDir, { recursive: true, force: true })
    await fs.symlink(elsewhere, storeDir)

    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }),
      /path component is a symlink/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses a symlinked DB file", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { dbPath } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    const decoy = path.join(fixture.base, "decoy.sqlite")
    await fs.writeFile(decoy, "")
    await fs.symlink(decoy, dbPath)

    await assert.rejects(
      () =>
        withPrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }, (store) =>
          store.list({ limit: 5 }),
        ),
      /DB path is a symlink/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses a path component that is not a directory", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await fs.mkdir(fixture.stateHome, { recursive: true })
    await fs.writeFile(path.join(fixture.stateHome, "ouroboros-skills"), "not a directory")

    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }),
      /path component is not a directory/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses to write inside the desk workspace", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(path.join(fixture.deskRoot, "state"))
  try {
    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }),
      /refusing to write private feedback inside the desk workspace/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses to write inside a Git checkout", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await fs.mkdir(path.join(fixture.stateHome, ".git"), { recursive: true })

    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }),
      /refusing to write private feedback inside the Git checkout/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store surfaces an unreadable path as an explicit error", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await fs.mkdir(fixture.stateHome, { recursive: true })
    await fs.chmod(fixture.stateHome, 0o000)

    await assert.rejects(
      () => resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }),
      /could not be inspected \(EACCES\)/u,
    )
  } finally {
    await fs.chmod(fixture.stateHome, 0o700).catch(() => {})
    restore()
    await cleanup(fixture.base)
  }
})

test("private store surfaces SQLite open failures instead of silently succeeding", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { dbPath } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    await fs.mkdir(dbPath, { recursive: true })

    await assert.rejects(
      () =>
        withPrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }, (store) =>
          store.list({ limit: 5 }),
        ),
      /could not be opened/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store surfaces a corrupt store file instead of silently succeeding", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { dbPath } = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    await fs.writeFile(dbPath, "this is not a SQLite database")

    await assert.rejects(
      () =>
        withPrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" }, (store) =>
          store.list({ limit: 5 }),
        ),
      /could not be opened/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store refuses Windows storage without the native ACL provider", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await assert.rejects(
      () =>
        resolvePrivateStore({
          deskRoot: fixture.deskRoot,
          person: "rowan",
          platform: "win32",
          env: { XDG_STATE_HOME: fixture.stateHome },
        }),
      /Windows ACL protection.*SystemRoot/u,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store fails explicitly when the desk root cannot be resolved", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await assert.rejects(
      () =>
        resolvePrivateStore({
          deskRoot: path.join(fixture.base, "no-such-workspace"),
          person: "rowan",
        }),
      /desk root could not be resolved.*ENOENT/su,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store falls back to the home state directory when XDG_STATE_HOME is unusable", async () => {
  const fixture = await mkFeedbackFixture()
  const home = path.join(fixture.base, "home")
  await fs.mkdir(home, { recursive: true })
  const restore = useHome(home)
  try {
    const fallback = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
    })
    const expectedBase = path.join(await fs.realpath(home), ".local", "state")
    assert.ok(
      fallback.storeDir.startsWith(expectedBase),
      `${fallback.storeDir} should sit under ${expectedBase}`,
    )

    process.env.XDG_STATE_HOME = "   "
    const blank = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    assert.equal(blank.storeDir, fallback.storeDir)

    process.env.XDG_STATE_HOME = "~/other-state"
    const tilde = await resolvePrivateStore({ deskRoot: fixture.deskRoot, person: "rowan" })
    assert.ok(
      tilde.storeDir.startsWith(path.join(await fs.realpath(home), "other-state")),
      `${tilde.storeDir} should expand ~ against HOME`,
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store resolves a home from the OS when the environment has none", async () => {
  const fixture = await mkFeedbackFixture()
  try {
    const env = { XDG_STATE_HOME: fixture.stateHome }
    assert.equal(env.HOME, undefined, "this case must exercise the OS home fallback")
    const implicitBinding = await resolvePrivateStore({ deskRoot: fixture.deskRoot, env })
    const explicitUnbound = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: null,
      env,
    })
    const bound = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      env,
    })
    assert.equal(implicitBinding.storeDir, explicitUnbound.storeDir)
    assert.notEqual(implicitBinding.storeDir, bound.storeDir)
    assert.ok(implicitBinding.storeDir.startsWith(await fs.realpath(fixture.stateHome)))
  } finally {
    await cleanup(fixture.base)
  }
})

test("private store stamps the installed Desk preview rather than the MCP component version", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const packageVersion = JSON.parse(
      await fs.readFile(new URL("../../../plugin.json", import.meta.url), "utf8"),
    ).version
    const captured = await withPrivateStore(
      { deskRoot: fixture.deskRoot, person: "rowan" },
      (store) => store.capture({ text: "version stamped", taskRef: "some/task" }),
    )
    assert.equal(captured.preview_version, packageVersion)
    assert.match(packageVersion, /^\d+\.\d+\.\d+/u)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store rejects a nested Git checkout inside its existing subtree", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    const { storeDir, dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot })
    await fs.writeFile(path.join(storeDir, ".git"), "gitdir: elsewhere\n")
    await assert.rejects(
      () => withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
        store.capture({ text: "must not enter a checkout", taskRef: null })),
      /inside the Git checkout/u,
    )
    await assert.rejects(() => fs.stat(dbPath), /ENOENT/u)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store rejects a hard-linked DB that could expose a second copy", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
      store.capture({ text: "existing note", taskRef: null }))
    const { dbPath } = await resolvePrivateStore({ deskRoot: fixture.deskRoot })
    const linked = path.join(fixture.deskRoot, "linked.sqlite")
    await fs.link(dbPath, linked)
    await assert.rejects(
      () => withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
        store.capture({ text: "must not cross the link", taskRef: null })),
      /hard.link/u,
    )
    assert.equal((await fs.readFile(linked)).includes(Buffer.from("must not cross the link")), false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("private store handles a racing directory creator without skipping protection", async (t) => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  const mkdir = fs.mkdir.bind(fs)
  let raced = false
  const mocked = t.mock.method(fs, "mkdir", async (target, options) => {
    if (!raced && path.basename(target) === "ouroboros-skills") {
      raced = true
      await mkdir(target, { mode: 0o777 })
      throw Object.assign(new Error("another opener created the directory"), { code: "EEXIST" })
    }
    return mkdir(target, options)
  })
  try {
    const { storeDir } = await resolvePrivateStore({ deskRoot: fixture.deskRoot })
    assert.equal(raced, true)
    assert.equal(await modeOf(storeDir), 0o700)
  } finally {
    mocked.mock.restore()
    restore()
    await cleanup(fixture.base)
  }
})

test("private store captures concurrent opens without losing either entry", async () => {
  const fixture = await mkFeedbackFixture()
  const restore = useStateHome(fixture.stateHome)
  try {
    await Promise.all(["first", "second"].map((text) =>
      withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
        store.capture({ text, taskRef: null }))))
    const result = await withPrivateStore({ deskRoot: fixture.deskRoot }, (store) =>
      store.list({ limit: 20 }))
    assert.equal(result.total, 2)
    assert.deepEqual(result.entries.map((entry) => entry.text).sort(), ["first", "second"])
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

for (const operation of ["mkdir", "writeFile"]) {
  test(`private store propagates ${operation} creation failures without opening SQLite`, async (t) => {
    const fixture = await mkFeedbackFixture()
    const restore = useStateHome(fixture.stateHome)
    const original = fs[operation].bind(fs)
    const failure = Object.assign(new Error("private storage creation denied"), { code: "EACCES" })
    let attempted = false
    const mocked = t.mock.method(fs, operation, async (target, ...args) => {
      if (path.basename(target) === (operation === "mkdir" ? "ouroboros-skills" : "feedback.sqlite")) {
        attempted = true
        throw failure
      }
      return original(target, ...args)
    })
    try {
      await assert.rejects(
        () => withPrivateStore({ deskRoot: fixture.deskRoot }, () => assert.fail("SQLite must not open")),
        (error) => error === failure,
      )
      assert.equal(attempted, true)
    } finally {
      mocked.mock.restore()
      restore()
      await cleanup(fixture.base)
    }
  })
}
