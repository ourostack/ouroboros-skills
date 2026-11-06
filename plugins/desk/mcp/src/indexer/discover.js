// discover.js — walk a desk root and enumerate the .md files that get indexed.
//
// Per planning Unit 4 + desk-search-design §2:
//   In scope: task.md, planning.md, doing.md, feedback.md, friction notes
//             (cross-cutting at _meta/friction.md + track-local under
//             _friction/*.md), lesson notes at _meta/tips/*.md.
//   Skipped: node_modules/, .state/, .git/, anything under _archive (we
//            don't index archived content per "Indexing strategy"), and
//            .bak files.
//
// For each match we compute kind/track/task_slug from the path shape, parse
// frontmatter (tolerant — falls back to {} on parse failure), hash the
// contents (sha256) for dirty-detection, and capture mtime as a fast first
// pass.

import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import matter from "gray-matter"

/** Filenames we always pick up regardless of where they sit in the tree. */
const TASK_DOC_BASENAMES = new Set([
  "task.md",
  "planning.md",
  "doing.md",
  "feedback.md",
])

/** Directory names that short-circuit recursion (we never descend in). */
const SKIP_DIRS = new Set([
  "node_modules",
  ".state",
  ".git",
])

/**
 * Walk `deskRoot` and return an array of indexable doc descriptors.
 *
 * @param {string} deskRoot — absolute path to desk workspace.
 * @returns {Promise<Array<DocDescriptor>>}
 *
 * Each descriptor: { path (relative), absPath, kind, track, task_slug,
 *                    status, schema_version, created_at, updated_at,
 *                    hash, mtime, frontmatter, body }
 */
export async function discover(deskRoot) {
  const results = []
  await walk(deskRoot, deskRoot, results)
  // Stable ordering — easier to reason about in tests and in CLI output.
  results.sort((a, b) => a.path.localeCompare(b.path))
  return results
}

async function walk(deskRoot, dir, out) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === "ENOENT") return
    throw err
  }
  for (const ent of entries) {
    const name = ent.name
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      // Archive directories anywhere in the tree are off-limits.
      if (name === "_archive" || name.startsWith("_archive")) continue
      const sub = path.join(dir, name)
      await walk(deskRoot, sub, out)
      continue
    }
    if (!ent.isFile()) continue
    if (name.endsWith(".bak")) continue
    if (!name.endsWith(".md")) continue

    const abs = path.join(dir, name)
    const rel = path.relative(deskRoot, abs)
    if (!isIndexable(rel)) continue

    const desc = await describeDoc(deskRoot, abs, rel)
    if (desc) out.push(desc)
  }
}

/**
 * Decide whether a relative path is one of the doc shapes we index. Exposed
 * for tests.
 */
export function isIndexable(relPath) {
  const segments = relPath.split(path.sep)
  const base = segments[segments.length - 1]
  if (TASK_DOC_BASENAMES.has(base)) return true

  // Lessons: _meta/tips/<topic>.md (any depth under _meta/tips ok)
  const tipsIdx = segments.indexOf("tips")
  if (
    tipsIdx > 0 &&
    segments[tipsIdx - 1] === "_meta" &&
    base.endsWith(".md")
  ) {
    return true
  }

  // Cross-cutting friction register: _meta/friction.md
  if (segments.length === 2 && segments[0] === "_meta" && base === "friction.md") {
    return true
  }

  // Track-local friction: <track>/_friction/<file>.md
  const fricIdx = segments.indexOf("_friction")
  if (fricIdx >= 0 && base.endsWith(".md")) {
    return true
  }

  return false
}

/**
 * Classify a relative path. Pure function — exposed for tests.
 *
 * @returns {{ kind: string, track: string|null, task_slug: string|null }}
 */
export function classify(relPath) {
  const segments = relPath.split(path.sep)
  const base = segments[segments.length - 1]

  if (TASK_DOC_BASENAMES.has(base)) {
    // task docs always live at <track>/<slug>/<base>.
    if (segments.length >= 3) {
      const track = segments[0]
      const task_slug = segments[segments.length - 2]
      const kind = base.replace(/\.md$/, "")
      return { kind, track, task_slug }
    }
    return { kind: base.replace(/\.md$/, ""), track: null, task_slug: null }
  }

  // Lessons under _meta/tips/.
  if (segments.includes("_meta") && segments.includes("tips")) {
    return { kind: "lesson", track: null, task_slug: null }
  }

  // Cross-cutting friction: _meta/friction.md.
  if (segments[0] === "_meta" && base === "friction.md") {
    return { kind: "friction", track: null, task_slug: null }
  }

  // Track-local friction: <track>/_friction/<file>.md.
  const fricIdx = segments.indexOf("_friction")
  if (fricIdx > 0) {
    return { kind: "friction", track: segments[0], task_slug: null }
  }

  return { kind: "other", track: null, task_slug: null }
}

async function describeDoc(deskRoot, abs, rel) {
  let raw
  let stat
  try {
    raw = await fs.readFile(abs, "utf8")
    stat = await fs.stat(abs)
  } catch (err) {
    // File vanished or unreadable mid-walk; skip silently.
    return null
  }
  let parsed
  try {
    parsed = matter(raw)
  } catch {
    // Malformed frontmatter — index anyway, just with empty metadata.
    parsed = { data: {}, content: raw }
  }
  const fm = parsed.data ?? {}
  const body = parsed.content ?? ""
  const hash = createHash("sha256").update(raw).digest("hex")
  const { kind, track, task_slug } = classify(rel)

  return {
    path: rel,
    absPath: abs,
    kind,
    track,
    task_slug,
    status: typeof fm.status === "string" ? fm.status : null,
    schema_version:
      typeof fm.schema_version === "number" ? fm.schema_version : 0,
    created_at: normalizeDate(fm.created ?? fm.created_at ?? null),
    updated_at: normalizeDate(fm.updated ?? fm.updated_at ?? null),
    hash,
    mtime: Math.floor(stat.mtimeMs),
    frontmatter: fm,
    body,
    raw,
  }
}

/**
 * Normalize a frontmatter date value to a string. gray-matter (via js-yaml)
 * eagerly parses unquoted ISO-shaped dates (e.g. `2026-05-01`) into Date
 * objects; we want the on-disk representation as a string so SQLite stores a
 * stable TEXT value and downstream comparisons stay string-based.
 *
 * Exposed for tests.
 */
export function normalizeDate(value) {
  if (value == null) return null
  if (value instanceof Date) {
    // YYYY-MM-DD when the original looked date-only (midnight UTC), else
    // full ISO. The heuristic: if time component is exactly midnight UTC,
    // emit YYYY-MM-DD; gray-matter parses bare date-only strings to that.
    const iso = value.toISOString()
    if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10)
    return iso
  }
  if (typeof value === "string") return value
  return String(value)
}
