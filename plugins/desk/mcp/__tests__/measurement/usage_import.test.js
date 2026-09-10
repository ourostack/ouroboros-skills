// Native usage import — desk_work_ledger pulling minimal usage facts from the
// host's own local session records.
//
// The host records are the native source; this import keeps a minimal
// normalized fact per event plus its provenance, and never copies transcripts.
// Everything asserted here is about honesty: what was actually measured, what
// was merely declared, what is simply unavailable, and the fact that importing
// the same records twice must not inflate anything.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import Database from "better-sqlite3"
import { promises as fs } from "node:fs"

import { callTool } from "../../src/server.js"
import { mkLedgerFixture, writeSessionRecords, writeSessionWorkspace, useHostEnv, cleanup, FIXTURE_SESSION_ID, baseSessionRecords } from "./_helpers.js"

const SESSION_ID = FIXTURE_SESSION_ID
const MACHINE = "workstation-a"

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

async function intake(fixture) {
  const result = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "intake", request: "One outcome worth measuring." },
    }),
  )
  assert.equal(result.status, "intake_recorded", result.message ?? "")
  return result.work_item.work_item_id
}

const baseRecords = baseSessionRecords

async function importUsage(fixture, workItemId, extra = {}) {
  return ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "import_usage",
      work_item_id: workItemId,
      source: "copilot_local_session_records",
      session_id: SESSION_ID,
      machine_id: MACHINE,
      ...extra,
    },
  })
}

test("import keeps minimal usage facts with native provenance", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)

    const imported = body(await importUsage(fixture, workItemId))
    assert.equal(imported.status, "usage_imported")
    assert.equal(imported.imported_events, 2)
    assert.equal(imported.duplicates_skipped, 0)
    assert.equal(imported.malformed_skipped, 0)
    assert.equal(imported.provenance.source, "copilot_local_session_records")
    assert.equal(imported.provenance.session_id, SESSION_ID)
    assert.equal(imported.provenance.machine_id.value, MACHINE)
    assert.equal(imported.provenance.machine_id.class, "declared")
    assert.ok(imported.provenance.imported_at)

    const inspected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: workItemId },
      }),
    )
    assert.equal(inspected.usage.length, 2)
    const subAgent = inspected.usage.find((row) => row.initiator === "sub-agent")
    assert.equal(subAgent.agent_id, "agent-7")
    assert.equal(subAgent.parent_tool_call_id, "call-99")
    assert.equal(subAgent.model, "model-b")
    assert.equal(subAgent.duration_ms, 20000)
    for (const key of ["user_message", "assistant_response", "text", "transcript"]) {
      assert.equal(subAgent[key], undefined, `import must not copy ${key} into the ledger`)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("importing the same records twice does not inflate the ledger", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)

    await importUsage(fixture, workItemId)
    const again = body(await importUsage(fixture, workItemId))
    assert.equal(again.imported_events, 0)
    assert.equal(again.duplicates_skipped, 2)

    const inspected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: workItemId },
      }),
    )
    assert.equal(inspected.usage.length, 2)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("a retried import picks up only the events that arrived since the last one", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const records = baseRecords()
    writeSessionRecords(fixture.sourcePath, records)
    const workItemId = await intake(fixture)
    await importUsage(fixture, workItemId)

    writeSessionRecords(fixture.sourcePath, {
      sessions: [],
      events: [
        {
          id: 3,
          session_id: SESSION_ID,
          turn_index: 2,
          model: "model-a",
          input_tokens: 100,
          output_tokens: 10,
          total_nano_aiu: 500,
          request_multiplier: 1,
          duration_ms: 5000,
          created_at: "2026-09-08T18:05:00.000Z",
        },
      ],
    })

    const incremental = body(await importUsage(fixture, workItemId))
    assert.equal(incremental.imported_events, 1)
    assert.equal(incremental.duplicates_skipped, 2)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("malformed and partial rows are counted and skipped, never guessed", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const records = baseRecords()
    records.events.push({
      id: 4,
      session_id: SESSION_ID,
      turn_index: 3,
      model: "model-c",
      input_tokens: null,
      output_tokens: null,
      total_nano_aiu: null,
      request_multiplier: null,
      duration_ms: 1500,
      created_at: "2026-09-08T18:06:00.000Z",
    })
    records.events.push({
      id: 5,
      session_id: SESSION_ID,
      turn_index: 4,
      model: "model-c",
      duration_ms: 100,
      created_at: null,
    })
    writeSessionRecords(fixture.sourcePath, records)
    const workItemId = await intake(fixture)

    const imported = body(await importUsage(fixture, workItemId))
    assert.equal(imported.imported_events, 3)
    assert.equal(imported.malformed_skipped, 1)

    const inspected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: workItemId },
      }),
    )
    const partial = inspected.usage.find((row) => row.source_event_id === 4)
    assert.equal(partial.input_tokens, null)
    assert.equal(partial.request_multiplier, null)
    assert.equal(partial.duration_ms, 1500)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("import requires an explicit session binding rather than guessing the caller's session", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  const previous = process.env.COPILOT_AGENT_SESSION_ID
  process.env.COPILOT_AGENT_SESSION_ID = "99999999-9999-9999-9999-999999999999"
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)

    const unbound = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        machine_id: MACHINE,
      },
    })
    assert.equal(unbound.isError, true)
    assert.match(body(unbound).message, /session_id/u)
    assert.match(body(unbound).message, /explicit/iu)

    const unknownSession = await importUsage(fixture, workItemId, {
      session_id: "99999999-9999-9999-9999-999999999999",
    })
    assert.equal(unknownSession.isError, true)
    assert.match(body(unknownSession).message, /not present in the local session records/iu)
  } finally {
    if (previous === undefined) delete process.env.COPILOT_AGENT_SESSION_ID
    else process.env.COPILOT_AGENT_SESSION_ID = previous
    restore()
    await cleanup(fixture.base)
  }
})

test("import fails with a typed error when the local records are missing or unreadable", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const workItemId = await intake(fixture)
    const absent = await importUsage(fixture, workItemId)
    assert.equal(absent.isError, true)
    assert.match(body(absent).message, /local session records/iu)

    await fs.writeFile(fixture.sourcePath, "this is not a database", "utf8")
    const unreadable = await importUsage(fixture, workItemId)
    assert.equal(unreadable.isError, true)
    assert.match(body(unreadable).message, /could not be read/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("import refuses a caller-supplied source path and an unknown source name", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)

    const injected = await importUsage(fixture, workItemId, {
      source_path: fixture.sourcePath,
    })
    assert.equal(injected.isError, true)
    assert.match(body(injected).message, /unknown input field/iu)

    const unknownSource = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: workItemId,
        source: "some_other_vendor",
        session_id: SESSION_ID,
        machine_id: MACHINE,
      },
    })
    assert.equal(unknownSource.isError, true)
    assert.match(body(unknownSource).message, /source/u)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("import leaves the native records untouched", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const before = await fs.readFile(fixture.sourcePath)
    const workItemId = await intake(fixture)
    await importUsage(fixture, workItemId)
    const after = await fs.readFile(fixture.sourcePath)
    assert.ok(before.equals(after), "the import must read the host records, never write them")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// An empty window and an unobserved window produce the same number: zero. The
// import has to tell them apart, because a lagging or partial source reads as a
// quiet day otherwise.
test("a window with no rows reports an honest cutoff, not an absence of work", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)

    const empty = body(
      await importUsage(fixture, workItemId, { since: "2026-09-08T19:00:00.000Z" }),
    )
    assert.equal(empty.status, "usage_imported")
    assert.equal(empty.imported_events, 0)
    assert.equal(
      empty.observed_through,
      "2026-09-08T18:00:10.000Z",
      "the cutoff is the latest event the source actually holds",
    )
    assert.equal(empty.coverage.complete.class, "unavailable")
    assert.ok(
      !Object.hasOwn(empty, "no_activity"),
      "an empty window must never be reported as an absence of work",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("a lagging aggregate summary is refused as a basis for current coverage", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)
    const refused = body(
      await importUsage(fixture, workItemId, { source: "cloud_session_summary" }),
    )
    assert.equal(refused.status, "error")
    assert.match(refused.message, /source/u)
    assert.match(
      refused.message,
      /lag|aggregate|summary/iu,
      "the refusal must name why a rolled-up summary cannot establish coverage",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// These rows are usage OBSERVATIONS, not proven billable requests. On the real
// host, rows exist that are identical on every field except their surrogate id,
// and there is no authoritative billing request identifier to settle whether
// such a pair is two requests or one recorded twice. The import therefore keeps
// both views and claims neither as billing truth.
test("the import keeps a raw view and a normalized-field-distinct view, and calls neither billable", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const twin = {
      session_id: SESSION_ID,
      turn_index: 0,
      model: "model-a",
      input_tokens: 1000,
      output_tokens: 100,
      total_nano_aiu: 3000,
      request_multiplier: 1,
      duration_ms: 30000,
      initiator: "user",
      created_at: "2026-09-08T18:00:00.000Z",
    }
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: SESSION_ID, host_type: "cli" }],
      events: [
        { id: 1, ...twin },
        { id: 2, ...twin },
      ],
    })

    const workItemId = await intake(fixture)
    const imported = body(await importUsage(fixture, workItemId))

    assert.equal(imported.observed_events, 2, "both rows are retained as observed")
    assert.equal(
      imported.normalized_distinct_events,
      1,
      "the normalized-field-distinct view collapses rows identical on every field but id",
    )
    for (const forbidden of ["billable_requests", "requests_billed", "billed_events"]) {
      assert.ok(
        !Object.hasOwn(imported, forbidden),
        `the import must not claim ${forbidden}; there is no authoritative billing identifier`,
      )
    }
    assert.match(
      imported.provenance.events_note,
      /observ/iu,
      "the result must say these are observations rather than billed requests",
    )
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// On a real host the per-session workspace mapping is usually missing, and
// where it does exist the cloud id is almost always different from the local
// id. A design that keys usage on a cloud or task id therefore loses most
// sessions, so the local id is the join key and the cloud binding is an
// optional extra that may simply be absent.
test("the local session id is the join key and any cloud or task id is optional", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    await writeSessionWorkspace(fixture.copilotHome, SESSION_ID, {
      mcSessionId: "11111111-2222-3333-4444-555555555555",
      mcTaskId: "66666666-7777-8888-9999-000000000000",
    })

    const workItemId = await intake(fixture)
    const imported = body(await importUsage(fixture, workItemId))
    assert.equal(imported.binding.local_session_id, SESSION_ID)
    assert.equal(imported.binding.cloud_session_id.value, "11111111-2222-3333-4444-555555555555")
    assert.equal(imported.binding.cloud_session_id.class, "declared")
    assert.notEqual(
      imported.binding.cloud_session_id.value,
      imported.binding.local_session_id,
      "the two identifiers are not interchangeable",
    )
    assert.equal(imported.binding.task_id.class, "declared")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("a missing or unmapped workspace file leaves the cloud identity unavailable without failing the import", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())

    // One work item across both imports. A second work item claiming the same
    // source rows is a conflicting allocation by design (see the
    // source-observation identity test), which would mask what this test is
    // about: the optional workspace mapping, not the allocation rule.
    const workItemId = await intake(fixture)

    const noFile = body(await importUsage(fixture, workItemId))
    assert.equal(noFile.status, "usage_imported", "a missing mapping must not abort the import")
    assert.equal(noFile.binding.cloud_session_id.class, "unavailable")
    assert.equal(noFile.binding.cloud_session_id.value, null)

    await writeSessionWorkspace(fixture.copilotHome, SESSION_ID, {
      mcSessionId: null,
      mcTaskId: null,
    })
    const nulled = body(await importUsage(fixture, workItemId))
    assert.equal(nulled.status, "usage_imported")
    assert.equal(
      nulled.binding.cloud_session_id.class,
      "unavailable",
      "an explicit null mapping is unavailable, not the literal string null",
    )
    assert.equal(nulled.binding.task_id.class, "unavailable")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Most agent rows come from command wrappers rather than substantive
// engineering, so the role and the parent call have to survive the import. The
// ledger records the distinction and refuses to characterise it.
test("sub-agent rows keep their role and parent call rather than merging into the parent's work", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)
    await importUsage(fixture, workItemId)

    const rows = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: workItemId },
      }),
    ).usage

    const sub = rows.find((r) => r.initiator === "sub-agent")
    assert.ok(sub, "the sub-agent row must survive as its own row")
    assert.equal(sub.agent_id, "agent-7")
    assert.equal(sub.parent_tool_call_id, "call-99")

    const user = rows.find((r) => r.initiator === "user")
    assert.ok(user, "the user-initiated row must remain distinguishable")
    assert.equal(user.agent_id, null)

    for (const row of rows) {
      for (const forbidden of ["is_engineering", "substantive", "work_kind", "productivity"]) {
        assert.ok(
          !Object.hasOwn(row, forbidden),
          `the ledger must not characterise a row as ${forbidden}`,
        )
      }
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Identity of an observation belongs to the source; attribution to a work item
// and a machine is the caller's declaration. Keying identity on the declaration
// would let the same source row be imported twice under two labels and counted
// twice, so the two are separated.
test("source-observation identity is independent of the declared work item and machine", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const first = await intake(fixture, "First outcome.")
    const second = await intake(fixture, "Second outcome.")

    const one = body(await importUsage(fixture, first, { machine_id: MACHINE }))
    assert.equal(one.imported_events, 2)

    // Same source rows, different declared machine: not new observations.
    const relabelledMachine = body(await importUsage(fixture, first, { machine_id: "workstation-b" }))
    assert.equal(relabelledMachine.imported_events, 0)
    assert.equal(relabelledMachine.duplicates_skipped, 2)

    // Same source rows claimed by a second work item is a conflicting
    // allocation. It must be refused or represented explicitly — never added to
    // both items' consumption, which would double-count the same work.
    const claimedTwice = body(await importUsage(fixture, second, { machine_id: MACHINE }))
    assert.equal(claimedTwice.imported_events, 0)
    assert.equal(claimedTwice.conflicting_allocations.length, 2)
    assert.equal(claimedTwice.conflicting_allocations[0].held_by_work_item_id, first)
    assert.match(claimedTwice.status, /conflict/iu)

    const report = body(await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }))
    const secondItem = report.items.find((row) => row.work_item_id === second)
    assert.equal(secondItem.tokens.class, "unavailable")
    assert.equal(secondItem.tokens.value, null)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// A source row that changes after it was imported is a fact about the source,
// not a licence to overwrite what was recorded. The ledger notices and says so.
test("a changed source row under an already-imported identity is reported, not silently replaced", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const workItemId = await intake(fixture)
    assert.equal(body(await importUsage(fixture, workItemId)).imported_events, 2)

    const db = new Database(fixture.sourcePath)
    db.prepare("UPDATE assistant_usage_events SET input_tokens = ? WHERE id = ?").run(999999, 1)
    db.close()

    const again = body(await importUsage(fixture, workItemId))
    assert.equal(again.imported_events, 0)
    assert.equal(again.changed_since_import.length, 1)
    assert.equal(again.changed_since_import[0].source_event_id, 1)
    assert.match(again.changed_since_import[0].note, /changed/iu)

    const inspected = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "inspect", work_item_id: workItemId } }),
    )
    const row = inspected.usage.find((entry) => entry.source_event_id === 1)
    assert.equal(row.input_tokens, 1000, "the originally observed value must survive")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Numbers the source cannot mean must not become measured facts. A missing
// counter is not zero, an impossible counter is not data, and an id too large
// to represent exactly must not be rounded into a neighbour's identity.
test("the import refuses impossible numbers and keeps missing counters missing", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const records = baseRecords()
    records.events.push(
      { id: 3, session_id: SESSION_ID, input_tokens: -5, created_at: "2026-09-08T18:00:20.000Z" },
      { id: 4, session_id: SESSION_ID, input_tokens: null, output_tokens: 7, created_at: "2026-09-08T18:00:30.000Z" },
      { id: Number.MAX_SAFE_INTEGER + 2, session_id: SESSION_ID, created_at: "2026-09-08T18:00:40.000Z" },
      { id: 6, session_id: SESSION_ID, created_at: "not-a-timestamp" },
    )
    writeSessionRecords(fixture.sourcePath, records)
    const workItemId = await intake(fixture)

    const imported = body(await importUsage(fixture, workItemId))
    assert.equal(imported.malformed_skipped, 3, "negative, unsafe-id and invalid-time rows are not data")
    assert.deepEqual(
      imported.malformed_reasons.map((entry) => entry.reason).sort(),
      ["invalid_timestamp", "negative_counter", "unsafe_integer_id"],
    )

    const inspected = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "inspect", work_item_id: workItemId } }),
    )
    const partial = inspected.usage.find((row) => row.source_event_id === 4)
    assert.equal(partial.input_tokens, null, "a missing counter stays missing")
    assert.equal(partial.output_tokens, 7)

    // A partial row contributes what it has and declares what it lacks; the sum
    // must never quietly treat the missing counter as a zero.
    const report = body(await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }))
    const item = report.items.find((row) => row.work_item_id === workItemId)
    assert.equal(item.tokens.class, "measured")
    assert.equal(item.tokens.value.input, 1500)
    assert.equal(item.tokens.partial_fields.input.missing_rows, 1)
    assert.equal(item.tokens.partial_fields.input.covered_rows, 2)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
