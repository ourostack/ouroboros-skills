// discover.test.js — fixture desk with mixed content; assert enumeration +
// skip rules + classification.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import * as os from "node:os"
import { promises as fs } from "node:fs"

import { discover, classify, isIndexable, normalizeDate } from "../../src/indexer/discover.js"

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
  await w("trackA/task-1/notes.txt", "ignored — not markdown")
  await w("trackA/task-1/task.md.bak", "ignored bak")
  try {
    await fs.symlink("trackA/task-1/task.md", path.join(root, "task-link.md"))
  } catch {
    // Some filesystems disallow symlinks; the rest of the fixture remains valid.
  }

  return root
}

test("discover picks up only the indexable shapes", async () => {
  const root = await buildFixture()
  const docs = await discover(root)
  const paths = docs.map((d) => d.path).sort()

  // 1.1: _archive content is included; per-tool search defaults scope it
  // in/out. node_modules/, .state/, .bak files still skipped.
  assert.deepEqual(paths, [
    "_meta/friction.md",
    "_meta/tips/some-topic.md",
    "trackA/_archive/old-task/task.md",
    "trackA/_friction/2026-05-01-flaky.md",
    "trackA/task-1/doing.md",
    "trackA/task-1/feedback.md",
    "trackA/task-1/planning.md",
    "trackA/task-1/task.md",
    "trackB/task-2/task.md",
  ])
})

test("discover returns an empty list for a missing root", async () => {
  const root = path.join(os.tmpdir(), "desk-discover-missing-root")
  assert.deepEqual(await discover(root), [])
})

test("discover surfaces unexpected directory read errors", async (t) => {
  const root = await buildFixture()
  t.mock.method(fs, "readdir", async () => {
    const err = new Error("blocked")
    err.code = "EACCES"
    throw err
  })

  await assert.rejects(
    discover(root),
    (err) => err.code === "EACCES" && err.message === "blocked",
  )
})

test("discover rejects immediately when startup abort signal is already tripped", async () => {
  const root = await buildFixture()
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    discover(root, { signal: controller.signal }),
    (err) => err.name === "AbortError" && err.message === "operation aborted",
  )
})

test("discover propagates aborts tripped while describing a document", async (t) => {
  const root = await buildFixture()
  const controller = new AbortController()
  const readFile = fs.readFile.bind(fs)
  t.mock.method(fs, "readFile", async (...args) => {
    const bytes = await readFile(...args)
    controller.abort()
    return bytes
  })

  await assert.rejects(
    discover(root, { signal: controller.signal }),
    (err) => err.name === "AbortError" && err.message === "operation aborted",
  )
})

test("discover skips documents that become unreadable mid-walk", async (t) => {
  const root = await buildFixture()
  t.mock.method(fs, "readFile", async () => {
    const err = new Error("unreadable")
    err.code = "EACCES"
    throw err
  })

  assert.deepEqual(await discover(root), [])
})

test("discover indexes malformed frontmatter with empty metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desk-discover-malformed-"))
  await fs.mkdir(path.join(root, "trackA", "bad-task"), { recursive: true })
  await fs.writeFile(
    path.join(root, "trackA", "bad-task", "task.md"),
    "---\n[\n---\nbody after malformed frontmatter",
    "utf8",
  )

  const docs = await discover(root)
  assert.equal(docs.length, 1)
  assert.equal(docs[0].status, null)
  assert.equal(docs[0].schema_version, 0)
  assert.equal(docs[0].body, "---\n[\n---\nbody after malformed frontmatter")
})

test("discover flags _archive docs with is_archived=true", async () => {
  const root = await buildFixture()
  const docs = await discover(root)
  const byPath = Object.fromEntries(docs.map((d) => [d.path, d]))

  // _archive content is flagged
  assert.equal(byPath["trackA/_archive/old-task/task.md"].is_archived, true)

  // Active content is not
  assert.equal(byPath["trackA/task-1/task.md"].is_archived, false)
  assert.equal(byPath["_meta/friction.md"].is_archived, false)
  assert.equal(byPath["trackA/_friction/2026-05-01-flaky.md"].is_archived, false)
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
  assert.equal(isIndexable("trackA/_archive/old-note.md"), true)
  assert.equal(isIndexable("trackA/_archive/old-note.txt"), false)
  assert.equal(isIndexable("_meta/friction.md"), true)
  assert.equal(isIndexable("_meta/friction.txt"), false)
  assert.equal(isIndexable("_meta/tips/x.md"), true)
  assert.equal(isIndexable("tips/x.md"), false)
  assert.equal(isIndexable("trackA/tips/x.md"), false)
  assert.equal(isIndexable("trackA/_friction/foo.md"), true)
  assert.equal(isIndexable("trackA/_friction/foo.txt"), false)
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
  assert.deepEqual(classify("_meta/friction.md"), {
    kind: "friction",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("trackA/_friction/local.md"), {
    kind: "friction",
    track: "trackA",
    task_slug: null,
  })
  assert.deepEqual(classify("_shared/landscape/glossary.md"), {
    kind: "shared",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("task.md"), {
    kind: "task",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("trackA/_archive/2026-01-planning-old.md"), {
    kind: "planning",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("trackA/_archive/doing-old.md"), {
    kind: "doing",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("trackA/_archive/feedback-old.md"), {
    kind: "feedback",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("trackA/_archive/old-note.md"), {
    kind: "archive",
    track: null,
    task_slug: null,
  })
  assert.deepEqual(classify("misc/notes.md"), {
    kind: "other",
    track: null,
    task_slug: null,
  })
})

test("normalizeDate preserves strings and normalizes Date or scalar values", () => {
  assert.equal(normalizeDate(null), null)
  assert.equal(normalizeDate(new Date("2026-06-15T00:00:00.000Z")), "2026-06-15")
  assert.equal(
    normalizeDate(new Date("2026-06-15T12:34:56.000Z")),
    "2026-06-15T12:34:56.000Z",
  )
  assert.equal(normalizeDate("already-text"), "already-text")
  assert.equal(normalizeDate(123), "123")
})
