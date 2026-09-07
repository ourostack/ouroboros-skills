// lesson_add — write/append a lesson under `<root>/_meta/tips/<topic>.md`.
//
// Per `plugins/desk/skills/lesson-capture/SKILL.md`, lessons are agent-driven
// post-task captures. We write one file per topic slug; subsequent calls with
// the same topic append `## Update <date>` sections so the file accumulates
// without losing prior content.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { findFilenameEquivalent, today, slugify, pathExists } from "../util/fm.js"
import { resolveWriteTarget } from "../util/paths.js"

function relPath(deskRoot, absPath) {
  return path.relative(deskRoot, absPath)
}

async function availableLessonPath(canonicalName, resolveCandidate) {
  let candidateName = `_${canonicalName}`
  let candidatePath = await resolveCandidate(candidateName)
  while (await findFilenameEquivalent(candidatePath, resolveCandidate)) {
    candidateName = `_${candidateName}`
    candidatePath = await resolveCandidate(candidateName)
  }
  return candidatePath
}

async function lessonPathMatches(filePath, topicSlug) {
  const [firstLine] = (await fs.readFile(filePath, "utf8")).split(/\r?\n/u)
  return firstLine.startsWith("# ") && slugify(firstLine.slice(2)) === topicSlug
}

async function resolveLessonPath({ directory, topicSlug, canonicalPath, resolveCandidate }) {
  const canonicalName = path.basename(canonicalPath)
  const canonicalExistingPath = await findFilenameEquivalent(canonicalPath, resolveCandidate)
  const canonicalExists = canonicalExistingPath !== null
  if (canonicalExistingPath && await lessonPathMatches(canonicalExistingPath, topicSlug)) {
    return canonicalExistingPath
  }
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort()
  const matches = []
  for (const name of names) {
    const candidate = path.join(directory, name)
    if (await lessonPathMatches(candidate, topicSlug)) {
      matches.push(name)
    }
  }
  if (matches.length > 0) {
    const match = matches[0]
    const matchedPath = path.join(directory, match)
    if (!match.startsWith("_") && slugify(path.basename(match, ".md")) === topicSlug) {
      const destination = canonicalExists
        ? await availableLessonPath(canonicalName, resolveCandidate)
        : canonicalPath
      await fs.rename(matchedPath, destination)
      return destination
    }
    return matchedPath
  }
  return canonicalExists
    ? availableLessonPath(canonicalName, resolveCandidate)
    : canonicalPath
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
  const resolveCandidate = (name) => resolveWriteTarget({
    deskRoot,
    person,
    segments: ["_meta", "tips", name],
  })
  await fs.mkdir(directory, { recursive: true })
  filePath = await resolveLessonPath({
    directory,
    topicSlug,
    canonicalPath: filePath,
    resolveCandidate,
  })

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
