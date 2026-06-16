import { promises as fs } from "node:fs"
import * as path from "node:path"

const GITIGNORE_PATH = ".gitignore"
const SENSITIVE_SEGMENTS = new Set([
  ".env",
  "api-keys",
  "api_keys",
  "credential",
  "credentials",
  "private",
  "secret",
  "secrets",
])
const SENSITIVE_NAME_RE = /(?:^|[-_.])(api[-_]?key|credential|credentials|private[-_]?key|secret|secrets)(?:[-_.]|$)/u

export async function loadExclusionRules({ deskRoot } = {}) {
  if (!deskRoot) return { gitignore: [] }
  const gitignore = await readRootGitignore(deskRoot)
  if (!gitignore.valid) {
    const error = new Error("gitignore exclusion rules could not be read")
    error.code = "exclusion_rules_unavailable"
    error.reason = "gitignore_unreadable"
    throw error
  }
  return {
    gitignore: parseGitignore(gitignore.body),
  }
}

export function exclusionForPath(relPath, rules = {}) {
  const normalized = normalizeRelPath(relPath)
  if (matchesGitignore(normalized, rules.gitignore ?? [])) {
    return { excluded: true, reason: "gitignore" }
  }
  if (isSensitivePath(normalized)) {
    return { excluded: true, reason: "sensitive_path" }
  }
  return { excluded: false, reason: null }
}

export async function assertArtifactInputsAllowed({
  deskRoot,
  artifact_type,
  docs = [],
  rules,
} = {}) {
  if (!Array.isArray(docs) || docs.length === 0) {
    throw artifactInputUnknownError(artifact_type)
  }
  if (typeof deskRoot !== "string" || deskRoot.trim() === "") {
    throw artifactInputUnknownError(artifact_type)
  }
  for (const doc of docs) {
    if (!hasKnownRelativeDocPath(doc)) {
      throw artifactInputUnknownError(artifact_type)
    }
  }
  const resolvedRules = rules ?? await loadExclusionRules({ deskRoot })
  const reasons = new Set()
  let excludedCount = 0
  for (const doc of docs) {
    const decision = exclusionForPath(doc.path, resolvedRules)
    if (!decision.excluded) continue
    excludedCount += 1
    reasons.add(decision.reason)
  }
  if (excludedCount === 0) return { allowed: true }

  const error = new Error("artifact input includes excluded documents")
  error.code = "artifact_input_excluded"
  error.artifact_type = artifact_type
  error.excluded_count = excludedCount
  error.reasons = reasons
  throw error
}

function artifactInputUnknownError(artifact_type) {
  const error = new Error("artifact input source documents are required")
  error.code = "artifact_input_unknown"
  error.artifact_type = artifact_type
  return error
}

function hasKnownRelativeDocPath(doc) {
  if (doc == null) return false
  if (typeof doc !== "object") return false
  if (Array.isArray(doc)) return false
  if (typeof doc.path !== "string") return false
  const rawPath = doc.path.trim()
  if (rawPath === "") return false
  if (path.isAbsolute(rawPath)) return false
  if (path.win32.isAbsolute(rawPath)) return false
  return true
}

async function readRootGitignore(deskRoot) {
  const gitignorePath = path.join(deskRoot, GITIGNORE_PATH)
  let stat
  try {
    stat = await fs.stat(gitignorePath)
  } catch (error) {
    if (error.code === "ENOENT") return { valid: true, body: "" }
    return { valid: false, body: "" }
  }
  if (!stat.isFile()) return { valid: false, body: "" }
  try {
    return {
      valid: true,
      body: await fs.readFile(gitignorePath, "utf8"),
    }
  } catch (error) {
    return { valid: false, body: "" }
  }
}

function parseGitignore(raw) {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("!"))
}

function matchesGitignore(relPath, patterns) {
  return patterns.some((pattern) => matchesGitignorePattern(relPath, pattern))
}

function matchesGitignorePattern(relPath, pattern) {
  const normalizedPattern = normalizeRelPath(pattern)
  if (normalizedPattern.endsWith("/")) {
    const prefix = normalizedPattern.replace(/\/+$/u, "")
    if (!prefix.includes("/")) {
      return pathContainsMatchingSegment(relPath, prefix)
    }
    return relPath === prefix || relPath.startsWith(`${prefix}/`)
  }
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3)
    return relPath === prefix || relPath.startsWith(`${prefix}/`)
  }
  if (!normalizedPattern.includes("/")) {
    return pathContainsMatchingSegment(relPath, normalizedPattern)
  }
  return globPathToRegExp(normalizedPattern).test(relPath)
}

function pathContainsMatchingSegment(relPath, pattern) {
  const segmentPattern = globSegmentToRegExp(pattern)
  return relPath
    .split("/")
    .filter(Boolean)
    .some((segment) => segmentPattern.test(segment))
}

function isSensitivePath(relPath) {
  return relPath
    .split("/")
    .filter(Boolean)
    .some((segment) => {
      const lower = segment.toLowerCase()
      return SENSITIVE_SEGMENTS.has(lower) || SENSITIVE_NAME_RE.test(lower)
    })
}

function globPathToRegExp(pattern) {
  return new RegExp(`^${globToRegexSource(pattern)}$`, "u")
}

function globSegmentToRegExp(pattern) {
  return new RegExp(`^${globToRegexSource(pattern)}$`, "u")
}

function globToRegexSource(pattern) {
  return pattern
    .split("*")
    .map(escapeRegExp)
    .join("[^/]*")
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function normalizeRelPath(relPath) {
  return String(relPath ?? "")
    .replace(/\\/gu, "/")
    .replace(/^\/+/u, "")
}
