// Resolve the desk root path from --root flag or DESK environment variable.
//
// Resolution order:
//   1. Explicit --root argument
//   2. DESK env var
//   3. ./desk (relative to current working dir) — last-resort fallback
//
// We don't auto-create the dir here; consumers expect to point at an
// existing desk workspace.

import * as path from "node:path"
import * as os from "node:os"
import { existsSync } from "node:fs"

export function resolveDeskRoot(explicit) {
  const candidate = explicit ?? process.env.DESK ?? "./desk"
  const expanded = expandHome(candidate)
  const resolved = path.resolve(expanded)
  if (!existsSync(resolved)) {
    throw new Error(
      `desk-mcp: --root path does not exist: ${resolved}. ` +
        `Pass --root <path> pointing at an existing desk workspace, or set $DESK.`,
    )
  }
  return resolved
}

export function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2))
  if (p === "~") return os.homedir()
  return p
}
