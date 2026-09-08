// Shared scaffolding for private-feedback tests.
//
// Every test gets its own temp desk root plus its own private state home so
// no test ever touches the developer's real feedback store.

import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

export async function mkFeedbackFixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "desk-feedback-"))
  const deskRoot = path.join(base, "workspace")
  const stateHome = path.join(base, "state")
  await fs.mkdir(deskRoot, { recursive: true })
  return { base, deskRoot, stateHome }
}

export function useStateHome(stateHome) {
  const previous = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = stateHome
  return () => {
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
  }
}

export function useHome(home) {
  const previousHome = process.env.HOME
  const previousStateHome = process.env.XDG_STATE_HOME
  delete process.env.XDG_STATE_HOME
  process.env.HOME = home
  return () => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousStateHome !== undefined) process.env.XDG_STATE_HOME = previousStateHome
  }
}

export async function cleanup(base) {
  await fs.rm(base, { recursive: true, force: true })
}
