// The weekly work-design review.
//
// Once a week the operator looks back at the work items they declared complete
// in that window and asks a design question about them: what did I take on,
// how uncertain and risky did I say it was, how much verification did it carry,
// and did the delivery evidence actually arrive at the endpoint I committed to.
//
// The review is deliberately narrow about what it is allowed to say. It selects
// on a *declaration* of completion, never on a judgement that the work was
// really delivered. It refuses to grade, rank or score anything, because the
// point is to read the shape of the work, not to mark it. It never treats a
// cancelled or abandoned item as completed. And an empty week is reported as an
// empty week with a stated reason, never as a quiet success and never as
// evidence that nothing happened or that the operator has started using this.

import { test } from "node:test"
import Database from "better-sqlite3"
import { promises as fs } from "node:fs"
import * as path from "node:path"
import { strict as assert } from "node:assert"

import { callTool } from "../../src/server.js"
import {
  mkLedgerFixture,
  useHostEnv,
  cleanup,
  writeSessionRecords,
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

async function ledger({ deskRoot, input, person = "rowan" }) {
  return callTool({ deskRoot, name: "desk_work_ledger", input, person })
}

const ENDPOINT = "desks/rowan/delivery/intake-queue/task.md"

async function committedItem(fixture, request) {
  const created = body(
    await ledger({ deskRoot: fixture.deskRoot, input: { action: "intake", request } }),
  )
  assert.equal(created.status, "intake_recorded", created.message ?? "")
  const workItemId = created.work_item.work_item_id
  const committed = body(
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
    }),
  )
  assert.equal(committed.status, "committed", committed.message ?? "")
  return workItemId
}

/** A window wide enough to contain anything this test just recorded. */
function windowAroundNow() {
  const now = Date.now()
  return {
    since: new Date(now - 3600_000).toISOString(),
    until: new Date(now + 3600_000).toISOString(),
  }
}

async function review(fixture, input = {}) {
  return body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "review", ...windowAroundNow(), ...input },
    }),
  )
}

test("the review selects the work items declared complete inside its window", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const completed = await committedItem(fixture, "Ship the thing that was asked for.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: completed,
      endpoint: ENDPOINT,
      evidence: "The endpoint holds the delivered artifact.",
    },
  })

  const result = await review(fixture)
  assert.equal(result.status, "ok", result.message ?? "")
  assert.equal(result.eligible.count, 1)
  assert.deepEqual(
    result.eligible.items.map((entry) => entry.work_item_id),
    [completed],
  )

  // Selection is on a declaration. Saying so in the payload is the whole
  // honesty of this route: nothing here verifies that delivery really happened.
  assert.equal(result.eligible.class, "declared")
  assert.match(result.eligible.selected_by, /complet/i)
})

test("an item still open is not in the cohort, and open coverage is pointed at separately", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  await committedItem(fixture, "Work that is still in flight.")

  const result = await review(fixture)
  assert.equal(result.eligible.count, 0)
  // An empty cohort must carry a reason. A silent zero reads as "nothing
  // happened", which is exactly the false conclusion this route must not invite.
  assert.equal(result.eligible.empty.class, "unavailable")
  assert.match(result.eligible.empty.reason, /no work item was declared complete/i)
  // Open and blocked work is a separate question, and the review says so rather
  // than implying its silence covers them.
  assert.equal(result.open_coverage.class, "unavailable")
  assert.match(result.open_coverage.reason, /separate/i)
})

test("a cancelled or abandoned item is never counted as completed work", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const abandoned = await committedItem(fixture, "Work that was dropped.")
  const closed = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "close",
        work_item_id: abandoned,
        state: "abandoned",
        reason: "Superseded by a different outcome.",
      },
    }),
  )
  assert.equal(closed.status, "closed", closed.message ?? "")

  const result = await review(fixture)
  assert.equal(result.eligible.count, 0)
  assert.equal(
    result.eligible.items.some((entry) => entry.work_item_id === abandoned),
    false,
  )
})

test("the review preserves every recorded size feature, and names the ones never recorded", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const sized = await committedItem(fixture, "Work whose shape was recorded first.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "size",
      work_item_id: sized,
      work_type: "implementation",
      scope: "one module and its tests",
      systems: ["the ledger", "its protected store"],
      uncertainty: "the native source format was unknown at the time",
      risk: "a wrong protection claim would be worse than none",
      verification: "a real Windows runner, not a skip",
    },
  })
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: sized,
      endpoint: ENDPOINT,
      evidence: "The runner output is attached.",
    },
  })

  const unsized = await committedItem(fixture, "Work whose shape was never recorded.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: unsized,
      endpoint: ENDPOINT,
      evidence: "Delivered without a recorded sizing.",
    },
  })

  const result = await review(fixture)
  const byId = new Map(result.eligible.items.map((entry) => [entry.work_item_id, entry]))

  const sizedEntry = byId.get(sized)
  assert.equal(sizedEntry.size.class, "declared")
  assert.equal(sizedEntry.size.work_type, "implementation")
  assert.equal(sizedEntry.size.uncertainty, "the native source format was unknown at the time")
  assert.equal(sizedEntry.size.risk, "a wrong protection claim would be worse than none")
  assert.equal(sizedEntry.size.verification, "a real Windows runner, not a skip")
  assert.equal(sizedEntry.size.scope, "one module and its tests")
  assert.deepEqual(sizedEntry.size.systems, ["the ledger", "its protected store"])

  // A missing sizing is a real and interesting answer for a design review, so
  // it is stated rather than defaulted to an empty string or dropped.
  const unsizedEntry = byId.get(unsized)
  assert.equal(unsizedEntry.size.class, "unavailable")
  assert.match(unsizedEntry.size.reason, /no size was recorded/i)
})

test("the review reports delivery evidence against the committed endpoint", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const delivered = await committedItem(fixture, "Work with evidence at the endpoint.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: delivered,
      endpoint: ENDPOINT,
      evidence: "Run 34394778641 is green on the exact source.",
    },
  })

  const entry = (await review(fixture)).eligible.items[0]
  assert.equal(entry.delivery.class, "declared")
  assert.equal(entry.delivery.endpoint, ENDPOINT)
  assert.equal(entry.delivery.evidence, "Run 34394778641 is green on the exact source.")
  assert.equal(entry.delivery.endpoint_string_matches_commitment, true)
  assert.equal(typeof entry.delivery.completed_at, "string")
})

test("the review never grades, scores or ranks the work it reads", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const item = await committedItem(fixture, "Work that will not be marked.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: item,
      endpoint: ENDPOINT,
      evidence: "Delivered.",
    },
  })

  const result = await review(fixture)

  // Checked structurally rather than as a substring over the serialized JSON.
  // A raw substring scan cannot tell a grading *field* from the sentence that
  // states this route does not grade, so it flags the route's own honesty
  // narration. Walking keys and values separately keeps the real contract —
  // no grading anywhere in the data — while letting the narration say so.
  const forbidden = ["score", "grade", "rank", "rating", "percentile", "efficiency"]
  const offences = []
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`))
      return
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        const here = path ? `${path}.${key}` : key
        for (const token of forbidden) {
          if (key.toLowerCase().includes(token)) offences.push(`key ${here}`)
        }
        walk(value, here)
      }
      return
    }
    if (typeof node === "string" && !path.startsWith("reading")) {
      for (const token of forbidden) {
        if (node.toLowerCase().includes(token)) offences.push(`value at ${path}`)
      }
    }
  }
  walk(result, "")
  assert.deepEqual(offences, [], "work design is read, not marked")

  // The narration that earns the carve-out must actually be present, so the
  // exemption above cannot quietly cover an empty field.
  assert.equal(
    result.reading.some((line) => /graded, scored or ranked/i.test(line)),
    true,
  )
})

test("a window that excludes the completion returns an empty cohort, not the item", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const item = await committedItem(fixture, "Completed now, reviewed for last week.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: item,
      endpoint: ENDPOINT,
      evidence: "Delivered.",
    },
  })

  const past = {
    since: "2026-01-01T00:00:00.000Z",
    until: "2026-01-08T00:00:00.000Z",
  }
  const result = await review(fixture, past)
  assert.equal(result.eligible.count, 0)
  assert.equal(result.window.since, past.since)
  assert.equal(result.window.until, past.until)
})

test("the review refuses a window it cannot trust rather than guessing one", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const undated = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "review", since: "2026-09-07", until: "2026-09-14" },
    }),
  )
  assert.match(undated.message ?? "", /instant/i)

  const backwards = await review(fixture, {
    since: "2026-09-14T00:00:00.000Z",
    until: "2026-09-07T00:00:00.000Z",
  })
  assert.match(backwards.message ?? "", /before/i)

  // A value can have the exact shape of an instant and still not be one. The
  // shape check alone would let hour 25 through and then quietly parse to
  // nothing, so the window is refused rather than silently emptied.
  const notReal = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        since: "2026-09-07T25:00:00Z",
        until: "2026-09-14T00:00:00Z",
      },
    }),
  )
  assert.match(notReal.message ?? "", /not a real one/i)

  // A caller can send something that is not text at all. It is refused on the
  // same ground as a bare date: there is no instant here to read, and guessing
  // one would silently pick a window.
  const notText = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "review", since: 12345, until: "2026-09-14T00:00:00Z" },
    }),
  )
  assert.match(notText.message ?? "", /instant/i)
})

test("the review is a read: advertised as non-capturing, and answerable while recording is off", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  // Binds the protected store to this fixture's own state home. Without it the
  // ledger resolves against the real operator state directory and every case
  // leaves a live partition behind there.
  t.after(useHostEnv(fixture))

  const capabilities = body(
    await ledger({ deskRoot: fixture.deskRoot, input: { action: "capabilities" } }),
  )
  const entry = capabilities.routes.find((route) => route.route === "review")
  assert.ok(entry, "the review route must be discoverable, not just callable")
  assert.equal(entry.bound, true)
  assert.equal(entry.availability, "available")
  // Reading work already recorded is not new capture, so the recording switch
  // does not govern it and the advertised shape must say so.
  assert.equal(entry.captures, false)
  // The exact accepted shape, pinned. carry_forward names work-item identities
  // the owner's dispatch ledger already holds; it still selects no store, no
  // person and no schema, which is the property this pin exists to protect.
  assert.deepEqual(entry.fields, ["since", "until", "carry_forward"])

  const off = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "set_recording", enabled: false, reason: "the owner stops new capture" },
    }),
  )
  assert.equal(off.status, "recording_disabled", off.message ?? "")

  const result = await review(fixture)
  assert.equal(result.status, "ok", result.message ?? "")
})

// A recorded completion timestamp carries whole-second precision, so two items
// finished in the same second share a completed_at exactly. Left at that, their
// order in the cohort would fall back to whatever order the rows came out of
// SQLite in, which is not specified. The tie is broken on the work item id so a
// week reads the same way every time it is opened. The collision is constructed
// here rather than raced for, because two completions landing in the same second
// is ordinary at this precision but not something a test can schedule.
async function ledgerDbPath(stateHome) {
  const namespace = path.join(stateHome, "ouroboros-skills", "desk", "work-ledger")
  const partitions = await fs.readdir(namespace)
  assert.equal(partitions.length, 1, "the fixture must own exactly one partition")
  return path.join(namespace, partitions[0], "work-ledger.sqlite")
}

test("two items completed in the same second read in a stable order", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const ids = []
  for (const request of ["Deliver the first outcome.", "Deliver the second outcome."]) {
    const workItemId = await committedItem(fixture, request)
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: workItemId,
        endpoint: ENDPOINT,
        evidence: "The endpoint holds the delivered artifact.",
      },
    })
    ids.push(workItemId)
  }

  const sameSecond = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/u, "Z")
  const expected = [...ids].sort((a, b) => a.localeCompare(b))
  const db = new Database(await ledgerDbPath(fixture.stateHome))
  db.prepare("UPDATE completions SET completed_at = ?").run(sameSecond)
  const stored = db.prepare("SELECT DISTINCT completed_at FROM completions").all()
  assert.equal(stored.length, 1, "both completions must now carry the identical second")
  // Rows are stored in the order the completions were recorded, which here is
  // already the answer the review is supposed to produce. That would let a
  // missing tiebreak look correct, so the stored order is reversed first: now
  // only an explicit tiebreak can put the cohort back into a stable order.
  db.prepare("UPDATE completions SET rowid = rowid + 1000").run()
  ;[...expected].reverse().forEach((workItemId, index) => {
    db.prepare("UPDATE completions SET rowid = ? WHERE work_item_id = ?").run(index + 1, workItemId)
  })
  // Selecting the same columns the review does, so this observes the order the
  // review really sees. Asking for the id alone is answered from the primary
  // key index instead, which is always sorted and would hide the row order.
  const scanned = db
    .prepare("SELECT work_item_id, endpoint, evidence, completed_at FROM completions")
    .all()
    .map((row) => row.work_item_id)
  db.close()
  assert.deepEqual(scanned, [...expected].reverse(), "the stored order must oppose the expected one")

  const result = await review(fixture)
  assert.equal(result.status, "ok", result.message ?? "")
  assert.equal(result.eligible.count, 2)
  assert.deepEqual(
    result.eligible.items.map((item) => item.work_item_id),
    expected,
    "a same-second tie is settled on the work item id, not on row order",
  )
})

// A date can have the exact shape of an instant, parse without complaint, and
// still name a day that never existed. The platform parser rolls those over
// silently: the last of February in a common year becomes the first of March,
// and the thirty-first of April becomes the first of May. A window bound that
// quietly moves to a different day selects a different week's work than the
// caller asked about, and nothing in the answer would show it. The rollover is
// refused rather than accepted, while real leap days and explicit offsets keep
// working exactly as before.
test("the review refuses a date the calendar does not have", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const impossible = [
    ["2026-02-30T00:00:00Z", "February 2026 has 28 days, and this silently became 2 March"],
    ["2025-02-29T00:00:00Z", "2025 is not a leap year, and this silently became 1 March"],
    ["1900-02-29T00:00:00Z", "1900 was a century and not a leap year, despite dividing by four"],
    ["2026-04-31T00:00:00Z", "April has 30 days, and this silently became 1 May"],
    ["2026-09-07T24:00:00Z", "hour 24 silently became the next day"],
    ["2026-13-01T00:00:00Z", "there is no thirteenth month"],
    ["2026-00-10T00:00:00Z", "there is no month zero"],
    ["2026-01-00T00:00:00Z", "there is no day zero"],
    ["2026-09-07T12:60:00Z", "there is no minute 60"],
    ["2026-09-07T12:00:60Z", "there is no second 60"],
    ["2026-09-07T00:00:00+99:99", "the written fields are real but the offset is not"],
  ]
  for (const [since, why] of impossible) {
    const refused = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "review", since, until: "2026-12-01T00:00:00Z" },
      }),
    )
    assert.notEqual(refused.status, "ok", `${since} must not be accepted: ${why}`)
    assert.match(refused.message ?? "", /not a real one/i, why)
  }

  // The bound is checked as the calendar day the caller wrote, not as the day
  // it lands on in UTC, so an offset that legitimately moves the instant across
  // midnight is still a valid bound rather than a rejected one.
  const shifted = await review(fixture, {
    since: "2026-09-07T00:00:00+02:00",
    until: "2026-09-14T00:00:00+02:00",
  })
  assert.equal(shifted.status, "ok", shifted.message ?? "")

  // Both leap rules that say yes: an ordinary leap year, and the century that
  // is one because it divides by four hundred. 1900 above is the century that
  // is not.
  for (const year of ["2024", "2000"]) {
    const leapDay = await review(fixture, {
      since: `${year}-02-29T00:00:00Z`,
      until: `${year}-03-01T00:00:00Z`,
    })
    assert.equal(leapDay.status, "ok", leapDay.message ?? "")
  }
})

// The route selects the input a weekly reading would start from. It does not
// perform the reading, and it does not verify that anything was delivered. Both
// of those are easy to assume from a successful status and an endpoint that
// matches, so the payload says otherwise in its own words and this case holds
// it to that.
test("a successful result is eligible input, not a review that happened", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const workItemId = await committedItem(fixture, "Ship the thing that was asked for.")
  await ledger({
    deskRoot: fixture.deskRoot,
    input: {
      action: "complete",
      work_item_id: workItemId,
      endpoint: ENDPOINT,
      evidence: "The endpoint holds the delivered artifact.",
    },
  })

  const result = await review(fixture)
  assert.equal(result.status, "ok", result.message ?? "")
  assert.equal(result.result_is.kind, "eligible_input")
  assert.equal(
    result.result_is.examined,
    false,
    "a successful selection must not present itself as an examination",
  )
  assert.match(result.result_is.statement, /not that a review happened/i)

  // Which items were actually read or deferred belongs to the owner's dispatch
  // ledger. This route must say it does not know rather than imply it does.
  assert.equal(result.result_is.reviewed_and_deferred_identities.class, "unavailable")

  // The window is selected on the completion claim, which is not a delivery
  // time, and the payload has to say so where a reader will see it.
  assert.match(result.window.selected_on, /completions\.completed_at/)
  assert.match(result.window.selected_on, /not a delivery time/i)

  // The endpoint comparison is between two declared strings. Its name must not
  // suggest delivery was checked, and the payload must disclaim that in words.
  const entry = result.eligible.items[0]
  assert.equal(entry.delivery.endpoint_string_matches_commitment, true)
  assert.equal(
    entry.delivery.matches_committed_endpoint,
    undefined,
    "the older name read as a delivery check and must not come back",
  )
  assert.equal(entry.delivery.class, "declared")
  assert.ok(
    result.reading.some((line) => /never a verification of delivery/i.test(line)),
    "the payload must state in words that selection is not delivery verification",
  )
})

// A reading is source-bound, or it says it is not.
//
// The point of naming the session behind an item is that a weekly reading of
// "my work" should be able to show which of it actually came from a recorded
// session on this machine. An item with no binding was never correlated with
// any session, and that has to read as an absence rather than as a quiet blank.
// This is also the seam a later first-use confirmation needs: a real V2 item
// carries a binding to the source and session that produced it, and this route
// is where that binding is read back.

async function completeItem(fixture, workItemId, evidence = "Replay output attached.") {
  const done = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: workItemId,
        endpoint: ENDPOINT,
        evidence,
      },
    }),
  )
  assert.equal(done.status, "completed", done.message ?? "")
  return done
}

test("a reading names the session an item came from, or states it has none", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  writeSessionRecords(fixture.sourcePath, baseSessionRecords())

  const bound = await committedItem(fixture, "Work that came from a real session.")
  const imported = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: bound,
        source: "copilot_local_session_records",
        session_id: FIXTURE_SESSION_ID,
        machine_id: "workstation-a",
      },
    }),
  )
  assert.equal(imported.status, "usage_imported", imported.message ?? "")
  await completeItem(fixture, bound)

  const unbound = await committedItem(fixture, "Work nobody bound to a session.")
  await completeItem(fixture, unbound)

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "review", ...windowAroundNow() },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  const boundItem = review.eligible.items.find((item) => item.work_item_id === bound)
  const unboundItem = review.eligible.items.find((item) => item.work_item_id === unbound)

  assert.equal(boundItem.source_binding.class, "declared")
  assert.equal(boundItem.source_binding.sessions.length, 1)
  assert.equal(boundItem.source_binding.sessions[0].source, "copilot_local_session_records")
  assert.equal(boundItem.source_binding.sessions[0].session_id, FIXTURE_SESSION_ID)
  assert.equal(boundItem.source_binding.sessions[0].machine_id, "workstation-a")
  assert.ok(boundItem.source_binding.sessions[0].bound_at)

  // The absence has to be explicit. A missing binding must never read as though
  // the item merely had nothing interesting to say about its origin.
  assert.equal(unboundItem.source_binding.class, "unavailable")
  assert.match(unboundItem.source_binding.reason, /no session/i)
  assert.equal(unboundItem.source_binding.sessions, undefined)

  // And the reading states plainly what a binding is and is not evidence of.
  assert.match(JSON.stringify(review.result_is), /binding/i)
})

// Carry-forward, and the identity it is not allowed to launder.
//
// An item whose evidence could not be assessed in its own week comes back for a
// later look, but it stays in the cohort it was completed in. It must never be
// added to a later week's new-completion denominator, because that would count
// one outcome as completed twice and quietly inflate a later week.

async function backdateCompletion(fixture, workItemId, completedAt) {
  const db = new Database(await ledgerDbPath(fixture.stateHome))
  try {
    db.prepare("UPDATE completions SET completed_at = ? WHERE work_item_id = ?").run(
      completedAt,
      workItemId,
    )
  } finally {
    db.close()
  }
}

const LAST_WEEK = "2026-08-31T07:00:00.000Z"

test("a carried-forward item keeps its original cohort and stays out of the denominator", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const older = await committedItem(fixture, "Completed in an earlier week.")
  await completeItem(fixture, older)
  await backdateCompletion(fixture, older, LAST_WEEK)

  const fresh = await committedItem(fixture, "Completed in this week.")
  await completeItem(fixture, fresh)

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        ...windowAroundNow(),
        carry_forward: [{ work_item_id: older, completed_at: LAST_WEEK }],
      },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  // The denominator is this window's new completions only.
  assert.equal(review.eligible.count, 1)
  assert.deepEqual(review.eligible.ids, [fresh])
  assert.ok(!review.eligible.ids.includes(older))

  const carried = review.carried_forward
  assert.equal(carried.count, 1)
  assert.equal(carried.counted_in_denominator, false)
  assert.equal(carried.items[0].work_item_id, older)
  assert.equal(carried.items[0].status, "carried_forward")
  assert.equal(carried.items[0].original_cohort.completed_at, LAST_WEEK)
  assert.equal(carried.items[0].original_cohort.falls_in_this_window, false)
})

test("a carry-forward that restates a different completion time is refused", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const older = await committedItem(fixture, "Completed in an earlier week.")
  await completeItem(fixture, older)
  await backdateCompletion(fixture, older, LAST_WEEK)

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        ...windowAroundNow(),
        // A later completion time than the ledger holds: the shape a
        // recompletion or reopened-work claim would take if it were allowed to
        // move an item into a newer cohort.
        carry_forward: [{ work_item_id: older, completed_at: "2026-09-07T07:00:00.000Z" }],
      },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  const entry = review.carried_forward.items[0]
  assert.equal(entry.status, "identity_mismatch")
  assert.equal(entry.original_cohort.completed_at, LAST_WEEK)
  assert.equal(entry.stated_completed_at, "2026-09-07T07:00:00.000Z")
  assert.match(entry.reason, /cannot.*reset|does not match/i)
  // Refused entries are never silently promoted into the denominator either.
  assert.equal(review.carried_forward.counted_in_denominator, false)
  assert.equal(review.eligible.count, 0)
})

test("a carry-forward already completed inside this window is not double counted", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const fresh = await committedItem(fixture, "Completed in this very window.")
  const done = await completeItem(fixture, fresh)

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        ...windowAroundNow(),
        carry_forward: [{ work_item_id: fresh, completed_at: done.completion.completed_at }],
      },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  // It is a new completion in this window, so it belongs in the denominator
  // exactly once and must not also be reported as carried forward.
  assert.equal(review.eligible.count, 1)
  assert.equal(review.carried_forward.items[0].status, "already_in_this_window")
  assert.match(review.carried_forward.items[0].reason, /counted once|already/i)
})

test("a carry-forward for an unknown item is stated unavailable", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        ...windowAroundNow(),
        carry_forward: [
          { work_item_id: "11111111-2222-3333-4444-555555555555", completed_at: LAST_WEEK },
        ],
      },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  const entry = review.carried_forward.items[0]
  assert.equal(entry.status, "unavailable")
  assert.match(entry.reason, /no completion|not recorded|unknown/i)
})

test("a malformed carry-forward input is refused on shape", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  for (const carry of [
    "not-a-list",
    [7],
    [null],
    [{ completed_at: LAST_WEEK }],
    [{ work_item_id: "11111111-2222-3333-4444-555555555555" }],
    [{ work_item_id: 7, completed_at: LAST_WEEK }],
  ]) {
    const refused = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "review", ...windowAroundNow(), carry_forward: carry },
      }),
    )
    assert.notEqual(refused.status, "ok")
    assert.match(refused.message, /carry_forward/i)
  }
})

test("a carry-forward completed after this window is not pulled backwards into it", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const later = await committedItem(fixture, "Completed in a later week.")
  await completeItem(fixture, later)
  const AFTER = "2099-01-04T08:00:00.000Z"
  await backdateCompletion(fixture, later, AFTER)

  const review = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "review",
        ...windowAroundNow(),
        carry_forward: [{ work_item_id: later, completed_at: AFTER }],
      },
    }),
  )
  assert.equal(review.status, "ok", review.message ?? "")

  const entry = review.carried_forward.items[0]
  assert.equal(entry.status, "completed_after_window")
  assert.equal(entry.original_cohort.falls_in_this_window, false)
  assert.match(entry.reason, /later cohort|after this window/i)
  assert.equal(review.carried_forward.count, 0)
  assert.equal(review.eligible.count, 0)
})

for (const field of ["since", "until"]) {
  test(`the review refuses sub-millisecond ${field} precision instead of moving its boundary`, async (t) => {
    const fixture = await mkLedgerFixture()
    t.after(() => cleanup(fixture.base))
    t.after(useHostEnv(fixture))

    const workItemId = await committedItem(fixture, "Keep the exact completion-window boundary.")
    await completeItem(fixture, workItemId)
    const observed = await review(fixture)
    assert.equal(observed.status, "ok", observed.message ?? "")
    assert.equal(observed.eligible.count, 1)
    const completedAt = observed.eligible.items[0].delivery.completed_at
    const second = new Date(completedAt).toISOString().replace(/\.000Z$/u, "")

    for (const fraction of [".0001Z", ".0000001Z", ".1230001Z", ".0001+00:00"]) {
      const bound = `${second}${fraction}`
      const result = await review(fixture, { [field]: bound })
      t.diagnostic(JSON.stringify({
        field,
        completedAt,
        bound,
        status: result.status,
        eligible: result.eligible?.ids,
      }))
      assert.notEqual(result.status, "ok", "unsupported precision must not become a successful different window")
      assert.match(result.message, /millisecond|precision/i)
    }
  })
}

test("the review preserves representable fractional precision and its half-open boundary", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  const workItemId = await committedItem(fixture, "Retain exact millisecond-compatible instants.")
  await completeItem(fixture, workItemId)
  const observed = await review(fixture)
  assert.equal(observed.status, "ok", observed.message ?? "")
  const completedAt = observed.eligible.items[0].delivery.completed_at
  const epoch = Date.parse(completedAt)
  const second = new Date(epoch).toISOString().replace(/\.000Z$/u, "")

  for (const suffix of [".0Z", ".00Z", ".000Z", ".000000Z", ".0000+0000", ".0000+00:00"]) {
    const bound = `${second}${suffix}`
    const included = await review(fixture, {
      since: bound,
      until: new Date(epoch + 1).toISOString(),
    })
    assert.equal(included.status, "ok", included.message ?? "")
    assert.deepEqual(included.eligible.ids, [workItemId])
    const excluded = await review(fixture, {
      since: new Date(epoch - 1).toISOString(),
      until: bound,
    })
    assert.equal(excluded.status, "ok", excluded.message ?? "")
    assert.equal(excluded.eligible.count, 0)
  }

  const fractional = await review(fixture, {
    since: `${second}.123000Z`,
    until: `${second}.124000Z`,
  })
  assert.equal(fractional.status, "ok", fractional.message ?? "")
  assert.equal(fractional.eligible.count, 0)
})

test("the review rejects duplicate carry-forward identities rather than inflating carried work", async (t) => {
  const fixture = await mkLedgerFixture()
  t.after(() => cleanup(fixture.base))
  t.after(useHostEnv(fixture))

  for (const request of ["One unresolved outcome.", "A different unresolved outcome."]) {
    await completeItem(fixture, await committedItem(fixture, request))
  }
  const observed = await review(fixture)
  assert.equal(observed.status, "ok", observed.message ?? "")
  assert.equal(observed.eligible.count, 2)
  const entries = observed.eligible.items.map((item) => ({
    work_item_id: item.work_item_id,
    completed_at: item.delivery.completed_at,
  }))
  const latest = Math.max(...entries.map((entry) => Date.parse(entry.completed_at)))
  const window = {
    since: new Date(latest + 1000).toISOString(),
    until: new Date(latest + 2000).toISOString(),
  }
  const distinct = await review(fixture, { ...window, carry_forward: entries })
  assert.equal(distinct.status, "ok", distinct.message ?? "")
  assert.equal(distinct.eligible.count, 0)
  assert.equal(distinct.carried_forward.count, 2)
  const duplicate = await review(fixture, {
    ...window,
    carry_forward: [entries[0], { ...entries[0] }],
  })
  t.diagnostic(JSON.stringify({
    status: duplicate.status,
    carriedCount: duplicate.carried_forward?.count,
  }))
  assert.notEqual(duplicate.status, "ok", "one identity must not be presented as two carried outcomes")
  assert.match(duplicate.message, /duplicate|once/i)
})

test("the review module exposes only its production consumer entrypoint", async () => {
  const exports = await import("../../src/measurement/review.js")
  assert.deepEqual(Object.keys(exports), ["buildReview"])
})
