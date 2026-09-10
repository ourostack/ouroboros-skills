// Reading the host's own local session records.
//
// This is a read of a native local source, never a write to it, and never a
// copy of what was said. Only minimal usage facts and their provenance cross
// into the ledger: model, role, counters, the source's own accounting units,
// and the identifiers needed to know which observation this is. Prompt text,
// responses and transcripts are not read and have no column here.
//
// The source is located from the host's own environment. No caller names it,
// because a caller-named path is a way to point the import at a file of its
// own choosing.

import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const LABEL = "desk_work_ledger"

/**
 * Sources this import understands.
 *
 * `copilot_local_session_records` is the host's own per-machine record of its
 * assistant usage: one row per observation, written locally as it happens.
 *
 * `cloud_session_summary` is deliberately listed and deliberately refused. It
 * is a rolled-up aggregate that lags its own inputs, so a window it reports as
 * empty is indistinguishable from a window it has not caught up with. It cannot
 * establish coverage, and admitting it would let a lagging summary read as a
 * quiet day.
 */
export const KNOWN_SOURCES = {
  copilot_local_session_records: { kind: "native_local", supported: true },
  cloud_session_summary: {
    kind: "aggregate_summary",
    supported: false,
    refusal:
      "a rolled-up aggregate summary lags its own inputs, so it cannot establish " +
      "coverage for a window; import the native local session records instead",
  },
}

/** Where the host keeps its local session records. Never caller-supplied. */
export function localRecordsPath(env = process.env) {
  const home = env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot")
  return path.join(home, "session-store.db")
}

function sessionStateDir(env) {
  const home = env.COPILOT_HOME ?? path.join(os.homedir(), ".copilot")
  return path.join(home, "session-state")
}

/**
 * The optional per-session workspace mapping.
 *
 * On a real host this file is usually absent, and where it exists its cloud
 * identifiers are frequently null and are not the local id. So the local id is
 * the join key and everything here is an optional extra that reports itself
 * unavailable rather than failing the import.
 */
export function readSessionWorkspace(localSessionId, env = process.env) {
  const file = path.join(sessionStateDir(env), localSessionId, "workspace.yaml")
  const absent = { cloud_session_id: null, task_id: null }
  if (!existsSync(file)) return absent
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return absent
  }
  const read = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.*)$`, "mu"))
    if (match === null) return null
    const raw = match[1].trim()
    // An explicit `null` in the mapping is an absent identifier, not the
    // four-character string "null".
    if (raw === "" || raw === "null" || raw === "~") return null
    return raw
  }
  return { cloud_session_id: read("mc_session_id"), task_id: read("mc_task_id") }
}

/** The normalized fields a source row contributes. Identity is not among them. */
const NORMALIZED_FIELDS = [
  "model",
  "initiator",
  "agent_id",
  "parent_tool_call_id",
  "turn_index",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "total_nano_aiu",
  "request_multiplier",
  "duration_ms",
  "created_at",
]

// Counters count things, so they are whole numbers and must be exactly
// representable: a nano-scale accumulator is precisely the field that reaches
// the range where a double silently stops being the number the source reported.
const COUNTER_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "reasoning_tokens",
  "total_nano_aiu",
]

// These are quantities rather than counts. Half a request is a real value and
// so is a fractional millisecond, so holding them to whole numbers would refuse
// data the source legitimately carries. They still cannot be a magnitude
// arithmetic will not carry.
const FRACTIONAL_FIELDS = ["request_multiplier", "duration_ms"]

/**
 * Open the local records read-only and return every row for one session, plus
 * the latest timestamp the source actually holds for it.
 *
 * Throws a typed error when the records are absent or unreadable: a source that
 * cannot be read is not an empty source, and must not be reported as one.
 */
export function readSessionRows({ sessionId, env = process.env }) {
  const file = localRecordsPath(env)
  if (!existsSync(file)) {
    throw new Error(
      `${LABEL}: the host's local session records are not present at ${file}. ` +
        `Nothing was imported; an unreadable source is not an empty one.`,
    )
  }
  // The file is known to exist and is opened read-only, so construction itself
  // does not decide whether the source is usable. The header probe below is
  // what rejects a file that is present but is not a database, and it runs with
  // a handle that is already open — so every failure from here closes it.
  const db = new Database(file, { readonly: true, fileMustExist: true })
  let known
  let rows
  try {
    // Every read of the source sits inside this one boundary. A file that is
    // not a database and a database that is not this schema are both the source
    // being unreadable, and a schema error is the likelier of the two against a
    // real host — so neither may reach the caller in the driver's vocabulary.
    known = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId)
    rows = db
      .prepare(
        "SELECT id, session_id, turn_index, agent_id, parent_tool_call_id, model, " +
          "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, " +
          "total_nano_aiu, request_multiplier, duration_ms, initiator, created_at " +
          "FROM assistant_usage_events WHERE session_id = ? ORDER BY id",
      )
      .all(sessionId)
  } catch (error) {
    throw new Error(
      `${LABEL}: the host's local session records at ${file} could not be read: ${error.message}`,
    )
  } finally {
    db.close()
  }
  return { sessionKnown: known !== undefined, rows }
}

/**
 * Classify one source row.
 *
 * Returns either a normalized fact or the reason the row is not data. A missing
 * counter stays missing — it is not a zero — but a counter the source cannot
 * mean, a surrogate id too large to represent exactly, or a timestamp that is
 * not one are all refused rather than guessed.
 */
export function normalizeRow(row) {
  if (!Number.isSafeInteger(row.id)) {
    return { malformed: "unsafe_integer_id", source_event_id: String(row.id) }
  }
  for (const field of COUNTER_FIELDS) {
    const value = row[field]
    if (value === null || value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { malformed: "negative_counter", source_event_id: row.id }
    }
    // A counter counts things, so it is whole; and it has to be exactly
    // representable, or what gets stored is not the number the source reported.
    // Calling either one "measured" would be the lie this ledger exists to
    // avoid, so the row is refused with its reason rather than rounded.
    if (!Number.isSafeInteger(value)) {
      return { malformed: "unrepresentable_counter", source_event_id: row.id }
    }
  }
  for (const field of FRACTIONAL_FIELDS) {
    const value = row[field]
    if (value === null || value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { malformed: "negative_counter", source_event_id: row.id }
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      return { malformed: "unrepresentable_counter", source_event_id: row.id }
    }
  }
  const createdAt = normalizeTimestamp(row.created_at)
  if (createdAt === null) {
    return { malformed: "invalid_timestamp", source_event_id: row.id }
  }

  const fact = {
    source_event_id: row.id,
    model: row.model,
    initiator: row.initiator ?? null,
    agent_id: row.agent_id ?? null,
    parent_tool_call_id: row.parent_tool_call_id ?? null,
    turn_index: row.turn_index ?? null,
    input_tokens: nullableNumber(row.input_tokens),
    output_tokens: nullableNumber(row.output_tokens),
    cache_read_tokens: nullableNumber(row.cache_read_tokens),
    cache_write_tokens: nullableNumber(row.cache_write_tokens),
    reasoning_tokens: nullableNumber(row.reasoning_tokens),
    total_nano_aiu: nullableNumber(row.total_nano_aiu),
    request_multiplier: nullableNumber(row.request_multiplier),
    duration_ms: nullableNumber(row.duration_ms),
    created_at: createdAt,
  }
  fact.normalized_sha256 = normalizedDigest(fact)
  return { fact }
}

/**
 * A fingerprint of every normalized field of a row, identity excluded.
 *
 * Two source rows with the same fingerprint are indistinguishable on everything
 * the source actually reports, which is what the normalized-distinct view
 * collapses. It is also what notices a row that changed after it was imported.
 */
export function normalizedDigest(fact) {
  const payload = {}
  for (const field of NORMALIZED_FIELDS) payload[field] = fact[field] ?? null
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex")
}

function nullableNumber(value) {
  return value === null || value === undefined ? null : value
}

/**
 * A source or operator timestamp, or nothing.
 *
 * Exactly two shapes are admitted, because `Date.parse` reads a date-time with
 * no offset as *host-local* and a bare date or year as a valid instant. Either
 * would silently displace an observation by the host's UTC offset, or invent an
 * instant from a calendar day, and then report the result as measured.
 *
 * 1. Any date-time carrying its own `Z` or `±HH:MM` offset — unambiguous.
 * 2. `YYYY-MM-DD HH:MM:SS[.sss]` with no offset, read deliberately as UTC.
 *    This is SQLite's own `datetime()` / `CURRENT_TIMESTAMP` output, whose
 *    documented convention is UTC. It is admitted by that convention alone, not
 *    by guessing.
 *
 * Everything else — a date, a year, a `T`-separated form with no offset, a
 * shape that is not a real instant — is refused rather than guessed. A calendar
 * day that is genuinely a day, such as a rate's `effective_date`, is not a
 * timestamp and deliberately does not come through here.
 */
const INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/u
const SQLITE_UTC_INSTANT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/u

export function normalizeTimestamp(value) {
  if (typeof value !== "string") return null
  const text = value.trim()
  let candidate = null
  if (INSTANT_WITH_OFFSET.test(text)) candidate = text.replace(" ", "T")
  else if (SQLITE_UTC_INSTANT.test(text)) candidate = `${text.replace(" ", "T")}Z`
  if (candidate === null) return null
  // The shape can be right while the instant is not: month 13, hour 25.
  const parsed = Date.parse(candidate)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toISOString()
}
