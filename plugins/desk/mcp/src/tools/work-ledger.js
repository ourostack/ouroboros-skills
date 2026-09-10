// desk_work_ledger — the owner's own private record of their own work.
//
// A work item is one request for one specific independently assessable
// outcome. A prompt, a session, a pull request and an implementation step are
// not work items. Identity is taken at intake, before any commitment exists, so
// an outcome cannot be reset or split into a fresh accounting once it turns out
// to be expensive.
//
// The ledger owns accounting; it does not own lifecycle and it does not own
// canonical record. A canonical task in the Git-backed desk stays canonical:
// this tool reads it and reports agreement or disagreement, and never writes to
// it. Detailed operational facts live in the owner's protected store outside
// Git, and every read returns to this caller only — there is no share, export,
// publish or sync route, and no route accepts a caller-chosen location.
//
// It measures work, not people. Nothing here ranks, scores, or leaves the
// person it describes.

import { randomUUID } from "node:crypto"

import { nowIso } from "../util/fm.js"
import { CAPTURE_ROUTES, LEDGER_ACTIONS } from "../measurement/actions.js"
import { withLedger } from "../measurement/store.js"
import { readCanonicalStatus, resolveTaskRef } from "../measurement/identity.js"
import {
  KNOWN_SOURCES,
  normalizeRow,
  normalizedDigest,
  normalizeTimestamp,
  readSessionRows,
  readSessionWorkspace,
} from "../measurement/copilot-usage.js"
import { buildReport, readGaps, readRecording } from "../measurement/report.js"
import { buildReview } from "../measurement/review.js"

const LABEL = "desk_work_ledger"

const CLOSE_STATES = new Set(["cancelled", "abandoned", "superseded"])

// Derived, not restated. A state a closure can produce is a state the guard has
// to know about: when the two lists were written separately, `abandoned` was
// reachable through `close` and absent here, so an abandoned item went on
// accepting phases, scope changes and even a completion.
const TERMINAL_STATES = new Set([...CLOSE_STATES, "completed"])

// Routes a terminal work item does not accept. Correction, deletion,
// inspection and reporting are absent by design: they are the owner's rights
// over what is already recorded, and closed work stays visible and correctable.
const TRANSITION_GUARDED = new Set([
  "commit",
  "size",
  "phase",
  "scope_change",
  "link",
  "complete",
  "close",
  "import_usage",
])

// Routes whose work_item_id names a record that must already exist.
const REQUIRES_ITEM = new Set([
  "commit",
  "size",
  "phase",
  "scope_change",
  "link",
  "complete",
  "close",
  "correct",
  "delete",
  "inspect",
  "import_usage",
  "cost_basis",
  "link_evaluation_receipt",
])

// A relation records how two outcomes actually relate. Absent by design are
// relations that would retire an outcome's accounting into a fresh one —
// "replaces", "supersedes", "resets", "splits" — because necessary rework
// belongs to the original item and a genuinely new outcome is linked, not
// substituted.
const LINK_RELATIONS = new Set(["child", "parent", "follow_on", "related", "depends_on"])

// Fields an owner may correct: the ones a person declared. A measured
// observation is what a source said, and no correction may edit it into saying
// something else.
const CORRECTABLE = {
  request: { table: "work_items", column: "request" },
  requested_by: { table: "work_items", column: "requested_by" },
  outcome: { table: "commitments", column: "outcome" },
  scope: { table: "commitments", column: "scope" },
  evidence: { table: "commitments", column: "evidence" },
  delivery_endpoint: { table: "commitments", column: "delivery_endpoint" },
}

const DELETION_TABLES = [
  ["commitments", "DELETE FROM commitments WHERE work_item_id = ?"],
  ["completions", "DELETE FROM completions WHERE work_item_id = ?"],
  ["closures", "DELETE FROM closures WHERE work_item_id = ?"],
  ["corrections", "DELETE FROM corrections WHERE work_item_id = ?"],
  ["cost_bases", "DELETE FROM cost_bases WHERE work_item_id = ?"],
  ["evaluations", "DELETE FROM evaluations WHERE work_item_id = ?"],
  ["imports", "DELETE FROM imports WHERE work_item_id = ?"],
  ["phases", "DELETE FROM phases WHERE work_item_id = ?"],
  ["scope_changes", "DELETE FROM scope_changes WHERE work_item_id = ?"],
  ["session_bindings", "DELETE FROM session_bindings WHERE work_item_id = ?"],
  ["sizings", "DELETE FROM sizings WHERE work_item_id = ?"],
  ["usage_events", "DELETE FROM usage_events WHERE work_item_id = ?"],
  [
    "work_item_links",
    "DELETE FROM work_item_links WHERE work_item_id = ? OR related_work_item_id = ?",
  ],
  ["work_items", "DELETE FROM work_items WHERE work_item_id = ?"],
]

const EVENTS_NOTE =
  "These rows are usage observations as the source recorded them, not proven " +
  "billable requests: the source carries no authoritative billing identifier."

/**
 * desk_work_ledger
 *
 * One `action` per call. Validation runs in a fixed order — the recording
 * switch first, then the terminal-state guard, then field validation — so a
 * call made while recording is off is told that, rather than being told about
 * a field in a request that was never going to be recorded.
 */
export async function desk_work_ledger({ deskRoot, input, person = null, env = process.env }) {
  const values = input ?? {}
  const action = values.action
  if (!Object.hasOwn(LEDGER_ACTIONS, action)) {
    throw new Error(
      `${LABEL}: unknown action ${JSON.stringify(action ?? null)} — ` +
        `expected one of ${Object.keys(LEDGER_ACTIONS).join(", ")}.`,
    )
  }

  return withLedger({ deskRoot, person, env }, (db) => {
    // 1. The recording switch. Capture routes stop here when it is off; the
    //    owner's inspect, correct, delete, report and the switch itself do not.
    assertRecordingAllows(db, action)

    // 2. The terminal-state guard, which needs the record itself.
    let item = null
    if (REQUIRES_ITEM.has(action)) {
      item = requireOpenItem(db, action, values.work_item_id)
    }

    // 3. Field validation.
    rejectUnknownFields(values, LEDGER_ACTIONS[action])

    return ROUTES[action]({ db, values, item, deskRoot, person, env })
  })
}

// Gates 1 and 2, as functions rather than inline blocks, because `commit` has
// to run them a second time. A route that awaits anything has let go of the
// database between its checks and its writes, and the only honest way to close
// that window is to re-ask the same questions in the same words immediately
// before writing — the caller must not be able to tell which pass refused.

function assertRecordingAllows(db, action) {
  if (CAPTURE_ROUTES.has(action) && !readRecording(db).enabled) {
    throw new Error(
      `${LABEL}: recording is disabled, so ${action} was refused and nothing was ` +
        `recorded. Re-enable recording to resume capture; the window stays a ` +
        `visible gap in coverage rather than being backfilled later.`,
    )
  }
}

function requireOpenItem(db, action, workItemId) {  const item = requireItem(db, workItemId)
  if (TRANSITION_GUARDED.has(action) && TERMINAL_STATES.has(item.state)) {
    throw new Error(
      `${LABEL}: work item ${item.work_item_id} is ${item.state} — a terminal work ` +
        `item does not accept ${action}. Closed work stays visible as it was ` +
        `rather than being reopened under a fresh accounting.`,
    )
  }
  return item
}

function assertUncommitted(db, workItemId) {
  if (db.prepare("SELECT 1 FROM commitments WHERE work_item_id = ?").get(workItemId)) {
    throw new Error(
      `${LABEL}: work item ${workItemId} is already committed. A second ` +
        `commitment would restate the same outcome as a new one.`,
    )
  }
}

const ROUTES = {
  capabilities: () => ({
    status: "ok",
    routes: Object.entries(LEDGER_ACTIONS).map(([route, fields]) => ({
      route,
      availability: "available",
      bound: true,
      captures: CAPTURE_ROUTES.has(route),
      fields: fields.filter((field) => field !== "action"),
    })),
  }),

  intake: ({ db, values }) => {
    const request = requireText(values, "request")
    const requestKey = optionalText(values, "request_key")
    if (requestKey !== null) {
      const existing = db
        .prepare("SELECT * FROM work_items WHERE request_key = ?")
        .get(String(requestKey))
      if (existing !== undefined) {
        // A lost response is not a second outcome. The same key replays the
        // original item; the same key over a different request is a conflict,
        // never a silent overwrite of what was recorded first.
        if (existing.request !== request) {
          throw new Error(
            `${LABEL}: request_key ${JSON.stringify(requestKey)} already identifies a ` +
              `different request. A replay must repeat the request it first recorded; ` +
              `a genuinely different outcome needs its own intake.`,
          )
        }
        return {
          status: "intake_replayed",
          work_item_id: existing.work_item_id,
          work_item: shapeItem(db, existing),
        }
      }
    }

    const now = nowIso()
    const workItemId = randomUUID()
    db.prepare(
      "INSERT INTO work_items (work_item_id, request, requested_by, request_key, state, intake_at, revision, updated_at) " +
        "VALUES (?, ?, ?, ?, 'intake', ?, 1, ?)",
    ).run(workItemId, request, optionalText(values, "requested_by"), requestKey, now, now)

    return {
      status: "intake_recorded",
      work_item_id: workItemId,
      work_item: shapeItem(db, readItem(db, workItemId)),
    }
  },

  commit: ({ db, values, item, deskRoot, person }) => {
    assertUncommitted(db, item.work_item_id)
    const outcome = requireText(values, "outcome")
    const scope = requireText(values, "scope")
    const evidence = requireText(values, "evidence")
    const endpoint = requireText(values, "delivery_endpoint")
    const go = values.operator_go
    if (go === undefined || go === null || typeof go !== "object" || Array.isArray(go)) {
      throw new Error(
        `${LABEL}: commit requires operator_go — an explicit go recording who agreed ` +
          `and when. Commitment is a decision somebody made, not an inference.`,
      )
    }
    if (typeof go.by !== "string" || go.by.trim() === "" || typeof go.at !== "string") {
      throw new Error(`${LABEL}: operator_go requires both "by" and "at".`)
    }

    return (async () => {
      // Reading the canonical card is a filesystem read, so the ledger has let
      // go of the database here. Another call on this person's store — the
      // recording switch, a deletion, a closure — can land in this gap and did:
      // the commitment used to be written afterwards regardless, leaving a row
      // attached to an item that no longer existed or had already been closed.
      const taskRef = await resolveTaskRef({ deskRoot, person, taskRef: values.task_ref ?? null })
      return db.transaction(() => {
        assertRecordingAllows(db, "commit")
        const current = requireOpenItem(db, "commit", item.work_item_id)
        assertUncommitted(db, current.work_item_id)
        const now = nowIso()
        db.prepare(
          "INSERT INTO commitments (work_item_id, outcome, scope, evidence, delivery_endpoint, operator_go, task_ref, committed_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          current.work_item_id,
          outcome,
          scope,
          evidence,
          endpoint,
          JSON.stringify({ by: go.by, at: go.at }),
          taskRef === null ? null : JSON.stringify(taskRef),
          now,
        )
        touch(db, current.work_item_id, "committed", now)
        return {
          status: "committed",
          work_item: shapeItem(db, readItem(db, current.work_item_id)),
          commitment: {
            class: "declared",
            outcome,
            scope,
            evidence,
            delivery_endpoint: endpoint,
            operator_go: { by: go.by, at: go.at },
            task_ref: taskRef,
            committed_at: now,
          },
        }
      })()
    })()
  },

  size: ({ db, values, item }) => {
    // Size features are recorded before execution or not at all. A figure
    // written once the work is done is hindsight, and hindsight complexity is
    // exactly what this must not collect.
    const firstExecution = firstExecutionAt(db, item.work_item_id)
    if (firstExecution !== null) {
      throw new Error(
        `${LABEL}: size features must be recorded before execution. Execution ` +
          `evidence for work item ${item.work_item_id} already exists from ` +
          `${firstExecution}, so a size recorded now would be hindsight.`,
      )
    }
    if (db.prepare("SELECT 1 FROM sizings WHERE work_item_id = ?").get(item.work_item_id)) {
      throw new Error(`${LABEL}: work item ${item.work_item_id} already has size features.`)
    }
    const size = {
      work_type: requireText(values, "work_type"),
      scope: requireText(values, "scope"),
      systems: requireList(values, "systems"),
      uncertainty: requireText(values, "uncertainty"),
      risk: requireText(values, "risk"),
      verification: requireText(values, "verification"),
    }
    const now = nowIso()
    db.prepare(
      "INSERT INTO sizings (work_item_id, work_type, scope, systems, uncertainty, risk, verification, recorded_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      item.work_item_id,
      size.work_type,
      size.scope,
      JSON.stringify(size.systems),
      size.uncertainty,
      size.risk,
      size.verification,
      now,
    )
    return {
      status: "size_recorded",
      size: { class: "declared", ...size, recorded_at: now },
    }
  },

  phase: ({ db, values, item }) => {
    const phase = requireText(values, "phase")
    const startedAt = optionalTimestamp(values, "started_at")
    const endedAt = optionalTimestamp(values, "ended_at")
    if (startedAt !== null && endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt)) {
      throw new Error(
        `${LABEL}: phase ${JSON.stringify(phase)} ends before it starts ` +
          `(${startedAt} → ${endedAt}). A reversed interval is not a duration.`,
      )
    }
    const now = nowIso()
    // Validated before the insert, not while shaping the response: the older
    // order wrote the row with a coerced `String(values.cycle)` and only then
    // discovered the value was not a string, leaving a phase behind that a
    // later `size` would read as execution evidence.
    const cycle = optionalText(values, "cycle")
    const state = optionalText(values, "state")
    db.prepare(
      "INSERT INTO phases (work_item_id, phase, cycle, state, started_at, ended_at, recorded_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(item.work_item_id, phase, cycle, state, startedAt, endedAt, now)
    return {
      status: "phase_recorded",
      phase: { class: "declared", phase, cycle, started_at: startedAt, ended_at: endedAt },
    }
  },

  scope_change: ({ db, values, item }) => {
    // A scope change stays on the item it changed. Necessary rework is part of
    // the original outcome's cost, and moving it elsewhere would launder that.
    const change = requireText(values, "change")
    const now = nowIso()
    db.prepare(
      "INSERT INTO scope_changes (work_item_id, kind, change, reason, agreed_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      item.work_item_id,
      optionalText(values, "kind"),
      change,
      optionalText(values, "reason"),
      optionalText(values, "agreed_by"),
      now,
    )
    return {
      status: "scope_change_recorded",
      work_item_id: item.work_item_id,
      scope_change: { class: "declared", kind: optionalText(values, "kind"), change, recorded_at: now },
    }
  },

  link: ({ db, values, item }) => {
    const related = requireText(values, "related_work_item_id")
    const relation = requireText(values, "relation")
    if (!LINK_RELATIONS.has(relation)) {
      throw new Error(
        `${LABEL}: unknown relation ${JSON.stringify(relation)} — expected one of ` +
          `${[...LINK_RELATIONS].join(", ")}. A relation that retires one outcome's ` +
          `accounting into another's would let cost be re-labelled rather than linked.`,
      )
    }
    db.prepare(
      "INSERT INTO work_item_links (work_item_id, related_work_item_id, relation, recorded_at) VALUES (?, ?, ?, ?)",
    ).run(item.work_item_id, related, relation, nowIso())
    return { status: "linked", work_item_id: item.work_item_id, related_work_item_id: related, relation }
  },

  complete: ({ db, values, item, deskRoot }) => {
    const commitment = db
      .prepare("SELECT * FROM commitments WHERE work_item_id = ?")
      .get(item.work_item_id)
    if (commitment === undefined) {
      throw new Error(
        `${LABEL}: work item ${item.work_item_id} has no commitment, so there is no ` +
          `agreed endpoint to complete against. Record the commit first.`,
      )
    }
    const endpoint = requireText(values, "endpoint")
    if (endpoint !== commitment.delivery_endpoint) {
      throw new Error(
        `${LABEL}: endpoint ${JSON.stringify(endpoint)} is not the committed delivery ` +
          `endpoint ${JSON.stringify(commitment.delivery_endpoint)}. Completion is ` +
          `measured against the endpoint that was agreed, not one chosen afterwards.`,
      )
    }
    const evidence = requireText(values, "evidence")

    return (async () => {
      const now = nowIso()
      db.prepare(
        "INSERT INTO completions (work_item_id, endpoint, evidence, completed_at) VALUES (?, ?, ?, ?)",
      ).run(item.work_item_id, endpoint, evidence, now)
      touch(db, item.work_item_id, "completed", now)
      return {
        status: "completed",
        work_item: shapeItem(db, readItem(db, item.work_item_id)),
        completion: await shapeCompletion(db, item.work_item_id, deskRoot),
      }
    })()
  },

  close: ({ db, values, item }) => {
    const state = requireText(values, "state")
    if (!CLOSE_STATES.has(state)) {
      throw new Error(
        `${LABEL}: unknown close state ${JSON.stringify(state)} — expected one of ` +
          `${[...CLOSE_STATES].join(", ")}.`,
      )
    }
    const now = nowIso()
    db.prepare("INSERT INTO closures (work_item_id, state, reason, closed_at) VALUES (?, ?, ?, ?)").run(
      item.work_item_id,
      state,
      optionalText(values, "reason"),
      now,
    )
    touch(db, item.work_item_id, state, now)
    return {
      status: "closed",
      work_item: shapeItem(db, readItem(db, item.work_item_id)),
      closure: { class: "declared", state, reason: optionalText(values, "reason"), closed_at: now },
    }
  },

  correct: ({ db, values, item }) => {
    const field = requireText(values, "field")
    const target = CORRECTABLE[field]
    if (target === undefined) {
      throw new Error(
        `${LABEL}: ${JSON.stringify(field)} is not correctable. Only declared fields ` +
          `(${Object.keys(CORRECTABLE).join(", ")}) may be corrected; a measured ` +
          `observation records what the source said and is not editable.`,
      )
    }
    if (!Object.hasOwn(values, "value")) {
      throw new Error(`${LABEL}: correct requires the replacement value.`)
    }
    // Every correctable field is one the record was required to state. A
    // correction replaces a wrong sentence with a right one; it is not a way to
    // leave the item without the thing that makes it assessable.
    if (values.value === null) {
      throw new Error(
        `${LABEL}: ${JSON.stringify(field)} cannot be cleared by a correction — ` +
          `supply the corrected value, or delete the work item if it should not exist.`,
      )
    }
    // Optimistic concurrency, and not optional: a correction a caller could
    // skip the check on is not a check. The revision the caller read is the
    // revision they are allowed to overwrite.
    const expected = values.expected_revision
    if (typeof expected !== "number" || !Number.isInteger(expected)) {
      throw new Error(
        `${LABEL}: correct requires expected_revision, the integer revision the ` +
          `caller read. Work item ${item.work_item_id} is at revision ${item.revision}.`,
      )
    }
    if (expected !== item.revision) {
      throw new Error(
        `${LABEL}: expected revision ${JSON.stringify(expected)} but work ` +
          `item ${item.work_item_id} is at revision ${item.revision}. A correction ` +
          `written against a stale read would overwrite an edit it never saw.`,
      )
    }
    const row = db
      .prepare(`SELECT ${target.column} AS current FROM ${target.table} WHERE work_item_id = ?`)
      .get(item.work_item_id)
    if (row === undefined) {
      throw new Error(
        `${LABEL}: work item ${item.work_item_id} has no ${field} to correct yet.`,
      )
    }
    const now = nowIso()
    // Both remaining fields are validated before the first write, and the three
    // writes are one transaction. A correction that half-applied left the item
    // holding the new sentence with no history row saying it had changed and no
    // revision bump to make the change visible to the next reader.
    const value = requireCorrectionValue(values)
    const reason = optionalText(values, "reason")
    return db.transaction(() => {
      db.prepare(
        `UPDATE ${target.table} SET ${target.column} = ? WHERE work_item_id = ?`,
      ).run(value, item.work_item_id)
      db.prepare(
        "INSERT INTO corrections (work_item_id, field, previous_value, new_value, reason, corrected_at) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      ).run(item.work_item_id, field, row.current, value, reason, now)
      db.prepare(
        "UPDATE work_items SET revision = revision + 1, updated_at = ? WHERE work_item_id = ?",
      ).run(now, item.work_item_id)
      return {
        status: "corrected",
        work_item: shapeItem(db, readItem(db, item.work_item_id)),
        correction: {
          class: "declared",
          field,
          previous_value: row.current,
          new_value: value,
          reason,
          corrected_at: now,
        },
      }
    })()
  },

  delete: ({ db, values, item }) => {
    if (values.confirm !== true) {
      throw new Error(`${LABEL}: delete requires confirm:true — it destroys the record.`)
    }
    const removed = []
    const run = db.transaction(() => {
      for (const [table, sql] of DELETION_TABLES) {
        const params = table === "work_item_links"
          ? [item.work_item_id, item.work_item_id]
          : [item.work_item_id]
        const result = db.prepare(sql).run(...params)
        if (result.changes > 0) removed.push({ table, count: result.changes })
      }
      // What remains says only that coverage shrank, and when. It carries no
      // field of the record it replaces.
      db.prepare("INSERT INTO tombstones (work_item_id, deleted_at) VALUES (?, ?)").run(
        item.work_item_id,
        nowIso(),
      )
    })
    run()
    return { status: "deleted", work_item_id: item.work_item_id, removed_rows: removed }
  },

  inspect: ({ db, item, deskRoot }) =>
    (async () => {
      const fresh = readItem(db, item.work_item_id)
      return {
        status: "ok",
        work_item: {
          ...shapeItem(db, fresh),
          completion: await shapeCompletion(db, item.work_item_id, deskRoot),
        },
        size: shapeSize(db, item.work_item_id),
        phases: db
          .prepare("SELECT * FROM phases WHERE work_item_id = ? ORDER BY phase_id")
          .all(item.work_item_id)
          .map((row) => ({
            phase: row.phase,
            cycle: row.cycle,
            state: row.state,
            started_at: row.started_at,
            ended_at: row.ended_at,
            recorded_at: row.recorded_at,
          })),
        usage: db
          .prepare("SELECT * FROM usage_events WHERE work_item_id = ? ORDER BY source_event_id")
          .all(item.work_item_id)
          .map(shapeUsage),
        corrections: db
          .prepare("SELECT * FROM corrections WHERE work_item_id = ? ORDER BY correction_id")
          .all(item.work_item_id)
          .map((row) => ({
            field: row.field,
            previous_value: row.previous_value,
            new_value: row.new_value,
            reason: row.reason,
            corrected_at: row.corrected_at,
          })),
        links: db
          .prepare(
            "SELECT * FROM work_item_links WHERE work_item_id = ? OR related_work_item_id = ? ORDER BY link_id",
          )
          .all(item.work_item_id, item.work_item_id)
          .map((row) => ({
            work_item_id: row.work_item_id,
            related_work_item_id: row.related_work_item_id,
            relation: row.relation,
          })),
        scope_changes: db
          .prepare("SELECT * FROM scope_changes WHERE work_item_id = ? ORDER BY change_id")
          .all(item.work_item_id)
          .map((row) => ({ kind: row.kind, change: row.change, reason: row.reason, recorded_at: row.recorded_at })),
        // References only. The owner can see what was linked without this
        // ledger ever having held the evaluation payload itself.
        evaluation_receipts: db
          .prepare("SELECT * FROM evaluations WHERE work_item_id = ? ORDER BY evaluation_id")
          .all(item.work_item_id)
          .map((row) => ({
            measurement_kind: row.measurement_kind,
            receipt_ref: row.receipt_ref,
            receipt_sha256: row.receipt_sha256,
            run_set_id: row.run_set_id,
            run_id: row.run_id,
            case_id: row.case_id,
            status: row.status,
            grade: row.grade,
            availability: row.availability,
            recorded_at: row.recorded_at,
          })),
      }
    })(),

  report: ({ db, values, person }) =>
    buildReport(db, {
      person,
      workItemId: values.work_item_id ?? null,
      includePhaseSpan: values.include_phase_span === true,
      asOf: nowIso(),
    }),

  // A read, so it stays available while recording is off: the owner's right to
  // look at what is already held does not depend on new capture being on.
  review: ({ db, values }) =>
    buildReview(db, {
      since: values.since,
      until: values.until,
      carryForward: values.carry_forward,
    }),

  import_usage: ({ db, values, item, env }) => importUsage({ db, values, item, env }),

  cost_basis: ({ db, values, item }) => {
    // One declared basis per item, replaced rather than accumulated: two
    // simultaneous prices on one outcome have no representable meaning, and
    // silently adding a second would invent a total nobody asserted.
    const amount = requireFiniteNumber(values, "amount")
    const currency = requireText(values, "currency")
    const rate = requireFiniteNumber(values, "rate")
    const rateUnit = requireText(values, "rate_unit")
    const source = requireText(values, "source")
    const effectiveDate = requireText(values, "effective_date")

    const existing = db.prepare("SELECT * FROM cost_bases WHERE work_item_id = ?").get(item.work_item_id)
    if (existing === undefined) {
      db.prepare(
        "INSERT INTO cost_bases (work_item_id, amount, currency, rate, rate_unit, source, effective_date, revision, recorded_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)",
      ).run(item.work_item_id, amount, currency, rate, rateUnit, source, effectiveDate, nowIso())
      return { status: "cost_basis_recorded", revision: 1, ...shapeBasis(db, item.work_item_id) }
    }
    if (!Object.hasOwn(values, "expected_revision")) {
      throw new Error(
        `${LABEL}: work item ${item.work_item_id} already has a cost basis at revision ` +
          `${existing.revision}. Pass expected_revision to replace it; the ledger holds ` +
          `one declared basis per item rather than adding a competing one.`,
      )
    }
    if (values.expected_revision !== existing.revision) {
      throw new Error(
        `${LABEL}: expected revision ${JSON.stringify(values.expected_revision)} but the ` +
          `cost basis for ${item.work_item_id} is at revision ${existing.revision}.`,
      )
    }
    const next = existing.revision + 1
    db.prepare(
      "UPDATE cost_bases SET amount = ?, currency = ?, rate = ?, rate_unit = ?, source = ?, " +
        "effective_date = ?, revision = ?, recorded_at = ? WHERE work_item_id = ?",
    ).run(amount, currency, rate, rateUnit, source, effectiveDate, next, nowIso(), item.work_item_id)
    return { status: "cost_basis_replaced", revision: next, ...shapeBasis(db, item.work_item_id) }
  },

  set_recording: ({ db, values }) => {
    if (typeof values.enabled !== "boolean") {
      throw new Error(`${LABEL}: set_recording requires enabled:true or enabled:false.`)
    }
    const current = readRecording(db).enabled
    const now = nowIso()
    if (values.enabled !== current) {
      if (values.enabled) {
        db.prepare(
          "UPDATE recording_gaps SET enabled_at = ? WHERE enabled_at IS NULL",
        ).run(now)
      } else {
        db.prepare("INSERT INTO recording_gaps (disabled_at, enabled_at, reason) VALUES (?, NULL, ?)").run(
          now,
          optionalText(values, "reason"),
        )
      }
      db.prepare(
        "INSERT INTO ledger_state (key, value) VALUES ('recording_enabled', ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(values.enabled ? "1" : "0")
    }
    return {
      status: values.enabled ? "recording_enabled" : "recording_disabled",
      recording: { class: "declared", enabled: values.enabled, changed_at: now },
      recording_gaps: readGaps(db),
    }
  },

  link_evaluation_receipt: ({ db, values, item }) => {
    // A reference, never a payload. The evaluation owner keeps its own
    // artefacts; this records that they exist and what they claimed.
    const kind = requireText(values, "measurement_kind")
    if (kind !== "offline_evaluation") {
      throw new Error(
        `${LABEL}: measurement_kind ${JSON.stringify(kind)} is not accepted — this seam ` +
          `records offline_evaluation receipts only. Feedback and package diagnostics ` +
          `are not online evaluation, and this ledger is not an assessment engine.`,
      )
    }
    const receiptRef = requireText(values, "receipt_ref")
    // Validated like its neighbours rather than bound raw: an array digest used
    // to be accepted, stored as SQLite's own stringification, and echoed back to
    // the caller in the shape they sent — so the response and the record
    // disagreed about what had been written.
    const receiptSha256 = optionalText(values, "receipt_sha256")
    const now = nowIso()
    db.prepare(
      "INSERT INTO evaluations (work_item_id, measurement_kind, receipt_ref, receipt_sha256, run_set_id, run_id, case_id, status, grade, availability, recorded_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      item.work_item_id,
      kind,
      receiptRef,
      receiptSha256,
      optionalText(values, "run_set_id"),
      optionalText(values, "run_id"),
      optionalText(values, "case_id"),
      optionalText(values, "status"),
      optionalText(values, "grade"),
      optionalText(values, "availability"),
      now,
    )
    return {
      status: "evaluation_receipt_linked",
      receipt: {
        class: "declared",
        measurement_kind: kind,
        receipt_ref: receiptRef,
        receipt_sha256: receiptSha256,
        run_set_id: optionalText(values, "run_set_id"),
        run_id: optionalText(values, "run_id"),
        case_id: optionalText(values, "case_id"),
        status: optionalText(values, "status"),
        grade: optionalText(values, "grade"),
        availability: optionalText(values, "availability"),
        recorded_at: now,
      },
    }
  },
}

/**
 * Pull minimal usage facts out of the host's own local records.
 *
 * Identity of an observation belongs to the source — (source, session_id,
 * source_event_id). The work item and machine are the caller's declaration
 * about that observation, so relabelling one does not make it a new
 * observation, and a second work item claiming it is a visible conflict rather
 * than a second copy counted twice.
 */
function importUsage({ db, values, item, env }) {
  const source = requireText(values, "source")
  const known = KNOWN_SOURCES[source]
  if (known === undefined) {
    throw new Error(
      `${LABEL}: unknown source ${JSON.stringify(source)} — expected one of ` +
        `${Object.keys(KNOWN_SOURCES).join(", ")}.`,
    )
  }
  if (!known.supported) {
    throw new Error(`${LABEL}: source ${JSON.stringify(source)} is refused: ${known.refusal}.`)
  }
  const sessionId = values.session_id
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new Error(
      `${LABEL}: import_usage requires an explicit session_id. The ledger will not ` +
        `guess the caller's own session from its environment: a guessed binding ` +
        `attributes somebody's work to an outcome nobody named.`,
    )
  }
  const since = optionalTimestamp(values, "since")
  const until = optionalTimestamp(values, "until")
  const machineId = optionalText(values, "machine_id")

  const { sessionKnown, rows } = readSessionRows({ sessionId, env })
  if (!sessionKnown) {
    throw new Error(
      `${LABEL}: session ${JSON.stringify(sessionId)} is not present in the local session records.`,
    )
  }

  // Closed windows only, compared as instants: recording timestamps and native
  // source timestamps are not written at the same precision, so a lexical
  // comparison of the two would silently miss the boundary rows.
  const gaps = readGaps(db)
    .filter((gap) => gap.enabled_at !== null)
    .map((gap) => ({ from: Date.parse(gap.disabled_at), to: Date.parse(gap.enabled_at) }))
  const now = nowIso()
  let observedThrough = null
  let imported = 0
  let duplicates = 0
  let malformed = 0
  let recordingDisabled = 0
  const malformedReasons = []
  const conflicts = []
  const changed = []
  const digests = []
  let observed = 0

  const insert = db.prepare(
    "INSERT INTO usage_events (source, session_id, source_event_id, work_item_id, machine_id, model, initiator, " +
      "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, credit_units, nano_aiu, " +
      "agent_id, parent_tool_call_id, turn_index, duration_ms, source_created_at, source_row_sha256, imported_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
  const existing = db.prepare(
    "SELECT * FROM usage_events WHERE source = ? AND session_id = ? AND source_event_id = ?",
  )

  const run = db.transaction(() => {
    for (const raw of rows) {
      const { fact, malformed: reason, source_event_id: badId } = normalizeRow(raw)
      if (reason !== undefined) {
        malformed += 1
        malformedReasons.push({ source_event_id: badId, reason })
        continue
      }
      // The source's own cutoff, independent of the window asked for: it is the
      // latest thing the source actually holds, not the latest thing wanted.
      if (observedThrough === null || fact.created_at > observedThrough) {
        observedThrough = fact.created_at
      }
      if (since !== null && Date.parse(fact.created_at) < Date.parse(since)) continue
      if (until !== null && Date.parse(fact.created_at) > Date.parse(until)) continue

      // A window the owner switched off stays empty. Enforced against the
      // record's own timestamp, closed-inclusive at both ends, so re-enabling
      // capture cannot admit the silence after the fact.
      const instant = Date.parse(fact.created_at)
      if (gaps.some((gap) => instant >= gap.from && instant <= gap.to)) {
        recordingDisabled += 1
        continue
      }

      observed += 1
      digests.push(fact.normalized_sha256)

      const held = existing.get(source, sessionId, String(fact.source_event_id))
      if (held !== undefined) {
        if (held.work_item_id !== item.work_item_id) {
          conflicts.push({
            source,
            session_id: sessionId,
            source_event_id: fact.source_event_id,
            held_by_work_item_id: held.work_item_id,
            note:
              "this source observation is already allocated to another work item; " +
              "adding it here as well would count the same work twice",
          })
          continue
        }
        if (held.source_row_sha256 !== fact.normalized_sha256) {
          changed.push({
            source_event_id: fact.source_event_id,
            note:
              "the source row changed after it was imported; the originally observed " +
              "values are retained and were not overwritten",
          })
          continue
        }
        duplicates += 1
        continue
      }

      insert.run(
        source,
        sessionId,
        String(fact.source_event_id),
        item.work_item_id,
        machineId,
        fact.model,
        fact.initiator,
        fact.input_tokens,
        fact.output_tokens,
        fact.cache_read_tokens,
        fact.cache_write_tokens,
        fact.reasoning_tokens,
        fact.request_multiplier,
        fact.total_nano_aiu,
        fact.agent_id,
        fact.parent_tool_call_id,
        fact.turn_index,
        fact.duration_ms,
        fact.created_at,
        fact.normalized_sha256,
        now,
      )
      imported += 1
    }

    db.prepare(
      "INSERT INTO imports (work_item_id, source, session_id, machine_id, requested_since, requested_until, observed_through, imported_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(item.work_item_id, source, sessionId, machineId, since, until, observedThrough, now)
    db.prepare(
      "INSERT OR IGNORE INTO session_bindings (work_item_id, source, session_id, machine_id, bound_at) VALUES (?, ?, ?, ?, ?)",
    ).run(item.work_item_id, source, sessionId, machineId, now)
  })
  run()

  const workspace = readSessionWorkspace(sessionId, env)
  return {
    status: conflicts.length > 0 ? "usage_import_conflict" : "usage_imported",
    imported_events: imported,
    duplicates_skipped: duplicates,
    malformed_skipped: malformed,
    malformed_reasons: malformedReasons,
    skipped_recording_disabled: recordingDisabled,
    observed_events: observed,
    normalized_distinct_events: new Set(digests).size,
    observed_through: observedThrough,
    conflicting_allocations: conflicts,
    changed_since_import: changed,
    coverage: {
      complete: {
        class: "unavailable",
        reason:
          "the source states no completeness guarantee; observation stops at the " +
          "cutoff reported above and a later row may still arrive",
      },
    },
    provenance: {
      source,
      source_kind: known.kind,
      session_id: sessionId,
      machine_id:
        machineId === null
          ? { class: "unavailable", value: null }
          : { class: "declared", value: machineId },
      imported_at: now,
      events_note: EVENTS_NOTE,
    },
    binding: {
      local_session_id: sessionId,
      cloud_session_id: declaredOrUnavailable(workspace.cloud_session_id),
      task_id: declaredOrUnavailable(workspace.task_id),
    },
  }
}

function declaredOrUnavailable(value) {
  return value === null
    ? { class: "unavailable", value: null }
    : { class: "declared", value }
}

function readItem(db, workItemId) {
  return db.prepare("SELECT * FROM work_items WHERE work_item_id = ?").get(String(workItemId))
}

/**
 * The record, or an absence.
 *
 * Not an authorization check. Each person resolves to their own protected
 * partition, so another person's work item is not denied here — there is no row
 * of that identifier in the store this caller opened. An absent row cannot be
 * misconfigured open.
 */
function requireItem(db, workItemId) {
  if (typeof workItemId !== "string" || workItemId.trim() === "") {
    throw new Error(`${LABEL}: this action requires work_item_id.`)
  }
  const row = readItem(db, workItemId)
  if (row === undefined) {
    // A tombstone is the one thing deletion leaves behind, and it holds an
    // identifier and a time and nothing else. Saying an item was deleted here is
    // therefore honest and content-free — and it keeps the answer distinct from
    // the absence a caller sees for work held in a different partition.
    const tombstone = db
      .prepare("SELECT deleted_at FROM tombstones WHERE work_item_id = ?")
      .get(workItemId)
    if (tombstone !== undefined) {
      throw new Error(
        `${LABEL}: no work item ${JSON.stringify(workItemId)} — not found in this private ledger. ` +
          `It was deleted here on ${tombstone.deleted_at}; the record itself is gone and is not recoverable.`,
      )
    }
    throw new Error(
      `${LABEL}: no work item ${JSON.stringify(workItemId)} — not found in this private ledger.`,
    )
  }
  return row
}

function touch(db, workItemId, state, now) {
  db.prepare("UPDATE work_items SET state = ?, updated_at = ? WHERE work_item_id = ?").run(
    state,
    now,
    workItemId,
  )
}

function shapeItem(db, row) {
  const commitment = db.prepare("SELECT * FROM commitments WHERE work_item_id = ?").get(row.work_item_id)
  return {
    work_item_id: row.work_item_id,
    request: row.request,
    requested_by: row.requested_by,
    state: row.state,
    intake_at: row.intake_at,
    revision: row.revision,
    updated_at: row.updated_at,
    commitment:
      commitment === undefined
        ? null
        : {
            class: "declared",
            outcome: commitment.outcome,
            scope: commitment.scope,
            evidence: commitment.evidence,
            delivery_endpoint: commitment.delivery_endpoint,
            operator_go: JSON.parse(commitment.operator_go),
            task_ref: commitment.task_ref === null ? null : JSON.parse(commitment.task_ref),
            committed_at: commitment.committed_at,
          },
  }
}

/**
 * Completion as it actually stands: the operator's declaration, beside the
 * canonical task's own state where one is bound. The two disagreeing is a
 * finding, and it surfaces as one rather than being reconciled by writing to
 * the card.
 */
async function shapeCompletion(db, workItemId, deskRoot) {
  const completion = db.prepare("SELECT * FROM completions WHERE work_item_id = ?").get(workItemId)
  const commitment = db.prepare("SELECT * FROM commitments WHERE work_item_id = ?").get(workItemId)
  const taskRef = commitment?.task_ref ? JSON.parse(commitment.task_ref) : null
  const canonical = await readCanonicalStatus({
    deskRoot,
    taskRef,
    declaredState: completion === undefined ? null : "done",
  })
  if (completion === undefined) {
    return {
      class: "unavailable",
      reason: "this work item has not been completed",
      endpoint: null,
      evidence: null,
      canonical_status: canonical,
    }
  }
  return {
    class: "declared",
    endpoint: completion.endpoint,
    evidence: completion.evidence,
    completed_at: completion.completed_at,
    canonical_status: canonical,
  }
}

function shapeSize(db, workItemId) {
  const row = db.prepare("SELECT * FROM sizings WHERE work_item_id = ?").get(workItemId)
  if (row === undefined) return null
  const firstExecution = firstExecutionAt(db, workItemId)
  return {
    class: "declared",
    work_type: row.work_type,
    scope: row.scope,
    systems: JSON.parse(row.systems),
    uncertainty: row.uncertainty,
    risk: row.risk,
    verification: row.verification,
    recorded_at: row.recorded_at,
    // Shown next to each other so the ordering can be checked rather than
    // trusted. With nothing executed there is nothing to compare against, and
    // the ledger says so instead of implying the size was early.
    first_execution_at: firstExecution,
    preceded_execution: firstExecution === null ? null : row.recorded_at < firstExecution,
  }
}

function shapeUsage(row) {
  return {
    source: row.source,
    session_id: row.session_id,
    source_event_id: numericId(row.source_event_id),
    machine_id: row.machine_id,
    model: row.model,
    initiator: row.initiator,
    agent_id: row.agent_id,
    parent_tool_call_id: row.parent_tool_call_id,
    turn_index: row.turn_index,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_tokens,
    reasoning_tokens: row.reasoning_tokens,
    request_multiplier: row.credit_units,
    nano_aiu: row.nano_aiu,
    duration_ms: row.duration_ms,
    source_created_at: row.source_created_at,
    imported_at: row.imported_at,
  }
}

// Surrogate ids are stored as text so the primary key stays exact, and read
// back as numbers. normalizeRow has already refused anything that is not a safe
// integer, so this round-trip cannot lose or invent a value.
function numericId(value) {
  return Number(value)
}

function shapeBasis(db, workItemId) {
  const row = db.prepare("SELECT * FROM cost_bases WHERE work_item_id = ?").get(workItemId)
  return {
    cost_basis: {
      class: "declared",
      amount: row.amount,
      currency: row.currency,
      rate: row.rate,
      rate_unit: row.rate_unit,
      source: row.source,
      effective_date: row.effective_date,
      revision: row.revision,
    },
  }
}

/** The earliest evidence that execution began — declared phase or imported usage. */
function firstExecutionAt(db, workItemId) {
  const row = db
    .prepare(
      "SELECT MIN(at) AS first_at FROM (" +
        "SELECT MIN(COALESCE(started_at, recorded_at)) AS at FROM phases WHERE work_item_id = @id " +
        "UNION ALL " +
        "SELECT MIN(source_created_at) AS at FROM usage_events WHERE work_item_id = @id)",
    )
    .get({ id: workItemId })
  return row?.first_at ?? null
}

function rejectUnknownFields(values, allowed) {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${LABEL}: unknown input field ${JSON.stringify(key)} for action ` +
          `${JSON.stringify(values.action)} — accepted fields are ${allowed.join(", ")}. ` +
          `The store's location and the person binding come from the session, ` +
          `never from a call.`,
      )
    }
  }
}

function requireText(values, field) {
  const value = values[field]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${LABEL}: ${field} is required and must be a non-empty string.`,
    )
  }
  return value
}

// Every correctable field is a sentence somebody wrote, held in a text column.
// A replacement is the same kind of thing or it is refused: coercing one with
// `String()` used to record `"[object Object]"` as the corrected outcome and
// hand it back to the caller as though it had been accepted.
function requireCorrectionValue(values) {
  const value = values.value
  if (typeof value !== "string") {
    throw new Error(
      `${LABEL}: value must be a string — the corrected sentence itself, not ` +
        `${Array.isArray(value) ? "an array" : `a ${typeof value}`}. Every correctable ` +
        `field is text the record has to be able to hold.`,
    )
  }
  return value
}

function requireList(values, field) {
  const value = values[field]
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${LABEL}: ${field} is required and must be a non-empty array.`)
  }
  return value.map(String)
}

function requireFiniteNumber(values, field) {
  const value = values[field]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${LABEL}: ${field} is required and must be a finite number.`)
  }
  return value
}

// An optional free-text field is a scalar or it is absent. Anything else — an
// object, an array, a number, a boolean — is refused here rather than carried
// to the driver, which would report a bind failure in its own vocabulary, or
// worse, let a structured value be echoed back to the caller that the column
// behind it could never hold.
function optionalText(values, field) {  const value = values[field]
  if (value === undefined || value === null) return null
  if (typeof value !== "string") {
    throw new Error(
      `${LABEL}: ${field} must be a string when supplied, not ` +
        `${Array.isArray(value) ? "an array" : `a ${typeof value}`}. This field is ` +
        `recorded as the caller declared it, so it has to be a value the record can hold.`,
    )
  }
  return value
}

function optionalTimestamp(values, field) {
  if (values[field] === undefined || values[field] === null) return null
  const normalized = normalizeTimestamp(values[field])
  if (normalized === null) {
    throw new Error(
      `${LABEL}: ${field} ${JSON.stringify(values[field])} is not a timestamp.`,
    )
  }
  return normalized
}

export { normalizedDigest }
