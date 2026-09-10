import { test } from "node:test"
import { strict as assert } from "node:assert"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { desk_status } from "../../src/tools/status.js"
import { closeDb, indexDbPath, openDb, setMeta } from "../../src/db/init.js"

test("status's direct API defaults its context without provisioning missing state", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "status-default-context-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const body = await desk_status({ deskRoot: root })
  assert.equal(body.status, "ok")
  assert.equal(body.root.path, root)
  assert.deepEqual(body.write_scope, { mode: "workspace", person: null, relative_path: "." })
  assert.equal(existsSync(indexDbPath(root)), false)
  assert.deepEqual(readdirSync(root), [])
})

test("status retains the first tied markdown timestamp and ignores a newer non-markdown file", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "status-tied-freshness-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const contents = { "a.md": "# A\n", "b.md": "# B\n", "newer.txt": "not an indexed document\n" }
  const documentTime = new Date("2001-01-01T00:00:00.000Z")
  for (const [name, content] of Object.entries(contents)) {
    const file = path.join(root, name)
    writeFileSync(file, content)
    const time = name.endsWith(".md") ? documentTime : new Date("2003-01-01T00:00:00.000Z")
    utimesSync(file, time, time)
  }
  const db = openDb(root)
  try {
    setMeta(db, "last_indexed_at", "2002-01-01T00:00:00.000Z")
  } finally {
    closeDb(db)
  }
  const before = readFileSync(indexDbPath(root))
  const firstMarkdown = readdirSync(root).find((name) => name.endsWith(".md"))
  const body = await desk_status({ deskRoot: root })
  assert.deepEqual(body.local_db.freshness, {
    state: "fresh", last_indexed_at: "2002-01-01T00:00:00.000Z",
    newest_document: { path: firstMarkdown, mtime_ms: documentTime.getTime() },
  })
  assert.deepEqual(readFileSync(indexDbPath(root)), before)
  for (const [name, content] of Object.entries(contents)) assert.equal(readFileSync(path.join(root, name), "utf8"), content)
})
