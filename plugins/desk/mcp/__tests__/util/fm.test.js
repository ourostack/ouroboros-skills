import { test } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { promises as fs } from "node:fs"
import { readMarkdown, serializeMarkdown, slugify } from "../../src/util/fm.js"
import { friction_add } from "../../src/tools/friction.js"
import { lesson_add } from "../../src/tools/lesson.js"
import { mkTempDeskRoot } from "../tools/_helpers.js"

test("slugify preserves Unicode letters, marks, and numbers", () => {
  assert.equal(slugify("Working with gh CLI on EMU"), "working-with-gh-cli-on-emu")
  assert.equal(slugify("日本語の教訓"), "日本語の教訓")
  assert.equal(slugify("安全/路径"), "安全-路径")
  assert.equal(slugify("हिन्दी १२३"), "हिन्दी-१२३")
  assert.equal(slugify("café"), slugify("cafe\u0301"))
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
