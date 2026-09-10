import { test } from "node:test"
import { strict as assert } from "node:assert"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { syncBuiltinESMExports } from "node:module"
import { isPathContained, resolveDeskRootWithSource, resolveWriteTarget } from "../../src/util/paths.js"

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desk-path-coverage-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

test("root resolution with omitted options uses isolated home defaults without provisioning", async (t) => {
  const home = await temporaryRoot(t)
  await fs.mkdir(path.join(home, "desk"))
  const oldDesk = process.env.DESK
  delete process.env.DESK
  t.mock.method(os, "homedir", () => home)
  syncBuiltinESMExports()
  try {
    assert.deepEqual(resolveDeskRootWithSource(), {
      root: path.join(home, "desk"), source: "fallback:desk",
      tried: [
        { source: "fallback:ms-desk", path: path.join(home, "ms-desk") },
        { source: "fallback:desk", path: path.join(home, "desk") },
      ],
    })
  } finally {
    if (oldDesk === undefined) delete process.env.DESK
    else process.env.DESK = oldDesk
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  assert.deepEqual(await fs.readdir(home), ["desk"])
})

test("an omitted person resolves within the existing Desk root without creating the target", async (t) => {
  const deskRoot = await temporaryRoot(t)
  assert.equal(await resolveWriteTarget({ deskRoot, segments: ["planning.md"] }), path.join(deskRoot, "planning.md"))
  assert.deepEqual(await fs.readdir(deskRoot), [])
})

test("write confinement refuses an escaping platform resolution before filesystem work", async (t) => {
  const base = await temporaryRoot(t)
  const deskRoot = path.join(base, "desk")
  await fs.mkdir(deskRoot)
  const outside = path.join(base, "escape")
  const originalResolve = path.resolve
  t.mock.method(path, "resolve", (...parts) => parts.length === 2 && parts[0] === deskRoot && parts[1] === "leaf" ? outside : originalResolve(...parts))
  const stat = t.mock.method(fs, "stat", () => assert.fail("lexical confinement must precede filesystem access"))
  syncBuiltinESMExports()
  try {
    await assert.rejects(resolveWriteTarget({ deskRoot, segments: ["leaf"] }), {
      message: `desk-mcp: write target is outside effective write root: ${outside}`,
    })
    assert.equal(stat.mock.calls.length, 0)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
  assert.deepEqual(await fs.readdir(base), ["desk"])
  assert.deepEqual(await fs.readdir(deskRoot), [])
})

test("target realpath failures other than ENOENT reach the caller unchanged", async (t) => {
  const deskRoot = await temporaryRoot(t)
  const target = path.join(deskRoot, "task.md")
  await fs.writeFile(target, "unchanged\n")
  const failure = Object.assign(new Error("fixture target realpath denied"), { code: "EACCES" })
  const originalRealpath = fs.realpath
  const observed = []
  t.mock.method(fs, "realpath", async (candidate, ...options) => {
    observed.push(candidate)
    if (candidate === target) throw failure
    return originalRealpath(candidate, ...options)
  })
  try {
    await assert.rejects(resolveWriteTarget({ deskRoot, segments: ["task.md"] }), (error) => error === failure)
    assert.deepEqual(observed, [deskRoot, target])
  } finally {
    t.mock.restoreAll()
  }
  assert.equal(await fs.readFile(target, "utf8"), "unchanged\n")
  assert.deepEqual(await fs.readdir(deskRoot), ["task.md"])
})

test("confinement rejects the actual win32 cross-drive relative result on any test host", (t) => {
  const relative = path.win32.relative
  const isAbsolute = path.win32.isAbsolute
  assert.equal(relative("C:\\desk", "D:\\outside"), "D:\\outside")
  t.mock.method(path, "relative", relative)
  t.mock.method(path, "isAbsolute", isAbsolute)
  syncBuiltinESMExports()
  try {
    assert.equal(isPathContained("C:\\desk", "D:\\outside"), false)
  } finally {
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
