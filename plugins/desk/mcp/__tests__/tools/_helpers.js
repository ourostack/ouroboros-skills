// Shared scaffolding for tool tests — isolated tmp desk root + matter parsing.

import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import matter from "gray-matter"

export async function mkTempDeskRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "desk-test-"))
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
