// Shared ownership registry for fixture roots created under the OS temp dir.
//
// Test files own the fixtures they create. A file's fixtures must stay on disk
// for the whole file — per-test `finally` blocks and `t.after()` hooks read them
// during teardown — so removal happens once, in a file-level `after()` hook.
//
// Ownership is exact: only roots handed out by `mkTempRoot` are removed. Nothing
// is matched by prefix, name pattern, or age, so a same-prefix directory this
// file did not create is never touched.

import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { after } from "node:test"

const ownedRoots = new Set()

after(() => Promise.all([...ownedRoots].map((root) => fs.rm(root, { recursive: true, force: true }))))

/** Create a fixture root under the OS temp dir and own it until the test file ends. */
export async function mkTempRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  ownedRoots.add(root)
  return root
}
