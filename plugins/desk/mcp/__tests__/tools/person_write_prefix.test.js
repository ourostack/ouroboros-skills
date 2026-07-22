// person_write_prefix — Unit 1.2: write-prefix semantics on every write op.
//
// With `person: "ari"`, every write lands under `desks/ari/…` and the returned
// `path` is still relative to <root> (so it reads `desks/ari/…`). With
// `person: null` (or empty / whitespace) the paths are byte-identical to today.
// Path-traversal aliases throw.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { task_create, task_update, task_archive } from "../../src/tools/task.js"
import { track_create, track_update } from "../../src/tools/track.js"
import { friction_add } from "../../src/tools/friction.js"
import { lesson_add } from "../../src/tools/lesson.js"
import { mkTempDeskRoot, readFront, exists } from "./_helpers.js"

async function makeOutside() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-write-outside-"))
}

function containmentError() {
  return /write path|write target|outside|symlink|confined/i
}

function invalidSegmentError() {
  return /invalid write path segment/i
}

// ── task_create ───────────────────────────────────────────────────────────────

test("task_create person:ari → desks/ari/<track>/<slug>/task.md", async () => {
  const root = await mkTempDeskRoot()
  const res = await task_create({
    deskRoot: root,
    person: "ari",
    input: { track: "europe-trip", slug: "book-flights", title: "T" },
  })
  assert.equal(res.status, "created")
  assert.equal(
    res.path,
    path.join("desks", "ari", "europe-trip", "book-flights", "task.md"),
  )
  assert.ok(
    await exists(path.join(root, "desks", "ari", "europe-trip", "book-flights", "task.md")),
    "task.md should land under desks/ari/",
  )
  // Nothing leaks to the top-level (non-person) location.
  assert.equal(
    await exists(path.join(root, "europe-trip", "book-flights", "task.md")),
    false,
  )
})

test("task_create person:null → byte-identical top-level path (OFF)", async () => {
  const root = await mkTempDeskRoot()
  const res = await task_create({
    deskRoot: root,
    person: null,
    input: { track: "europe-trip", slug: "book-flights", title: "T" },
  })
  assert.equal(res.path, path.join("europe-trip", "book-flights", "task.md"))
  assert.ok(await exists(path.join(root, "europe-trip", "book-flights", "task.md")))
  assert.equal(await exists(path.join(root, "desks")), false, "no desks/ dir when OFF")
})

test("task_create omitted person behaves exactly like person:null", async () => {
  const root = await mkTempDeskRoot()
  const res = await task_create({
    deskRoot: root,
    input: { track: "t", slug: "s", title: "T" },
  })
  assert.equal(res.path, path.join("t", "s", "task.md"))
})

// ── task_update (same builder → must resolve to the person path) ──────────────

test("task_update under person:ari finds + rewrites the person-scoped task", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s", title: "T" },
  })
  const res = await task_update({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s", frontmatter: { status: "doing" } },
  })
  assert.equal(res.status, "updated")
  assert.equal(res.path, path.join("desks", "ari", "t", "s", "task.md"))
  const { data } = await readFront(path.join(root, "desks", "ari", "t", "s", "task.md"))
  assert.equal(data.status, "doing")
})

// ── task_archive ──────────────────────────────────────────────────────────────

test("task_archive person:ari → desks/ari/<track>/_archive/<slug>/", async () => {
  const root = await mkTempDeskRoot()
  await task_create({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s", title: "T" },
  })
  const res = await task_archive({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s" },
  })
  assert.equal(res.status, "archived")
  assert.equal(
    res.path,
    path.join("desks", "ari", "t", "_archive", "s", "task.md"),
  )
  assert.ok(
    await exists(path.join(root, "desks", "ari", "t", "_archive", "s", "task.md")),
  )
})

// ── track_create + track_update ───────────────────────────────────────────────

test("track_create person:ari → desks/ari/<slug>/track.md", async () => {
  const root = await mkTempDeskRoot()
  const res = await track_create({
    deskRoot: root,
    person: "ari",
    input: { slug: "europe-trip", title: "Europe" },
  })
  assert.equal(res.path, path.join("desks", "ari", "europe-trip", "track.md"))
  assert.ok(await exists(path.join(root, "desks", "ari", "europe-trip", "track.md")))
})

test("track_create person:null → byte-identical top-level (OFF)", async () => {
  const root = await mkTempDeskRoot()
  const res = await track_create({
    deskRoot: root,
    input: { slug: "europe-trip", title: "Europe" },
  })
  assert.equal(res.path, path.join("europe-trip", "track.md"))
})

test("track_update under person:ari rewrites the person-scoped track", async () => {
  const root = await mkTempDeskRoot()
  await track_create({
    deskRoot: root,
    person: "ari",
    input: { slug: "europe-trip", title: "Europe" },
  })
  const res = await track_update({
    deskRoot: root,
    person: "ari",
    input: { slug: "europe-trip", frontmatter: { status: "paused" } },
  })
  assert.equal(res.path, path.join("desks", "ari", "europe-trip", "track.md"))
})

// ── friction_add — both branches ──────────────────────────────────────────────

test("friction_add track-local person:ari → desks/ari/<track>/_friction/...", async () => {
  const root = await mkTempDeskRoot()
  const res = await friction_add({
    deskRoot: root,
    person: "ari",
    input: { track: "t", theme: "slow-build", body: "x" },
  })
  assert.equal(res.status, "added")
  const segs = res.path.split(path.sep)
  assert.equal(segs[0], "desks")
  assert.equal(segs[1], "ari")
  assert.equal(segs[2], "t")
  assert.equal(segs[3], "_friction")
  assert.ok(segs[4].endsWith("slow-build.md"))
  assert.ok(await exists(path.join(root, res.path)))
})

test("friction_add cross-cutting person:ari → desks/ari/_meta/friction.md", async () => {
  const root = await mkTempDeskRoot()
  const res = await friction_add({
    deskRoot: root,
    person: "ari",
    input: { body: "cross-cutting pain" },
  })
  assert.equal(res.path, path.join("desks", "ari", "_meta", "friction.md"))
  assert.ok(await exists(path.join(root, "desks", "ari", "_meta", "friction.md")))
})

test("friction_add omission-compatible track values stay cross-cutting inside the person root", async () => {
  for (const track of [null, "", undefined, 42]) {
    const root = await mkTempDeskRoot()
    const res = await friction_add({
      deskRoot: root,
      person: "ari",
      input: { track, body: "cross-cutting pain" },
    })
    assert.equal(res.path, path.join("desks", "ari", "_meta", "friction.md"))
    assert.ok(await exists(path.join(root, res.path)))
  }
})

test("friction_add cross-cutting person:null → byte-identical _meta/friction.md (OFF)", async () => {
  const root = await mkTempDeskRoot()
  const res = await friction_add({
    deskRoot: root,
    input: { body: "cross-cutting pain" },
  })
  assert.equal(res.path, path.join("_meta", "friction.md"))
})

// ── lesson_add ────────────────────────────────────────────────────────────────

test("lesson_add person:ari → desks/ari/_meta/tips/<topic>.md", async () => {
  const root = await mkTempDeskRoot()
  const res = await lesson_add({
    deskRoot: root,
    person: "ari",
    input: { topic: "EMU push auth", body: "use the personal token" },
  })
  assert.equal(res.path, path.join("desks", "ari", "_meta", "tips", "emu-push-auth.md"))
  assert.ok(await exists(path.join(root, "desks", "ari", "_meta", "tips", "emu-push-auth.md")))
})

test("lesson_add person:null → byte-identical _meta/tips/<topic>.md (OFF)", async () => {
  const root = await mkTempDeskRoot()
  const res = await lesson_add({
    deskRoot: root,
    input: { topic: "EMU push auth", body: "x" },
  })
  assert.equal(res.path, path.join("_meta", "tips", "emu-push-auth.md"))
})

// ── empty / whitespace person → OFF (treated as null) ─────────────────────────

test("empty-string person is OFF (top-level path)", async () => {
  const root = await mkTempDeskRoot()
  const res = await task_create({
    deskRoot: root,
    person: "",
    input: { track: "t", slug: "s", title: "T" },
  })
  assert.equal(res.path, path.join("t", "s", "task.md"))
})

test("whitespace-only person is OFF (top-level path)", async () => {
  const root = await mkTempDeskRoot()
  const res = await task_create({
    deskRoot: root,
    person: "   ",
    input: { track: "t", slug: "s", title: "T" },
  })
  assert.equal(res.path, path.join("t", "s", "task.md"))
})

// ── alias safety: path-traversal rejected across every write op ───────────────

test("task_create rejects a path-traversal alias", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    task_create({
      deskRoot: root,
      person: "../evil",
      input: { track: "t", slug: "s", title: "T" },
    }),
    /alias/i,
  )
})

test("track_create rejects a slash in the alias", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    track_create({ deskRoot: root, person: "a/b", input: { slug: "s", title: "T" } }),
    /alias/i,
  )
})

test("friction_add rejects a path-traversal alias", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    friction_add({ deskRoot: root, person: "..", input: { body: "x" } }),
    /alias/i,
  )
})

test("lesson_add rejects a backslash in the alias", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    lesson_add({ deskRoot: root, person: "a\\b", input: { topic: "x", body: "y" } }),
    /alias/i,
  )
})

test("task_archive rejects a path-traversal alias", async () => {
  const root = await mkTempDeskRoot()
  await assert.rejects(
    task_archive({ deskRoot: root, person: "../evil", input: { track: "t", slug: "s" } }),
    /alias/i,
  )
})

// ── caller-controlled path segments ──────────────────────────────────────────

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

const segmentCallSites = [
  {
    name: "task_create track",
    invoke: (root, value) =>
      task_create({
        deskRoot: root,
        person: "ari",
        input: { track: value, slug: "task", title: "T" },
      }),
  },
  {
    name: "task_create slug",
    invoke: (root, value) =>
      task_create({
        deskRoot: root,
        person: "ari",
        input: { track: "track", slug: value, title: "T" },
      }),
  },
  {
    name: "task_update track",
    invoke: (root, value) =>
      task_update({
        deskRoot: root,
        person: "ari",
        input: { track: value, slug: "task" },
      }),
  },
  {
    name: "task_update slug",
    invoke: (root, value) =>
      task_update({
        deskRoot: root,
        person: "ari",
        input: { track: "track", slug: value },
      }),
  },
  {
    name: "task_archive track",
    invoke: (root, value) =>
      task_archive({
        deskRoot: root,
        person: "ari",
        input: { track: value, slug: "task" },
      }),
  },
  {
    name: "task_archive slug",
    invoke: (root, value) =>
      task_archive({
        deskRoot: root,
        person: "ari",
        input: { track: "track", slug: value },
      }),
  },
  {
    name: "track_create slug",
    invoke: (root, value) =>
      track_create({
        deskRoot: root,
        person: "ari",
        input: { slug: value, title: "T" },
      }),
  },
  {
    name: "track_update slug",
    invoke: (root, value) =>
      track_update({
        deskRoot: root,
        person: "ari",
        input: { slug: value },
      }),
  },
  {
    name: "friction_add track",
    segments: hostileSegments.filter(
      ([kind]) => !["null", "non-string", "empty"].includes(kind),
    ),
    invoke: (root, value) =>
      friction_add({
        deskRoot: root,
        person: "ari",
        input: { track: value, theme: "theme", body: "x" },
      }),
  },
]

for (const callSite of segmentCallSites) {
  for (const [kind, value] of callSite.segments ?? hostileSegments) {
    test(`${callSite.name} rejects a ${kind} caller-controlled segment`, async () => {
      const root = await mkTempDeskRoot()
      await assert.rejects(callSite.invoke(root, value), invalidSegmentError())
    })
  }
}

// ── static symlink confinement on every mutation ─────────────────────────────

test("task_create rejects a broken final task.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  const outsideFile = path.join(outside, "created.md")
  await fs.mkdir(taskDir, { recursive: true })
  await fs.symlink(outsideFile, path.join(taskDir, "task.md"))

  await assert.rejects(
    task_create({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s", title: "T" },
    }),
    containmentError(),
  )
  assert.equal(await exists(outsideFile), false)
})

test("task_update rejects an existing final task.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  const outsideFile = path.join(outside, "task.md")
  const original = "---\ntitle: Outside\nstatus: drafting\n---\n\nuntouched\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(outsideFile, original, "utf8")
  await fs.symlink(outsideFile, path.join(taskDir, "task.md"))

  await assert.rejects(
    task_update({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s", frontmatter: { status: "done" } },
    }),
    containmentError(),
  )
  assert.equal(await fs.readFile(outsideFile, "utf8"), original)
})

test("track_create rejects a broken final track.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const trackDir = path.join(root, "desks", "ari", "t")
  const outsideFile = path.join(outside, "created.md")
  await fs.mkdir(trackDir, { recursive: true })
  await fs.symlink(outsideFile, path.join(trackDir, "track.md"))

  await assert.rejects(
    track_create({
      deskRoot: root,
      person: "ari",
      input: { slug: "t", title: "T" },
    }),
    containmentError(),
  )
  assert.equal(await exists(outsideFile), false)
})

test("track_update rejects an existing final track.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const trackDir = path.join(root, "desks", "ari", "t")
  const outsideFile = path.join(outside, "track.md")
  const original = "---\ntitle: Outside\nstatus: active\n---\n\nuntouched\n"
  await fs.mkdir(trackDir, { recursive: true })
  await fs.writeFile(outsideFile, original, "utf8")
  await fs.symlink(outsideFile, path.join(trackDir, "track.md"))

  await assert.rejects(
    track_update({
      deskRoot: root,
      person: "ari",
      input: { slug: "t", frontmatter: { status: "paused" } },
    }),
    containmentError(),
  )
  assert.equal(await fs.readFile(outsideFile, "utf8"), original)
})

test("friction_add rejects an intermediate _meta symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const personRoot = path.join(root, "desks", "ari")
  await fs.mkdir(personRoot, { recursive: true })
  await fs.symlink(outside, path.join(personRoot, "_meta"))

  await assert.rejects(
    friction_add({
      deskRoot: root,
      person: "ari",
      input: { body: "must stay confined" },
    }),
    containmentError(),
  )
  assert.equal(await exists(path.join(outside, "friction.md")), false)
})

test("lesson_add rejects an intermediate tips symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const metaDir = path.join(root, "desks", "ari", "_meta")
  await fs.mkdir(metaDir, { recursive: true })
  await fs.symlink(outside, path.join(metaDir, "tips"))

  await assert.rejects(
    lesson_add({
      deskRoot: root,
      person: "ari",
      input: { topic: "topic", body: "must stay confined" },
    }),
    containmentError(),
  )
  assert.equal(await exists(path.join(outside, "topic.md")), false)
})

test("task_archive rejects a source directory symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const trackDir = path.join(root, "desks", "ari", "t")
  const original = "---\ntitle: Outside\nstatus: drafting\n---\n\nuntouched\n"
  await fs.mkdir(trackDir, { recursive: true })
  await fs.writeFile(path.join(outside, "task.md"), original, "utf8")
  await fs.symlink(outside, path.join(trackDir, "s"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
  assert.equal(await fs.readFile(path.join(outside, "task.md"), "utf8"), original)
})

test("task_archive rejects a source task.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  const outsideFile = path.join(outside, "task.md")
  const original = "---\ntitle: Outside\nstatus: drafting\n---\n\nuntouched\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(outsideFile, original, "utf8")
  await fs.symlink(outsideFile, path.join(taskDir, "task.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
  assert.equal(await fs.readFile(outsideFile, "utf8"), original)
})

test("task_archive rejects a destination directory symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const archiveParent = path.join(root, "desks", "ari", "t", "_archive")
  await fs.mkdir(archiveParent, { recursive: true })
  await fs.symlink(outside, path.join(archiveParent, "s"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
})

test("task_archive rejects a destination task.md symlink outside the person root", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  const archiveDir = path.join(root, "desks", "ari", "t", "_archive", "s")
  const outsideFile = path.join(outside, "task.md")
  await fs.mkdir(archiveDir, { recursive: true })
  await fs.writeFile(outsideFile, "untouched", "utf8")
  await fs.symlink(outsideFile, path.join(archiveDir, "task.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
  assert.equal(await fs.readFile(outsideFile, "utf8"), "untouched")
})

test("task_archive rejects an _archive parent symlink before rename", async () => {
  const root = await mkTempDeskRoot()
  const outside = await makeOutside()
  await task_create({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s", title: "T" },
  })
  const trackDir = path.join(root, "desks", "ari", "t")
  await fs.symlink(outside, path.join(trackDir, "_archive"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
  assert.equal(await exists(path.join(outside, "s")), false)
})

test("task_archive rejects a relocation-sensitive task.md symlink before rename", async () => {
  const root = await mkTempDeskRoot()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  const sourceTarget = path.join(root, "desks", "ari", "t", "target.md")
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(
    sourceTarget,
    "---\ntitle: Safe before move\nstatus: drafting\n---\n\nuntouched\n",
    "utf8",
  )
  await fs.symlink("../target.md", path.join(taskDir, "task.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    containmentError(),
  )
  assert.equal(
    await fs.readFile(sourceTarget, "utf8"),
    "---\ntitle: Safe before move\nstatus: drafting\n---\n\nuntouched\n",
  )
  assert.equal(await exists(taskDir), true)
  assert.equal(
    await exists(path.join(root, "desks", "ari", "t", "_archive", "s")),
    false,
  )
})

test("task_archive cannot retarget a relative task.md symlink to another internal card", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const taskDir = path.join(trackDir, "s")
  const sourceTarget = path.join(trackDir, "target.md")
  const relocatedTarget = path.join(trackDir, "_archive", "target.md")
  const sourceContent = "---\ntitle: Source\nstatus: drafting\n---\n\nsource\n"
  const relocatedContent = "---\ntitle: Wrong target\nstatus: drafting\n---\n\nwrong\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.mkdir(path.dirname(relocatedTarget), { recursive: true })
  await fs.writeFile(sourceTarget, sourceContent, "utf8")
  await fs.writeFile(relocatedTarget, relocatedContent, "utf8")
  await fs.symlink("../target.md", path.join(taskDir, "task.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /symlink would change referent/i,
  )

  assert.equal(await fs.readFile(sourceTarget, "utf8"), sourceContent)
  assert.equal(await fs.readFile(relocatedTarget, "utf8"), relocatedContent)
  assert.equal(await exists(taskDir), true)
  assert.equal(await exists(path.join(trackDir, "_archive", "s")), false)
})

test("task_archive preserves a relative task.md symlink whose target moves with the task", async () => {
  const root = await mkTempDeskRoot()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(
    path.join(taskDir, "card.md"),
    "---\ntitle: Internal card\nstatus: drafting\n---\n\nbody\n",
    "utf8",
  )
  await fs.symlink("card.md", path.join(taskDir, "task.md"))

  const result = await task_archive({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s" },
  })

  assert.equal(result.status, "archived")
  const archivedDir = path.join(root, "desks", "ari", "t", "_archive", "s")
  assert.equal(await fs.readlink(path.join(archivedDir, "task.md")), "card.md")
  assert.equal((await readFront(path.join(archivedDir, "card.md"))).data.status, "done")
})

test("task_archive preserves a stable nested symlink chain that moves with the task", async () => {
  const root = await mkTempDeskRoot()
  const taskDir = path.join(root, "desks", "ari", "t", "s")
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(
    path.join(taskDir, "card.md"),
    "---\ntitle: Internal card\nstatus: drafting\n---\n\nbody\n",
    "utf8",
  )
  await fs.symlink("card.md", path.join(taskDir, "card-link.md"))
  await fs.symlink("card-link.md", path.join(taskDir, "task.md"))

  const result = await task_archive({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s" },
  })

  assert.equal(result.status, "archived")
  const archivedDir = path.join(root, "desks", "ari", "t", "_archive", "s")
  assert.equal(await fs.readlink(path.join(archivedDir, "task.md")), "card-link.md")
  assert.equal(await fs.readlink(path.join(archivedDir, "card-link.md")), "card.md")
  assert.equal((await readFront(path.join(archivedDir, "card.md"))).data.status, "done")
})

test("task_archive preserves a stable absolute task.md symlink within the person root", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const taskDir = path.join(trackDir, "s")
  const sharedCard = path.join(trackDir, "shared.md")
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(
    sharedCard,
    "---\ntitle: Shared card\nstatus: drafting\n---\n\nbody\n",
    "utf8",
  )
  await fs.symlink(sharedCard, path.join(taskDir, "task.md"))

  const result = await task_archive({
    deskRoot: root,
    person: "ari",
    input: { track: "t", slug: "s" },
  })

  assert.equal(result.status, "archived")
  const archivedTask = path.join(trackDir, "_archive", "s", "task.md")
  assert.equal(await fs.readlink(archivedTask), sharedCard)
  assert.equal((await readFront(sharedCard)).data.status, "done")
})

test("task_archive rejects a nested symlink chain that retargets after relocation", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const taskDir = path.join(trackDir, "s")
  const sourceTarget = path.join(trackDir, "target.md")
  const relocatedTarget = path.join(trackDir, "_archive", "target.md")
  const sourceContent = "---\ntitle: Source\nstatus: drafting\n---\n\nsource\n"
  const relocatedContent = "---\ntitle: Wrong target\nstatus: drafting\n---\n\nwrong\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.mkdir(path.dirname(relocatedTarget), { recursive: true })
  await fs.writeFile(sourceTarget, sourceContent, "utf8")
  await fs.writeFile(relocatedTarget, relocatedContent, "utf8")
  await fs.symlink("../target.md", path.join(taskDir, "card.md"))
  await fs.symlink("card.md", path.join(taskDir, "task.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /symlink would change referent/i,
  )

  assert.equal(await fs.readFile(sourceTarget, "utf8"), sourceContent)
  assert.equal(await fs.readFile(relocatedTarget, "utf8"), relocatedContent)
  assert.equal(await exists(taskDir), true)
  assert.equal(await exists(path.join(trackDir, "_archive", "s")), false)
})

test("task_archive rejects a post-relocation symlink cycle before rename", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const taskDir = path.join(trackDir, "s")
  const archiveParent = path.join(trackDir, "_archive")
  const sourceTarget = path.join(trackDir, "target.md")
  const sourceContent = "---\ntitle: Source\nstatus: drafting\n---\n\nsource\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.mkdir(archiveParent, { recursive: true })
  await fs.writeFile(sourceTarget, sourceContent, "utf8")
  await fs.symlink("../target.md", path.join(taskDir, "card.md"))
  await fs.symlink("card.md", path.join(taskDir, "task.md"))
  await fs.symlink(path.join("s", "task.md"), path.join(archiveParent, "target.md"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /symlink would change referent/i,
  )

  assert.equal(await fs.readFile(sourceTarget, "utf8"), sourceContent)
  assert.equal(await exists(taskDir), true)
  assert.equal(await exists(path.join(archiveParent, "s")), false)
})

test("task_archive canonicalizes a symlinked track ancestor before relocation checks", async () => {
  const root = await mkTempDeskRoot()
  const personRoot = path.join(root, "desks", "ari")
  const realTrack = path.join(personRoot, "real-track")
  const taskDir = path.join(realTrack, "s")
  const cardPath = path.join(taskDir, "card.md")
  const original = "---\ntitle: Internal card\nstatus: drafting\n---\n\nbody\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(cardPath, original, "utf8")
  await fs.symlink(cardPath, path.join(taskDir, "task.md"))
  await fs.symlink("real-track", path.join(personRoot, "t"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /symlink would change referent/i,
  )

  assert.equal(await fs.readFile(cardPath, "utf8"), original)
  assert.equal(await exists(taskDir), true)
  assert.equal(await exists(path.join(realTrack, "_archive", "s")), false)
})

test("task_archive rejects an archive destination nested inside the source directory", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const taskDir = path.join(trackDir, "s")
  const cardPath = path.join(taskDir, "card.md")
  const original = "---\ntitle: Internal card\nstatus: drafting\n---\n\nbody\n"
  await fs.mkdir(taskDir, { recursive: true })
  await fs.writeFile(cardPath, original, "utf8")
  await fs.symlink("card.md", path.join(taskDir, "task.md"))
  await fs.symlink("s", path.join(trackDir, "_archive"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /archive destination cannot be inside source directory/i,
  )

  assert.equal(await fs.readFile(cardPath, "utf8"), original)
  assert.equal(await exists(taskDir), true)
})

test("task_archive rejects an internal source-directory symlink before rename", async () => {
  const root = await mkTempDeskRoot()
  const trackDir = path.join(root, "desks", "ari", "t")
  const realTask = path.join(trackDir, "real-task")
  await fs.mkdir(realTask, { recursive: true })
  await fs.writeFile(
    path.join(realTask, "task.md"),
    "---\ntitle: Internal card\nstatus: drafting\n---\n\nbody\n",
    "utf8",
  )
  await fs.symlink("real-task", path.join(trackDir, "s"))

  await assert.rejects(
    task_archive({
      deskRoot: root,
      person: "ari",
      input: { track: "t", slug: "s" },
    }),
    /source directory symlink/i,
  )

  assert.equal(await exists(path.join(trackDir, "s")), true)
  assert.equal(await exists(path.join(trackDir, "_archive", "s")), false)
})
