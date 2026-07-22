// task_archive — happy path moves dir, bumps status to done, idempotent on
// already-archived; refuses if neither source nor archive exists.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import {
  task_create,
  task_archive,
} from "../../src/tools/task.js"
import { mkTempDeskRoot, readFront, exists } from "./_helpers.js"

test("task_archive moves the dir into _archive/ and marks status=done", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "Some task" },
  })
  const result = await task_archive({
    deskRoot: root,
    input: { track: "t", slug: "s" },
  })
  assert.equal(result.status, "archived")

  const srcExists = await exists(path.join(root, "t", "s"))
  assert.equal(srcExists, false, "source dir should be gone")
  const archived = path.join(root, "t", "_archive", "s", "task.md")
  assert.ok(await exists(archived), "archived task.md should exist")

  const { data } = await readFront(archived)
  assert.equal(data.status, "done")
})

test("task_archive preserves an already-terminal status", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: {
      track: "t",
      slug: "s",
      title: "Done already",
      status: "cancelled",
    },
  })
  await task_archive({ deskRoot: root, input: { track: "t", slug: "s" } })
  const { data } = await readFront(
    path.join(root, "t", "_archive", "s", "task.md"),
  )
  assert.equal(data.status, "cancelled", "terminal status preserved")
})

test("task_archive is idempotent when source already archived", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T" },
  })
  await task_archive({ deskRoot: root, input: { track: "t", slug: "s" } })
  const second = await task_archive({
    deskRoot: root,
    input: { track: "t", slug: "s" },
  })
  assert.equal(second.status, "already_archived")
  assert.equal(
    second.path,
    path.join("t", "_archive", "s", "task.md"),
  )
})

test("task_archive throws when neither source nor archive exists", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    () =>
      task_archive({
        deskRoot: root,
        input: { track: "ghost", slug: "phantom" },
      }),
    /does not exist/,
  )
})

test("task_archive refuses an existing archive destination while the source exists", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T" },
  })
  await fs.mkdir(path.join(root, "t", "_archive", "s"), { recursive: true })

  await assert.rejects(
    task_archive({
      deskRoot: root,
      input: { track: "t", slug: "s" },
    }),
    /archive destination already exists/i,
  )
})

test("task_archive requires both task identifiers", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    task_archive({ deskRoot: root }),
    /track.*slug.*required/,
  )
  await assert.rejects(
    task_archive({ deskRoot: root, input: { slug: "s" } }),
    /track.*slug.*required/,
  )
  await assert.rejects(
    task_archive({ deskRoot: root, input: { track: "t" } }),
    /track.*slug.*required/,
  )
})

test("task_archive moves a task directory even when its task card is absent", async () => {
  const root = await mkTempDeskRoot()
  await fs.mkdir(path.join(root, "t", "s"), { recursive: true })

  const result = await task_archive({
    deskRoot: root,
    input: { track: "t", slug: "s" },
  })

  assert.equal(result.status, "archived")
  assert.equal(await exists(path.join(root, "t", "s")), false)
  assert.equal(await exists(path.join(root, "t", "_archive", "s")), true)
})

test("task_archive creates _archive/ dir if missing", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    input: { track: "fresh", slug: "task1", title: "T" },
  })
  // No _archive dir exists yet — the tool must create it.
  await task_archive({
    deskRoot: root,
    input: { track: "fresh", slug: "task1" },
  })
  const stat = await fs.stat(path.join(root, "fresh", "_archive"))
  assert.ok(stat.isDirectory())
})
