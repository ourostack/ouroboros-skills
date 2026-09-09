// Shared scaffolding for tool tests — isolated tmp desk root + matter parsing.

import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after } from "node:test"
import matter from "gray-matter"

const tempDeskRoots = new Set()

after(() => Promise.all([...tempDeskRoots].map((root) => fs.rm(root, { recursive: true, force: true }))))

export async function mkTempDeskRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "desk-test-"))
  tempDeskRoots.add(root)
  return root
}

export async function readFront(filePath) {
  const raw = await fs.readFile(filePath, "utf8")
  return matter(raw)
}

export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
