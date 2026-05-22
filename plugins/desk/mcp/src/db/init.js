// SQLite index init. Stub for Unit 2 — Unit 4 fills in the real path
// (open DB, run schema.sql, attach sqlite-vec, set up FTS5 virtual table).

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import * as path from "node:path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function readSchemaSql() {
  return readFileSync(path.join(__dirname, "schema.sql"), "utf-8")
}

// Unit 4 will add: openDb(deskRoot), runMigrations(db), attachSqliteVec(db), ensureFts(db), etc.
