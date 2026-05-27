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
