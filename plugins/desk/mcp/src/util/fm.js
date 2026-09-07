// Frontmatter + markdown file helpers shared by the runtime CRUD tools.
//
// Wraps gray-matter (a CommonJS module) for ESM consumers, exposes a
// canonical ISO-timestamp helper, plus small file-IO conveniences so each
// tool module stays focused on its contract.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import matter from "gray-matter"
import { caseFold } from "unicode-case-folding"
import letterRegex from "./unicode-16/letter.cjs"
import markRegex from "./unicode-16/mark.cjs"
import numberRegex from "./unicode-16/number.cjs"

const windowsReservedBasename = /^(?:aux|con|nul|prn|com[1-9¹²³]|lpt[1-9¹²³])$/u

/** Current UTC time in the canonical `YYYY-MM-DDTHH:MM:SSZ` shape. */
export function nowIso() {
  // Trim milliseconds — the schema example uses second precision.
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

/** Today's date as `YYYY-MM-DD` (UTC). */
export function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Read a markdown file and return its parsed frontmatter + body.
 * Throws a clear error if the file doesn't exist.
 */
export async function readMarkdown(filePath) {
  let raw
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`file does not exist: ${filePath}`)
    }
    throw err
  }
  const parsed = matter(raw)
  return { data: parsed.data, content: parsed.content }
}

/**
 * Serialize frontmatter + body to a markdown string. gray-matter.stringify
 * writes a `---\n<yaml>\n---\n<body>` document.
 */
export function serializeMarkdown(data, content) {
  // gray-matter.stringify strips a leading newline from content; normalize
  // body so there's always a blank line between frontmatter and body when
  // body is non-empty.
  const body = content == null ? "" : String(content)
  return matter.stringify(body.startsWith("\n") ? body : `\n${body}`, data)
}

/** Write a markdown file with frontmatter, creating parent dirs as needed. */
export async function writeMarkdown(filePath, data, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, serializeMarkdown(data, content), "utf8")
}

/** Check whether a path exists (file OR directory). */
export async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function retainUnicodeSlugParts(value) {
  let result = ""
  let separatorPending = false
  let hasBase = false

  for (const character of value) {
    if (letterRegex.test(character) || numberRegex.test(character)) {
      if (separatorPending && result) result += "-"
      result += character
      separatorPending = false
      hasBase = true
    } else if (markRegex.test(character) && hasBase && !separatorPending) {
      result += character
    } else {
      separatorPending = result.length > 0
      hasBase = false
    }
  }

  return result
}

/**
 * Slugify a topic / theme to a filesystem-safe token using pinned Unicode 16
 * categories, full case folding, and canonical normalization.
 */
export function slugify(raw) {
  if (raw == null) return ""
  const retained = retainUnicodeSlugParts(String(raw)).normalize("NFC")
  const slug = retainUnicodeSlugParts(caseFold(retained).normalize("NFC"))
  return windowsReservedBasename.test(slug) ? `x-${slug}` : slug
}
