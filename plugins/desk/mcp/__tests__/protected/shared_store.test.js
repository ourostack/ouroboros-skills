// The shared protected-store primitive.
//
// Two private stores now live in the operating-system user's own state
// directory: the participant's qualitative feedback and the operator's work
// ledger. They share one set of protections — owner-only permissions, refusal
// to sit inside a Git checkout, refusal to follow a symlink or a hard link,
// DELETE journalling and secure_delete — and they share nothing else. The
// primitive exists to keep those protections in one place; it must not become
// a way to address a store the caller was never bound to.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { resolvePrivateStore, withPrivateStore } from "../../src/feedback/store.js"
import { resolveProtectedStore, withProtectedStore } from "../../src/protected/store.js"
import { mkLedgerFixture, cleanup } from "../measurement/_helpers.js"

// These cases are about POSIX store layout, refusals, journalling and message
// parity — not about macOS extended-ACL mechanics, which no assertion here
// inspects. Pinning "darwin" therefore claimed a platform rather than choosing
// one: on a Linux runner the primitive still took the macOS branch and shelled
// out to `/bin/chmod -N`, a flag that exists only on macOS, so these passed on
// a developer Mac and failed on CI. Following the host keeps the non-Windows
// branch deterministic without asserting darwin behaviour on a machine that is
// not one. Windows maps to a POSIX value because the real Windows provider is
// exercised by the native cases, not from here.
const POSIX_PLATFORM = process.platform === "win32" ? "linux" : process.platform

// A store descriptor. `label` prefixes a message; `subject` names the thing in
// its body. Both are module-internal constants in production — never tool input
// — and both must be parameterised, because a prefix alone would leave the work
// ledger reporting a compromised *feedback* database.
const FEEDBACK = {
  namespace: "feedback",
  filename: "feedback.sqlite",
  label: "desk_feedback",
  subject: "feedback",
}
const LEDGER = {
  namespace: "work-measurement",
  filename: "work-measurement.sqlite",
  label: "desk_work_ledger",
  subject: "work measurement",
}

function expectedPartition(realDeskRoot, alias) {
  return createHash("sha256")
    .update(JSON.stringify({ desk_root: realDeskRoot, person: alias }))
    .digest("hex")
    .slice(0, 32)
}

test("the extracted primitive keeps the feedback store exactly where it already was", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const viaFeedback = await resolvePrivateStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      env,
      platform: POSIX_PLATFORM,
    })
    const viaPrimitive = await resolveProtectedStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      env,
      platform: POSIX_PLATFORM,
      ...FEEDBACK,
    })
    assert.deepEqual(viaPrimitive, viaFeedback)

    const realDeskRoot = await fs.realpath(fixture.deskRoot)
    const realStateHome = await fs.realpath(fixture.stateHome)
    assert.equal(
      viaFeedback.dbPath,
      path.join(
        realStateHome,
        "ouroboros-skills",
        "desk",
        "feedback",
        expectedPartition(realDeskRoot, "rowan"),
        "feedback.sqlite",
      ),
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("the work ledger gets its own namespace, never the feedback database", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const binding = { deskRoot: fixture.deskRoot, person: "rowan", env, platform: POSIX_PLATFORM }
    const feedback = await resolveProtectedStore({ ...binding, ...FEEDBACK })
    const ledger = await resolveProtectedStore({ ...binding, ...LEDGER })

    assert.notEqual(ledger.storeDir, feedback.storeDir)
    assert.notEqual(ledger.dbPath, feedback.dbPath)
    assert.ok(ledger.storeDir.includes(`${path.sep}work-measurement${path.sep}`))
    assert.equal(path.basename(ledger.dbPath), "work-measurement.sqlite")
  } finally {
    await cleanup(fixture.base)
  }
})

test("each binding gets its own partition and one binding cannot address another", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const base = { deskRoot: fixture.deskRoot, env, platform: POSIX_PLATFORM, ...LEDGER }
    const rowan = await resolveProtectedStore({ ...base, person: "rowan" })
    const quinn = await resolveProtectedStore({ ...base, person: "quinn" })
    const unbound = await resolveProtectedStore({ ...base, person: null })

    const dirs = new Set([rowan.storeDir, quinn.storeDir, unbound.storeDir])
    assert.equal(dirs.size, 3)

    await assert.rejects(
      () => resolveProtectedStore({ ...base, person: "../escape" }),
      /invalid --person alias/u,
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive creates owner-only directories and an owner-only database", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const binding = { deskRoot: fixture.deskRoot, person: "rowan", env, platform: process.platform }
    const opened = await withProtectedStore(
      { ...binding, ...LEDGER, schemaSql: "CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY);" },
      (store) => {
        store.db.prepare("INSERT INTO probe (id) VALUES (?)").run("one")
        return store.db.prepare("SELECT COUNT(*) AS total FROM probe").get().total
      },
    )
    assert.equal(opened, 1)

    const { storeDir, dbPath } = await resolveProtectedStore({ ...binding, ...LEDGER })
    assert.equal((await fs.stat(storeDir)).mode & 0o777, 0o700)
    assert.equal((await fs.stat(dbPath)).mode & 0o777, 0o600)
    assert.equal(await fs.readdir(storeDir).then((names) => names.join(",")), "work-measurement.sqlite")
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive refuses a state home inside a Git checkout", async () => {
  const fixture = await mkLedgerFixture()
  try {
    await fs.mkdir(path.join(fixture.stateHome), { recursive: true })
    await fs.mkdir(path.join(fixture.base, ".git"), { recursive: true })
    await assert.rejects(
      () =>
        resolveProtectedStore({
          deskRoot: fixture.deskRoot,
          person: "rowan",
          env: { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome },
          platform: POSIX_PLATFORM,
          ...LEDGER,
        }),
      /desk_work_ledger: refusing to write private work measurement inside the Git checkout/u,
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive refuses to write the private ledger inside the desk workspace", async () => {
  const fixture = await mkLedgerFixture()
  try {
    await assert.rejects(
      () =>
        resolveProtectedStore({
          deskRoot: fixture.deskRoot,
          person: "rowan",
          env: { HOME: fixture.base, XDG_STATE_HOME: path.join(fixture.deskRoot, "state") },
          platform: POSIX_PLATFORM,
          ...LEDGER,
        }),
      /desk_work_ledger: refusing to write private work measurement inside the desk workspace/u,
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive refuses a symlinked path component and a hard-linked database", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const binding = { deskRoot: fixture.deskRoot, person: "rowan", env, platform: POSIX_PLATFORM, ...LEDGER }
    const { storeDir, dbPath } = await resolveProtectedStore(binding)

    const decoy = path.join(fixture.base, "decoy.sqlite")
    await fs.writeFile(decoy, "", { mode: 0o600 })
    await fs.rm(dbPath, { force: true })
    await fs.symlink(decoy, dbPath)
    await assert.rejects(
      () => withProtectedStore({ ...binding, schemaSql: "" }, () => null),
      /desk_work_ledger: private work measurement DB path is a symlink and will not be used/u,
    )

    await fs.rm(dbPath, { force: true })
    await fs.link(decoy, dbPath)
    await assert.rejects(
      () => withProtectedStore({ ...binding, schemaSql: "" }, () => null),
      /desk_work_ledger: private work measurement DB is hard-linked and will not be used/u,
    )

    await fs.rm(dbPath, { force: true })
    await fs.rm(storeDir, { recursive: true, force: true })
    await fs.symlink(fixture.base, storeDir)
    await assert.rejects(
      () => resolveProtectedStore(binding),
      /desk_work_ledger: private work measurement path component is a symlink and will not be used/u,
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive opens the database with DELETE journalling and secure_delete", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const pragmas = await withProtectedStore(
      {
        deskRoot: fixture.deskRoot,
        person: "rowan",
        env,
        platform: process.platform,
        ...LEDGER,
        schemaSql: "CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY);",
      },
      (store) => ({
        journal: store.db.pragma("journal_mode", { simple: true }),
        secureDelete: store.db.pragma("secure_delete", { simple: true }),
      }),
    )
    assert.equal(pragmas.journal, "delete")
    assert.equal(pragmas.secureDelete, 1)

    const { storeDir } = await resolveProtectedStore({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      env,
      platform: process.platform,
      ...LEDGER,
    })
    const sidecars = (await fs.readdir(storeDir)).filter((name) => name.endsWith("-wal"))
    assert.deepEqual(sidecars, [], "a WAL sidecar would leave private rows in a second file")
  } finally {
    await cleanup(fixture.base)
  }
})

test("the primitive closes the database even when the body throws", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const binding = {
      deskRoot: fixture.deskRoot,
      person: "rowan",
      env: { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome },
      platform: process.platform,
      ...LEDGER,
      schemaSql: "CREATE TABLE IF NOT EXISTS probe (id TEXT PRIMARY KEY);",
    }
    let leaked = null
    await assert.rejects(
      () =>
        withProtectedStore(binding, (store) => {
          leaked = store.db
          throw new Error("body failed")
        }),
      /body failed/u,
    )
    assert.equal(leaked.open, false, "the handle must be closed before the error propagates")
  } finally {
    await cleanup(fixture.base)
  }
})

// The extraction regression. Callers already read these sentences; a shared
// primitive that quietly reworded them would be a silent break, and a regex
// with a wildcard in the middle would not notice. These are pinned verbatim.
const FEEDBACK_MESSAGES = {
  gitCheckout: (dir) =>
    `desk_feedback: refusing to write private feedback inside the Git checkout at ${dir}. ` +
    "Point XDG_STATE_HOME at a directory that is not under version control.",
  deskWorkspace: (storeDir) =>
    `desk_feedback: refusing to write private feedback inside the desk workspace: ${storeDir}. ` +
    "The desk workspace is a Git checkout; private feedback must stay out of it.",
  dbSymlink: (dbPath) =>
    `desk_feedback: private feedback DB path is a symlink and will not be used: ${dbPath}`,
  dbHardLink: (dbPath) =>
    `desk_feedback: private feedback DB is hard-linked and will not be used: ${dbPath}`,
  componentSymlink: (dir) =>
    `desk_feedback: private feedback path component is a symlink and will not be used: ${dir}`,
}

test("extraction leaves every desk_feedback protection message byte-for-byte unchanged", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const env = { HOME: fixture.base, XDG_STATE_HOME: fixture.stateHome }
    const binding = { deskRoot: fixture.deskRoot, person: "rowan", env, platform: POSIX_PLATFORM }
    const { storeDir, dbPath } = await resolvePrivateStore(binding)

    const decoy = path.join(fixture.base, "decoy-feedback.sqlite")
    await fs.writeFile(decoy, "", { mode: 0o600 })

    await fs.rm(dbPath, { force: true })
    await fs.symlink(decoy, dbPath)
    await assert.rejects(
      () => withPrivateStore({ ...binding, platform: process.platform }, () => null),
      (error) => {
        assert.equal(error.message, FEEDBACK_MESSAGES.dbSymlink(dbPath))
        return true
      },
    )

    await fs.rm(dbPath, { force: true })
    await fs.link(decoy, dbPath)
    await assert.rejects(
      () => withPrivateStore({ ...binding, platform: process.platform }, () => null),
      (error) => {
        assert.equal(error.message, FEEDBACK_MESSAGES.dbHardLink(dbPath))
        return true
      },
    )

    await fs.rm(dbPath, { force: true })
    await fs.rm(storeDir, { recursive: true, force: true })
    await fs.symlink(fixture.base, storeDir)
    await assert.rejects(
      () => resolvePrivateStore(binding),
      (error) => {
        assert.equal(error.message, FEEDBACK_MESSAGES.componentSymlink(storeDir))
        return true
      },
    )
  } finally {
    await cleanup(fixture.base)
  }
})

test("extraction leaves the desk_feedback Git and workspace refusals byte-for-byte unchanged", async () => {
  const fixture = await mkLedgerFixture()
  try {
    const insideWorkspace = path.join(fixture.deskRoot, "state")
    const realDeskRoot = await fs.realpath(fixture.deskRoot)
    await assert.rejects(
      () =>
        resolvePrivateStore({
          deskRoot: fixture.deskRoot,
          person: "rowan",
          env: { HOME: fixture.base, XDG_STATE_HOME: insideWorkspace },
          platform: POSIX_PLATFORM,
        }),
      (error) => {
        assert.equal(error.message.startsWith("desk_feedback: refusing to write private feedback inside the desk workspace: "), true)
        assert.equal(error.message.endsWith("The desk workspace is a Git checkout; private feedback must stay out of it."), true)
        assert.match(error.message, new RegExp(realDeskRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
        return true
      },
    )

    const gitFixture = await mkLedgerFixture()
    try {
      await fs.mkdir(gitFixture.stateHome, { recursive: true })
      await fs.mkdir(path.join(gitFixture.base, ".git"), { recursive: true })
      const realBase = await fs.realpath(gitFixture.base)
      await assert.rejects(
        () =>
          resolvePrivateStore({
            deskRoot: gitFixture.deskRoot,
            person: "rowan",
            env: { HOME: gitFixture.base, XDG_STATE_HOME: gitFixture.stateHome },
            platform: POSIX_PLATFORM,
          }),
        (error) => {
          assert.equal(error.message, FEEDBACK_MESSAGES.gitCheckout(realBase))
          return true
        },
      )
    } finally {
      await cleanup(gitFixture.base)
    }
  } finally {
    await cleanup(fixture.base)
  }
})
