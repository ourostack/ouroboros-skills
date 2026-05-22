-- desk MCP indexer schema. Created on first run at <root>/.state/desk-index.sqlite.
-- Stub schema for Unit 2; columns, indexes, FTS5/sqlite-vec virtual tables fill in in Unit 4.

-- Documents: one row per file under <root>/ that gets indexed (task.md, planning.md, doing.md, friction notes, lessons, journal/diary entries).
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,                -- relative to deskRoot
  kind TEXT NOT NULL,                       -- task | planning | doing | friction | lesson | journal | diary | other
  track TEXT,                               -- nullable; null for top-level _meta/ docs
  task_slug TEXT,                           -- nullable; null for non-task docs
  status TEXT,                              -- task status field (null for non-task)
  schema_version INTEGER DEFAULT 0,
  created_at TEXT,                          -- ISO 8601, from frontmatter
  updated_at TEXT,                          -- ISO 8601, from frontmatter
  hash TEXT NOT NULL,                       -- sha256 of file content for dirty-detection
  mtime INTEGER NOT NULL                    -- filesystem mtime for fast first-pass dirty check
);

CREATE INDEX IF NOT EXISTS idx_docs_track ON docs(track);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON docs(kind);
CREATE INDEX IF NOT EXISTS idx_docs_status ON docs(status);
CREATE INDEX IF NOT EXISTS idx_docs_updated_at ON docs(updated_at);

-- Chunks: one row per semantic chunk extracted from a doc. Unit 4 fills in chunking strategy.
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,             -- 0-based position within doc
  text TEXT NOT NULL,
  heading TEXT,                             -- nearest preceding heading, if any
  start_offset INTEGER,                     -- byte offset into doc
  end_offset INTEGER
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_id ON chunks(doc_id);

-- refs_graph: directed edges between docs (e.g., task.md → its planning.md, doing.md → its task.md).
-- Powers desk_thread (provenance walk) in Unit 6.
CREATE TABLE IF NOT EXISTS refs_graph (
  src_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  dst_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  ref_kind TEXT NOT NULL,                   -- planning_of | doing_of | feedback_of | linked_from_body | predecessor | etc.
  PRIMARY KEY (src_doc_id, dst_doc_id, ref_kind)
);

CREATE INDEX IF NOT EXISTS idx_refs_src ON refs_graph(src_doc_id);
CREATE INDEX IF NOT EXISTS idx_refs_dst ON refs_graph(dst_doc_id);

-- chunks_fts: FTS5 virtual table over chunks.text. Created in Unit 4 with proper tokenization.
-- (Scaffolded as a marker; Unit 4 will write the CREATE VIRTUAL TABLE statement.)
-- CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');

-- chunk_vecs: sqlite-vec virtual table for dense embeddings. Created in Unit 4 once vector dimensionality is known (nomic-embed-text-v1.5 produces 768-dim vectors).
-- CREATE VIRTUAL TABLE chunk_vecs USING vec0(embedding float[768]);
