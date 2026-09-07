// Frontmatter + markdown file helpers shared by the runtime CRUD tools.
//
// Wraps gray-matter (a CommonJS module) for ESM consumers, exposes a
// canonical ISO-timestamp helper, plus small file-IO conveniences so each
// tool module stays focused on its contract.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import matter from "gray-matter"
import { caseFold } from "unicode-case-folding"

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

/**
 * Reproduce the pre-1.3.4 slug for compatibility lookups.
 */
export function legacySlugify(raw) {
  if (raw == null) return ""
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Slugify a topic / theme to a filesystem-safe token. Normalizes, case-folds,
 * replaces non-letter/mark/number runs with `-`, and trims edge separators.
 */
export function slugify(raw) {
  if (raw == null) return ""
  const normalized = String(raw)
    .normalize("NFC")
    .replace(/(^|[^\p{L}\p{M}\p{N}])\p{M}+/gu, "$1")
  return caseFold(normalized)
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/(^|-)\p{M}+/gu, "$1")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}
