// Resolve the desk root path from --root flag, host/session defaults, an
// activation config, DESK env var, or a fallback chain of canonical workspace
// locations under $HOME.
//
// Resolution order:
//   1. Explicit --root argument (if path exists)
//   2. Host/session root (if provided and path exists)
//   3. Activation config desk.root (if provided and path exists)
//   4. $DESK env var (if set and path exists)
//   5. $HOME/ms-desk/ (if exists)
//   6. $HOME/desk/ (if exists)
//   7. $HOME/worker-workspace/ (legacy operators may still have this)
//   8. Fail — listing every path tried, so the operator can diagnose
//
// We don't auto-create the dir here; consumers expect to point at an
// existing desk workspace. The fallback chain exists so the most common
// install paths "just work" without the operator having to export $DESK.

import * as path from "node:path"
import * as os from "node:os"
import { existsSync, readFileSync } from "node:fs"

export function resolveDeskRoot(explicit, options = {}) {
  return resolveDeskRootWithSource({
    ...options,
    explicitRoot: explicit,
  }).root
}

export function resolveDeskRootWithSource({
  activationConfigPath,
  env = process.env,
  explicitRoot,
  homeDir = os.homedir(),
  hostSessionRoot,
} = {}) {
  const tried = []

  // 1. Explicit --root argument — if passed, this is authoritative.
  if (hasText(explicitRoot)) {
    const resolved = path.resolve(expandHome(explicitRoot, homeDir))
    tried.push({ source: "explicit-root", path: resolved })
    if (existsSync(resolved)) return { root: resolved, source: "explicit-root", tried }
    throw new Error(
      `desk-mcp: --root path does not exist: ${resolved}. ` +
        `Pass --root <path> pointing at an existing desk workspace, or set $DESK.`,
    )
  }

  if (hasText(hostSessionRoot)) {
    const resolved = path.resolve(expandHome(hostSessionRoot, homeDir))
    tried.push({ source: "host-session-root", path: resolved })
    if (existsSync(resolved)) return { root: resolved, source: "host-session-root", tried }
    throw new Error(`desk-mcp: host/session root path does not exist: ${resolved}.`)
  }

  const activationConfig = loadActivationConfig({ configPath: activationConfigPath, homeDir })
  if (activationConfig !== null) {
    const resolved = path.resolve(expandHome(activationConfig.desk.root, homeDir))
    tried.push({ source: "activation-config", path: resolved })
    if (existsSync(resolved)) return { root: resolved, source: "activation-config", tried }
    throw new Error(`desk-mcp: activation config desk.root path does not exist: ${resolved}.`)
  }

  // $DESK env var.
  if (hasText(env.DESK)) {
    const resolved = path.resolve(expandHome(env.DESK, homeDir))
    tried.push({ source: "env:DESK", path: resolved })
    if (existsSync(resolved)) return { root: resolved, source: "env:DESK", tried }
  }

  // Canonical fallback locations under $HOME.
  const home = homeDir
  const fallbacks = [
    { source: "fallback:ms-desk", path: path.join(home, "ms-desk") },
    { source: "fallback:desk", path: path.join(home, "desk") },
    { source: "fallback:worker-workspace", path: path.join(home, "worker-workspace") },
  ]
  for (const candidate of fallbacks) {
    tried.push(candidate)
    if (existsSync(candidate.path)) {
      return { root: candidate.path, source: candidate.source, tried }
    }
  }

  // Fail with diagnostic listing every path tried.
  throw new Error(
    `desk-mcp: no desk workspace found. Tried (in order):\n` +
      tried.map((entry) => `  - ${formatTriedEntry(entry)}`).join("\n") +
      `\nPass --root <path> pointing at an existing desk workspace, or set $DESK.`,
  )
}

export function loadActivationConfig({ configPath, homeDir = os.homedir() } = {}) {
  if (!hasText(configPath)) return null
  const resolvedPath = path.resolve(expandHome(configPath, homeDir))
  let parsed
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"))
  } catch {
    throw new Error(`desk-mcp: activation config ${resolvedPath} must be valid JSON`)
  }
  if (parsed?.schema_version !== 1) {
    throw new Error("desk-mcp: activation config schema_version must be 1")
  }
  if (!hasText(parsed?.desk?.root)) {
    throw new Error("desk-mcp: activation config desk.root must be a non-empty string")
  }
  return parsed
}

export function expandHome(p, homeDir = os.homedir()) {
  if (p.startsWith("~/")) return path.join(homeDir, p.slice(2))
  if (p === "~") return homeDir
  return p
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

function formatTriedEntry(entry) {
  if (entry.source === "env:DESK") return `$DESK=${entry.path}`
  return entry.path
}

// ── Shared-workspace write-prefix ─────────────────────────────────────────────
//
// `--person <alias>` scopes a session's WRITES to `<deskRoot>/desks/<alias>/`
// while reads/search still span the whole repo. This single helper is the seam
// every write-path builder routes through, so the default-OFF path stays
// byte-identical to today.
//
//   personPrefix(deskRoot, person)
//     person null / undefined / "" / whitespace-only → deskRoot  (OFF)
//     valid alias                                     → join(deskRoot, "desks", alias)
//     alias with "..", "/" , "\", or absolute         → throws    (path-traversal reject)
//
// Validation rule: a valid alias is a single path segment with no traversal.
// We reject anything that, when treated as a path, would escape the `desks/`
// dir or split into multiple segments — i.e. it must contain no separators,
// no "..", and must not be "." or absolute.

export function personPrefix(deskRoot, person) {
  // OFF: null / undefined / empty / whitespace-only → no remap.
  if (person == null) return deskRoot
  if (typeof person !== "string") return deskRoot
  const alias = person.trim()
  if (alias === "") return deskRoot

  // Reject path-traversal and multi-segment aliases.
  if (
    alias === "." ||
    alias === ".." ||
    alias.includes("..") ||
    alias.includes("/") ||
    alias.includes("\\") ||
    path.isAbsolute(alias)
  ) {
    throw new Error(
      `desk-mcp: invalid --person alias ${JSON.stringify(person)} — ` +
        `an alias must be a single path segment with no ".." or path separators.`,
    )
  }

  return path.join(deskRoot, "desks", alias)
}
