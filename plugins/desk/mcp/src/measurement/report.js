// The owner-private work-item report.
//
// Every field carries a provenance class, because a report that mixes what was
// measured at a native source with what somebody declared, inferred or simply
// does not know is worse than no report at all. The classes are:
//
//   measured    — read from a native source that actually recorded it
//   declared    — asserted by whoever recorded it; true only as a statement
//   inferred    — derived by a stated rule from other fields, rule named
//   estimated   — a figure with acknowledged error
//   unavailable — not known, with the reason it is not known
//
// Nothing here ranks people, scores work, or leaves this caller.

const PROVENANCE = {
  measured: "measured",
  declared: "declared",
  inferred: "inferred",
  unavailable: "unavailable",
}

const TOKEN_FIELDS = [
  "input",
  "output",
  "cache_read",
  "cache_write",
  "reasoning",
]

const TOKEN_COLUMNS = {
  input: "input_tokens",
  output: "output_tokens",
  cache_read: "cache_read_tokens",
  cache_write: "cache_write_tokens",
  reasoning: "reasoning_tokens",
}

const COVERAGE_NOTE =
  "Every figure covers only what was actually observed, through the cutoff each " +
  "source reports. An empty window is not evidence that no work happened."

const UNATTRIBUTED_REASON = "no_declared_phase_covering_observation"
const AMBIGUOUS_REASON = "observation_covered_by_multiple_declared_phases"

/** Build the whole report for one caller's own partition. */
export function buildReport(db, { person, workItemId = null, includePhaseSpan = false, asOf }) {
  const recording = readRecording(db)
  const gaps = readGaps(db)
  const items = db
    .prepare("SELECT * FROM work_items ORDER BY intake_at, work_item_id")
    .all()
    .filter((row) => workItemId === null || row.work_item_id === workItemId)

  const reported = items.map((row) =>
    buildItem(db, row, { includePhaseSpan, asOf, gaps }),
  )

  return {
    status: "ok",
    as_of: asOf,
    scope: { person: person ?? null, shared: false },
    recording: { class: PROVENANCE.declared, enabled: recording.enabled },
    recording_gaps: gaps,
    coverage: {
      deleted_items: readTombstones(db),
      // An object, like every other classed field: the source states no
      // completeness guarantee, and a bare string could not carry the reason.
      complete: {
        class: PROVENANCE.unavailable,
        value: null,
        reason:
          "no source consulted by this ledger states that its records are complete " +
          "for a window, so completeness cannot be reported as a fact",
      },
    },
    coverage_note: COVERAGE_NOTE,
    items: reported,
    totals: {
      tokens: totalTokens(reported),
      financial_cost: totalFinancialCost(db, items),
    },
  }
}

/** One work item, every field classed. */
export function buildItem(db, row, { includePhaseSpan, asOf, gaps }) {
  const usage = db
    .prepare("SELECT * FROM usage_events WHERE work_item_id = ? ORDER BY source_created_at, source_event_id")
    .all(row.work_item_id)
  const phases = db
    .prepare("SELECT * FROM phases WHERE work_item_id = ? ORDER BY phase_id")
    .all(row.work_item_id)
  const completion = db
    .prepare("SELECT * FROM completions WHERE work_item_id = ?")
    .get(row.work_item_id)
  // A closure is a terminal claim too. Reading it here keeps a cancelled item
  // from being reported as still running, without ever calling it delivered.
  const closureRow = db
    .prepare("SELECT * FROM closures WHERE work_item_id = ?")
    .get(row.work_item_id)
  const terminalCompletion =
    completion === undefined
      ? undefined
      : { terminal_at: completion.completed_at, disposition: "completed" }
  const terminalClosure =
    closureRow === undefined
      ? undefined
      : { terminal_at: closureRow.closed_at, disposition: closureRow.state }
  const links = db
    .prepare("SELECT * FROM work_item_links WHERE work_item_id = ?")
    .all(row.work_item_id)

  const hasUsage = usage.length > 0
  const cycleView = windowBreakdown(usage, phases, "cycle")
  const phaseView = windowBreakdown(usage, phases, "phase")

  return {
    work_item_id: row.work_item_id,
    request: { class: PROVENANCE.declared, value: row.request },
    state: { class: PROVENANCE.declared, value: row.state },
    // Retained for compatibility with the field this report first defined, and
    // explicitly unavailable: the native rows carry one timestamp per row whose
    // meaning the source never states, so no interval can be anchored on them.
    elapsed_ms: {
      class: PROVENANCE.unavailable,
      value: null,
      reason: "source_interval_anchor_unknown",
      superseded_by: ["active_span_ms", "lead_time_ms"],
    },
    model_time_ms: hasUsage
      ? measuredSum(usage, "duration_ms")
      : unavailable("no usage has been imported for this work item"),
    active_span_ms: activeSpan(phases, includePhaseSpan),
    lead_time_ms: leadTime(row, terminalCompletion, terminalClosure, asOf),
    tokens: tokenTotals(usage),
    usage_multiplier_sum: hasUsage
      ? measuredSum(usage, "credit_units", { unit: "request_multiplier", is_price: false })
      : {
          ...unavailable("no usage has been imported for this work item"),
          unit: "request_multiplier",
          is_price: false,
        },
    nano_aiu_sum: hasUsage
      ? measuredSum(usage, "nano_aiu", { unit: "nano_aiu", is_price: false })
      : {
          ...unavailable("no usage has been imported for this work item"),
          unit: "nano_aiu",
          is_price: false,
        },
    financial_cost: financialCost(db, row.work_item_id),
    observed_events: { class: PROVENANCE.measured, value: usage.length },
    normalized_distinct_events: {
      class: PROVENANCE.measured,
      value: new Set(usage.map((entry) => entry.source_row_sha256)).size,
    },
    billable_requests: {
      class: PROVENANCE.unavailable,
      value: null,
      reason:
        "the source carries no authoritative billing identifier, so a billable " +
        "request count cannot be derived from these observations",
    },
    by_model: groupBy(usage, "model", "model"),
    by_initiator: groupBy(usage, "initiator", "initiator"),
    by_cycle: cycleView,
    by_phase: phaseView,
    by_agent: agentBreakdown(usage),
    phases: {
      class: PROVENANCE.declared,
      value: phases.map((entry) => ({
        phase: entry.phase,
        cycle: entry.cycle,
        state: entry.state,
        started_at: entry.started_at,
        ended_at: entry.ended_at,
        recorded_at: entry.recorded_at,
      })),
    },
    evaluations: {
      class: PROVENANCE.declared,
      value: db
        .prepare("SELECT * FROM evaluations WHERE work_item_id = ? ORDER BY evaluation_id")
        .all(row.work_item_id)
        .map((entry) => ({
          measurement_kind: entry.measurement_kind,
          receipt_ref: entry.receipt_ref,
          receipt_sha256: entry.receipt_sha256,
          run_set_id: entry.run_set_id,
          run_id: entry.run_id,
          case_id: entry.case_id,
          status: entry.status,
          grade: entry.grade,
          availability: entry.availability,
          recorded_at: entry.recorded_at,
        })),
    },
    coverage: {
      sources: coverageSources(db, row.work_item_id),
      recording_gaps_overlapping: overlappingGaps(gaps, row, terminalCompletion ?? terminalClosure, asOf),
    },
    rollup: rollup(db, links),
  }
}

function unavailable(reason) {
  return { class: PROVENANCE.unavailable, value: null, reason }
}

/**
 * A total, plus whether arithmetic could carry it exactly.
 *
 * Every observation can be exactly representable and their sum still not be:
 * past the safe-integer range a running total is silently wrong by one or more.
 * A caller must not put `measured` on such a number, so the exactness travels
 * with it rather than being assumed.
 */
function exactSum(rows, column) {
  let total = 0
  for (const row of rows) {
    const value = row[column]
    if (typeof value === "number" && Number.isFinite(value)) total += value
  }
  return { total, exact: Math.abs(total) <= Number.MAX_SAFE_INTEGER }
}

const UNREPRESENTABLE_TOTAL =
  "the observations sum past the range arithmetic can carry exactly, so no exact total can be reported"

/** A measured total, or an explicit absence when it could not be carried exactly. */
function measuredSum(rows, column, extra = {}) {
  const { total, exact } = exactSum(rows, column)
  if (!exact) return { ...unavailable(UNREPRESENTABLE_TOTAL), ...extra }
  return { class: PROVENANCE.measured, value: total, ...extra }
}

/**
 * Token totals plus, per field, how many rows actually carried it.
 *
 * A missing counter is not a zero. The sum states what it covered so a reader
 * can see that a total rests on two rows out of three rather than on all of them.
 */
function tokenTotals(usage) {
  if (usage.length === 0) {
    return unavailable(
      "no usage has been imported for this work item, so nothing is known about its token consumption",
    )
  }
  const value = {}
  const partial = {}
  for (const field of TOKEN_FIELDS) {
    const column = TOKEN_COLUMNS[field]
    let sum = 0
    let covered = 0
    let missing = 0
    for (const row of usage) {
      const entry = row[column]
      if (typeof entry === "number" && Number.isFinite(entry)) {
        sum += entry
        covered += 1
      } else {
        missing += 1
      }
    }
    if (Math.abs(sum) > Number.MAX_SAFE_INTEGER) {
      return unavailable(UNREPRESENTABLE_TOTAL)
    }
    value[field] = sum
    partial[field] = { covered_rows: covered, missing_rows: missing }
  }
  return { class: PROVENANCE.measured, value, partial_fields: partial }
}

/**
 * The union of declared phase intervals.
 *
 * Only computed on request, and only ever from intervals that have both ends.
 * Without that request it stays unavailable rather than being derived from
 * source timestamps whose anchor the source never states.
 */
function activeSpan(phases, includePhaseSpan) {
  if (!includePhaseSpan) {
    return {
      class: PROVENANCE.unavailable,
      value: null,
      reason: "source_interval_anchor_unknown",
    }
  }
  const intervals = phases
    .filter((entry) => entry.started_at !== null && entry.ended_at !== null)
    .map((entry) => [Date.parse(entry.started_at), Date.parse(entry.ended_at)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start)
    .sort((a, b) => a[0] - b[0])

  // No usable interval is not a zero-length one. Reporting 0 ms as *inferred*
  // would assert that the work took no time, when what is true is that nothing
  // was declared to infer from.
  if (intervals.length === 0) {
    return {
      class: PROVENANCE.unavailable,
      value: null,
      reason: "no_declared_phase_intervals",
    }
  }

  let total = 0
  let openStart = null
  let openEnd = null
  for (const [start, end] of intervals) {
    if (openStart === null) {
      openStart = start
      openEnd = end
      continue
    }
    if (start <= openEnd) {
      openEnd = Math.max(openEnd, end)
      continue
    }
    total += openEnd - openStart
    openStart = start
    openEnd = end
  }
  // At least one interval reached the loop, so there is always an open run to
  // close here. The empty case returned above rather than falling through.
  total += openEnd - openStart

  return {
    class: PROVENANCE.inferred,
    value: total,
    method: "interval_union",
    basis: "declared_phase_intervals",
    intervals: intervals.length,
  }
}

/**
 * Intake to the recorded terminal claim — including every hour nobody was
 * working. The ledger can time its own recording, not an unobserved physical
 * delivery, so the closing endpoint is named for what it actually is. While the
 * item is open the figure is censored at the report time, and says so, because
 * an unfinished item has no lead time yet. A closed item terminated: it is not
 * still running, and it was never delivered.
 */
function leadTime(row, completion, closure, asOf) {
  const start = Date.parse(row.intake_at)
  const terminal = completion ?? closure
  const end = terminal ? Date.parse(terminal.terminal_at) : Date.parse(asOf)
  return {
    class: PROVENANCE.measured,
    // Both ends are ledger-written timestamps: intake is stamped when the item
    // is created and as_of when the report is built.
    value: Math.max(0, end - start),
    from: "intake",
    to: terminal ? "terminal_claim_recording" : "as_of",
    censored: terminal === undefined,
    disposition: terminal ? terminal.disposition : "open",
    // Delivery is a claim the ledger cannot verify, so the only thing it says
    // here is when a claim was *not* made: a cancelled or abandoned item is
    // never counted as verified successful delivery.
    delivered: completion === undefined ? false : "declared",
    as_of: asOf,
  }
}

/**
 * A declared cost basis, or an explicit absence that names what is missing.
 *
 * The declared `amount` governs. Rate and rate_unit are qualification carried
 * beside it so a reader can judge what the number was asserted against; they are
 * never multiplied by anything to produce a figure the operator did not state.
 * A usage multiplier is not a price, and this ledger does not hold a conversion.
 */
function financialCost(db, workItemId) {
  const basis = db.prepare("SELECT * FROM cost_bases WHERE work_item_id = ?").get(workItemId)
  if (basis === undefined) {
    return {
      class: PROVENANCE.unavailable,
      value: null,
      currency: null,
      basis: null,
      superseded_revisions: 0,
      reason:
        "no rate, source and effective date have been recorded for this work item, " +
        "and a credit or multiplier unit carries no universal price",
    }
  }
  return {
    class: PROVENANCE.declared,
    value: basis.amount,
    currency: basis.currency,
    basis: {
      rate: basis.rate,
      rate_unit: basis.rate_unit,
      source: basis.source,
      effective_date: basis.effective_date,
      revision: basis.revision,
    },
    superseded_revisions: basis.revision - 1,
  }
}

/** A per-key breakdown where every observation lands in exactly one bucket. */
function groupBy(usage, column, key) {
  const buckets = new Map()
  for (const row of usage) {
    const name = row[column] ?? null
    const bucket = buckets.get(name) ?? {
      [key]: name,
      observed_events: 0,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
    }
    bucket.observed_events += 1
    bucket.input_tokens += numeric(row.input_tokens)
    bucket.output_tokens += numeric(row.output_tokens)
    bucket.duration_ms += numeric(row.duration_ms)
    buckets.set(name, bucket)
  }
  if (usage.length === 0) {
    // An empty array reads as "nothing was used", which is a different claim
    // from "this is not known". The class says unknown, so the value must too.
    return unavailable(
      `no usage has been imported for this work item, so no ${key} attribution has been observed`,
    )
  }
  return { class: PROVENANCE.measured, value: [...buckets.values()] }
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Usage per declared cycle.
 *
 * An observation no declared phase covers is an unattributed remainder, not a
 * zero. An observation two phases both cover is ambiguous: any single bucket
 * would be a guess presented as a breakdown, and adding it to both would count
 * the same work twice. Buckets plus both remainders account for every
 * observation exactly once.
 */
function windowBreakdown(usage, phases, key) {
  const covering = phases.filter(
    (entry) => entry[key] !== null && entry.started_at !== null && entry.ended_at !== null,
  )
  const buckets = new Map()
  let unattributed = 0
  let ambiguous = 0
  const ambiguousNames = new Set()

  for (const row of usage) {
    const at = Date.parse(row.source_created_at)
    const names = new Set()
    for (const phase of covering) {
      const start = Date.parse(phase.started_at)
      const end = Date.parse(phase.ended_at)
      if (Number.isFinite(at) && at >= start && at <= end) names.add(phase[key])
    }
    if (names.size === 0) {
      unattributed += 1
      continue
    }
    if (names.size > 1) {
      ambiguous += 1
      for (const name of names) ambiguousNames.add(name)
      continue
    }
    const [name] = [...names]
    const bucket = buckets.get(name) ?? { [key]: name, observed_events: 0, input_tokens: 0, output_tokens: 0 }
    bucket.observed_events += 1
    bucket.input_tokens += numeric(row.input_tokens)
    bucket.output_tokens += numeric(row.output_tokens)
    buckets.set(name, bucket)
  }

  return {
    // Declared, not measured: the buckets come from operator-declared windows
    // laid over observations the source timestamped. The source never said
    // which phase or cycle its rows belonged to.
    class: PROVENANCE.declared,
    value: [...buckets.values()],
    unattributed: { observed_events: unattributed, reason: UNATTRIBUTED_REASON },
    ambiguous: {
      observed_events: ambiguous,
      [`${key}s`]: [...ambiguousNames],
      reason: AMBIGUOUS_REASON,
    },
  }
}

/**
 * Which agent ran, as the source recorded it — not which window an operator
 * later drew around it. A row that carries no agent identity is counted as
 * missing rather than folded into a bucket, because "unknown" is a real answer
 * and an invented one would be indistinguishable from a real agent.
 */
const MISSING_AGENT_ID =
  "the source did not record an agent identity on these rows, so they " +
  "cannot be attributed to a root turn or a subagent"

function agentBreakdown(usage) {
  const buckets = new Map()
  let missingId = 0
  for (const row of usage) {
    const agentId = row.agent_id ?? null
    if (agentId === null) {
      missingId += 1
      continue
    }
    const bucket = buckets.get(agentId) ?? {
      agent_id: agentId,
      // A row with a parent tool call was spawned by another agent; one without
      // is a root turn. A single agent can appear as both across a work item,
      // so the roles it was *seen in* accumulate and the answer is derived once
      // at the end. Deciding per row makes the report depend on which row
      // happened to arrive last, which is not a fact about the agent.
      saw_root: false,
      saw_child: false,
      observed_events: 0,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: 0,
    }
    if (row.parent_tool_call_id !== null && row.parent_tool_call_id !== undefined) {
      bucket.saw_child = true
    } else {
      bucket.saw_root = true
    }
    bucket.observed_events += 1
    bucket.input_tokens += numeric(row.input_tokens)
    bucket.output_tokens += numeric(row.output_tokens)
    bucket.duration_ms += numeric(row.duration_ms)
    buckets.set(agentId, bucket)
  }
  if (usage.length === 0) {
    return {
      ...unavailable(
        "no usage has been imported for this work item, so no agent identity has been observed",
      ),
      missing_agent_id: { observed_events: missingId, reason: MISSING_AGENT_ID },
    }
  }
  const rows = [...buckets.values()].map(({ saw_root, saw_child, ...rest }) => ({
    agent_id: rest.agent_id,
    role: saw_root && saw_child ? "mixed" : saw_child ? "subagent" : "root",
    observed_events: rest.observed_events,
    input_tokens: rest.input_tokens,
    output_tokens: rest.output_tokens,
    duration_ms: rest.duration_ms,
  }))
  return {
    class: PROVENANCE.measured,
    value: rows,
    missing_agent_id: { observed_events: missingId, reason: MISSING_AGENT_ID },
  }
}


/** One entry per source and session actually imported for this item. */
function coverageSources(db, workItemId) {
  const imports = db
    .prepare("SELECT * FROM imports WHERE work_item_id = ? ORDER BY import_id")
    .all(workItemId)
  const latest = new Map()
  for (const entry of imports) latest.set(`${entry.source}\u0000${entry.session_id}`, entry)

  return [...latest.values()].map((entry) => {
    const rows = db
      .prepare(
        "SELECT COUNT(*) AS events, MIN(source_created_at) AS first_event_at, " +
          "MAX(source_created_at) AS last_event_at FROM usage_events " +
          "WHERE work_item_id = ? AND source = ? AND session_id = ?",
      )
      .get(workItemId, entry.source, entry.session_id)
    return {
      source: entry.source,
      source_kind: "native_local",
      session_id: entry.session_id,
      machine_id:
        entry.machine_id === null
          ? { class: PROVENANCE.unavailable, value: null }
          : { class: PROVENANCE.declared, value: entry.machine_id },
      events: rows.events,
      first_event_at: rows.first_event_at,
      last_event_at: rows.last_event_at,
      observed_through: entry.observed_through,
      requested_since: entry.requested_since,
      requested_until: entry.requested_until,
      complete: {
        class: PROVENANCE.unavailable,
        reason:
          "the source states no completeness guarantee; observation stops at the " +
          "cutoff above and a later row may still arrive",
      },
      imported_at: entry.imported_at,
    }
  })
}

/**
 * Recording gaps that overlap the window this item was alive in.
 *
 * A cancelled item is as terminal as a completed one, and the endpoint here is
 * the same one lead time reports. Reading only the completion row left an
 * abandoned item accruing gaps forever, so one report carried two different
 * lifetimes for the same work.
 */
function overlappingGaps(gaps, row, terminal, asOf) {
  const itemStart = Date.parse(row.intake_at)
  const itemEnd = terminal ? Date.parse(terminal.terminal_at) : Date.parse(asOf)
  let count = 0
  for (const gap of gaps) {
    const start = Date.parse(gap.disabled_at)
    const end = gap.enabled_at === null ? Date.parse(asOf) : Date.parse(gap.enabled_at)
    if (start <= itemEnd && end >= itemStart) count += 1
  }
  return count
}

/**
 * What linked children add up to.
 *
 * Inferred, and separate from the item's own consumption: a linked child's
 * usage is the child's, and folding it into the parent's own figure would
 * count the same work in two places.
 */
function rollup(db, links) {
  const children = links.filter((link) => link.relation === "child").map((link) => link.related_work_item_id)
  if (children.length === 0) {
    return { tokens: unavailable("no linked children"), includes: [] }
  }
  const value = {}
  for (const field of TOKEN_FIELDS) value[field] = 0
  const placeholders = children.map(() => "?").join(", ")
  const rows = db
    .prepare(`SELECT * FROM usage_events WHERE work_item_id IN (${placeholders})`)
    .all(...children)
  for (const row of rows) {
    for (const field of TOKEN_FIELDS) value[field] += numeric(row[TOKEN_COLUMNS[field]])
  }
  return { tokens: { class: PROVENANCE.inferred, value, basis: "linked_child_items" }, includes: children }
}

function totalTokens(items) {
  const value = {}
  for (const field of TOKEN_FIELDS) value[field] = 0
  let contributing = 0
  for (const item of items) {
    if (item.tokens.value === null) continue
    contributing += 1
    for (const field of TOKEN_FIELDS) value[field] += item.tokens.value[field]
  }
  if (contributing === 0) {
    return unavailable("no work item has imported usage")
  }
  return { class: PROVENANCE.measured, value, contributing_items: contributing }
}

/**
 * Money, per currency, with what it could not cover.
 *
 * There is no single number across currencies, and the ledger invents neither a
 * conversion between them nor a price for an item nobody priced.
 */
function totalFinancialCost(db, items) {
  const byCurrency = new Map()
  const uncosted = []
  let priced = 0
  for (const item of items) {
    const basis = db.prepare("SELECT * FROM cost_bases WHERE work_item_id = ?").get(item.work_item_id)
    if (basis === undefined) {
      uncosted.push(item.work_item_id)
      continue
    }
    priced += 1
    const bucket = byCurrency.get(basis.currency) ?? {
      currency: basis.currency,
      value: 0,
      items: 0,
      decimals: 0,
    }
    bucket.value += basis.amount
    bucket.decimals = Math.max(bucket.decimals, declaredDecimals(basis.amount))
    bucket.items += 1
    byCurrency.set(basis.currency, bucket)
  }
  const rows = [...byCurrency.values()].map(({ decimals, ...bucket }) => ({
    ...bucket,
    value: roundTo(bucket.value, decimals),
  }))
  return {
    class: priced > 0 ? PROVENANCE.declared : PROVENANCE.unavailable,
    // The array contract holds whether or not anything was priced; what changes
    // is that an empty one now says why it is empty rather than implying zero.
    by_currency: rows,
    ...(priced > 0
      ? {}
      : {
          reason:
            "no work item in this report carries a declared cost basis, and a " +
            "credit or multiplier unit carries no universal price",
        }),
    coverage: { priced_items: priced, unpriced_items: uncosted.length },
    uncosted_items: { count: uncosted.length, work_item_ids: uncosted },
  }
}

/**
 * How many decimal places an operator actually declared.
 *
 * Read from the number's own representation, including exponent form, so that
 * 4e-7 is understood as seven places rather than none.
 */
function declaredDecimals(value) {
  const [mantissa, exponent = "0"] = String(value).split(/e/iu)
  const dot = mantissa.indexOf(".")
  const fraction = dot === -1 ? 0 : mantissa.length - dot - 1
  return Math.min(100, Math.max(0, fraction - Number(exponent)))
}

/**
 * Round a currency total for presentation only, never below what was declared.
 *
 * Summing floats turns 4.2 + 0.1 into 4.300000000000001, which is noise a
 * reader should not have to filter. Rounding to a *fixed* precision instead
 * silently altered the operator's own figure — 0.0000004 became 0, and the
 * total stopped equalling the sum of its parts — so the precision here is
 * whatever the declarations themselves carried. There is no minor-unit model
 * and no conversion: this is presentation of one currency's own sum.
 */
function roundTo(value, decimals) {
  return Number(value.toFixed(decimals))
}

export function readRecording(db) {
  const row = db.prepare("SELECT value FROM ledger_state WHERE key = 'recording_enabled'").get()
  return { enabled: row === undefined ? true : row.value === "1" }
}

export function readGaps(db) {
  return db
    .prepare("SELECT * FROM recording_gaps ORDER BY gap_id")
    .all()
    .map((gap) => ({
      disabled_at: gap.disabled_at,
      enabled_at: gap.enabled_at,
      reason: gap.reason,
      open: gap.enabled_at === null,
    }))
}

function readTombstones(db) {
  const row = db
    .prepare("SELECT COUNT(*) AS count, MAX(deleted_at) AS last_deleted_at FROM tombstones")
    .get()
  return { count: row.count, last_deleted_at: row.last_deleted_at }
}
