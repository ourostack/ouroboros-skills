// The owner-private work-item report.
//
// The report is the whole point of the ledger: a person reading their own work
// should be able to tell, per field, whether a number was measured at its
// native source, declared by whoever recorded it, inferred by a stated rule,
// estimated, or simply unavailable. A report that quietly mixes those is worse
// than no report, so the rules are asserted rather than described.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { callTool } from "../../src/server.js"
import {
  mkLedgerFixture,
  writeSessionRecords,
  useHostEnv,
  cleanup,
  baseSessionRecords,
  FIXTURE_SESSION_ID,
} from "./_helpers.js"

const PROVENANCE_CLASSES = ["measured", "declared", "inferred", "estimated", "unavailable"]

function body(result) {
  const text = result.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    return { status: "unroutable", message: text }
  }
}

async function ledger({ deskRoot, input, person = "rowan" }) {
  return callTool({ deskRoot, name: "desk_work_ledger", input, person })
}

const ENDPOINT = "desks/rowan/delivery/intake-queue/task.md"

/** Intake plus the commitment every later action depends on. */
async function committedItem(fixture, request) {
  const workItemId = await seedItem(fixture, request)
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "commit",
      work_item_id: workItemId,
      outcome: "One assessable outcome.",
      scope: "Just this.",
      evidence: "Replay output.",
      delivery_endpoint: ENDPOINT,
      operator_go: { by: "operator", at: "2026-09-08T17:00:00.000Z" },
    },
  })
  return workItemId
}

async function seedItem(fixture, request) {
  const created = body(
    await ledger({ deskRoot: fixture.deskRoot, input: { action: "intake", request } }),
  )
  assert.equal(created.status, "intake_recorded", created.message ?? "")
  return created.work_item.work_item_id
}

async function reportFor(fixture, workItemId, extra = {}) {
  const report = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "report", work_item_id: workItemId, ...extra },
    }),
  )
  return report.items[0]
}

// Two sessions whose model calls overlap in wall-clock time: 60s of elapsed
// work containing 100s of billed model time. Any report that adds those
// durations together and calls the result elapsed time is lying.
function overlappingRecords() {
  return {
    sessions: [
      { id: "session-one", host_type: "cli" },
      { id: "session-two", host_type: "cli" },
    ],
    events: [
      {
        id: 1,
        session_id: "session-one",
        model: "model-a",
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_tokens: 20,
        cache_write_tokens: 5,
        reasoning_tokens: 10,
        total_nano_aiu: 3000,
        request_multiplier: 1,
        duration_ms: 60000,
        initiator: "user",
        created_at: "2026-09-08T18:00:00.000Z",
      },
      {
        id: 2,
        session_id: "session-two",
        agent_id: "agent-1",
        parent_tool_call_id: "call-1",
        model: "model-b",
        input_tokens: 400,
        output_tokens: 40,
        total_nano_aiu: 1000,
        request_multiplier: 0.25,
        duration_ms: 40000,
        initiator: "sub-agent",
        created_at: "2026-09-08T18:00:10.000Z",
      },
    ],
  }
}

async function importBoth(fixture, workItemId) {
  for (const sessionId of ["session-one", "session-two"]) {
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: sessionId,
        machine_id: "workstation-a",
      },
    })
  }
}

test("every reported field carries a provenance class", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    const classed = [
      item.request,
      item.state,
      item.elapsed_ms,
      item.model_time_ms,
      item.tokens,
      item.usage_multiplier_sum,
      item.nano_aiu_sum,
      item.financial_cost,
    ]
    for (const field of classed) {
      assert.ok(
        PROVENANCE_CLASSES.includes(field.class),
        `field class ${field.class} must be one of ${PROVENANCE_CLASSES.join(", ")}`,
      )
    }
    assert.equal(item.request.class, "declared")
    assert.equal(item.tokens.class, "measured")
    assert.equal(item.tokens.value.input, 1400)
    assert.equal(item.tokens.value.output, 140)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("parallel model time is never reported as elapsed time", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.model_time_ms.value, 100000)
    assert.equal(item.model_time_ms.class, "measured")
    // The union is only computable over intervals with a known start. The
    // native records carry one timestamp per row whose meaning — request start,
    // completion, or write time — the source never states, so a span derived
    // from them stays unavailable rather than being asserted as measured or
    // inferred. Declared phase intervals do have both ends, and those are what
    // an activity span may be built from.
    assert.equal(item.active_span_ms.class, "unavailable")
    assert.equal(item.active_span_ms.value, null)
    assert.equal(item.active_span_ms.reason, "source_interval_anchor_unknown")

    // Two declared intervals with known bounds that overlap by ten seconds:
    // 18:00:00-18:00:40 and 18:00:30-18:01:10. Their durations sum to 80s, but
    // the union of the wall-clock they cover is 70s. The span must report the
    // union, so the overlap is counted once.
    for (const phase of [
      { phase: "planning", started_at: "2026-09-08T18:00:00.000Z", ended_at: "2026-09-08T18:00:40.000Z" },
      { phase: "doing", started_at: "2026-09-08T18:00:30.000Z", ended_at: "2026-09-08T18:01:10.000Z" },
    ]) {
      const recorded = body(
        await ledger({
          deskRoot: fixture.deskRoot,
          input: { action: "phase", work_item_id: workItemId, ...phase },
        }),
      )
      assert.equal(recorded.status, "phase_recorded", recorded.message ?? "")
    }

    const fromPhases = await reportFor(fixture, workItemId, { include_phase_span: true })
    assert.equal(fromPhases.active_span_ms.class, "inferred")
    assert.equal(fromPhases.active_span_ms.method, "interval_union")
    assert.equal(fromPhases.active_span_ms.basis, "declared_phase_intervals")
    assert.equal(fromPhases.active_span_ms.intervals, 2)
    assert.equal(fromPhases.active_span_ms.value, 70000, "the union counts the overlap once")
    assert.notEqual(fromPhases.active_span_ms.value, 80000, "summing the intervals would double-count")
    assert.ok(
      item.model_time_ms.value > fromPhases.active_span_ms.value,
      "parallel model time exceeds the wall-clock the work actually occupied",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Three separate layers, never collapsed into one another:
//   1. token counts, as the source reported them
//   2. the source's own credit or multiplier units — an internal accounting
//      unit, not a price
//   3. actual money, which only exists when someone attached a rate with a
//      source and an effective date
//
// Layer 2 does not become layer 3 by arithmetic. Rates vary by account,
// agreement and date, so a credit unit carries no universal price and the
// ledger must not invent one.
test("credit units are reported as units, not as a price", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.tokens.class, "measured")
    assert.equal(item.usage_multiplier_sum.value, 1.25)
    assert.equal(item.usage_multiplier_sum.unit, "request_multiplier")
    assert.equal(item.usage_multiplier_sum.is_price, false)
    assert.equal(item.nano_aiu_sum.value, 4000)
    assert.equal(item.nano_aiu_sum.unit, "nano_aiu")
    assert.equal(item.nano_aiu_sum.is_price, false)

    assert.equal(item.financial_cost.class, "unavailable")
    assert.equal(item.financial_cost.value, null)
    assert.equal(item.financial_cost.currency, null)
    assert.equal(item.financial_cost.basis, null)
    assert.match(item.financial_cost.reason, /rate/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("no rate is inferred from credit units, however many were recorded", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    assert.ok(item.nano_aiu_sum.value > 0, "the fixture must actually carry credit units")
    assert.equal(item.financial_cost.value, null)

    // No action may install a conversion rate that applies to everything.
    const global = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "set_conversion_rate", rate: 0.0001, rate_unit: "nano_aiu" },
    })
    assert.equal(global.isError, true)
    assert.match(body(global).message, /unknown action/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("a financial cost exists only with an explicit rate, its source and its date", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const complete = {
      action: "cost_basis",
      work_item_id: workItemId,
      amount: 4.2,
      currency: "USD",
      rate: 0.00105,
      rate_unit: "nano_aiu",
      source: "The rate schedule this figure was read from.",
      effective_date: "2026-09-01",
    }
    for (const missing of ["amount", "currency", "rate", "rate_unit", "source", "effective_date"]) {
      const partial = { ...complete }
      delete partial[missing]
      const rejected = await ledger({ deskRoot: fixture.deskRoot, input: partial })
      assert.equal(rejected.isError, true, `cost_basis must require ${missing}`)
      assert.match(body(rejected).message, new RegExp(missing, "u"))
    }

    const recorded = body(await ledger({ deskRoot: fixture.deskRoot, input: complete }))
    assert.equal(recorded.status, "cost_basis_recorded")

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.financial_cost.value, 4.2)
    assert.equal(item.financial_cost.currency, "USD")
    assert.equal(item.financial_cost.class, "declared")
    assert.equal(item.financial_cost.basis.rate, 0.00105)
    assert.equal(item.financial_cost.basis.rate_unit, "nano_aiu")
    assert.equal(item.financial_cost.basis.effective_date, "2026-09-01")
    assert.match(item.financial_cost.basis.source, /rate schedule/iu)

    // Layer 2 is untouched by layer 3: the credit units still read as units.
    assert.equal(item.nano_aiu_sum.unit, "nano_aiu")
    assert.equal(item.nano_aiu_sum.is_price, false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("a rate recorded for one work item does not price any other work item", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const pricedId = await seedItem(fixture, "The outcome someone priced.")
    const otherId = await seedItem(fixture, "The outcome nobody priced.")
    // One session each: two work items cannot both claim session-two (see the
    // source-observation identity test), and this test needs the unpriced item
    // to hold real usage of its own.
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: pricedId,
        source: "copilot_local_session_records",
        session_id: "session-one",
        machine_id: "workstation-a",
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: otherId,
        source: "copilot_local_session_records",
        session_id: "session-two",
        machine_id: "workstation-a",
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "cost_basis",
        work_item_id: pricedId,
        amount: 4.2,
        currency: "USD",
        rate: 0.00105,
        rate_unit: "nano_aiu",
        source: "The rate schedule this figure was read from.",
        effective_date: "2026-09-01",
      },
    })

    const other = await reportFor(fixture, otherId)
    assert.ok(other.nano_aiu_sum.value > 0)
    assert.equal(other.financial_cost.value, null)
    assert.equal(other.financial_cost.class, "unavailable")

    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    // The total is real for what was priced and says what it leaves out, and
    // it is held per currency — the ledger converts neither credits into money
    // nor one currency into another.
    assert.equal(report.totals.financial_cost.class, "declared")
    assert.deepEqual(report.totals.financial_cost.by_currency, [{ currency: "USD", value: 4.2, items: 1 }])
    assert.equal(report.totals.financial_cost.coverage.priced_items, 1)
    assert.equal(report.totals.financial_cost.coverage.unpriced_items, 1)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("declared phase records are reported as declared, not measured", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "phase",
        work_item_id: workItemId,
        phase: "planning",
        started_at: "2026-09-08T18:00:00Z",
        ended_at: "2026-09-08T18:30:00Z",
      },
    })

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.phases.class, "declared")
    assert.equal(item.phases.value.length, 1)
    assert.equal(item.phases.value[0].phase, "planning")
    assert.equal(item.model_time_ms.class, "unavailable")
    assert.equal(item.model_time_ms.value, null)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("coverage names each source and machine and never claims to be complete", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: "session-one",
        machine_id: "workstation-a",
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: "session-two",
        machine_id: "workstation-b",
      },
    })

    const item = await reportFor(fixture, workItemId)
    const machines = item.coverage.sources.map((entry) => entry.machine_id.value).sort()
    assert.deepEqual(machines, ["workstation-a", "workstation-b"])
    for (const entry of item.coverage.sources) {
      assert.equal(entry.machine_id.class, "declared")
      assert.equal(entry.source, "copilot_local_session_records")
      assert.equal(entry.complete.class, "unavailable")
      assert.ok(entry.events > 0)
      assert.ok(entry.first_event_at)
      assert.ok(entry.last_event_at)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("linked work items roll up without double-counting the child", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const parentId = await seedItem(fixture, "Parent outcome.")
    const childId = await seedItem(fixture, "Child outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "link",
        work_item_id: parentId,
        related_work_item_id: childId,
        relation: "child",
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: childId,
        source: "copilot_local_session_records",
        session_id: "session-one",
        machine_id: "workstation-a",
      },
    })

    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    const parent = report.items.find((entry) => entry.work_item_id === parentId)
    const child = report.items.find((entry) => entry.work_item_id === childId)
    assert.equal(child.tokens.value.input, 1000)
    // Nothing was imported for the parent, so nothing is known about the
    // parent's own consumption. A linked child does not make that zero, and
    // `unavailable` must never be rendered as a number.
    assert.equal(parent.tokens.class, "unavailable")
    assert.equal(parent.tokens.value, null)
    assert.equal(parent.rollup.tokens.value.input, 1000)
    assert.equal(parent.rollup.tokens.class, "inferred")
    assert.deepEqual(parent.rollup.includes, [childId])
    assert.equal(report.totals.tokens.value.input, 1000)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("the report is neither a ranking nor an export", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await seedItem(fixture, "One outcome.")
    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    assert.equal(report.status, "ok")
    for (const forbidden of ["rank", "ranking", "leaderboard", "score", "percentile"]) {
      assert.ok(
        !Object.hasOwn(report, forbidden),
        `the report must not expose a ${forbidden} field`,
      )
    }
    assert.equal(report.scope.person, "rowan")
    assert.equal(report.scope.shared, false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// A summary that lags its own source looks exactly like an absence of work.
// The only defence is to say what was actually observed and when observation
// stopped, so a silent gap reads as a gap instead of as a quiet day.
test("coverage reports the cutoff it actually observed, not the window asked for", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: "session-one",
        machine_id: "workstation-a",
        until: "2027-01-01T00:00:00.000Z",
      },
    })

    const item = await reportFor(fixture, workItemId)
    const entry = item.coverage.sources[0]
    assert.equal(entry.source_kind, "native_local")
    assert.equal(entry.observed_through, "2026-09-08T18:00:00.000Z")
    assert.equal(entry.requested_until, "2027-01-01T00:00:00.000Z")
    assert.ok(
      entry.observed_through < entry.requested_until,
      "asking for a window does not make it covered",
    )
    assert.equal(entry.complete.class, "unavailable")

    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    assert.ok(report.as_of, "the report must say when it was produced")
    assert.ok(report.as_of >= entry.observed_through)
    assert.match(report.coverage_note, /observed/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("an item with no imported usage says so rather than reporting zero cost", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const workItemId = await seedItem(fixture, "Work nobody has imported yet.")
    const item = await reportFor(fixture, workItemId)
    assert.deepEqual(item.coverage.sources, [])
    assert.equal(item.tokens.class, "unavailable")
    assert.equal(item.tokens.value, null)
    assert.equal(item.model_time_ms.class, "unavailable")
    assert.equal(item.nano_aiu_sum.class, "unavailable")
    assert.match(item.tokens.reason, /import/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// The counts the report may state, and the one it may not. Observed and
// distinct event counts are both measured facts about the records; a billable
// request count is not derivable from them, because the source carries no
// authoritative billing identifier.
test("billable requests are unavailable while observed and distinct counts are measured", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.observed_events.class, "measured")
    assert.equal(item.normalized_distinct_events.class, "measured")
    assert.equal(item.billable_requests.class, "unavailable")
    assert.equal(item.billable_requests.value, null)
    assert.match(item.billable_requests.reason, /billing|identifier/iu)
    assert.ok(
      item.observed_events.value >= item.normalized_distinct_events.value,
      "the raw view can never be smaller than the normalized-distinct view",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("the report keeps the role split instead of calling all agent activity engineering", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await importBoth(fixture, workItemId)

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.by_initiator.class, "measured")
    assert.ok(
      item.by_initiator.value.find((row) => row.initiator === "user"),
      "user-initiated activity stays separate",
    )
    assert.ok(
      item.by_initiator.value.find((row) => row.initiator === "sub-agent"),
      "sub-agent activity stays separate",
    )
    for (const forbidden of ["engineering_share", "substantive_ratio", "productivity", "effort_score"]) {
      assert.ok(
        !Object.hasOwn(item, forbidden),
        `the report must not derive ${forbidden} from a role split`,
      )
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Lead time and activity are different questions. How long an item was worked
// on is a union of intervals; how long it took is intake to the declared
// endpoint, including the waiting nobody was working through. Reporting one
// under the other's name hides queue and discovery time entirely.
test("lead time runs from intake to endpoint and is censored while the item is open", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const openItem = await committedItem(fixture, "Still in flight.")
    const open = await reportFor(fixture, openItem)
    assert.equal(open.lead_time_ms.class, "measured")
    assert.equal(open.lead_time_ms.censored, true)
    assert.match(open.lead_time_ms.as_of, /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal(open.lead_time_ms.from, "intake")
    assert.equal(open.lead_time_ms.to, "as_of")
    assert.notEqual(
      open.lead_time_ms.value,
      open.active_span_ms.value,
      "a censored lead time is not the activity union",
    )

    const doneItem = await committedItem(fixture, "Delivered outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: doneItem,
        endpoint: ENDPOINT,
        evidence: "Delivered and checked.",
      },
    })
    const done = await reportFor(fixture, doneItem)
    assert.equal(done.lead_time_ms.censored, false)
    // The ledger times its own recording of the terminal claim, not an
    // unobserved physical delivery, so the endpoint is named for that.
    assert.equal(done.lead_time_ms.to, "terminal_claim_recording")
    assert.equal(done.lead_time_ms.disposition, "completed")
    assert.equal(done.lead_time_ms.delivered, "declared")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// The named deliverable is work / phase / cycle / model / sub-agent. Cycle is
// recorded and model is measured per row, so both get a view; where an
// observation cannot be attributed to one bucket, the report says so instead of
// choosing a bucket for it.
test("the report breaks usage down by model and by cycle, and exposes what it cannot attribute", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      },
    })

    const item = await reportFor(fixture, workItemId)

    assert.equal(item.by_model.class, "measured")
    const models = item.by_model.value.map((row) => row.model).sort()
    assert.deepEqual(models, ["model-a", "model-b"])
    assert.equal(
      item.by_model.value.reduce((sum, row) => sum + row.observed_events, 0),
      item.observed_events.value,
      "every observation belongs to exactly one model bucket",
    )

    // No phase was declared around these observations, so no cycle can claim
    // them. That is an honest unattributed remainder, not a zero.
    assert.equal(item.by_cycle.class, "declared")
    assert.deepEqual(item.by_cycle.value, [])
    assert.equal(item.by_cycle.unattributed.observed_events, 2)
    assert.equal(item.by_cycle.unattributed.reason, "no_declared_phase_covering_observation")

    assert.equal(item.by_initiator.value.find((row) => row.initiator === "sub-agent").observed_events, 1)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// One declared basis per work item, replaced rather than accumulated. Two
// bases that both claim to price the same item have no representable result,
// and silently adding a second one would invent a total nobody asserted. A
// replacement must name the revision it believes it is replacing, so a retried
// call cannot overwrite a newer correction.
test("a work item carries one replaceable cost basis, and a stale replacement is refused", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const workItemId = await seedItem(fixture, "One priced outcome.")
    await importBoth(fixture, workItemId)

    const basis = {
      action: "cost_basis",
      work_item_id: workItemId,
      amount: 4.2,
      currency: "USD",
      rate: 0.00105,
      rate_unit: "nano_aiu",
      source: "the account's own rate schedule",
      effective_date: "2026-09-01",
    }
    const first = body(await ledger({ deskRoot: fixture.deskRoot, input: basis }))
    assert.equal(first.revision, 1)

    // A second basis without acknowledging the first is refused: the contract
    // has no meaning for two simultaneous prices on one item.
    const competing = await ledger({
      deskRoot: fixture.deskRoot,
      input: { ...basis, amount: 9.9, currency: "EUR" },
    })
    assert.equal(competing.isError, true)
    assert.match(body(competing).message, /expected_revision|already has a cost basis/iu)

    const stale = await ledger({
      deskRoot: fixture.deskRoot,
      input: { ...basis, amount: 5.5, expected_revision: 7 },
    })
    assert.equal(stale.isError, true)
    assert.match(body(stale).message, /revision/iu)

    const replaced = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { ...basis, amount: 5.5, source: "corrected rate schedule", expected_revision: 1 },
      }),
    )
    assert.equal(replaced.revision, 2)
    assert.equal(replaced.status, "cost_basis_replaced")

    const item = await reportFor(fixture, workItemId)
    assert.equal(item.financial_cost.value, 5.5)
    assert.equal(item.financial_cost.class, "declared")
    assert.equal(item.financial_cost.basis.revision, 2)
    assert.equal(item.financial_cost.superseded_revisions, 1)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Money does not add across currencies, and an item nobody priced is not free.
// The aggregate says what it covered and what it could not.
test("aggregate money is reported per currency with explicit uncosted coverage", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, overlappingRecords())
    const usdItem = await seedItem(fixture, "Priced in one currency.")
    const eurItem = await seedItem(fixture, "Priced in another.")
    const unpriced = await seedItem(fixture, "Priced by nobody.")
    await importBoth(fixture, usdItem)

    for (const [id, amount, currency] of [
      [usdItem, 4.2, "USD"],
      [eurItem, 3.1, "EUR"],
    ]) {
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "cost_basis",
          work_item_id: id,
          amount,
          currency,
          rate: 0.00105,
          rate_unit: "nano_aiu",
          source: "the account's own rate schedule",
          effective_date: "2026-09-01",
        },
      })
    }

    const report = body(await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }))
    assert.deepEqual(
      report.totals.financial_cost.by_currency.sort((a, b) => a.currency.localeCompare(b.currency)),
      [
        { currency: "EUR", value: 3.1, items: 1 },
        { currency: "USD", value: 4.2, items: 1 },
      ],
    )
    assert.equal(report.totals.financial_cost.class, "declared")
    assert.equal(report.totals.financial_cost.uncosted_items.count, 1)
    assert.deepEqual(report.totals.financial_cost.uncosted_items.work_item_ids, [unpriced])
    assert.equal(
      report.totals.financial_cost.combined ?? null,
      null,
      "there is no single number across currencies and none may be invented",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// The unattributed case covers observations no phase claims. The opposite case
// is worse and was unpinned: when two declared phases both cover an observation,
// any single bucket the report picks is a guess presented as a breakdown. The
// ambiguity has to be visible, and the ambiguous events must not be silently
// double-counted into both buckets either.
test("an observation covered by two declared phases is reported as ambiguous, not allocated", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const workItemId = await seedItem(fixture, "One measurable outcome.")

    // Two overlapping declared phases; the first observation falls inside both.
    for (const [phase, cycle, started, ended] of [
      ["implementation", "cycle-1", "2026-09-08T17:50:00.000Z", "2026-09-08T18:00:05.000Z"],
      ["review", "cycle-2", "2026-09-08T17:55:00.000Z", "2026-09-08T18:20:00.000Z"],
    ]) {
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "phase",
          work_item_id: workItemId,
          phase,
          cycle,
          started_at: started,
          ended_at: ended,
        },
      })
    }

    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      },
    })

    const item = await reportFor(fixture, workItemId)

    assert.equal(item.by_cycle.ambiguous.observed_events, 1)
    assert.deepEqual(item.by_cycle.ambiguous.cycles.sort(), ["cycle-1", "cycle-2"])
    assert.equal(item.by_cycle.ambiguous.reason, "observation_covered_by_multiple_declared_phases")

    // The ambiguous event belongs to no bucket, so the buckets plus the
    // ambiguous and unattributed remainders account for every observation
    // exactly once.
    const bucketed = item.by_cycle.value.reduce((sum, row) => sum + row.observed_events, 0)
    assert.equal(
      bucketed + item.by_cycle.ambiguous.observed_events + item.by_cycle.unattributed.observed_events,
      item.observed_events.value,
      "no observation may be dropped or counted twice across the cycle breakdown",
    )
    assert.ok(
      item.by_cycle.value.every((row) => row.observed_events >= 0),
      "an ambiguous event is never subtracted out of a bucket to make totals work",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Several report fields are arrays of named rows and several are objects with
// named properties. JSON.stringify silently discards named properties hung off
// an array, so a shape that is convenient in JS can arrive at the MCP boundary
// with its data gone while every in-process assertion still passes. This test
// reads the report only after it has crossed that boundary.
test("named report fields survive JSON transit across the MCP boundary", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const workItemId = await committedItem(fixture, "Serialize every named field.")
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "phase",
        work_item_id: workItemId,
        phase: "implementation",
        cycle: "cycle-1",
        started_at: "2026-09-08T17:50:00.000Z",
        ended_at: "2026-09-08T18:00:05.000Z",
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      },
    })
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "cost_basis",
        work_item_id: workItemId,
        amount: 4.2,
        currency: "USD",
        rate: 0.00105,
        rate_unit: "nano_aiu",
        source: "published rate schedule",
        effective_date: "2026-09-01",
      },
    })

    // body() parses the tool's serialized text, so anything asserted below has
    // already made the round trip a caller would see.
    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    const item = report.items.find((row) => row.work_item_id === workItemId)

    // Arrays of named rows: the name must live in a property of each element,
    // never as a property hung off the array itself.
    for (const [label, rows, key] of [
      ["items", report.items, "work_item_id"],
      ["by_currency", report.totals.financial_cost.by_currency, "currency"],
      ["by_model", item.by_model.value, "model"],
      ["by_initiator", item.by_initiator.value, "initiator"],
      ["coverage.sources", item.coverage.sources, "machine_id"],
    ]) {
      assert.ok(Array.isArray(rows), `${label} must survive as an array`)
      assert.ok(rows.length > 0, `${label} must not be empty in this fixture`)
      for (const row of rows) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(row, key),
          `${label} rows must carry ${key} as their own property after JSON transit`,
        )
      }
    }

    // Objects with named properties: present, and not silently turned into an
    // array whose properties would have been dropped in transit.
    assert.equal(Array.isArray(item.coverage), false, "per-item coverage is an object, not an array")
    assert.equal(typeof item.coverage.recording_gaps_overlapping, "number")
    assert.equal(typeof item.by_cycle.ambiguous.observed_events, "number")
    assert.equal(typeof item.by_cycle.unattributed.observed_events, "number")
    assert.equal(typeof report.totals.financial_cost.coverage.priced_items, "number")

    // Re-serializing what the caller already received must be a fixed point.
    // If any named property had been hung off an array, it would be missing
    // above; if one is added later, this catches the loss on the next hop.
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
