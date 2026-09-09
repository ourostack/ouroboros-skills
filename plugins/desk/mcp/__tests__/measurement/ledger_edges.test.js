// Edge and refusal paths of the private work-measurement ledger.
//
// The frozen contract suites cover the capability a reader cares about. This
// file covers the paths that only appear when a caller gets something wrong, or
// when the shape of a real record is less tidy than a happy-path fixture: bad
// arguments, guarded transitions, partial native rows, and the interval union
// that keeps parallel work from being counted twice.

import { test, mock } from "node:test"
import { strict as assert } from "node:assert"
import Database from "better-sqlite3"
import { promises as fs } from "node:fs"
import * as path from "node:path"

import { callTool } from "../../src/server.js"
import { desk_work_ledger } from "../../src/tools/work-ledger.js"
import { resolveTaskRef, readCanonicalStatus } from "../../src/measurement/identity.js"
import {
  readSessionWorkspace,
  readSessionRows,
  localRecordsPath,
  normalizeRow,
  normalizeTimestamp,
} from "../../src/measurement/copilot-usage.js"
import { withLedger } from "../../src/measurement/store.js"
import { buildReport } from "../../src/measurement/report.js"
import {
  mkLedgerFixture,
  cleanup,
  useHostEnv,
  writeSessionRecords,
  writeSessionWorkspace,
  FIXTURE_SESSION_ID,
  baseSessionRecords,
} from "./_helpers.js"

function body(result) {
  const text = result.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    return { status: "unroutable", message: text }
  }
}

// Every call goes through the real MCP route, so a refusal is the envelope a
// caller actually receives rather than an exception this file caught itself.
function ledger(fixture, input) {
  return callTool({ deskRoot: fixture.deskRoot, name: "desk_work_ledger", input, person: "rowan" })
}

async function throws(fixture, input, pattern, message) {
  const refused = await ledger(fixture, input)
  assert.equal(refused.isError, true, message ?? `${input.action} must refuse`)
  assert.match(body(refused).message, pattern, message)
}

async function seed(fixture, request = "One assessable outcome.") {
  const intake = body(
    await ledger(fixture, { action: "intake", request, requested_by: "the operator" }),
  )
  return intake.work_item_id
}

const COMMITMENT = {
  outcome: "Restart-safe intake queue, verified by an operator-visible replay.",
  scope: "The queue module and its restart path only.",
  evidence: "Replay test output attached to the task card.",
  delivery_endpoint: "desks/rowan/delivery/intake-queue/task.md",
  operator_go: { by: "operator", at: "2026-09-08T18:00:00Z" },
}

async function withFixture(run) {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await run(fixture)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
}

test("the interval union never counts two overlapping phases twice", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const phases = [
      // Two overlapping intervals and one disjoint interval. Wall-clock spans
      // 09:00 to 11:00 and 12:00 to 12:30: 150 minutes of union against 190
      // minutes of summed duration.
      ["planning", "2026-09-08T09:00:00.000Z", "2026-09-08T10:30:00.000Z"],
      ["implementation", "2026-09-08T10:00:00.000Z", "2026-09-08T11:00:00.000Z"],
      ["review", "2026-09-08T12:00:00.000Z", "2026-09-08T12:30:00.000Z"],
    ]
    for (const [phase, started_at, ended_at] of phases) {
      await ledger(fixture, { action: "phase", work_item_id: workItemId, phase, started_at, ended_at })
    }

    const report = body(
      await ledger(fixture, { action: "report", include_phase_span: true }),
    )
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(item.active_span_ms.class, "inferred")
    assert.equal(item.active_span_ms.method, "interval_union")
    assert.equal(
      item.active_span_ms.value,
      150 * 60 * 1000,
      "overlapping phases contribute their union, not their sum",
    )
  })
})

test("an unended phase contributes nothing to the union rather than an open span", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, {
      action: "phase",
      work_item_id: workItemId,
      phase: "implementation",
      started_at: "2026-09-08T09:00:00.000Z",
    })
    const report = body(await ledger(fixture, { action: "report", include_phase_span: true }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    // It contributes nothing, and saying so honestly means reporting no span at
    // all rather than a zero that reads as "this took no time".
    assert.equal(item.active_span_ms.value, null)
    assert.equal(item.active_span_ms.class, "unavailable")
  })
})

test("a phase that ends before it starts is refused", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      {
        action: "phase",
        work_item_id: workItemId,
        phase: "implementation",
        started_at: "2026-09-08T11:00:00.000Z",
        ended_at: "2026-09-08T09:00:00.000Z",
      },
      /ends before it starts/iu,
    )
  })
})

test("inspect returns the links, scope changes and corrections a work item carries", async () => {
  await withFixture(async (fixture) => {
    const first = await seed(fixture, "The original outcome.")
    const second = await seed(fixture, "A genuinely separate outcome.")
    await ledger(fixture, {
      action: "link",
      work_item_id: first,
      related_work_item_id: second,
      relation: "follow_on",
    })
    await ledger(fixture, {
      action: "scope_change",
      work_item_id: first,
      change: "The delivery endpoint moved to the private report.",
      kind: "narrowed",
      reason: "The operator asked for one report, not a dashboard.",
    })
    await ledger(fixture, {
      action: "correct",
      work_item_id: first,
      field: "request",
      value: "The original outcome, said more precisely.",
      expected_revision: 1,
      reason: "The first sentence was ambiguous.",
    })

    const inspected = body(await ledger(fixture, { action: "inspect", work_item_id: first }))
    assert.equal(inspected.links.length, 1)
    assert.equal(inspected.links[0].related_work_item_id, second)
    assert.equal(inspected.links[0].relation, "follow_on")
    assert.equal(inspected.scope_changes.length, 1)
    assert.equal(inspected.scope_changes[0].kind, "narrowed")
    assert.match(inspected.scope_changes[0].change, /delivery endpoint/iu)
    assert.equal(inspected.corrections.length, 1)
    assert.equal(inspected.corrections[0].field, "request")
  })
})

test("correcting a field the work item has not recorded yet is refused", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      { action: "correct", work_item_id: workItemId, field: "outcome", value: "x", expected_revision: 1, reason: "y" },
      /has no outcome to correct yet/iu,
    )
  })
})

test("correct requires an explicit replacement value and refuses to clear one", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      { action: "correct", work_item_id: workItemId, field: "request", expected_revision: 1, reason: "y" },
      /requires the replacement value/iu,
    )
    await throws(
      fixture,
      {
        action: "correct",
        work_item_id: workItemId,
        field: "request",
        value: null,
        expected_revision: 1,
        reason: "Recorded against the wrong item.",
      },
      /cannot be cleared by a correction/iu,
      "clearing the defining sentence is a deletion, not a correction",
    )
    const inspected = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    assert.equal(inspected.work_item.request, "One assessable outcome.")
  })
})

test("commitment refuses an operator go that names no one and no time", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      {
        action: "commit",
        work_item_id: workItemId,
        outcome: "An assessable outcome.",
        scope: "One module.",
        evidence: "The replay output.",
        delivery_endpoint: "desks/rowan/delivery/intake-queue/task.md",
        operator_go: { by: "   ", at: "2026-09-08T09:00:00.000Z" },
      },
      /operator_go requires both/iu,
    )
  })
})

test("a second size record is refused rather than silently replacing the first", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const size = {
      action: "size",
      work_item_id: workItemId,
      work_type: "implementation",
      scope: "one module",
      systems: ["desk-mcp"],
      uncertainty: "unknown",
      risk: "low",
      verification: "unit tests plus an operator replay",
    }
    await ledger(fixture, size)
    await throws(fixture, size, /already has size features/iu)
  })
})

test("close refuses an unknown state and delete refuses without confirmation", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      { action: "close", work_item_id: workItemId, state: "finished", reason: "r" },
      /unknown close state/iu,
    )
    await throws(fixture, { action: "delete", work_item_id: workItemId }, /confirm:true/iu)
  })
})

test("set_recording refuses a non-boolean switch", async () => {
  await withFixture(async (fixture) => {
    await throws(fixture, { action: "set_recording", enabled: "off" }, /enabled:true or enabled:false/iu)
  })
})

test("an action that needs a work item refuses a blank identifier", async () => {
  await withFixture(async (fixture) => {
    await throws(fixture, { action: "inspect", work_item_id: "   " }, /requires work_item_id/iu)
  })
})

test("evidence must be a non-empty list and timestamps must parse", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      {
        action: "commit",
        work_item_id: workItemId,
        outcome: "An assessable outcome.",
        scope: "One module.",
        evidence: "   ",
        delivery_endpoint: "desks/rowan/delivery/intake-queue/task.md",
        operator_go: { by: "the operator", at: "2026-09-08T09:00:00.000Z" },
      },
      /evidence is required and must be a non-empty string/iu,
    )
    await throws(
      fixture,
      { action: "import_usage", work_item_id: workItemId, source: "copilot_local_session_records", session_id: FIXTURE_SESSION_ID, since: "yesterday" },
      /is not a timestamp/iu,
    )
  })
})

test("an import window keeps only the rows inside it", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, host_type: "cli" }],
      events: [
        { id: 1, session_id: FIXTURE_SESSION_ID, model: "m", created_at: "2026-09-08T08:00:00.000Z" },
        { id: 2, session_id: FIXTURE_SESSION_ID, model: "m", created_at: "2026-09-08T12:00:00.000Z" },
        { id: 3, session_id: FIXTURE_SESSION_ID, model: "m", created_at: "2026-09-08T20:00:00.000Z" },
      ],
    })
    const workItemId = await seed(fixture)
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        since: "2026-09-08T10:00:00.000Z",
        until: "2026-09-08T14:00:00.000Z",
      }),
    )
    assert.equal(imported.imported_events, 1)
    assert.equal(
      imported.observed_through,
      "2026-09-08T20:00:00.000Z",
      "the source cutoff is what the source holds, not what the window asked for",
    )
  })
})

test("a negative request multiplier is malformed, and its counters are not imported", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, host_type: "cli" }],
      events: [
        {
          id: 1,
          session_id: FIXTURE_SESSION_ID,
          model: "m",
          request_multiplier: -2,
          created_at: "2026-09-08T12:00:00.000Z",
        },
      ],
    })
    const workItemId = await seed(fixture)
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      }),
    )
    assert.equal(imported.imported_events, 0)
    assert.deepEqual(imported.malformed_reasons, [{ source_event_id: 1, reason: "negative_counter" }])
  })
})

test("normalizeRow refuses a non-finite multiplier the same way it refuses a negative one", () => {
  const malformed = normalizeRow({
    id: 4,
    session_id: "s",
    model: "m",
    request_multiplier: Number.POSITIVE_INFINITY,
    created_at: "2026-09-08T12:00:00.000Z",
  })
  assert.equal(malformed.malformed, "negative_counter")
})

test("an unreadable workspace mapping is unavailable rather than an import failure", async () => {
  await withFixture(async (fixture) => {
    // A directory where the mapping file belongs: present on disk, unreadable
    // as a file. The identity is unavailable and nothing throws.
    const dir = path.join(fixture.copilotHome, "session-state", FIXTURE_SESSION_ID, "workspace.yaml")
    await fs.mkdir(dir, { recursive: true })
    const workspace = readSessionWorkspace(FIXTURE_SESSION_ID, process.env)
    assert.deepEqual(workspace, { cloud_session_id: null, task_id: null })
  })
})

test("a workspace mapping written with a tilde reads as absent, not as a literal", async () => {
  await withFixture(async (fixture) => {
    await writeSessionWorkspace(fixture.copilotHome, FIXTURE_SESSION_ID, {
      mcSessionId: "~",
      mcTaskId: "task-1",
    })
    const workspace = readSessionWorkspace(FIXTURE_SESSION_ID, process.env)
    assert.equal(workspace.cloud_session_id, null)
    assert.equal(workspace.task_id, "task-1")
  })
})

test("a task reference must be an object naming only a track and a slug", async () => {
  await withFixture(async (fixture) => {
    await assert.rejects(
      () => resolveTaskRef({ deskRoot: fixture.deskRoot, person: null, taskRef: "delivery/intake" }),
      /must be an object with track and slug/iu,
    )
    await assert.rejects(
      () =>
        resolveTaskRef({
          deskRoot: fixture.deskRoot,
          person: null,
          taskRef: { track: "delivery", slug: "intake", iteration: 2 },
        }),
      /unknown task_ref field "iteration"/iu,
    )
    assert.equal(await resolveTaskRef({ deskRoot: fixture.deskRoot, person: null, taskRef: null }), null)
  })
})

test("a canonical task with no status, or none readable, reports itself unavailable", async () => {
  await withFixture(async (fixture) => {
    const missing = await readCanonicalStatus({
      deskRoot: fixture.deskRoot,
      taskRef: { track: "delivery", slug: "absent", path: "delivery/absent/task.md" },
    })
    assert.equal(missing.class, "unavailable")
    assert.equal(missing.reason, "canonical_task_unreadable")
    assert.equal(missing.mismatch, "unavailable")

    const dir = path.join(fixture.deskRoot, "delivery", "statusless")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "task.md"), "---\ntitle: No status here\n---\n\nBody.\n")
    const statusless = await readCanonicalStatus({
      deskRoot: fixture.deskRoot,
      taskRef: { track: "delivery", slug: "statusless", path: "delivery/statusless/task.md" },
    })
    assert.equal(statusless.class, "unavailable")
    assert.equal(statusless.reason, "canonical_task_has_no_status")
  })
})

test("a receipt reference is recorded as declared with every optional field it was given", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const recorded = body(
      await ledger(fixture, {
        action: "link_evaluation_receipt",
        work_item_id: workItemId,
        measurement_kind: "offline_evaluation",
        receipt_ref: "runs/run-set-1/run-9/case-3/receipt.json",
        receipt_sha256: "a".repeat(64),
        run_set_id: "run-set-1",
        run_id: "run-9",
        case_id: "case-3",
        status: "passed",
        grade: null,
        availability: "available",
      }),
    )
    assert.equal(recorded.receipt.class, "declared")
    assert.equal(recorded.receipt.receipt_sha256, "a".repeat(64))
    assert.equal(recorded.receipt.run_set_id, "run-set-1")
    assert.equal(recorded.receipt.run_id, "run-9")

    const inspected = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    assert.equal(inspected.evaluation_receipts.length, 1)
    assert.equal(inspected.evaluation_receipts[0].run_id, "run-9")
  })
})

test("a source event id that is not a plain integer survives inspection unchanged", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, host_type: "cli" }],
      events: [{ id: 7, session_id: FIXTURE_SESSION_ID, model: "m", created_at: "2026-09-08T12:00:00.000Z" }],
    })
    const workItemId = await seed(fixture)
    await ledger(fixture, {
      action: "import_usage",
      work_item_id: workItemId,
      source: "copilot_local_session_records",
      session_id: FIXTURE_SESSION_ID,
    })
    const inspected = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    assert.equal(inspected.usage[0].source_event_id, 7)
  })
})

test("size refuses an empty systems list", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      {
        action: "size",
        work_item_id: workItemId,
        work_type: "implementation",
        scope: "one module",
        systems: [],
        uncertainty: "unknown",
        risk: "low",
        verification: "unit tests",
      },
      /systems is required and must be a non-empty array/iu,
    )
  })
})

test("a call carrying no input at all is refused by name, not by exception", async () => {
  await withFixture(async (fixture) => {
    const refused = await callTool({
      deskRoot: fixture.deskRoot,
      name: "desk_work_ledger",
      input: undefined,
    })
    assert.equal(refused.isError, true)
    assert.match(body(refused).message, /unknown action null/iu)
  })
})

test("optional qualifiers are optional everywhere they are offered", async () => {
  await withFixture(async (fixture) => {
    const first = await seed(fixture, "The first outcome.")
    const second = await seed(fixture, "The second outcome.")

    const scoped = body(
      await ledger(fixture, {
        action: "scope_change",
        work_item_id: first,
        change: "The endpoint moved.",
      }),
    )
    assert.equal(scoped.scope_change.kind, null)

    const corrected = body(
      await ledger(fixture, {
        action: "correct",
        work_item_id: first,
        field: "request",
        value: "The first outcome, restated.",
        expected_revision: 1,
      }),
    )
    assert.equal(corrected.status, "corrected")

    const linked = body(
      await ledger(fixture, {
        action: "link_evaluation_receipt",
        work_item_id: first,
        measurement_kind: "offline_evaluation",
        receipt_ref: "runs/run-set-2/run-1/case-1/receipt.json",
      }),
    )
    assert.equal(linked.receipt.receipt_sha256, null)
    assert.equal(linked.receipt.run_set_id, null)
    assert.equal(linked.receipt.run_id, null)
    assert.equal(linked.receipt.case_id, null)
    assert.equal(linked.receipt.status, null)
    assert.equal(linked.receipt.availability, null)

    const closed = body(await ledger(fixture, { action: "close", work_item_id: second, state: "cancelled" }))
    assert.equal(closed.closure.reason, null)
  })
})

test("a native row that names no model, initiator or turn keeps those fields null", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, host_type: "cli" }],
      events: [
        {
          id: 1,
          session_id: FIXTURE_SESSION_ID,
          model: "model-a",
          initiator: null,
          turn_index: null,
          input_tokens: null,
          output_tokens: null,
          total_nano_aiu: null,
          created_at: "2026-09-08T12:00:00.000Z",
        },
      ],
    })
    const workItemId = await seed(fixture)
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      }),
    )
    assert.equal(imported.imported_events, 1)

    const report = body(await ledger(fixture, { action: "report" }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(item.tokens.value.input, 0, "a missing counter is not a zero it can add")
    assert.equal(item.tokens.partial_fields.input.missing_rows, 1)
    assert.equal(item.tokens.partial_fields.input.covered_rows, 0)
    assert.ok(
      item.by_initiator.value.some((row) => row.initiator === null),
      "a row whose initiator the source never named is reported as unnamed, not dropped",
    )
  })
})

test("a recording gap outside a work item's activity is not counted against it", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, host_type: "cli" }],
      events: [{ id: 1, session_id: FIXTURE_SESSION_ID, model: "m", created_at: "2026-09-08T12:00:00.000Z" }],
    })
    // The switch goes off and on again before this work item existed, so the
    // closed window cannot overlap anything the item did.
    await ledger(fixture, { action: "set_recording", enabled: false, reason: "Off the record." })
    await ledger(fixture, { action: "set_recording", enabled: true })
    // Recording timestamps carry whole seconds, so the item has to start in a
    // later second for "after the window closed" to mean anything.
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const workItemId = await seed(fixture)
    await ledger(fixture, {
      action: "import_usage",
      work_item_id: workItemId,
      source: "copilot_local_session_records",
      session_id: FIXTURE_SESSION_ID,
    })

    const report = body(await ledger(fixture, { action: "report" }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(item.coverage.recording_gaps_overlapping, 0)
    assert.equal(report.recording_gaps.length, 1, "the gap is still reported at the top level")
  })
})

test("the local record path falls back to the host default when no home is set", () => {
  const fallback = localRecordsPath({})
  assert.equal(path.basename(fallback), "session-store.db")
  assert.match(fallback, /\.copilot/u)
})

test("a session with no local record database is reported unknown, not opened", async () => {
  await withFixture(async (fixture) => {
    // The fixture home exists but holds no record database yet.
    await fs.rm(fixture.sourcePath, { force: true })
    assert.throws(
      () => readSessionRows({ sessionId: FIXTURE_SESSION_ID }),
      /not present|unreadable source is not an empty one/iu,
      "an absent source is refused, never reported as no usage",
    )
  })
})

test("a workspace mapping missing a key reads as absent", async () => {
  await withFixture(async (fixture) => {
    const dir = path.join(fixture.copilotHome, "session-state", FIXTURE_SESSION_ID)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "workspace.yaml"), "somethingElse: 1\n")
    const workspace = readSessionWorkspace(FIXTURE_SESSION_ID)
    assert.deepEqual(workspace, { cloud_session_id: null, task_id: null })
  })
})

test("a report built with only the fields it requires still names its scope", async () => {
  await withFixture(async (fixture) => {
    const report = await withLedger({ deskRoot: fixture.deskRoot, env: process.env }, (db) =>
      buildReport(db, {}),
    )
    assert.equal(report.scope.person, null)
    assert.deepEqual(report.items, [])
  })
})

test("a local record file that is not a database is refused, not read as empty", async () => {
  await withFixture(async (fixture) => {
    await fs.writeFile(fixture.sourcePath, "this is not a sqlite database\n")
    const workItemId = await seed(fixture)
    await throws(
      fixture,
      {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      },
      /could not be read/iu,
    )
  })
})

test("the source seams read the ambient host environment when none is passed", async () => {
  await withFixture(async (fixture) => {
    assert.equal(localRecordsPath(), fixture.sourcePath)
    // No COPILOT_HOME in the supplied environment: the session-state directory
    // falls back to the host default rather than failing.
    assert.deepEqual(readSessionWorkspace(FIXTURE_SESSION_ID, {}), {
      cloud_session_id: null,
      task_id: null,
    })
  })
})

test("the tool called with nothing but a desk root refuses by name", async () => {
  await withFixture(async (fixture) => {
    // Called directly rather than through the MCP route, the refusal is the
    // exception the boundary turns into an error envelope.
    await assert.rejects(
      () => desk_work_ledger({ deskRoot: fixture.deskRoot }),
      /unknown action null/iu,
    )
  })
})

// A non-scalar in an optional free-text field used to reach the driver, where
// an object became "Too few parameter values were provided", an array was
// echoed back to the caller while the column could not hold it, and a number
// drifted into a text column. A seam another owner binds to has to refuse these
// by name instead.
test("optional free-text fields refuse a non-scalar by name", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const receipt = (grade) => ({
      action: "link_evaluation_receipt",
      work_item_id: workItemId,
      measurement_kind: "offline_evaluation",
      receipt_ref: "sha256:abc",
      grade,
    })
    for (const grade of [{ status: "pass", report: "/x" }, ["pass"], 7, true]) {
      const refused = await ledger(fixture, receipt(grade))
      assert.equal(refused.isError, true, `${JSON.stringify(grade)} must be refused`)
      const text = refused.content[0].text
      assert.match(text, /grade/u)
      assert.match(text, /string/iu)
      assert.doesNotMatch(
        text,
        /SQLite3|parameter values/iu,
        "the refusal names the field, never the driver",
      )
    }
  })
})

test("a scalar grade is admitted and survives the JSON boundary", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const linked = body(
      await ledger(fixture, {
        action: "link_evaluation_receipt",
        work_item_id: workItemId,
        measurement_kind: "offline_evaluation",
        receipt_ref: "sha256:abc",
        status: "complete",
        grade: "investigate",
        availability: "available",
      }),
    )
    assert.equal(linked.receipt.grade, "investigate")
    assert.equal(linked.receipt.class, "declared")
    // What the evaluation owner reads back over the wire is what was recorded.
    const roundTripped = JSON.parse(JSON.stringify(linked))
    assert.equal(roundTripped.receipt.grade, "investigate")
    assert.equal(roundTripped.receipt.availability, "available")
    assert.equal(roundTripped.receipt.status, "complete")
  })
})

test("the same refusal covers optional text on the other capture routes", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const cases = [
      [{ action: "scope_change", work_item_id: workItemId, change: "wider", reason: { why: 1 } }, /reason/u],
      [{ action: "phase", work_item_id: workItemId, phase: "review", cycle: ["a"] }, /cycle/u],
    ]
    for (const [input, field] of cases) {
      const refused = await ledger(fixture, input)
      assert.equal(refused.isError, true, `${input.action} must refuse a non-scalar`)
      assert.match(refused.content[0].text, field)
      assert.doesNotMatch(refused.content[0].text, /SQLite3|parameter values/iu)
    }
  })
})

// The ledger can time its own recording, not an unobserved physical delivery.
test("a completed lead time names the recording endpoint it actually observed", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
    await ledger(fixture, {
      action: "complete",
      work_item_id: workItemId,
      endpoint: COMMITMENT.delivery_endpoint,
      evidence: "Replay output captured on the task card.",
    })
    const report = body(await ledger(fixture, { action: "report" }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(item.lead_time_ms.to, "terminal_claim_recording")
    assert.equal(item.lead_time_ms.censored, false)
    assert.equal(item.lead_time_ms.disposition, "completed")
  })
})

// A cancelled item terminated; reporting it as still running would be a lie in
// the other direction, and calling it delivered would be a worse one.
test("a closed item terminates its lead time and keeps its disposition", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
    await ledger(fixture, {
      action: "close",
      work_item_id: workItemId,
      state: "cancelled",
      reason: "the outcome stopped being wanted",
    })
    const report = body(await ledger(fixture, { action: "report" }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)
    assert.equal(item.lead_time_ms.censored, false, "a closed item is not still running")
    assert.equal(item.lead_time_ms.to, "terminal_claim_recording")
    assert.equal(item.lead_time_ms.disposition, "cancelled")
    assert.equal(
      item.lead_time_ms.delivered,
      false,
      "a cancelled item is never counted as verified successful delivery",
    )
  })
})

// Every classed field on the report is an object carrying its class and its
// reason. A bare string could not say why completeness is unknown, and the
// report's own coverage is exactly where that reason matters.
test("report coverage completeness is a classed object, not a bare string", async () => {
  await withFixture(async (fixture) => {
    await seed(fixture)
    const report = body(await ledger(fixture, { action: "report" }))
    assert.equal(typeof report.coverage.complete, "object")
    assert.equal(report.coverage.complete.class, "unavailable")
    assert.equal(report.coverage.complete.value, null)
    assert.match(report.coverage.complete.reason, /complete/iu)
    // It survives the wire, like every other field a caller reads.
    assert.equal(
      JSON.parse(JSON.stringify(report)).coverage.complete.class,
      "unavailable",
    )
  })
})

// A raw agent_id column is not a subagent breakdown. The projection has to say
// which agent ran, in which role, and how many rows it could not attribute.
test("usage projects by phase and by source agent, with its limits stated", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    writeSessionRecords(fixture.sourcePath, {
      sessions: [{ id: FIXTURE_SESSION_ID, cwd: "/work/repo", repository: "repo", host_type: "cli" }],
      events: [
        // Two rows inside the planning window, one root and one subagent; one
        // row outside every declared window; one row with no agent identity.
        { id: 1, session_id: FIXTURE_SESSION_ID, model: "m1", agent_id: "root-1", input_tokens: 10, output_tokens: 1, created_at: "2026-09-08T09:10:00.000Z" },
        { id: 2, session_id: FIXTURE_SESSION_ID, model: "m1", agent_id: "sub-1", parent_tool_call_id: "call-9", input_tokens: 20, output_tokens: 2, created_at: "2026-09-08T09:20:00.000Z" },
        { id: 3, session_id: FIXTURE_SESSION_ID, model: "m1", agent_id: "root-1", input_tokens: 30, output_tokens: 3, created_at: "2026-09-08T23:00:00.000Z" },
        { id: 4, session_id: FIXTURE_SESSION_ID, model: "m1", agent_id: null, input_tokens: 40, output_tokens: 4, created_at: "2026-09-08T09:30:00.000Z" },
      ],
    })
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
      }),
    )
    assert.equal(imported.status, "usage_imported", "setup must actually import")
    assert.equal(imported.imported_events, 4)

    const phase = await ledger(fixture, {
      action: "phase",
      work_item_id: workItemId,
      phase: "planning",
      cycle: "c1",
      started_at: "2026-09-08T09:00:00.000Z",
      ended_at: "2026-09-08T10:00:00.000Z",
    })
    assert.equal(phase.isError, undefined, "setup phase must be accepted")

    const report = body(await ledger(fixture, { action: "report", include_phase_span: true }))
    const item = report.items.find((entry) => entry.work_item_id === workItemId)

    // Declared: an operator's window laid over rows the source timestamped.
    assert.equal(item.by_phase.class, "declared")
    const planning = item.by_phase.value.find((entry) => entry.phase === "planning")
    assert.equal(planning.observed_events, 3)
    assert.equal(planning.input_tokens, 70)
    assert.equal(item.by_phase.unattributed.observed_events, 1)
    assert.match(item.by_phase.unattributed.reason, /window|declared/iu)

    // Measured: identity the source itself recorded.
    assert.equal(item.by_agent.class, "measured")
    const root = item.by_agent.value.find((entry) => entry.agent_id === "root-1")
    assert.equal(root.observed_events, 2)
    assert.equal(root.role, "root")
    const sub = item.by_agent.value.find((entry) => entry.agent_id === "sub-1")
    assert.equal(sub.observed_events, 1)
    assert.equal(sub.role, "subagent")
    // The row with no agent identity is counted, never invented into a bucket.
    assert.equal(item.by_agent.missing_agent_id.observed_events, 1)
    assert.equal(
      item.by_agent.value.some((entry) => entry.agent_id === null),
      false,
    )
  })
})

// Asking for the phase span of an item that declared no phases must not answer
// "0 ms". Zero is a measurement; absence is not.
test("a phase span with nothing declared to infer from stays unavailable", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "An outcome with no phases declared.")

    const withoutPhases = body(
      await ledger(fixture, { action: "report", work_item_id: workItemId, include_phase_span: true }),
    ).items[0]
    assert.equal(withoutPhases.active_span_ms.class, "unavailable")
    assert.equal(withoutPhases.active_span_ms.value, null)
    assert.equal(withoutPhases.active_span_ms.reason, "no_declared_phase_intervals")

    // A phase that names only a start is not an interval either: a union needs
    // both ends, and half of one cannot be silently completed with "now".
    const openEnded = body(
      await ledger(fixture, {
        action: "phase",
        work_item_id: workItemId,
        phase: "doing",
        started_at: "2026-09-08T18:00:00.000Z",
      }),
    )
    assert.equal(openEnded.status, "phase_recorded", openEnded.message ?? "")

    const stillOpen = body(
      await ledger(fixture, { action: "report", work_item_id: workItemId, include_phase_span: true }),
    ).items[0]
    assert.equal(stillOpen.active_span_ms.class, "unavailable")
    assert.equal(stillOpen.active_span_ms.reason, "no_declared_phase_intervals")
  })
})

// A deleted item and an item that never existed here are different facts. The
// tombstone already records that coverage shrank, so the lookup can say so
// without recovering any of the deleted payload — and must stay distinguishable
// from the absence a caller sees for another partition's work.
test("a deleted work item reads as deleted, not as one that never existed", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "An outcome that will be deleted.")
    const deleted = body(await ledger(fixture, { action: "delete", work_item_id: workItemId, confirm: true }))
    assert.equal(deleted.status, "deleted")

    const afterwards = await ledger(fixture, { action: "inspect", work_item_id: workItemId })
    assert.equal(afterwards.isError, true)
    const message = body(afterwards).message
    assert.match(message, /no work item/iu)
    assert.match(message, /not found|unknown work item/iu)
    assert.match(message, /deleted/iu)
    assert.doesNotMatch(message, /permission|forbidden|not authori[sz]ed/iu)
    // Content-free: the tombstone knows an identifier and a time, and the
    // message must not carry a field of the record it replaced.
    assert.doesNotMatch(message, /An outcome that will be deleted/u)

    const neverExisted = await ledger(fixture, {
      action: "inspect",
      work_item_id: "8a5e4d3c-2b1a-4f9e-8d7c-6b5a4f3e2d1c",
    })
    assert.equal(neverExisted.isError, true)
    assert.match(body(neverExisted).message, /no work item/iu)
    assert.doesNotMatch(body(neverExisted).message, /deleted/iu)
  })
})

// The conflict status is pinned by an exact token, not a substring a differently
// worded label would also satisfy.
test("an allocation conflict reports its exact status token", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const first = await seed(fixture, "The first claim on these rows.")
    const second = await seed(fixture, "A second claim on the same rows.")
    const importInput = (workItemId) => ({
      action: "import_usage",
      work_item_id: workItemId,
      source: "copilot_local_session_records",
      session_id: FIXTURE_SESSION_ID,
      machine_id: "workstation-a",
    })
    const one = body(await ledger(fixture, importInput(first)))
    assert.equal(one.status, "usage_imported")
    const two = body(await ledger(fixture, importInput(second)))
    assert.equal(two.status, "usage_import_conflict")
    assert.equal(two.imported_events, 0)
  })
})

// The declared amount is the only figure. Rate metadata qualifies it; it does
// not authorise the report to calculate a number the operator never asserted.
test("the declared amount governs and the recorded rate is never applied to usage", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const workItemId = await seed(fixture, "An outcome with a declared cost.")
    body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    body(
      await ledger(fixture, {
        action: "cost_basis",
        work_item_id: workItemId,
        amount: 12.5,
        currency: "USD",
        rate: 4,
        rate_unit: "request_multiplier",
        source: "an internal rate card",
        effective_date: "2026-09-01",
      }),
    )

    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    assert.equal(item.financial_cost.class, "declared")
    assert.equal(item.financial_cost.value, 12.5, "the declared amount is the reported figure")
    assert.equal(item.financial_cost.currency, "USD")
    assert.equal(item.financial_cost.basis.rate, 4, "the rate is carried as qualification")
    assert.equal(item.financial_cost.basis.rate_unit, "request_multiplier")

    const multiplierSum = item.usage_multiplier_sum.value
    assert.ok(multiplierSum > 0, "the fixture must actually carry multiplier units")
    assert.notEqual(
      item.financial_cost.value,
      multiplierSum * 4,
      "rate x usage is a calculation this ledger does not perform",
    )
    assert.equal(item.usage_multiplier_sum.class, "measured")
    assert.equal(item.usage_multiplier_sum.currency, undefined, "a multiplier unit is not money")
  })
})

// One agent identifier can appear both as a sub-agent turn and as a root turn.
// Neither role is the whole truth about it, and picking whichever arrived first
// would make the answer depend on row order, so it reports as mixed.
test("an agent seen in both roles is reported as mixed, whichever role arrived first", async () => {
  for (const order of ["subagent_first", "root_first"]) {
    await withFixture(async (fixture) => {
      const base = baseSessionRecords()
      const asSubagent = { ...base.events[1], id: 10, agent_id: "agent-both", parent_tool_call_id: "call-1" }
      const asRoot = { ...base.events[0], id: 11, agent_id: "agent-both", parent_tool_call_id: null }
      const events =
        order === "subagent_first"
          ? [
              { ...asSubagent, created_at: "2026-09-08T18:00:00.000Z" },
              { ...asRoot, created_at: "2026-09-08T18:00:10.000Z" },
            ]
          : [
              { ...asRoot, created_at: "2026-09-08T18:00:00.000Z" },
              { ...asSubagent, created_at: "2026-09-08T18:00:10.000Z" },
            ]
      writeSessionRecords(fixture.sourcePath, { sessions: base.sessions, events })

      const workItemId = await seed(fixture, `An outcome observed ${order}.`)
      body(
        await ledger(fixture, {
          action: "import_usage",
          work_item_id: workItemId,
          source: "copilot_local_session_records",
          session_id: FIXTURE_SESSION_ID,
          machine_id: "workstation-a",
        }),
      )

      const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
      const agent = item.by_agent.value.find((entry) => entry.agent_id === "agent-both")
      assert.ok(agent, `agent-both must be reported for ${order}`)
      assert.equal(agent.role, "mixed", `${order} must still read as mixed`)
      assert.equal(agent.observed_events, 2)
    })
  }
})

// A correction has to name the revision the caller read. Skipping the field is
// not "no opinion about concurrency" — it is overwriting whatever is there now.
test("correct refuses without an integer expected_revision", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "An outcome to correct.")
    for (const expected of [undefined, "1", 1.5, null, Number.NaN]) {
      const input = { action: "correct", work_item_id: workItemId, field: "request", value: "Restated." }
      if (expected !== undefined) input.expected_revision = expected
      const refused = await ledger(fixture, input)
      assert.equal(refused.isError, true, `expected_revision ${String(expected)} must be refused`)
      assert.match(body(refused).message, /requires expected_revision/iu)
    }

    const accepted = body(
      await ledger(fixture, {
        action: "correct",
        work_item_id: workItemId,
        field: "request",
        value: "Restated.",
        expected_revision: 1,
      }),
    )
    assert.equal(accepted.status, "corrected")
  })
})

// `state` is an optional declared label on a phase — "started", "blocked",
// whatever the operator calls it. It is stored as given and never interpreted;
// the interval is what the report reads.
test("a phase records its optional declared state without interpreting it", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "An outcome with a labelled phase.")
    const labelled = body(
      await ledger(fixture, {
        action: "phase",
        work_item_id: workItemId,
        phase: "implementation",
        cycle: "cycle-2",
        state: "blocked",
        started_at: "2026-09-08T18:00:00.000Z",
        ended_at: "2026-09-08T18:00:30.000Z",
      }),
    )
    assert.equal(labelled.status, "phase_recorded")
    assert.equal(labelled.phase.cycle, "cycle-2")

    const seen = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    const stored = seen.phases.find((entry) => entry.phase === "implementation")
    assert.ok(stored, "the phase must be readable back")
    assert.equal(stored.state, "blocked", "the declared label is stored as given")

    // And it does not become an interval: the span still comes from the times.
    const item = body(
      await ledger(fixture, { action: "report", work_item_id: workItemId, include_phase_span: true }),
    ).items[0]
    assert.equal(item.active_span_ms.value, 30000)
  })
})

// The breakdowns added for phase and agent are named-row arrays like by_model,
// and they cross the MCP boundary as JSON. An internal green proves nothing if
// the shape loses its named properties in transit, so the regression covers
// them the same way the parent's named fields are covered.
test("by_phase and by_agent survive JSON transit with their named rows intact", async () => {
  await withFixture(async (fixture) => {
    writeSessionRecords(fixture.sourcePath, baseSessionRecords())
    const workItemId = await seed(fixture, "An outcome with phases and agents.")
    body(
      await ledger(fixture, {
        action: "phase",
        work_item_id: workItemId,
        phase: "implementation",
        cycle: "cycle-1",
        started_at: "2026-09-08T17:59:00.000Z",
        ended_at: "2026-09-08T18:00:05.000Z",
      }),
    )
    body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )

    const report = body(await ledger(fixture, { action: "report", work_item_id: workItemId }))
    const item = report.items[0]

    for (const [label, breakdown, key] of [
      ["by_phase", item.by_phase, "phase"],
      ["by_agent", item.by_agent, "agent_id"],
    ]) {
      assert.ok(Array.isArray(breakdown.value), `${label}.value must be an array of rows`)
      assert.ok(breakdown.value.length > 0, `${label} must not be empty in this fixture`)
      for (const row of breakdown.value) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(row, key),
          `${label} rows must carry ${key} as their own property`,
        )
        assert.equal(typeof row.observed_events, "number")
      }
    }

    assert.equal(item.by_phase.class, "declared", "a phase window is an operator declaration")
    assert.equal(item.by_agent.class, "measured", "agent identity is what the source recorded")
    assert.equal(typeof item.by_phase.ambiguous.observed_events, "number")
    assert.equal(typeof item.by_phase.unattributed.observed_events, "number")
    assert.equal(typeof item.by_agent.missing_agent_id.observed_events, "number")
    assert.match(item.by_agent.missing_agent_id.reason, /did not record an agent identity/iu)

    // The named remainders are objects, not properties hung off an array, so
    // re-serializing what the caller received is a fixed point.
    assert.equal(Array.isArray(item.by_phase), false)
    assert.equal(Array.isArray(item.by_agent), false)
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report)
  })
})

// Counters that name a count of things must be whole and exactly representable.
// `isFinite` and `>= 0` admit 1.5 tokens and 2^60 tokens, neither of which the
// source can have meant, and storing them puts the word "measured" on a number
// the source did not report.
test("a counter that is fractional or too large to represent exactly is malformed", async () => {
  await withFixture(async (fixture) => {
    const base = baseSessionRecords()
    const events = [
      { ...base.events[0], id: 1, input_tokens: 1.5 },
      { ...base.events[0], id: 2, created_at: "2026-09-08T18:00:01.000Z", output_tokens: 2 ** 60 },
      { ...base.events[0], id: 3, created_at: "2026-09-08T18:00:02.000Z", duration_ms: Number.MAX_SAFE_INTEGER + 2 },
      { ...base.events[0], id: 4, created_at: "2026-09-08T18:00:03.000Z" },
    ]
    writeSessionRecords(fixture.sourcePath, { sessions: base.sessions, events })

    const workItemId = await seed(fixture, "An outcome with malformed counters.")
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    assert.equal(imported.imported_events, 1, "only the well-formed row is an observation")
    assert.equal(imported.malformed_skipped, 3)
    const reasons = imported.malformed_reasons.map((entry) => entry.reason)
    assert.ok(
      reasons.every((reason) => reason === "unrepresentable_counter"),
      `every refusal must name the counter problem, got ${JSON.stringify(reasons)}`,
    )
  })
})

// A multiplier is legitimately fractional — 0.5 of a request is a real value —
// so it keeps the finite check, but it still cannot be a magnitude arithmetic
// cannot carry.
test("a fractional request multiplier is kept and an unrepresentable one is not", async () => {
  await withFixture(async (fixture) => {
    const base = baseSessionRecords()
    const events = [
      { ...base.events[0], id: 1, request_multiplier: 0.25 },
      // Finite, positive, and still past the range arithmetic can carry — this
      // is the case the earlier non-finite guard does not catch.
      { ...base.events[0], id: 2, created_at: "2026-09-08T18:00:01.000Z", request_multiplier: 2 ** 60 },
      // Non-finite is a different fault and keeps its own distinct reason.
      { ...base.events[0], id: 3, created_at: "2026-09-08T18:00:02.000Z", request_multiplier: 1e309 },
      { ...base.events[0], id: 4, created_at: "2026-09-08T18:00:03.000Z", request_multiplier: -1 },
    ]
    writeSessionRecords(fixture.sourcePath, { sessions: base.sessions, events })

    const workItemId = await seed(fixture, "An outcome with multipliers.")
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    assert.equal(imported.imported_events, 1, "the fractional multiplier is a real value")
    assert.equal(imported.malformed_skipped, 3)
    const byId = new Map(imported.malformed_reasons.map((entry) => [String(entry.source_event_id), entry.reason]))
    assert.equal(byId.get("2"), "unrepresentable_counter", "a finite but uncarryable magnitude is its own fault")
    assert.equal(byId.get("3"), "negative_counter", "a non-finite value keeps the existing reason")
    assert.equal(byId.get("4"), "negative_counter")

    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    assert.equal(item.usage_multiplier_sum.value, 0.25)
  })
})

// Every counter can be a safe integer and their sum still not be one. A total
// past the exactly-representable range is silently wrong by one or more, and
// "measured" must never sit on a number arithmetic has already damaged.
test("a total that leaves the exactly representable range is unavailable, not wrong", async () => {
  await withFixture(async (fixture) => {
    const base = baseSessionRecords()
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2)
    const events = [
      { ...base.events[0], id: 1, input_tokens: half, duration_ms: half, total_nano_aiu: half },
      {
        ...base.events[0],
        id: 2,
        created_at: "2026-09-08T18:00:01.000Z",
        input_tokens: half,
        duration_ms: half,
        total_nano_aiu: half,
      },
      {
        ...base.events[0],
        id: 3,
        created_at: "2026-09-08T18:00:02.000Z",
        input_tokens: half,
        duration_ms: half,
        total_nano_aiu: half,
      },
    ]
    writeSessionRecords(fixture.sourcePath, { sessions: base.sessions, events })

    const workItemId = await seed(fixture, "An outcome whose totals overflow.")
    const imported = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    assert.equal(imported.imported_events, 3, "each row on its own is representable")

    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    for (const [label, field] of [
      ["model_time_ms", item.model_time_ms],
      ["nano_aiu_sum", item.nano_aiu_sum],
    ]) {
      assert.equal(field.class, "unavailable", `${label} must not claim a damaged total`)
      assert.equal(field.value, null)
      assert.match(field.reason, /exact/iu)
    }
    assert.equal(item.tokens.class, "unavailable", "a damaged token total is not measured")
    assert.equal(item.tokens.value, null)
    assert.match(item.tokens.reason, /exact/iu)
  })
})

// ---------------------------------------------------------------------------
// Second implementation review: report / import / identity.
//
// Every case below was executed against the frozen bytes by the reviewer before
// it was written here, so each one names a defect that was observed rather than
// a shape that was imagined.
// ---------------------------------------------------------------------------

// A role is a claim about everything the source recorded for one agent, so it
// cannot depend on which row happened to arrive last. Two-row orders were
// already covered; the defect only appears from the third row on, where a
// bucket that already reads "mixed" is reassigned by the next row it sees.
test("an agent seen in both roles stays mixed for every arrival order", async () => {
  await withFixture(async (fixture) => {
    const base = baseSessionRecords()
    const mixedOrders = []
    for (const length of [3, 4]) {
      for (let mask = 0; mask < 2 ** length; mask += 1) {
        const roles = Array.from({ length }, (_, bit) => (((mask >> bit) & 1) === 1 ? "root" : "subagent"))
        if (roles.includes("root") && roles.includes("subagent")) mixedOrders.push(roles)
      }
    }
    assert.equal(mixedOrders.length, 20, "every mixed order of three and four rows is exercised")
    // Pure runs are carried alongside so a fix cannot pass by answering "mixed"
    // to everything.
    const pureOrders = [["root", "root", "root"], ["subagent", "subagent", "subagent"]]
    const cases = [...mixedOrders, ...pureOrders].map((roles, index) => ({
      agentId: `agent-${index}-${roles.join("-")}`,
      roles,
      expected: roles.includes("root") && roles.includes("subagent") ? "mixed" : roles[0],
    }))

    const events = []
    let id = 100
    let clock = Date.parse("2026-09-08T18:00:00.000Z")
    for (const { agentId, roles } of cases) {
      for (const role of roles) {
        events.push({
          ...base.events[0],
          id: (id += 1),
          agent_id: agentId,
          parent_tool_call_id: role === "subagent" ? "call-1" : null,
          created_at: new Date((clock += 1000)).toISOString(),
        })
      }
    }
    writeSessionRecords(fixture.sourcePath, { sessions: base.sessions, events })

    const workItemId = await seed(fixture)
    body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    for (const { agentId, roles, expected } of cases) {
      const agent = item.by_agent.value.find((entry) => entry.agent_id === agentId)
      assert.ok(agent, `${agentId} must be reported`)
      assert.equal(agent.role, expected, `${roles.join(",")} must read as ${expected}`)
      assert.equal(agent.observed_events, roles.length, `${agentId} must count every row it carries`)
    }
  })
})

// SQLite's own datetime()/CURRENT_TIMESTAMP output carries no offset and is
// documented UTC. Date.parse reads that form as host-local, which displaces
// every observation by the host's offset while still calling it measured.
test("the documented offset-less source form is read as UTC, not as host-local time", () => {
  assert.equal(normalizeTimestamp("2026-09-08 18:00:00"), "2026-09-08T18:00:00.000Z")
  assert.equal(normalizeTimestamp("2026-09-08 18:00:00.250"), "2026-09-08T18:00:00.250Z")
})

test("only an unambiguous source instant is accepted", () => {
  for (const [value, expected] of [
    ["2026-09-08T18:00:00Z", "2026-09-08T18:00:00.000Z"],
    ["2026-09-08T18:00:00.000Z", "2026-09-08T18:00:00.000Z"],
    ["2026-09-08T18:00:00+02:00", "2026-09-08T16:00:00.000Z"],
    ["2026-09-08T11:00:00-07:00", "2026-09-08T18:00:00.000Z"],
  ]) {
    assert.equal(normalizeTimestamp(value), expected, `${value} carries its own offset`)
  }
  for (const value of [
    "2026", // a year is not an instant, and Date.parse turns it into one
    "2026-09",
    "2026-09-08", // a day is not an instant either
    "2026-09-08T18:00:00", // no offset, and not the documented UTC form
    "2026-13-45 00:00:00", // shaped like the UTC form, not a real instant
    "2026-09-08 25:00:00",
    "2026-09-08 18:00",
    "not-a-time",
    "",
  ]) {
    assert.equal(normalizeTimestamp(value), null, `${JSON.stringify(value)} must be refused`)
  }
})

test("a row carrying only a date is refused as malformed rather than imported as midnight", async () => {
  await withFixture(async (fixture) => {
    const base = baseSessionRecords()
    writeSessionRecords(fixture.sourcePath, {
      sessions: base.sessions,
      events: [{ ...base.events[0], id: 501, created_at: "2026-09-08" }],
    })
    const workItemId = await seed(fixture)
    const result = body(
      await ledger(fixture, {
        action: "import_usage",
        work_item_id: workItemId,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      }),
    )
    assert.equal(result.imported_events, 0)
    assert.equal(result.malformed_skipped, 1)
    assert.equal(result.malformed_reasons[0].reason, "invalid_timestamp")
  })
})

// The header probe only proves the file is a database. The realistic first
// failure against a real host is a database whose schema is not this one, and
// that error was reaching the caller in the driver's vocabulary.
test("a source database with the wrong schema is refused in the ledger's own words", async () => {
  await withFixture(async (fixture) => {
    const other = new Database(fixture.sourcePath)
    other.prepare("CREATE TABLE something_else (id INTEGER PRIMARY KEY)").run()
    other.close()
    assert.throws(
      () => readSessionRows({ sessionId: FIXTURE_SESSION_ID, env: process.env }),
      (error) => {
        assert.match(error.message, /^desk_work_ledger: /u, "the refusal must be the ledger's, not the driver's")
        assert.match(error.message, /could not be read/u)
        assert.match(error.message, /no such table/u, "the underlying cause is still carried")
        return true
      },
    )
  })
})

// A counter counts things and must be exact. A duration and a multiplier are
// genuinely fractional, and holding them to whole numbers refuses real data.
test("fractional durations and multipliers are data; fractional counts are not", () => {
  const base = baseSessionRecords().events[0]
  for (const field of ["duration_ms", "request_multiplier"]) {
    const row = { ...base, id: 601, [field]: 1234.5 }
    assert.equal(normalizeRow(row).malformed, undefined, `${field} may be fractional`)
  }
  for (const field of ["input_tokens", "output_tokens", "total_nano_aiu", "reasoning_tokens"]) {
    const fractional = normalizeRow({ ...base, id: 602, [field]: 12.5 })
    assert.equal(fractional.malformed, "unrepresentable_counter", `${field} must be whole`)
    const unsafe = normalizeRow({ ...base, id: 603, [field]: 2 ** 60 })
    assert.equal(unsafe.malformed, "unrepresentable_counter", `${field} must be exactly representable`)
  }
  // A fractional field still cannot be a magnitude arithmetic will not carry.
  for (const field of ["duration_ms", "request_multiplier"]) {
    const huge = normalizeRow({ ...base, id: 604, [field]: 2 ** 60 })
    assert.equal(huge.malformed, "unrepresentable_counter", `${field} must stay in range`)
  }
})

// Rounding an operator's stated figure means the report no longer says what
// they declared, and the currency total stops equalling the sum of its parts.
test("a declared amount survives into the currency total at its own precision", async () => {
  await withFixture(async (fixture) => {
    const declared = [
      ["0.0000004", 0.0000004],
      ["1.0000005", 1.0000005],
    ]
    const ids = []
    for (const [label, amount] of declared) {
      const workItemId = await seed(fixture, `An outcome priced at ${label}.`)
      body(
        await ledger(fixture, {
          action: "cost_basis",
          work_item_id: workItemId,
          amount,
          currency: "USD",
          rate: 1,
          rate_unit: "per_request",
          source: "an internal rate sheet",
          effective_date: "2026-09-01",
        }),
      )
      ids.push([workItemId, amount])
    }
    const report = body(await ledger(fixture, { action: "report" }))
    for (const [workItemId, amount] of ids) {
      const item = report.items.find((entry) => entry.work_item_id === workItemId)
      assert.equal(item.financial_cost.value, amount, "the item must report exactly what was declared")
    }
    const usd = report.totals.financial_cost.by_currency.find((entry) => entry.currency === "USD")
    assert.equal(usd.value, 0.0000004 + 1.0000005, "the total must be the sum of the declared amounts")
    assert.equal(usd.items, 2)
  })
})

test("a currency total reads cleanly without truncating below what was declared", async () => {
  await withFixture(async (fixture) => {
    for (const amount of [4.2, 0.1]) {
      const workItemId = await seed(fixture, `An outcome priced at ${amount}.`)
      body(
        await ledger(fixture, {
          action: "cost_basis",
          work_item_id: workItemId,
          amount,
          currency: "EUR",
          rate: 1,
          rate_unit: "per_request",
          source: "an internal rate sheet",
          effective_date: "2026-09-01",
        }),
      )
    }
    const report = body(await ledger(fixture, { action: "report" }))
    const eur = report.totals.financial_cost.by_currency.find((entry) => entry.currency === "EUR")
    assert.equal(eur.value, 4.3, "float noise is presentation, not a licence to drop declared digits")
  })
})

// Lead time already treats a closure as terminal. Coverage read the completion
// row only, so one report carried two different lifetimes for the same item.
test("a cancelled item stops accruing recording gaps at the same endpoint lead time uses", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    body(await ledger(fixture, { action: "close", work_item_id: workItemId, state: "cancelled", reason: "Withdrawn." }))
    for (const enabled of [false, true]) {
      body(await ledger(fixture, { action: "set_recording", enabled, reason: "A window." }))
    }
    body(await ledger(fixture, { action: "set_recording", enabled: false, reason: "A second window." }))
    body(await ledger(fixture, { action: "set_recording", enabled: true, reason: "Back on." }))

    // Wall clock inside one test cannot separate these events, so the fixture
    // states the timeline it means: one gap while the item was alive, one after
    // it was cancelled.
    await withLedger({ deskRoot: fixture.deskRoot, person: "rowan", env: process.env }, (db) => {
      db.prepare("UPDATE work_items SET intake_at = ? WHERE work_item_id = ?").run(
        "2026-09-08T09:00:00.000Z",
        workItemId,
      )
      db.prepare("UPDATE closures SET closed_at = ? WHERE work_item_id = ?").run(
        "2026-09-08T10:00:00.000Z",
        workItemId,
      )
      const gaps = db.prepare("SELECT gap_id FROM recording_gaps ORDER BY gap_id").all()
      assert.equal(gaps.length, 2, "the fixture must have produced exactly two windows")
      const windows = [
        ["2026-09-08T09:30:00.000Z", "2026-09-08T09:45:00.000Z"],
        ["2026-09-08T11:00:00.000Z", "2026-09-08T11:30:00.000Z"],
      ]
      for (const [index, [disabledAt, enabledAt]] of windows.entries()) {
        const written = db
          .prepare("UPDATE recording_gaps SET disabled_at = ?, enabled_at = ? WHERE gap_id = ?")
          .run(disabledAt, enabledAt, gaps[index].gap_id)
        // A fixture that silently writes nothing would leave this test asserting
        // against wall-clock rows and passing for the wrong reason.
        assert.equal(written.changes, 1, "the fixture's own timeline must actually be stored")
      }
    })

    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    assert.equal(item.lead_time_ms.disposition, "cancelled")
    assert.equal(item.lead_time_ms.to, "terminal_claim_recording")
    assert.equal(item.lead_time_ms.censored, false)
    assert.equal(
      item.coverage.recording_gaps_overlapping,
      1,
      "only the window inside the item's own lifetime overlaps it",
    )
  })
})

// An unknown breakdown that reports an empty array reads as "nothing was used",
// which is a different claim from "this is not known".
test("an unknown breakdown says why it is unknown instead of reading as empty", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    const item = body(await ledger(fixture, { action: "report", work_item_id: workItemId })).items[0]
    for (const field of ["by_model", "by_initiator", "by_agent"]) {
      assert.equal(item[field].class, "unavailable", `${field} is not known`)
      assert.equal(item[field].value, null, `${field} must not read as an empty set`)
      assert.match(item[field].reason, /no usage/iu, `${field} must say why`)
    }
    // The agent breakdown keeps its own named companion field either way.
    assert.equal(item.by_agent.missing_agent_id.observed_events, 0)
  })
})

test("an unpriced report says why money is unavailable and keeps the currency array", async () => {
  await withFixture(async (fixture) => {
    await seed(fixture)
    const totals = body(await ledger(fixture, { action: "report" })).totals
    assert.equal(totals.financial_cost.class, "unavailable")
    assert.ok(Array.isArray(totals.financial_cost.by_currency), "the currency contract stays an array")
    assert.deepEqual(totals.financial_cost.by_currency, [])
    assert.match(totals.financial_cost.reason, /declared cost basis/iu)
  })
})

// --- Third implementation review: routing, atomicity and terminal state -----
//
// The four findings below are ordering defects rather than wrong values: a
// check that runs before an `await` and a write that runs after it, a write
// that lands before the validation that would have refused it, a guard whose
// state list drifted from the list that produces those states, and a bind that
// skipped the validator its neighbours use.

/** Write the Git-backed card a `task_ref` points at, so resolving one is a real read. */
async function writeTaskCard(fixture, track, slug) {
  const dir = path.join(fixture.deskRoot, "desks", "rowan", track, slug)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, "task.md"),
    "---\nstatus: doing\n---\n\n# Restart-safe intake queue\n",
    "utf8",
  )
  return { track, slug }
}

/** Every row in the owner's ledger, as one comparable value. */
async function snapshotLedger(fixture) {
  return withLedger({ deskRoot: fixture.deskRoot, person: "rowan", env: process.env }, (db) => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name)
    return JSON.stringify(
      tables.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]),
      null,
      1,
    )
  })
}

function countRows(fixture, table, workItemId) {
  return withLedger(
    { deskRoot: fixture.deskRoot, person: "rowan", env: process.env },
    (db) =>
      db.prepare(`SELECT count(*) AS n FROM "${table}" WHERE work_item_id = ?`).get(workItemId).n,
  )
}

// Suspends a commit inside the one asynchronous step it has — reading the
// canonical task card — so a second call provably runs while the first is
// mid-flight. Without a barrier the interleaving is a wall-clock coin flip: the
// card read usually resolves before any interfering call gets started, and a
// regression test could sit green having never raced anything.
async function withCommitSuspendedAtCardRead(fixture, commitInput, interfere) {
  const realLstat = fs.lstat
  let reached
  const suspended = new Promise((resolve) => {
    reached = resolve
  })
  let release
  const resume = new Promise((resolve) => {
    release = resolve
  })
  let held = false
  mock.method(fs, "lstat", async function heldLstat(target, ...rest) {
    if (!held && String(target).endsWith("task.md")) {
      held = true
      reached()
      await resume
    }
    return realLstat.call(this, target, ...rest)
  })
  try {
    const pending = ledger(fixture, commitInput)
    await suspended
    const interference = await interfere()
    release()
    return { commit: await pending, interference }
  } finally {
    mock.restoreAll()
  }
}

test("a commit already in flight is refused when recording is switched off beneath it", async () => {
  await withFixture(async (fixture) => {
    const taskRef = await writeTaskCard(fixture, "delivery", "intake-queue")
    const workItemId = await seed(fixture)
    const { commit, interference } = await withCommitSuspendedAtCardRead(
      fixture,
      { action: "commit", work_item_id: workItemId, ...COMMITMENT, task_ref: taskRef },
      () =>
        ledger(fixture, {
          action: "set_recording",
          enabled: false,
          reason: "The owner stopped capture.",
        }),
    )
    assert.equal(interference.isError, undefined, "the switch itself must succeed")
    assert.equal(commit.isError, true, "a commit may not land after capture was switched off")
    assert.match(body(commit).message, /recording is disabled/u)
    assert.equal(await countRows(fixture, "commitments", workItemId), 0, "nothing recorded")
    const item = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    assert.equal(item.work_item.state, "intake", "the item stays where it was")
  })
})

test("a commit already in flight is refused when the work item is deleted beneath it", async () => {
  await withFixture(async (fixture) => {
    const taskRef = await writeTaskCard(fixture, "delivery", "intake-queue")
    const workItemId = await seed(fixture)
    const { commit, interference } = await withCommitSuspendedAtCardRead(
      fixture,
      { action: "commit", work_item_id: workItemId, ...COMMITMENT, task_ref: taskRef },
      () => ledger(fixture, { action: "delete", work_item_id: workItemId, confirm: true }),
    )
    assert.equal(interference.isError, undefined, "the deletion itself must succeed")
    assert.equal(commit.isError, true, "a deleted item may not acquire a commitment")
    assert.match(body(commit).message, /no work item/iu)
    assert.equal(
      await countRows(fixture, "commitments", workItemId),
      0,
      "a commitment written after the deletion would be an orphan the owner cannot see",
    )
    assert.equal(await countRows(fixture, "work_items", workItemId), 0, "the item stays deleted")
  })
})

test("a commit already in flight is refused when the item reaches a terminal state beneath it", async () => {
  await withFixture(async (fixture) => {
    const taskRef = await writeTaskCard(fixture, "delivery", "intake-queue")
    const workItemId = await seed(fixture)
    const { commit, interference } = await withCommitSuspendedAtCardRead(
      fixture,
      { action: "commit", work_item_id: workItemId, ...COMMITMENT, task_ref: taskRef },
      () =>
        ledger(fixture, {
          action: "close",
          work_item_id: workItemId,
          state: "cancelled",
          reason: "The outcome was dropped.",
        }),
    )
    assert.equal(interference.isError, undefined, "the closure itself must succeed")
    assert.equal(commit.isError, true, "a terminal item may not acquire a commitment")
    assert.match(body(commit).message, /terminal work item does not accept commit/u)
    assert.equal(await countRows(fixture, "commitments", workItemId), 0, "nothing recorded")
  })
})

test("a correction rejected on its reason leaves the whole ledger untouched", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "The original sentence.")
    const before = await snapshotLedger(fixture)
    await throws(
      fixture,
      {
        action: "correct",
        work_item_id: workItemId,
        field: "request",
        value: "A replacement sentence.",
        expected_revision: 1,
        reason: {},
      },
      /reason must be a string when supplied/u,
    )
    assert.equal(await snapshotLedger(fixture), before, "a refused correction wrote something")
    const item = body(await ledger(fixture, { action: "inspect", work_item_id: workItemId }))
    assert.equal(item.work_item.request, "The original sentence.")
    assert.equal(item.work_item.revision, 1, "a refused correction must not bump the revision")
    assert.equal(await countRows(fixture, "corrections", workItemId), 0, "no history row")
  })
})

test("a correction may not replace a declared sentence with a structured value", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture, "The original sentence.")
    const before = await snapshotLedger(fixture)
    for (const value of [{ text: "x" }, ["x"], 7, true]) {
      await throws(
        fixture,
        {
          action: "correct",
          work_item_id: workItemId,
          field: "request",
          value,
          expected_revision: 1,
        },
        /value must be a string/u,
        `correct must refuse ${JSON.stringify(value)}`,
      )
    }
    assert.equal(await snapshotLedger(fixture), before, "a refused correction wrote something")
  })
})

test("a phase rejected on its cycle leaves no phase behind and does not block sizing", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
    const before = await snapshotLedger(fixture)
    await throws(
      fixture,
      {
        action: "phase",
        work_item_id: workItemId,
        phase: "planning",
        cycle: [],
        started_at: "2026-09-08T09:00:00Z",
        ended_at: "2026-09-08T10:00:00Z",
      },
      /cycle must be a string when supplied/u,
    )
    assert.equal(await snapshotLedger(fixture), before, "a refused phase wrote something")
    assert.equal(await countRows(fixture, "phases", workItemId), 0, "no phase row")
    const sized = await ledger(fixture, {
      action: "size",
      work_item_id: workItemId,
      work_type: "feature",
      scope: "The queue module only.",
      systems: ["One service."],
      uncertainty: "low",
      risk: "low",
      verification: "Replay test.",
    })
    assert.equal(
      sized.isError,
      undefined,
      "a refused phase must not count as execution evidence that makes sizing hindsight",
    )
  })
})

test("a phase rejected on its state leaves no phase behind", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
    const before = await snapshotLedger(fixture)
    await throws(
      fixture,
      {
        action: "phase",
        work_item_id: workItemId,
        phase: "planning",
        state: { name: "running" },
        started_at: "2026-09-08T09:00:00Z",
        ended_at: "2026-09-08T10:00:00Z",
      },
      /state must be a string when supplied/u,
    )
    assert.equal(await snapshotLedger(fixture), before, "a refused phase wrote something")
  })
})

test("every accepted closure state is terminal for every guarded transition", async () => {
  await withFixture(async (fixture) => {
    // The guard's list and the list of states a closure may produce have to be
    // the same list. A state a caller can reach but the guard does not name is
    // a closed item that quietly accepts more work.
    const attempts = [
      { action: "complete", endpoint: "desks/rowan/delivery/x/task.md", evidence: "Replay test." },
      {
        action: "phase",
        phase: "build",
        started_at: "2026-09-08T09:00:00Z",
        ended_at: "2026-09-08T10:00:00Z",
      },
      { action: "scope_change", kind: "added", change: "One more case.", reason: "Asked for." },
      {
        action: "size",
        work_type: "feature",
        scope: "The queue module only.",
        systems: ["One service."],
        uncertainty: "low",
        risk: "low",
        verification: "tests",
      },
      { action: "commit", ...COMMITMENT },
    ]
    for (const state of ["cancelled", "abandoned", "superseded"]) {
      const workItemId = await seed(fixture, `Closed as ${state}.`)
      await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
      const closed = await ledger(fixture, {
        action: "close",
        work_item_id: workItemId,
        state,
        reason: "Stopped.",
      })
      assert.equal(closed.isError, undefined, `close must accept ${state}`)
      const before = await snapshotLedger(fixture)
      for (const attempt of attempts) {
        await throws(
          fixture,
          { ...attempt, work_item_id: workItemId },
          new RegExp(`is ${state} — a terminal work item does not accept ${attempt.action}`, "u"),
          `${attempt.action} must be refused on a ${state} item`,
        )
      }
      assert.equal(await snapshotLedger(fixture), before, `a ${state} item accepted a write`)
    }
  })
})

test("an evaluation receipt digest must be a scalar the record can hold", async () => {
  await withFixture(async (fixture) => {
    const workItemId = await seed(fixture)
    await ledger(fixture, { action: "commit", work_item_id: workItemId, ...COMMITMENT })
    const before = await snapshotLedger(fixture)
    for (const receipt_sha256 of [["abc"], { sha: "abc" }, 12, false]) {
      await throws(
        fixture,
        {
          action: "link_evaluation_receipt",
          work_item_id: workItemId,
          measurement_kind: "offline_evaluation",
          receipt_ref: "receipts/run-1.json",
          receipt_sha256,
        },
        /receipt_sha256 must be a string when supplied/u,
        `a ${Array.isArray(receipt_sha256) ? "array" : typeof receipt_sha256} digest must be refused`,
      )
    }
    assert.equal(await snapshotLedger(fixture), before, "a refused receipt wrote something")
    const linked = body(
      await ledger(fixture, {
        action: "link_evaluation_receipt",
        work_item_id: workItemId,
        measurement_kind: "offline_evaluation",
        receipt_ref: "receipts/run-1.json",
        receipt_sha256: "a".repeat(64),
      }),
    )
    assert.equal(
      linked.receipt.receipt_sha256,
      "a".repeat(64),
      "the response must echo the value that was actually stored",
    )
  })
})
