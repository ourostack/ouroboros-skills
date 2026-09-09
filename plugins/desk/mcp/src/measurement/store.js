// Private work-measurement ledger store.
//
// Deliberately NOT the qualitative feedback DB (`src/feedback/store.js`): that
// store holds a participant's own words about a preview build and has its own
// explicit-capture contract. This is a separate namespace, a separate database
// file and a separate schema, sharing only the protection primitive that keeps
// both of them owner-only and out of any Git checkout.
//
// Detailed operational facts — phases, cycles, models, sub-agents, usage counts
// — live here and only here. They are not in the desk workspace, not in the
// rebuildable search index, and not transmitted anywhere. Every read returns to
// the caller that asked.

import { withProtectedStore } from "../protected/store.js"

// This store's identity within the shared primitive. Module-internal constants,
// never tool input: no caller can name another store's namespace, file or
// schema. `subject` is what the protection messages call this data, so a
// refusal names work measurement rather than feedback.
const LEDGER_STORE = {
  namespace: "work-ledger",
  filename: "work-ledger.sqlite",
  label: "desk_work_ledger",
  subject: "work measurement",
}

// The ledger schema.
//
// `usage_events` is keyed on where the observation came from — (source,
// session_id, source_event_id) — not on what it was later attributed to. A
// second work item claiming the same source rows produces a visible allocation
// conflict rather than a duplicate row or a silent overwrite.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS work_items (
  work_item_id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  requested_by TEXT,
  request_key TEXT UNIQUE,
  state TEXT NOT NULL,
  intake_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commitments (
  work_item_id TEXT PRIMARY KEY,
  outcome TEXT NOT NULL,
  scope TEXT,
  evidence TEXT,
  delivery_endpoint TEXT,
  operator_go TEXT NOT NULL,
  task_ref TEXT,
  committed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sizings (
  work_item_id TEXT PRIMARY KEY,
  work_type TEXT,
  scope TEXT,
  systems TEXT,
  uncertainty TEXT,
  risk TEXT,
  verification TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phases (
  phase_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  cycle INTEGER,
  state TEXT,
  started_at TEXT,
  ended_at TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scope_changes (
  change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  kind TEXT,
  change TEXT NOT NULL,
  reason TEXT,
  agreed_by TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_item_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  related_work_item_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS completions (
  work_item_id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  evidence TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS closures (
  work_item_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  reason TEXT,
  closed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  work_item_id TEXT,
  machine_id TEXT,
  model TEXT,
  initiator TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  credit_units REAL,
  nano_aiu INTEGER,
  agent_id TEXT,
  parent_tool_call_id TEXT,
  turn_index INTEGER,
  duration_ms INTEGER,
  source_created_at TEXT,
  source_row_sha256 TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (source, session_id, source_event_id)
);

CREATE TABLE IF NOT EXISTS imports (
  import_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT,
  machine_id TEXT,
  requested_since TEXT,
  requested_until TEXT,
  observed_through TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_bindings (
  binding_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  machine_id TEXT,
  bound_at TEXT NOT NULL,
  UNIQUE (work_item_id, source, session_id)
);

CREATE TABLE IF NOT EXISTS cost_bases (
  work_item_id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  rate REAL,
  rate_unit TEXT,
  source TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  evaluation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  measurement_kind TEXT NOT NULL,
  receipt_ref TEXT,
  receipt_sha256 TEXT,
  run_set_id TEXT,
  run_id TEXT,
  case_id TEXT,
  status TEXT,
  grade TEXT,
  availability TEXT,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS corrections (
  correction_id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  corrected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recording_gaps (
  gap_id INTEGER PRIMARY KEY AUTOINCREMENT,
  disabled_at TEXT NOT NULL,
  enabled_at TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS ledger_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tombstones (
  work_item_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL
);
`

/**
 * Open the private ledger, run `body` against it, and always close the handle.
 * The raw database handle is internal to this call — it is closed before this
 * function returns or throws, and no caller outside this module ever holds one.
 */
export async function withLedger({ deskRoot, person = null, env, platform = process.platform }, body) {
  return withProtectedStore(
    { deskRoot, person, env, platform, schemaSql: SCHEMA_SQL, ...LEDGER_STORE },
    ({ db }) => body(db),
  )
}

export { LEDGER_STORE }
