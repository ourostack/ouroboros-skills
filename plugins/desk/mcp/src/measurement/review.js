/**
 * The weekly work-design review.
 *
 * A separate reading of the ledger from the per-item report, and deliberately a
 * much narrower one. It answers a single design question — of the work I
 * declared finished this week, what shape did I say it had, and did the
 * delivery evidence arrive at the endpoint I committed to — and it is built so
 * that it cannot quietly answer anything else.
 *
 * Three rules hold the honesty of this module, and each is asserted in the
 * tests rather than merely described here:
 *
 *   1. Selection is on a *declaration*. An item enters the cohort because
 *      somebody recorded a completion, not because delivery was verified. The
 *      payload says `declared` so no reader can mistake the cohort for proof.
 *   2. Nothing is graded. There is no score, rank, rating or efficiency figure
 *      anywhere in the output. A design review reads the shape of work; the
 *      moment it marks the work it becomes a performance instrument, which this
 *      ledger must never be.
 *   3. Absence is stated, never implied. An empty week, a missing sizing and
 *      the open/blocked/cancelled population all carry explicit reasons,
 *      because a silent zero reads as "nothing happened" and that is exactly
 *      the false conclusion this route must not invite.
 */

const DECLARED = "declared"
const UNAVAILABLE = "unavailable"

function unavailable(reason) {
  return { class: UNAVAILABLE, value: null, reason }
}

/**
 * A window bound the caller supplied.
 *
 * Deliberately stricter than the native source reader, which also admits the
 * bare SQLite date-time form under that source's own documented UTC
 * convention. A tool caller carries no such convention, so a value with no
 * offset would have to be guessed as UTC or as host-local, and both are
 * guesses. Only an explicit offset or `Z` is accepted here.
 */
const INSTANT_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/u

export function parseWindowBound(value, field) {
  if (typeof value !== "string" || !INSTANT_WITH_OFFSET.test(value.trim())) {
    throw new Error(
      `${field} must be an instant with an explicit UTC offset or Z, such as ` +
        `2026-09-07T00:00:00Z. A date or a local-looking time would have to be ` +
        `guessed into an instant, and a guessed window silently changes which ` +
        `work is reviewed.`,
    )
  }
  const epoch = Date.parse(value.trim())
  if (!Number.isFinite(epoch)) {
    throw new Error(`${field} has the shape of an instant but is not a real one: ${value}`)
  }
  return epoch
}

/**
 * Every completion, filtered in JavaScript rather than in SQL.
 *
 * The stored `completed_at` is written at second precision while a caller's
 * bound normally carries milliseconds, and ISO strings of differing precision
 * do not compare correctly: `"…:45Z" > "…:45.678Z"` lexically, because `Z`
 * sorts above `.`. Comparing parsed instants avoids an off-by-one-second
 * selection bug that would silently move items in and out of a week. The row
 * count here is one operator's own work items, so reading them is cheap.
 */
function completionsInWindow(db, sinceEpoch, untilEpoch) {
  const rows = db
    .prepare("SELECT work_item_id, endpoint, evidence, completed_at FROM completions")
    .all()
  return rows
    .map((row) => ({ ...row, epoch: Date.parse(row.completed_at) }))
    .filter((row) => Number.isFinite(row.epoch))
    .filter((row) => row.epoch >= sinceEpoch && row.epoch < untilEpoch)
    .sort((a, b) => a.epoch - b.epoch || a.work_item_id.localeCompare(b.work_item_id))
}

/** The six recorded size features, or a stated absence. */
function sizeOf(db, workItemId) {
  const row = db
    .prepare(
      "SELECT work_type, scope, systems, uncertainty, risk, verification, recorded_at " +
        "FROM sizings WHERE work_item_id = ?",
    )
    .get(workItemId)
  if (!row) {
    return unavailable(
      "no size was recorded for this work item, so its type, scope, systems, " +
        "uncertainty, risk and verification burden are not known",
    )
  }
  return {
    class: DECLARED,
    work_type: row.work_type,
    scope: row.scope,
    // Stored as JSON by the size route, and read back the same way the
    // existing item shape reads it, so both surfaces agree on the type.
    systems: JSON.parse(row.systems),
    uncertainty: row.uncertainty,
    risk: row.risk,
    verification: row.verification,
    recorded_at: row.recorded_at,
  }
}

/**
 * Whether the sizing was recorded before the completion.
 *
 * Reported as a fact, not as a mark. Size features are meant to be recorded
 * before execution, so a sizing that appeared afterwards is worth seeing in a
 * design review — but the review states the ordering and stops there.
 */
function sizingOrder(size, completedAt) {
  if (size.class === UNAVAILABLE) {
    return unavailable("no sizing was recorded, so its order cannot be compared")
  }
  // Both instants are NOT NULL columns written by the server clock, so there is
  // no API path that can make either unparseable. A guard here would be dead
  // code kept alive only to be counted, so it is deliberately absent.
  const recorded = Date.parse(size.recorded_at)
  const completed = Date.parse(completedAt)
  return { class: DECLARED, value: recorded <= completed }
}

export function buildReview(db, { since, until }) {
  const sinceEpoch = parseWindowBound(since, "since")
  const untilEpoch = parseWindowBound(until, "until")
  if (!(sinceEpoch < untilEpoch)) {
    throw new Error(
      `since must fall before until; received a window that starts at ${since} and ` +
        `ends at ${until}.`,
    )
  }

  const completions = completionsInWindow(db, sinceEpoch, untilEpoch)
  const items = completions.map((completion) => {
    const item = db
      .prepare("SELECT work_item_id, request, state FROM work_items WHERE work_item_id = ?")
      .get(completion.work_item_id)
    const commitment = db
      .prepare("SELECT outcome, delivery_endpoint FROM commitments WHERE work_item_id = ?")
      .get(completion.work_item_id)
    const size = sizeOf(db, completion.work_item_id)

    return {
      work_item_id: completion.work_item_id,
      // Both rows are guaranteed present: the completion route refuses a work
      // item that was never taken in and one that carries no commitment, so a
      // completion cannot exist without either. Guarding for their absence here
      // would be unreachable code kept only to be counted.
      request: { class: DECLARED, value: item.request },
      outcome: { class: DECLARED, value: commitment.outcome },
      delivery: {
        class: DECLARED,
        endpoint: completion.endpoint,
        evidence: completion.evidence,
        completed_at: completion.completed_at,
        // The completion route already refuses an endpoint that is not the
        // committed one, so this is a restatement for the reader rather than a
        // new check. It is reported because a design review should not require
        // trusting that the write path held.
        matches_committed_endpoint: commitment.delivery_endpoint === completion.endpoint,
        committed_endpoint: commitment.delivery_endpoint,
      },
      size,
      size_recorded_before_completion: sizingOrder(size, completion.completed_at),
      // No closure is read here. Completion is terminal — the close route
      // refuses a completed item with "a terminal work item does not accept
      // close" for every accepted closure state — so a reviewed item can never
      // also carry one, and a field for it would always be empty.
    }
  })

  return {
    status: "reviewed",
    window: { since, until, bounds: "since is inclusive, until is exclusive" },
    cohort: {
      class: DECLARED,
      selected_by: "a completion recorded inside the window; cancelled and abandoned work is never counted as completed",
      count: items.length,
      items,
      empty:
        items.length === 0
          ? unavailable(
              "no work item was declared complete inside this window. That is not " +
                "evidence that no work happened, that nothing was delivered, or that " +
                "this ledger has begun recording the operator's real work.",
            )
          : null,
    },
    open_coverage: unavailable(
      "open, blocked and cancelled work is a separate question from a completed-work " +
        "design review, and is deliberately not summarised here",
    ),
    reading: [
      "Selection is a declaration of completion, never a verification of delivery.",
      "Nothing here is graded, scored or ranked; the review reads the shape of work.",
      "An absent sizing or an empty week is stated with a reason rather than left as a zero.",
    ],
  }
}
