// friction_add — append a friction entry to the operator's friction log.
//
// Two scopes per `plugins/desk/skills/friction-management/SKILL.md`:
//   - Cross-cutting (no `track`):  `<root>/_meta/friction.md`
//   - Track-local (with `track`):  `<root>/<track>/_friction/<YYYY-MM-DD>-<theme>.md`
//
// Both are append-only; if the file already exists, the new entry is
// appended with a separator (no rewriting of prior entries — see the skill's
// "never delete, never rewrite" rule).

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { today, slugify, pathExists } from "../util/fm.js"
import { resolveWriteTarget } from "../util/paths.js"

function relPath(deskRoot, absPath) {
  return path.relative(deskRoot, absPath)
}

function trackFrictionIdentity(themeSlug) {
  return `<!-- desk-friction:v2 theme=${themeSlug} -->`
}

async function resolveTrackFrictionPath({ deskRoot, person, track, themeSlug }) {
  const date = today()
  const identity = trackFrictionIdentity(themeSlug)
  let fileSlug = themeSlug
  while (true) {
    const filePath = await resolveWriteTarget({
      deskRoot,
      person,
      segments: [track, "_friction", `${date}-${fileSlug}.md`],
    })
    if (!(await pathExists(filePath))) return { filePath, identity }
    const [firstLine] = (await fs.readFile(filePath, "utf8")).split(/\r?\n/u)
    if (firstLine === identity) return { filePath, identity }
    fileSlug = `_${fileSlug}`
  }
}

/**
 * friction_add
 *
 * Input:
 *   {
 *     track?: string,    // omit for cross-cutting; include for track-local
 *     theme?: string,    // short slug for the track-local filename; defaults "untitled"
 *     body: string,      // the entry body (without surrounding `---` separators)
 *   }
 *
 * Side effects: appends to the resolved friction file. Track-local files begin
 * with an identity comment so lossy legacy filenames cannot absorb unrelated
 * entries. Creates parent dirs + the file itself if missing. Adds a leading
 * `---` separator between entries (and a trailing newline) so future entries
 * land cleanly.
 *
 * Returns: { status: "added", path }
 */
export async function friction_add({ deskRoot, input, person = null }) {
  const values = input ?? {}
  const { track, theme, body } = values
  if (!body || typeof body !== "string") {
    throw new Error("friction_add: `body` is required (string)")
  }

  let filePath
  let identity = null
  if (typeof track === "string" && track.length > 0) {
    const themeSlug = slugify(theme) || "untitled"
    const resolved = await resolveTrackFrictionPath({
      deskRoot,
      person,
      track,
      themeSlug,
    })
    filePath = resolved.filePath
    identity = resolved.identity
  } else {
    filePath = await resolveWriteTarget({
      deskRoot,
      person,
      segments: ["_meta", "friction.md"],
    })
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })

  const trimmedBody = body.endsWith("\n") ? body : `${body}\n`
  if (await pathExists(filePath)) {
    // Append with a separator so each entry is visually distinct.
    const existing = await fs.readFile(filePath, "utf8")
    const sep = existing.endsWith("\n") ? "" : "\n"
    await fs.writeFile(
      filePath,
      `${existing}${sep}\n---\n\n${trimmedBody}`,
      "utf8",
    )
  } else {
    const initial = identity ? `${identity}\n\n${trimmedBody}` : trimmedBody
    await fs.writeFile(filePath, initial, "utf8")
  }

  return { status: "added", path: relPath(deskRoot, filePath) }
}
