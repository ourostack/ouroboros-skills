// Resolve the desk root path from --root flag, DESK env var, or a fallback
// chain of canonical workspace locations under $HOME.
//
// Resolution order:
//   1. Explicit --root argument (if path exists)
//   2. $DESK env var (if set and path exists)
//   3. $HOME/ms-desk/ (if exists)
//   4. $HOME/desk/ (if exists)
//   5. $HOME/worker-workspace/ (legacy operators may still have this)
//   6. Fail — listing every path tried, so the operator can diagnose
//
// We don't auto-create the dir here; consumers expect to point at an
// existing desk workspace. The fallback chain exists so the most common
// install paths "just work" without the operator having to export $DESK.

import * as path from "node:path"
import * as os from "node:os"
import { existsSync } from "node:fs"

export function resolveDeskRoot(explicit) {
  const tried = []

  // 1. Explicit --root argument — if passed, this is authoritative.
  if (explicit) {
    const resolved = path.resolve(expandHome(explicit))
    tried.push(`--root ${resolved}`)
    if (existsSync(resolved)) return resolved
    throw new Error(
      `desk-mcp: --root path does not exist: ${resolved}. ` +
        `Pass --root <path> pointing at an existing desk workspace, or set $DESK.`,
    )
  }

  // 2. $DESK env var.
  if (process.env.DESK) {
    const resolved = path.resolve(expandHome(process.env.DESK))
    tried.push(`$DESK=${resolved}`)
    if (existsSync(resolved)) return resolved
  }

  // 3-5. Canonical fallback locations under $HOME.
  const home = os.homedir()
  const fallbacks = [
    path.join(home, "ms-desk"),
    path.join(home, "desk"),
    path.join(home, "worker-workspace"),
  ]
  for (const candidate of fallbacks) {
    tried.push(candidate)
    if (existsSync(candidate)) return candidate
  }

  // 6. Fail with diagnostic listing every path tried.
  throw new Error(
    `desk-mcp: no desk workspace found. Tried (in order):\n` +
      tried.map((t) => `  - ${t}`).join("\n") +
      `\nPass --root <path> pointing at an existing desk workspace, or set $DESK.`,
  )
}

export function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  if (p === "~") return os.homedir()
  return p
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
