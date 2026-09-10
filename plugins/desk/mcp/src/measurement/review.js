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
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(?<fraction>\d+))?(?:Z|[+-]\d{2}:?\d{2})$/u

/** The Gregorian rule in full: every fourth year, except centuries, except every fourth century. */
function isLeapYear(year) {
  if (year % 4 !== 0) return false
  if (year % 100 !== 0) return true
  return year % 400 === 0
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/**
 * Whether the fields the caller actually wrote name a day and time that exist.
 *
 * This has to be checked against the written fields rather than against the
 * instant they parse to. The platform parser does not reject an impossible
 * date, it rolls it forward: the thirtieth of February becomes the second of
 * March, the twenty-ninth of February in a common year becomes the first of
 * March, and hour 24 becomes midnight the following day. A window bound that
 * moves to a different day selects a different week's work than the caller
 * asked about, and nothing in the answer would reveal it.
 *
 * Checking the written fields is also what keeps an offset valid. A bound like
 * `2026-09-07T00:00:00+02:00` is a real instant on the seventh even though it
 * lands on the sixth in UTC, so comparing against the parsed UTC components
 * would reject legitimate bounds.
 */
function statedInstantIsReal([, year, month, day, hour, minute, second]) {
  const numericMonth = Number(month)
  const numericDay = Number(day)
  if (numericMonth < 1 || numericMonth > 12) return false
  if (numericDay < 1 || numericDay > daysInMonth(Number(year), numericMonth)) return false
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
}

function parseWindowBound(value, field) {
  const written = typeof value === "string" ? value.trim() : ""
  const fields = INSTANT_WITH_OFFSET.exec(written)
  if (!fields) {
    throw new Error(
      `${field} must be an instant with an explicit UTC offset or Z, such as ` +
        `2026-09-07T00:00:00Z. A date or a local-looking time would have to be ` +
        `guessed into an instant, and a guessed window silently changes which ` +
        `work is reviewed.`,
    )
  }
  if (!statedInstantIsReal(fields)) {
    throw new Error(
      `${field} has the shape of an instant but is not a real one: ${value}. The ` +
        `calendar has no such day or time, and accepting it would roll the window ` +
        `forward onto a different day than the one asked about.`,
    )
  }
  const fraction = fields.groups.fraction ?? ""
  if (/[1-9]/u.test(fraction.slice(3))) {
    throw new Error(
      `${field} must not contain nonzero fractional precision beyond milliseconds.`,
    )
  }
  const epoch = Date.parse(written)
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

/**
 * The sessions an item's usage was actually imported from.
 *
 * This is what makes a weekly reading source-bound rather than anonymous. A
 * binding is written only by a real usage import, which names its source and
 * session explicitly and refuses to guess the caller's own, so a bound item is
 * one whose work was genuinely correlated with a recorded session on a named
 * machine. An item with no binding was never correlated with anything, and that
 * has to be stated: read as a blank it would look like an item that simply had
 * nothing to say about its origin.
 *
 * An item can carry more than one, because work can span sessions, so they are
 * reported as a list rather than collapsed into one.
 */
function bindingsOf(db, workItemId) {
  const rows = db
    .prepare(
      "SELECT source, session_id, machine_id, bound_at FROM session_bindings " +
        "WHERE work_item_id = ? ORDER BY bound_at, source, session_id",
    )
    .all(workItemId)
  if (rows.length === 0) {
    return unavailable(
      "no session is bound to this work item, so this reading cannot say which " +
        "source or session produced it",
    )
  }
  return { class: DECLARED, sessions: rows }
}

/**
 * Entries the owner's dispatch ledger says were left unresolved in an earlier
 * window. Supplied by the caller because this route does not hold dispositions:
 * which items were read and which were deferred lives in that ledger, not here.
 */
function parseCarryForward(carryForward) {
  if (carryForward === undefined) return []
  if (!Array.isArray(carryForward)) {
    throw new Error(
      "carry_forward must be a list of { work_item_id, completed_at } entries taken " +
        "from an earlier window's unresolved items.",
    )
  }
  const seen = new Set()
  return carryForward.map((entry) => {
    const record = typeof entry === "object" && entry !== null ? entry : {}
    if (typeof record.work_item_id !== "string" || typeof record.completed_at !== "string") {
      throw new Error(
        "each carry_forward entry must name a work_item_id and the completed_at it was " +
          "originally recorded with, both as strings, so the item can be matched to the " +
          "cohort it was completed in.",
      )
    }
    if (seen.has(record.work_item_id)) {
      throw new Error(
        `carry_forward must name each work_item_id once; duplicate ${record.work_item_id}.`,
      )
    }
    seen.add(record.work_item_id)
    return { work_item_id: record.work_item_id, completed_at: record.completed_at }
  })
}

/**
 * Resolve carried-forward entries against the ledger's own immutable record.
 *
 * The rule being enforced is that carrying an item forward may not move it: it
 * keeps the cohort it was completed in, and it never joins a later window's
 * new-completion denominator. So the stated completion time is checked against
 * the one this ledger holds, and a disagreement is surfaced rather than
 * accepted — that disagreement is exactly the shape a recompletion, correction
 * or reopened-work claim would take if it were allowed to relabel an old
 * outcome as newly completed.
 */
function resolveCarryForward(db, entries, sinceEpoch, untilEpoch) {
  return entries.map((entry) => {
    const row = db
      .prepare("SELECT completed_at FROM completions WHERE work_item_id = ?")
      .get(entry.work_item_id)
    if (!row) {
      return {
        work_item_id: entry.work_item_id,
        status: UNAVAILABLE,
        stated_completed_at: entry.completed_at,
        reason:
          "no completion is recorded for this work item in this ledger, so there is no " +
          "original cohort to carry it forward under",
      }
    }
    if (row.completed_at !== entry.completed_at) {
      return {
        work_item_id: entry.work_item_id,
        status: "identity_mismatch",
        stated_completed_at: entry.completed_at,
        original_cohort: { completed_at: row.completed_at },
        reason:
          "the stated completion time does not match the immutable one this ledger holds. " +
          "A recompletion, correction or reopened-work claim cannot reset the original " +
          "identity or move the item into a newer window's denominator.",
      }
    }
    const epoch = Date.parse(row.completed_at)
    if (epoch < sinceEpoch) {
      return {
        work_item_id: entry.work_item_id,
        status: "carried_forward",
        original_cohort: { completed_at: row.completed_at, falls_in_this_window: false },
      }
    }
    if (epoch < untilEpoch) {
      return {
        work_item_id: entry.work_item_id,
        status: "already_in_this_window",
        original_cohort: { completed_at: row.completed_at, falls_in_this_window: true },
        reason:
          "this item was declared complete inside this window, so it is already counted " +
          "once in the new-completion denominator and is not also carried forward",
      }
    }
    return {
      work_item_id: entry.work_item_id,
      status: "completed_after_window",
      original_cohort: { completed_at: row.completed_at, falls_in_this_window: false },
      reason:
        "this item was declared complete after this window closed, so it belongs to a " +
        "later cohort and cannot be carried backwards into this one",
    }
  })
}

export function buildReview(db, { since, until, carryForward }) {
  const sinceEpoch = parseWindowBound(since, "since")
  const untilEpoch = parseWindowBound(until, "until")
  if (!(sinceEpoch < untilEpoch)) {
    throw new Error(
      `since must fall before until; received a window that starts at ${since} and ` +
        `ends at ${until}.`,
    )
  }
  const carried = resolveCarryForward(
    db,
    parseCarryForward(carryForward),
    sinceEpoch,
    untilEpoch,
  )

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
        // The immutable claim that the work was declared complete. It is not a
        // delivery time, and nothing here observes when or whether anything
        // arrived at the endpoint.
        completed_at: completion.completed_at,
        // A string comparison between two declarations: the endpoint named at
        // commitment and the endpoint named at completion. The completion route
        // already refuses a mismatch, so this restates that for the reader
        // rather than checking anything new. It is emphatically not delivery
        // verification, and must not be consumed as evidence that anything was
        // delivered, received or is present at that endpoint.
        endpoint_string_matches_commitment:
          commitment.delivery_endpoint === completion.endpoint,
        committed_endpoint: commitment.delivery_endpoint,
      },
      size,
      size_recorded_before_completion: sizingOrder(size, completion.completed_at),
      // Which recorded session this item's work was correlated with, or an
      // explicit absence. Read back here so a later first-use confirmation has
      // somewhere to land: a genuinely used session shows up as a binding on
      // the item it produced.
      source_binding: bindingsOf(db, completion.work_item_id),
      // No closure is read here. Completion is terminal — the close route
      // refuses a completed item with "a terminal work item does not accept
      // close" for every accepted closure state — so a reviewed item can never
      // also carry one, and a field for it would always be empty.
    }
  })

  return {
    status: "ok",
    // What a caller is allowed to conclude from this payload. The route selects
    // input for a weekly work-design reading; it does not perform one, and it
    // does not verify delivery. A successful status means the selection ran,
    // never that anything was examined.
    result_is: {
      kind: "eligible_input",
      examined: false,
      statement:
        "These are the work items eligible for a weekly work-design reading in this " +
        "window. Nothing here has been read, judged or verified, and no delivery has " +
        "been confirmed. A status of ok means the selection succeeded, not that a " +
        "review happened.",
      // Which items were actually read, which were deferred, and which carry
      // forward because their evidence could not be assessed are identities in
      // the owner's review and dispatch ledger. This route cannot determine
      // them: it sees a declared evidence string and never the thing itself, so
      // reporting an availability judgement here would be an invention.
      reviewed_and_deferred_identities: unavailable(
        "which eligible items were actually reviewed, deferred, or carried forward " +
          "is recorded in the owner's review and dispatch ledger, not by this read route",
      ),
      // A binding says which recorded session an item's usage came from. It is
      // not on its own evidence that the operator has started using anything:
      // it says where imported usage came from, and nothing about whether the
      // work behind it mattered or was delivered.
      binding_means:
        "a source binding names the session an item's imported usage came from; it is " +
        "not evidence of delivery, of quality, or on its own of a first real use",
    },
    window: {
      since,
      until,
      bounds: "since is inclusive, until is exclusive",
      selected_on:
        "completions.completed_at, the immutable claim that the item was declared " +
        "complete, which the item report names terminal_claim_recording, and which " +
        "is not a delivery time",
    },
    eligible: {
      class: DECLARED,
      selected_by: "a completion recorded inside the window; cancelled and abandoned work is never counted as completed",
      // The denominator for this window. Carried-forward items are reported
      // separately and are never added here, because counting one outcome as
      // newly completed in two different weeks would inflate the later one.
      denominator: "new completions inside this window only",
      count: items.length,
      ids: items.map((item) => item.work_item_id),
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
    // Items an earlier window left unresolved, kept under the cohort they were
    // completed in. They are listed so the reader can pick them up again, and
    // they are deliberately outside the denominator above.
    carried_forward: {
      count: carried.filter((entry) => entry.status === "carried_forward").length,
      counted_in_denominator: false,
      statement:
        "These were declared complete in an earlier window and left unresolved there. " +
        "They keep their original cohort and are never counted as newly completed in " +
        "this one. Entries whose stated completion time disagrees with this ledger are " +
        "reported as a mismatch rather than accepted.",
      supplied_by:
        "the owner's review and dispatch ledger; this route holds no dispositions of its own",
      items: carried,
    },
    reading: [
      "Selection is a declaration of completion, never a verification of delivery.",
      "This is input for a reading, not a reading that happened.",
      "Nothing here is graded, scored or ranked; the review reads the shape of work.",
      "An absent sizing or an empty week is stated with a reason rather than left as a zero.",
    ],
  }
}
