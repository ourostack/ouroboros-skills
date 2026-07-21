// Runtime CRUD tools for `task.md` cards — task_create, task_update, task_archive.
//
// Each export is invoked from server.js with a parsed { deskRoot, input }
// pair. The implementation owns the on-disk layout under
// `<root>/<track>/<slug>/task.md` and obeys the schema documented in
// `plugins/desk/skills/task-card-format/SKILL.md` (schema_version 1).

import { promises as fs } from "node:fs"
import * as path from "node:path"
import {
  nowIso,
  readMarkdown,
  writeMarkdown,
  pathExists,
} from "../util/fm.js"
import { isPathContained, resolveWriteTarget } from "../util/paths.js"

const TERMINAL_STATUSES = new Set(["done", "cancelled"])

// Optional runtime fields the operator (or harness) may pass at create time.
// Kept explicit so we don't silently accept arbitrary keys.
const OPTIONAL_RUNTIME_FIELDS = [
  "category",
  "cadence",
  "scheduledAt",
  "requester",
  "validator",
  "artifacts",
  "active_bridge",
  "bridge_sessions",
  "planning_complete",
  "adopted_at",
  "repos",
  "iterations",
  "predecessor",
]

function relPath(deskRoot, absPath) {
  return path.relative(deskRoot, absPath)
}

async function assertArchiveSourceIsRelocationSafe({
  srcDir,
  srcFile,
  archiveDir,
}) {
  if ((await fs.lstat(srcDir)).isSymbolicLink()) {
    throw new Error(`task_archive: source directory symlink cannot be archived safely: ${srcDir}`)
  }
  if (!(await pathExists(srcFile))) return

  const fileStat = await fs.lstat(srcFile)
  if (!fileStat.isSymbolicLink()) return

  const realSrcDir = await fs.realpath(srcDir)
  const realArchiveDir = await prospectiveArchiveDir(archiveDir)
  if (isPathContained(realSrcDir, realArchiveDir)) {
    throw new Error(`task_archive: archive destination cannot be inside source directory: ${archiveDir}`)
  }

  const sourceReferent = await fs.realpath(srcFile)
  const expectedReferent = isPathContained(realSrcDir, sourceReferent)
    ? path.join(realArchiveDir, path.relative(realSrcDir, sourceReferent))
    : sourceReferent
  const relocatedReferent = await realpathAfterArchive(
    path.join(realArchiveDir, path.basename(srcFile)),
    { realSrcDir, realArchiveDir },
  )
  if (relocatedReferent !== expectedReferent) {
    throw new Error(`task_archive: task.md symlink would change referent when archived: ${srcFile}`)
  }
}

async function prospectiveArchiveDir(archiveDir) {
  const archiveParent = path.dirname(archiveDir)
  const realArchiveParent = await pathExists(archiveParent)
    ? await fs.realpath(archiveParent)
    : path.join(
        await fs.realpath(path.dirname(archiveParent)),
        path.basename(archiveParent),
      )
  return path.join(realArchiveParent, path.basename(archiveDir))
}

async function realpathAfterArchive(candidate, { realSrcDir, realArchiveDir }) {
  let { root, segments } = splitAbsolutePath(candidate)
  let resolved = root
  let followedLinks = 0

  while (segments.length > 0) {
    const virtualPath = path.join(resolved, segments.shift())
    const inspectionPath = pathBeforeArchive(virtualPath, {
      realSrcDir,
      realArchiveDir,
    })
    if (inspectionPath === null) return null

    let stat
    try {
      stat = await fs.lstat(inspectionPath)
    } catch (error) {
      if (
        error?.code === "ENOENT" &&
        isPathContained(virtualPath, realArchiveDir)
      ) {
        resolved = virtualPath
        continue
      }
      const unavailableAfterMove = ["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)
      /* node:coverage ignore next 3 */
      if (!unavailableAfterMove) {
        throw error
      }
      return null
    }

    if (!stat.isSymbolicLink()) {
      resolved = virtualPath
      continue
    }
    followedLinks += 1
    if (followedLinks > 40) return null

    const linkTarget = await fs.readlink(inspectionPath)
    const nextPath = path.resolve(
      path.dirname(virtualPath),
      linkTarget,
      ...segments,
    )
    const splitPath = splitAbsolutePath(nextPath)
    root = splitPath.root
    segments = splitPath.segments
    resolved = root
  }

  return resolved
}

function pathBeforeArchive(candidate, { realSrcDir, realArchiveDir }) {
  if (isPathContained(realArchiveDir, candidate)) {
    return path.join(realSrcDir, path.relative(realArchiveDir, candidate))
  }
  if (isPathContained(realSrcDir, candidate)) return null
  return candidate
}

function splitAbsolutePath(candidate) {
  const resolved = path.resolve(candidate)
  const root = path.parse(resolved).root
  return {
    root,
    segments: resolved.slice(root.length).split(path.sep).filter(Boolean),
  }
}

/**
 * task_create
 *
 * Input:
 *   {
 *     track: string,            // required
 *     slug: string,             // required
 *     title: string,            // required
 *     status?: string,          // default "drafting"
 *     body?: string,            // markdown body (no frontmatter)
 *     ...optional runtime fields per task-card schema
 *   }
 *
 * Side effects: creates `<root>/<track>/<slug>/task.md` (and parent dirs).
 *
 * Errors: refuses if the target task.md already exists.
 *
 * Returns: { status: "created", path: "<track>/<slug>/task.md" }
 */
export async function task_create({ deskRoot, input, person = null }) {
  const values = input ?? {}
  const { track, slug, title } = values
  if (!Object.hasOwn(values, "track")) {
    throw new Error("task_create: `track` is required (string)")
  }
  if (!Object.hasOwn(values, "slug")) {
    throw new Error("task_create: `slug` is required (string)")
  }
  if (!title || typeof title !== "string") {
    throw new Error("task_create: `title` is required (string)")
  }

  const filePath = await resolveWriteTarget({
    deskRoot,
    person,
    segments: [track, slug, "task.md"],
  })
  if (await pathExists(filePath)) {
    throw new Error(
      `task_create: task already exists at ${relPath(deskRoot, filePath)}`,
    )
  }

  const ts = nowIso()
  const data = {
    schema_version: 1,
    title,
    status: values.status ?? "drafting",
    created: ts,
    updated: ts,
    track,
  }
  for (const k of OPTIONAL_RUNTIME_FIELDS) {
    if (values[k] !== undefined) data[k] = values[k]
  }

  await writeMarkdown(filePath, data, values.body ?? "")
  return { status: "created", path: relPath(deskRoot, filePath) }
}

/**
 * task_update
 *
 * Input:
 *   {
 *     track: string,
 *     slug: string,
 *     frontmatter?: object,   // shallow-merged into existing frontmatter
 *     body_append?: string,   // appended to existing body (blank line sep)
 *   }
 *
 * Side effects: rewrites `<root>/<track>/<slug>/task.md` in place.
 *
 * Preserves: `schema_version`, `created`. Always refreshes `updated` to now.
 *
 * Errors: refuses if the task doesn't exist.
 *
 * Returns: { status: "updated", path }
 */
export async function task_update({ deskRoot, input, person = null }) {
  const values = input ?? {}
  const { track, slug, frontmatter, body_append } = values
  if (
    !Object.hasOwn(values, "track") ||
    !Object.hasOwn(values, "slug")
  ) {
    throw new Error("task_update: `track` and `slug` are required")
  }

  const filePath = await resolveWriteTarget({
    deskRoot,
    person,
    segments: [track, slug, "task.md"],
  })
  if (!(await pathExists(filePath))) {
    throw new Error(
      `task_update: task does not exist at ${relPath(deskRoot, filePath)}`,
    )
  }

  const existing = await readMarkdown(filePath)
  const merged = { ...existing.data, ...(frontmatter ?? {}) }

  // Preserve immutable fields even if the caller passed them.
  if (existing.data.schema_version !== undefined) {
    merged.schema_version = existing.data.schema_version
  } else {
    merged.schema_version = 1
  }
  if (existing.data.created !== undefined) {
    merged.created = existing.data.created
  }
  merged.updated = nowIso()

  let newBody = existing.content
  if (typeof body_append === "string" && body_append.length > 0) {
    const sep = newBody.endsWith("\n\n") || newBody.length === 0 ? "" : "\n\n"
    newBody = `${newBody}${sep}${body_append}`
  }

  await writeMarkdown(filePath, merged, newBody)
  return { status: "updated", path: relPath(deskRoot, filePath) }
}

/**
 * task_archive
 *
 * Input: { track, slug }
 *
 * Side effects: moves `<root>/<track>/<slug>/` → `<root>/<track>/_archive/<slug>/`.
 * Marks the task `done` if not already in a terminal status.
 *
 * Idempotent: if the source dir doesn't exist AND `_archive/<slug>` does,
 * returns `{ status: "already_archived" }`. Throws if neither exists.
 *
 * Returns: { status: "archived" | "already_archived", path }
 */
export async function task_archive({ deskRoot, input, person = null }) {
  const values = input ?? {}
  const { track, slug } = values
  if (
    !Object.hasOwn(values, "track") ||
    !Object.hasOwn(values, "slug")
  ) {
    throw new Error("task_archive: `track` and `slug` are required")
  }

  const target = (segments) =>
    resolveWriteTarget({ deskRoot, person, segments })
  const srcDir = await target([track, slug])
  const srcFile = await target([track, slug, "task.md"])
  const archiveDir = await target([track, "_archive", slug])
  const archivedFile = await target([track, "_archive", slug, "task.md"])

  const srcExists = await pathExists(srcDir)
  const dstExists = await pathExists(archiveDir)

  if (!srcExists && dstExists) {
    return {
      status: "already_archived",
      path: relPath(deskRoot, archivedFile),
    }
  }
  if (!srcExists && !dstExists) {
    throw new Error(
      `task_archive: task does not exist at ${relPath(deskRoot, srcDir)}`,
    )
  }
  if (srcExists && dstExists) {
    throw new Error(
      `task_archive: archive destination already exists at ${relPath(
        deskRoot,
        archiveDir,
      )} but source ${relPath(deskRoot, srcDir)} also exists`,
    )
  }

  await assertArchiveSourceIsRelocationSafe({
    srcDir,
    srcFile,
    archiveDir,
  })

  // Move the dir. fs.rename is atomic on the same filesystem.
  await fs.mkdir(path.dirname(archiveDir), { recursive: true })
  await fs.rename(srcDir, archiveDir)

  // Bump task status to `done` (and refresh `updated`) if not already terminal.
  await target([track, "_archive", slug])
  const filePath = await target([track, "_archive", slug, "task.md"])
  if (await pathExists(filePath)) {
    const existing = await readMarkdown(filePath)
    const currentStatus = existing.data.status
    if (!TERMINAL_STATUSES.has(currentStatus)) {
      const merged = {
        ...existing.data,
        status: "done",
        updated: nowIso(),
      }
      await writeMarkdown(filePath, merged, existing.content)
    }
  }

  return { status: "archived", path: relPath(deskRoot, filePath) }
}
