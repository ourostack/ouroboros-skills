// Shared scaffolding for private work-measurement tests.
//
// Every test gets its own temp desk root, its own private state home, and its
// own fake local-session-record source, so no test reads or writes the
// developer's real ledger or the real host session records.

import Database from "better-sqlite3"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// Column shape of the host's local session records, reproduced here so the
// import contract is exercised against the real column names rather than a
// convenient invention. Every value in a fixture is synthetic.
const SESSION_RECORD_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT,
  repository TEXT,
  host_type TEXT,
  branch TEXT,
  summary TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS assistant_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_index INTEGER,
  agent_id TEXT,
  parent_tool_call_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_nano_aiu INTEGER,
  request_multiplier REAL,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  inter_token_latency_ms INTEGER,
  initiator TEXT,
  api_endpoint TEXT,
  reasoning_effort TEXT,
  finish_reason TEXT,
  content_filter_triggered INTEGER,
  token_details_json TEXT,
  created_at TEXT
);
`

export async function mkLedgerFixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "desk-work-ledger-"))
  const deskRoot = path.join(base, "workspace")
  const stateHome = path.join(base, "state")
  const copilotHome = path.join(base, "copilot-home")
  await fs.mkdir(deskRoot, { recursive: true })
  await fs.mkdir(copilotHome, { recursive: true })
  return {
    base,
    deskRoot,
    stateHome,
    copilotHome,
    sourcePath: path.join(copilotHome, "session-store.db"),
  }
}

/** Build a fake local session-record database holding the given rows. */
export function writeSessionRecords(sourcePath, { sessions = [], events = [] }) {
  const db = new Database(sourcePath)
  try {
    db.exec(SESSION_RECORD_SCHEMA)
    const insertSession = db.prepare(
      "INSERT INTO sessions (id, cwd, repository, host_type, branch, summary, created_at, updated_at) " +
        "VALUES (@id, @cwd, @repository, @host_type, @branch, @summary, @created_at, @updated_at)",
    )
    for (const session of sessions) {
      insertSession.run({
        cwd: null,
        repository: null,
        host_type: null,
        branch: null,
        summary: null,
        created_at: "2026-09-08T00:00:00.000Z",
        updated_at: "2026-09-08T00:00:00.000Z",
        ...session,
      })
    }
    const insertEvent = db.prepare(
      "INSERT INTO assistant_usage_events (id, session_id, turn_index, agent_id, parent_tool_call_id, model, " +
        "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, " +
        "request_multiplier, duration_ms, time_to_first_token_ms, inter_token_latency_ms, initiator, api_endpoint, " +
        "reasoning_effort, finish_reason, content_filter_triggered, token_details_json, created_at) " +
        "VALUES (@id, @session_id, @turn_index, @agent_id, @parent_tool_call_id, @model, " +
        "@input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @reasoning_tokens, @total_nano_aiu, " +
        "@request_multiplier, @duration_ms, @time_to_first_token_ms, @inter_token_latency_ms, @initiator, @api_endpoint, " +
        "@reasoning_effort, @finish_reason, @content_filter_triggered, @token_details_json, @created_at)",
    )
    for (const event of events) {
      insertEvent.run({
        model: "test-model",
        turn_index: 0,
        agent_id: null,
        parent_tool_call_id: null,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_nano_aiu: 0,
        request_multiplier: 1,
        duration_ms: 0,
        time_to_first_token_ms: null,
        inter_token_latency_ms: null,
        initiator: "agent",
        api_endpoint: null,
        reasoning_effort: null,
        finish_reason: "stop",
        content_filter_triggered: 0,
        token_details_json: null,
        ...event,
      })
    }
  } finally {
    db.close()
  }
}

/**
 * Write a host session-state workspace mapping for one local session id.
 * Mirrors the real `<COPILOT_HOME>/session-state/<local id>/workspace.yaml`,
 * whose cloud identifiers are frequently absent and, when present, are usually
 * not the local id.
 */
export async function writeSessionWorkspace(
  copilotHome,
  localSessionId,
  { mcSessionId = null, mcTaskId = null } = {},
) {
  const dir = path.join(copilotHome, "session-state", localSessionId)
  await fs.mkdir(dir, { recursive: true })
  const lines = [
    `id: ${localSessionId}`,
    `host_type: cli`,
    `mc_session_id: ${mcSessionId === null ? "null" : mcSessionId}`,
    `mc_task_id: ${mcTaskId === null ? "null" : mcTaskId}`,
  ]
  await fs.writeFile(path.join(dir, "workspace.yaml"), `${lines.join("\n")}\n`, "utf8")
  return dir
}

export function useHostEnv({ stateHome, copilotHome }) {
  const previous = {
    state: process.env.XDG_STATE_HOME,
    copilot: process.env.COPILOT_HOME,
  }
  process.env.XDG_STATE_HOME = stateHome
  process.env.COPILOT_HOME = copilotHome
  return () => {
    if (previous.state === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous.state
    if (previous.copilot === undefined) delete process.env.COPILOT_HOME
    else process.env.COPILOT_HOME = previous.copilot
  }
}

export async function cleanup(base) {
  await fs.rm(base, { recursive: true, force: true })
}

/** The session id every measurement fixture binds to. */
export const FIXTURE_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

/**
 * Two source observations: one user-initiated, one sub-agent row carrying its
 * parent call. Shared so the import and lifecycle suites cannot drift apart on
 * what the source is supposed to look like.
 */
export function baseSessionRecords() {
  return {
    sessions: [{ id: FIXTURE_SESSION_ID, cwd: "/work/repo", repository: "repo", host_type: "cli" }],
    events: [
      {
        id: 1,
        session_id: FIXTURE_SESSION_ID,
        turn_index: 0,
        model: "model-a",
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 50,
        cache_write_tokens: 10,
        reasoning_tokens: 25,
        total_nano_aiu: 4000,
        request_multiplier: 1,
        duration_ms: 30000,
        initiator: "user",
        created_at: "2026-09-08T18:00:00.000Z",
      },
      {
        id: 2,
        session_id: FIXTURE_SESSION_ID,
        turn_index: 1,
        agent_id: "agent-7",
        parent_tool_call_id: "call-99",
        model: "model-b",
        input_tokens: 500,
        output_tokens: 100,
        total_nano_aiu: 2000,
        request_multiplier: 0.5,
        duration_ms: 20000,
        initiator: "sub-agent",
        created_at: "2026-09-08T18:00:10.000Z",
      },
    ],
  }
}
