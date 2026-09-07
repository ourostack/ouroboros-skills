// lesson_add — write/append a lesson under `<root>/_meta/tips/<topic>.md`.
//
// Per `plugins/desk/skills/lesson-capture/SKILL.md`, lessons are agent-driven
// post-task captures. We write one file per topic slug; subsequent calls with
// the same topic append `## Update <date>` sections so the file accumulates
// without losing prior content.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { today, slugify, pathExists } from "../util/fm.js"
import { resolveWriteTarget } from "../util/paths.js"

function relPath(deskRoot, absPath) {
  return path.relative(deskRoot, absPath)
}

async function findMatchingLessonPath(directory, topicSlug, canonicalPath) {
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
  for (const name of names) {
    const candidate = path.join(directory, name)
    const [firstLine] = (await fs.readFile(candidate, "utf8")).split(/\r?\n/u)
    if (firstLine.startsWith("# ") && slugify(firstLine.slice(2)) === topicSlug) {
      if (slugify(path.basename(name, ".md")) === topicSlug) {
        await fs.rename(candidate, canonicalPath)
        return canonicalPath
      }
      return candidate
    }
  }
  return null
}

/**
 * lesson_add
 *
 * Input:
 *   {
 *     topic: string,    // human-readable; gets slugified for the filename
 *     body: string,     // markdown body
 *   }
 *
 * Side effects: writes `<root>/_meta/tips/<topic-slug>.md`. If the file
 * exists, appends an `## Update <YYYY-MM-DD>` section + the new body.
 *
 * Returns: { status: "added", path }
 */
export async function lesson_add({ deskRoot, input, person = null }) {
  const values = input ?? {}
  const { topic, body } = values
  if (!topic || typeof topic !== "string") {
    throw new Error("lesson_add: `topic` is required (string)")
  }
  if (!body || typeof body !== "string") {
    throw new Error("lesson_add: `body` is required (string)")
  }

  const topicSlug = slugify(topic)
  if (!topicSlug) {
    throw new Error("lesson_add: `topic` slugified to empty string")
  }

  let filePath = await resolveWriteTarget({
    deskRoot,
    person,
    segments: ["_meta", "tips", `${topicSlug}.md`],
  })
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  if (!(await pathExists(filePath))) {
    filePath = await findMatchingLessonPath(directory, topicSlug, filePath) ?? filePath
  }

  const trimmedBody = body.endsWith("\n") ? body : `${body}\n`
  if (await pathExists(filePath)) {
    const existing = await fs.readFile(filePath, "utf8")
    const sep = existing.endsWith("\n") ? "" : "\n"
    const update = `${existing}${sep}\n## Update ${today()}\n\n${trimmedBody}`
    await fs.writeFile(filePath, update, "utf8")
  } else {
    // Initial write: include a top-level heading derived from the topic.
    const header = `# ${topic}\n\n`
    await fs.writeFile(filePath, `${header}${trimmedBody}`, "utf8")
  }

  return { status: "added", path: relPath(deskRoot, filePath) }
}
