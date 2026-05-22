// discover.test.js — fixture desk with mixed content; assert enumeration +
// skip rules + classification.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import * as os from "node:os"
import { promises as fs } from "node:fs"

import { discover, classify, isIndexable } from "../../src/indexer/discover.js"

async function buildFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desk-discover-"))

  async function w(rel, body) {
    const abs = path.join(root, rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, body, "utf8")
  }

  // Indexable shapes.
  await w(
    "trackA/task-1/task.md",
    "---\nstatus: processing\nschema_version: 1\ncreated: 2026-05-01\n---\n# Task 1\n\nbody",
  )
  await w("trackA/task-1/planning.md", "# Planning")
  await w("trackA/task-1/doing.md", "# Doing")
  await w("trackA/task-1/feedback.md", "# Feedback")
  await w("trackB/task-2/task.md", "---\nstatus: done\n---\n# Task 2")
  await w("_meta/friction.md", "# Friction")
  await w("_meta/tips/some-topic.md", "# Tip")
  await w("trackA/_friction/2026-05-01-flaky.md", "# Friction local")

  // Skips.
  await w("trackA/_archive/old-task/task.md", "should be ignored")
  await w("node_modules/foo/task.md", "ignored")
  await w(".state/leftover.md", "ignored")
  await w("trackA/task-1/notes.md", "ignored — not a recognized shape")
  await w("trackA/task-1/task.md.bak", "ignored bak")

  return root
}

test("discover picks up only the indexable shapes", async () => {
  const root = await buildFixture()
  const docs = await discover(root)
  const paths = docs.map((d) => d.path).sort()

  assert.deepEqual(paths, [
    "_meta/friction.md",
    "_meta/tips/some-topic.md",
    "trackA/_friction/2026-05-01-flaky.md",
    "trackA/task-1/doing.md",
    "trackA/task-1/feedback.md",
    "trackA/task-1/planning.md",
    "trackA/task-1/task.md",
    "trackB/task-2/task.md",
  ])
})

test("discover classifies each doc correctly + extracts frontmatter", async () => {
  const root = await buildFixture()
  const docs = await discover(root)
  const byPath = Object.fromEntries(docs.map((d) => [d.path, d]))

  assert.equal(byPath["trackA/task-1/task.md"].kind, "task")
  assert.equal(byPath["trackA/task-1/task.md"].track, "trackA")
  assert.equal(byPath["trackA/task-1/task.md"].task_slug, "task-1")
  assert.equal(byPath["trackA/task-1/task.md"].status, "processing")
  assert.equal(byPath["trackA/task-1/task.md"].schema_version, 1)
  assert.equal(byPath["trackA/task-1/task.md"].created_at, "2026-05-01")

  assert.equal(byPath["trackA/task-1/planning.md"].kind, "planning")
  assert.equal(byPath["trackA/task-1/doing.md"].kind, "doing")
  assert.equal(byPath["trackA/task-1/feedback.md"].kind, "feedback")
  assert.equal(byPath["_meta/friction.md"].kind, "friction")
  assert.equal(byPath["_meta/friction.md"].track, null)
  assert.equal(byPath["_meta/tips/some-topic.md"].kind, "lesson")
  assert.equal(byPath["trackA/_friction/2026-05-01-flaky.md"].kind, "friction")
  assert.equal(byPath["trackA/_friction/2026-05-01-flaky.md"].track, "trackA")
})

test("discover returns hash + mtime for dirty-detection", async () => {
  const root = await buildFixture()
  const docs = await discover(root)
  for (const d of docs) {
    assert.equal(typeof d.hash, "string")
    assert.equal(d.hash.length, 64, "expected sha256 hex digest")
    assert.equal(typeof d.mtime, "number")
    assert.ok(d.mtime > 0)
  }
})

test("isIndexable matches the intended set", () => {
  assert.equal(isIndexable("trackA/task-1/task.md"), true)
  assert.equal(isIndexable("trackA/task-1/planning.md"), true)
  assert.equal(isIndexable("_meta/friction.md"), true)
  assert.equal(isIndexable("_meta/tips/x.md"), true)
  assert.equal(isIndexable("trackA/_friction/foo.md"), true)
  assert.equal(isIndexable("trackA/notes.md"), false)
  assert.equal(isIndexable("trackA/task-1/random.md"), false)
})

test("classify is purely path-driven", () => {
  assert.deepEqual(classify("trackA/slug/task.md"), {
    kind: "task",
    track: "trackA",
    task_slug: "slug",
  })
  assert.deepEqual(classify("_meta/friction.md"), {
    kind: "friction",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("_meta/tips/topic.md"), {
    kind: "lesson",
    track: null,
    task_slug: null,
  })
})
