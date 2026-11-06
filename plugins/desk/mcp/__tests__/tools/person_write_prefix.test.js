// person_write_prefix — Unit 1.2: write-prefix semantics on every write op.
//
// With `person: "ari"`, every write lands under `desks/ari/…` and the returned
// `path` is still relative to <root> (so it reads `desks/ari/…`). With
// `person: null` (or empty / whitespace) the paths are byte-identical to today.
// Path-traversal aliases throw.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { task_create, task_update, task_archive } from "../../src/tools/task.js"
import { track_create, track_update } from "../../src/tools/track.js"
import { friction_add } from "../../src/tools/friction.js"
import { lesson_add } from "../../src/tools/lesson.js"
import { mkTempDeskRoot, readFront, exists } from "./_helpers.js"

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
