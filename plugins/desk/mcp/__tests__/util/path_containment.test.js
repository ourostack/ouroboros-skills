import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as paths from "../../src/util/paths.js"

async function makeRoot(prefix = "desk-containment-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function resolveWriteTarget(options) {
  return paths.resolveWriteTarget(options)
}

function containmentError() {
  return /write path|write target|outside|symlink|confined/i
}

test("resolveWriteTarget resolves a workspace target beneath the desk root", async () => {
  const root = await makeRoot()
  const target = await resolveWriteTarget({
    deskRoot: root,
    person: null,
    segments: ["track", "task", "task.md"],
  })
  assert.equal(target, path.join(root, "track", "task", "task.md"))
})

test("resolveWriteTarget creates and resolves a missing person root safely", async () => {
  const root = await makeRoot()
  const target = await resolveWriteTarget({
    deskRoot: root,
    person: "ari",
    segments: ["track", "task.md"],
  })
  assert.equal(target, path.join(root, "desks", "ari", "track", "task.md"))
  assert.equal((await fs.stat(path.join(root, "desks", "ari"))).isDirectory(), true)
})

test("resolveWriteTarget rejects a missing segment list", async () => {
  const root = await makeRoot()
  await assert.rejects(
    resolveWriteTarget({ deskRoot: root, person: "ari" }),
    /requires at least one path segment/i,
  )
  await assert.rejects(
    resolveWriteTarget({ deskRoot: root, person: "ari", segments: [] }),
    /requires at least one path segment/i,
  )
})

const hostileSegments = [
  ["null", null],
  ["non-string", 42],
  ["empty", ""],
  ["whitespace-only", " \t "],
  ["single-dot", "."],
  ["double-dot", ".."],
  ["absolute", path.join(path.sep, "tmp", "outside")],
  ["forward-slash", "safe/child"],
  ["backslash", "safe\\child"],
  ["nested-forward-traversal", "safe/../../outside"],
  ["nested-backslash-traversal", "safe\\..\\..\\outside"],
  ["embedded-double-dot", "safe..outside"],
]

for (const [name, segment] of hostileSegments) {
  test(`resolveWriteTarget rejects a ${name} segment`, async () => {
    const root = await makeRoot()
    await assert.rejects(
      resolveWriteTarget({
        deskRoot: root,
        person: "ari",
        segments: ["track", segment, "task.md"],
      }),
      containmentError(),
    )
  })
}

test("resolveWriteTarget rejects an effective person root symlinked outside the desk", async () => {
  const root = await makeRoot()
  const outside = await makeRoot("desk-outside-")
  await fs.mkdir(path.join(root, "desks"), { recursive: true })
  await fs.symlink(outside, path.join(root, "desks", "ari"))

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget rejects an effective person root component that is not a directory", async () => {
  const root = await makeRoot()
  await fs.mkdir(path.join(root, "desks"), { recursive: true })
  await fs.writeFile(path.join(root, "desks", "ari"), "not a directory", "utf8")

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task.md"],
    }),
    /not a directory/i,
  )
})

test("resolveWriteTarget rejects a desk root that is not a directory", async () => {
  const parent = await makeRoot()
  const root = path.join(parent, "desk-file")
  await fs.writeFile(root, "not a directory", "utf8")

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: null,
      segments: ["track.md"],
    }),
    /desk root is not a directory/i,
  )
})

test("resolveWriteTarget rejects an intermediate person-path symlink outside the effective root", async () => {
  const root = await makeRoot()
  const outside = await makeRoot("desk-outside-")
  await fs.mkdir(path.join(root, "desks", "ari"), { recursive: true })
  await fs.symlink(outside, path.join(root, "desks", "ari", "track"))

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget rejects an intermediate workspace-path symlink outside the desk root", async () => {
  const root = await makeRoot()
  const outside = await makeRoot("desk-outside-")
  await fs.symlink(outside, path.join(root, "track"))

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: null,
      segments: ["track", "task", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget rejects an existing final target symlinked outside the effective root", async () => {
  const root = await makeRoot()
  const outside = await makeRoot("desk-outside-")
  const outsideFile = path.join(outside, "task.md")
  await fs.writeFile(outsideFile, "outside", "utf8")
  const targetDir = path.join(root, "desks", "ari", "track", "task")
  await fs.mkdir(targetDir, { recursive: true })
  await fs.symlink(outsideFile, path.join(targetDir, "task.md"))

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget rejects a broken final symlink", async () => {
  const root = await makeRoot()
  const outside = await makeRoot("desk-outside-")
  const targetDir = path.join(root, "desks", "ari", "track", "task")
  await fs.mkdir(targetDir, { recursive: true })
  await fs.symlink(
    path.join(outside, "missing-task.md"),
    path.join(targetDir, "task.md"),
  )

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget permits an existing symlink that remains inside the effective root", async () => {
  const root = await makeRoot()
  const personRoot = path.join(root, "desks", "ari")
  const realTrack = path.join(personRoot, "real-track")
  await fs.mkdir(realTrack, { recursive: true })
  await fs.symlink(realTrack, path.join(personRoot, "track"))

  const target = await resolveWriteTarget({
    deskRoot: root,
    person: "ari",
    segments: ["track", "task.md"],
  })
  assert.equal(target, path.join(personRoot, "track", "task.md"))
})

test("resolveWriteTarget treats the effective root itself as contained", async () => {
  const root = await makeRoot()
  const personRoot = path.join(root, "desks", "ari")
  await fs.mkdir(personRoot, { recursive: true })
  await fs.symlink(personRoot, path.join(personRoot, "track"))

  const target = await resolveWriteTarget({
    deskRoot: root,
    person: "ari",
    segments: ["track", "task.md"],
  })
  assert.equal(target, path.join(personRoot, "track", "task.md"))
})

test("resolveWriteTarget rejects a symlink to the effective root parent", async () => {
  const root = await makeRoot()
  const personRoot = path.join(root, "desks", "ari")
  await fs.mkdir(personRoot, { recursive: true })
  await fs.symlink(path.dirname(personRoot), path.join(personRoot, "track"))

  await assert.rejects(
    resolveWriteTarget({
      deskRoot: root,
      person: "ari",
      segments: ["track", "task.md"],
    }),
    containmentError(),
  )
})

test("resolveWriteTarget propagates non-missing filesystem errors", async () => {
  const root = await makeRoot()
  const blocked = path.join(root, "blocked")
  await fs.mkdir(blocked)
  await fs.chmod(blocked, 0o000)

  try {
    await assert.rejects(
      resolveWriteTarget({
        deskRoot: root,
        person: null,
        segments: ["blocked", "task.md"],
      }),
      (error) => error?.code === "EACCES",
    )
  } finally {
    await fs.chmod(blocked, 0o700)
  }
})
