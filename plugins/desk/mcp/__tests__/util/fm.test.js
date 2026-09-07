import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  legacySlugify,
  readMarkdown,
  serializeMarkdown,
  slugify,
  today,
} from "../../src/util/fm.js"
import { friction_add } from "../../src/tools/friction.js"
import { lesson_add } from "../../src/tools/lesson.js"
import { mkTempDeskRoot } from "../tools/_helpers.js"

test("vendored Unicode 16 category tables match their pinned source", async () => {
  const root = fileURLToPath(new URL("../../src/util/unicode-16/", import.meta.url))
  const expected = {
    "letter.cjs": "57b42eb5efb05e70fd7378a7998cd4502516ecffaa6ab1119255e45a49077ad4",
    "mark.cjs": "bcd99fa2bda1cc7b38be4a6d3f4713c96701bb42bfd7066b91d305e11eb3b48d",
    "number.cjs": "c9ed76f5842d76210411b7e46162a7b3c4b47196469d5c014a887bba762263f2",
  }

  for (const [file, hash] of Object.entries(expected)) {
    const bytes = await fs.readFile(path.join(root, file))
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash)
  }
})

test("slugify preserves Unicode letters, marks, and numbers", () => {
  assert.equal(slugify("Working with gh CLI on EMU"), "working-with-gh-cli-on-emu")
  assert.equal(slugify("日本語の教訓"), "日本語の教訓")
  assert.equal(slugify("安全/路径"), "安全-路径")
  assert.equal(slugify("हिन्दी १२३"), "हिन्दी-१२३")
  assert.equal(slugify("café"), slugify("cafe\u0301"))
  assert.equal(slugify("H\u0331"), slugify("\u1E96"))
  assert.equal(slugify("J\u030C"), slugify("\u01F0"))
  assert.equal(slugify("H\u0331"), slugify("H\u0331").normalize("NFC"))
  assert.equal(slugify("Σ"), slugify("ς"))
  assert.equal(slugify("Straße"), slugify("STRASSE"))
  assert.notEqual(slugify("ı"), slugify("i"))
  assert.equal(slugify("\u1C89"), "\u1C8A")
  assert.equal(slugify("\u088F"), "")
  assert.equal(slugify("❤️"), "")
  assert.equal(slugify("☀️"), "")
  assert.equal(slugify("✈️"), "")
  assert.equal(slugify("\u0301"), "")
  assert.equal(slugify("\u0345"), "")
  assert.equal(slugify("a ❤️ b"), "a-b")
  assert.equal(slugify("CON"), "x-con")
  assert.equal(slugify("COM¹"), "x-com¹")
  assert.equal(slugify("LPT³"), "x-lpt³")
  assert.equal(slugify("COM0"), "com0")
  assert.equal(slugify("!!!"), "")
})

test("Unicode slugs reach lesson and track-friction file paths", async () => {
  const root = await mkTempDeskRoot()

  const lesson = await lesson_add({
    deskRoot: root,
    input: { topic: "日本語の教訓", body: "Lesson body." },
  })
  assert.equal(lesson.path, path.join("_meta", "tips", "日本語の教訓.md"))
  assert.match(await fs.readFile(path.join(root, lesson.path), "utf8"), /Lesson body/)

  const friction = await friction_add({
    deskRoot: root,
    input: { track: "t1", theme: "安全/路径", body: "Friction body." },
  })
  assert.equal(path.dirname(friction.path), path.join("t1", "_friction"))
  assert.match(path.basename(friction.path), /^\d{4}-\d{2}-\d{2}-安全-路径\.md$/)
  assert.match(await fs.readFile(path.join(root, friction.path), "utf8"), /Friction body/)

  const reservedLesson = await lesson_add({
    deskRoot: root,
    input: { topic: "COM¹", body: "Windows-safe lesson." },
  })
  assert.equal(reservedLesson.path, path.join("_meta", "tips", "x-com¹.md"))
})

test("case-fold-equivalent inputs share lesson and friction paths", async () => {
  const root = await mkTempDeskRoot()

  const firstLesson = await lesson_add({
    deskRoot: root,
    input: { topic: "Σ", body: "First lesson." },
  })
  const secondLesson = await lesson_add({
    deskRoot: root,
    input: { topic: "ς", body: "Second lesson." },
  })
  assert.equal(secondLesson.path, firstLesson.path)
  assert.match(await fs.readFile(path.join(root, firstLesson.path), "utf8"), /Second lesson/)

  const firstFriction = await friction_add({
    deskRoot: root,
    input: { track: "t1", theme: "Straße", body: "First friction." },
  })
  const secondFriction = await friction_add({
    deskRoot: root,
    input: { track: "t1", theme: "STRASSE", body: "Second friction." },
  })
  assert.equal(secondFriction.path, firstFriction.path)
  assert.match(await fs.readFile(path.join(root, firstFriction.path), "utf8"), /Second friction/)
})

test("legacy paths are reused only when their identity is provable", async () => {
  const root = await mkTempDeskRoot()
  const lessonSlug = legacySlugify("café")
  const lessonPath = path.join(root, "_meta", "tips", `${lessonSlug}.md`)
  await fs.mkdir(path.dirname(lessonPath), { recursive: true })
  await fs.writeFile(lessonPath, "# café\n\nOriginal lesson.\n", "utf8")

  const lesson = await lesson_add({
    deskRoot: root,
    input: { topic: "café", body: "Updated lesson." },
  })
  assert.equal(lesson.path, path.join("_meta", "tips", `${lessonSlug}.md`))
  assert.match(await fs.readFile(lessonPath, "utf8"), /Updated lesson/)

  const collisionRoot = await mkTempDeskRoot()
  const collisionPath = path.join(collisionRoot, "_meta", "tips", `${lessonSlug}.md`)
  await fs.mkdir(path.dirname(collisionPath), { recursive: true })
  await fs.writeFile(collisionPath, "# caf\n\nDifferent lesson.\n", "utf8")
  const collision = await lesson_add({
    deskRoot: collisionRoot,
    input: { topic: "café", body: "Specific lesson." },
  })
  assert.equal(collision.path, path.join("_meta", "tips", "café.md"))
  assert.equal(await fs.readFile(collisionPath, "utf8"), "# caf\n\nDifferent lesson.\n")

  const frictionSlug = legacySlugify("mañana notes")
  const frictionPath = path.join(root, "t1", "_friction", `${today()}-${frictionSlug}.md`)
  await fs.mkdir(path.dirname(frictionPath), { recursive: true })
  await fs.writeFile(frictionPath, "Original friction.\n", "utf8")

  const friction = await friction_add({
    deskRoot: root,
    input: { track: "t1", theme: "mañana notes", body: "Updated friction." },
  })
  assert.equal(friction.path, path.join("t1", "_friction", `${today()}-mañana-notes.md`))
  assert.equal(await fs.readFile(frictionPath, "utf8"), "Original friction.\n")
  assert.match(await fs.readFile(path.join(root, friction.path), "utf8"), /Updated friction/)

  const ambiguousPath = path.join(root, "t1", "_friction", `${today()}-untitled.md`)
  await fs.writeFile(ambiguousPath, "Ambiguous legacy friction.\n", "utf8")
  const unicodeFriction = await friction_add({
    deskRoot: root,
    input: { track: "t1", theme: "日本語の教訓", body: "Specific friction." },
  })
  assert.notEqual(unicodeFriction.path, path.relative(root, ambiguousPath))
  assert.match(unicodeFriction.path, /日本語の教訓\.md$/)
  assert.equal(await fs.readFile(ambiguousPath, "utf8"), "Ambiguous legacy friction.\n")
})

test("readMarkdown reports a missing file clearly", async () => {
  const root = await mkTempDeskRoot()
  const missing = path.join(root, "missing.md")

  await assert.rejects(() => readMarkdown(missing), {
    message: `file does not exist: ${missing}`,
  })
})

test("readMarkdown preserves non-missing filesystem errors", async () => {
  const root = await mkTempDeskRoot()

  await assert.rejects(
    () => readMarkdown(root),
    (error) => error.code === "EISDIR",
  )
})

test("readMarkdown returns concrete data and content without frontmatter", async () => {
  const root = await mkTempDeskRoot()
  const filePath = path.join(root, "plain.md")
  await fs.writeFile(filePath, "Plain body.\n", "utf8")

  assert.deepEqual(await readMarkdown(filePath), {
    data: {},
    content: "Plain body.\n",
  })
})

test("serializeMarkdown handles empty and already-prefixed content", () => {
  assert.equal(serializeMarkdown({}, null), "\n")
  assert.equal(serializeMarkdown({}, "\nBody.\n"), "\nBody.\n")
})
