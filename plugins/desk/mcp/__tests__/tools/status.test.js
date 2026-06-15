import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import Database from "better-sqlite3"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { closeDb, indexDbPath, openDb } from "../../src/db/init.js"
import { callTool, TOOL_IMPLS } from "../../src/server.js"
import { TOOL_DESCRIPTIONS, TOOL_NAMES } from "../../src/tool-names.js"

const packageJson = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
)

function makeRoot() {
  return mkdtempSync(path.join(tmpdir(), "desk-status-"))
}

function parseToolResult(response) {
  assert.equal(response.isError, undefined, response.content?.[0]?.text)
  return JSON.parse(response.content[0].text)
}

test("desk_status is registered with a session-start-safe description", () => {
  assert.ok(TOOL_NAMES.includes("desk_status"), `registered tools: ${TOOL_NAMES.join(", ")}`)
  assert.equal(typeof TOOL_IMPLS.desk_status, "function")
  assert.match(TOOL_DESCRIPTIONS.desk_status, /health|status/iu)
  assert.match(TOOL_DESCRIPTIONS.desk_status, /session-start|fast|repair/iu)
})

test("desk_status reports root, runtime, missing DB, and deferred repair state without creating .state", async () => {
  const root = makeRoot()
  const runtimeCacheDir = path.join(root, "..", "runtime-cache")
  const sourceMirrorPath = path.join(runtimeCacheDir, "source-mirror", "abc123")
  const dbPath = indexDbPath(root)
  try {
    mkdirSync(path.join(root, "ops", "status-check"), { recursive: true })
    writeFileSync(
      path.join(root, "ops", "status-check", "task.md"),
      "---\nschema_version: 1\nstatus: in_progress\n---\n\n# Status Check\n",
      "utf8",
    )

    assert.equal(existsSync(dbPath), false, "fixture must start without a local DB")

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        root: {
          source: "activation-config",
          tried: [{ source: "activation-config", path: root }],
        },
        runtime: {
          runtime_cache_dir: runtimeCacheDir,
          source_mirror_path: sourceMirrorPath,
          target: `${process.platform}-${process.arch}-node-${process.versions.modules}`,
        },
      },
    }))

    assert.equal(body.status, "ok")
    assert.equal(body.root.path, root)
    assert.equal(body.root.source, "activation-config")
    assert.deepEqual(body.root.tried, [{ source: "activation-config", path: root }])
    assert.equal(body.runtime.plugin.name, packageJson.name)
    assert.equal(body.runtime.plugin.version, packageJson.version)
    assert.equal(body.runtime.runtime_cache_dir, runtimeCacheDir)
    assert.equal(body.runtime.source_mirror_path, sourceMirrorPath)
    assert.equal(body.local_db.path, dbPath)
    assert.equal(body.local_db.exists, false)
    assert.deepEqual(body.local_db.schema, { id: "desk-index", version: null })
    assert.equal(body.local_db.state, "missing")
    assert.equal(body.lexical_index.available, false)
    assert.equal(body.document_vectors.state, "missing_local_db")
    assert.equal(body.query_embedding.available, "not_checked")
    assert.equal(body.snapshots.restore_state, "not_checked")
    assert.equal(body.vector_packs.import_state, "not_checked")
    assert.match(body.summary, /activation-config/iu)
    assert.equal(existsSync(dbPath), false, "status must not create the local index DB")
    assert.equal(existsSync(path.dirname(dbPath)), false, "status must not create .state during first-run checks")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status reports existing DB coverage without probing query embeddings", async () => {
  const root = makeRoot()
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  try {
    const db = openDb(root)
    closeDb(db)
    globalThis.fetch = async () => {
      fetchCalls += 1
      throw new Error("desk_status must not probe live embeddings")
    }

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
      statusContext: {
        root: { source: "explicit-root", tried: [{ source: "explicit-root", path: root }] },
        runtime: { runtime_cache_dir: null, source_mirror_path: null, target: "direct-import" },
      },
    }))

    assert.equal(body.local_db.exists, true)
    assert.equal(body.local_db.schema.id, "desk-index")
    assert.equal(body.local_db.schema.version, 1)
    assert.equal(body.lexical_index.available, true)
    assert.equal(body.document_vectors.chunks_total, 0)
    assert.equal(body.document_vectors.vectors_indexed, 0)
    assert.equal(body.document_vectors.missing_vectors, 0)
    assert.equal(body.query_embedding.available, "not_checked")
    assert.equal(fetchCalls, 0, "status must not call the embedding endpoint")
  } finally {
    globalThis.fetch = originalFetch
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status defaults unknown startup context and reports partial vector coverage", async () => {
  const root = makeRoot()
  try {
    const db = openDb(root)
    try {
      db.prepare(
        `INSERT INTO docs (path, kind, hash, mtime, frontmatter)
         VALUES ('notes.md', 'other', 'abc', 1, '{}')`,
      ).run()
      db.prepare(
        `INSERT INTO chunks (doc_id, chunk_index, text, heading, start_offset, end_offset)
         VALUES (1, 0, 'hello', null, 0, 5)`,
      ).run()
    } finally {
      closeDb(db)
    }

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
    }))

    assert.equal(body.root.source, "unknown")
    assert.deepEqual(body.root.tried, [])
    assert.equal(body.runtime.runtime_cache_dir, null)
    assert.equal(body.runtime.source_mirror_path, null)
    assert.equal(body.runtime.loaded_from_source_mirror, false)
    assert.equal(body.document_vectors.chunks_total, 1)
    assert.equal(body.document_vectors.vectors_indexed, 0)
    assert.equal(body.document_vectors.missing_vectors, 1)
    assert.equal(body.document_vectors.coverage, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("desk_status reports lexical index absence without mutating an existing DB", async () => {
  const root = makeRoot()
  const dbPath = indexDbPath(root)
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TABLE chunks (id INTEGER PRIMARY KEY);
        CREATE TABLE chunk_vecs (chunk_id INTEGER PRIMARY KEY);
      `)
    } finally {
      db.close()
    }

    const body = parseToolResult(await callTool({
      deskRoot: root,
      name: "desk_status",
      input: {},
    }))

    assert.equal(body.local_db.exists, true)
    assert.equal(body.lexical_index.available, false)
    assert.equal(body.lexical_index.state, "missing")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
