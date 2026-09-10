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
import { mkLedgerFixture, useHostEnv, cleanup } from "./_helpers.js"

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
  assert.equal(result.status, "reviewed", result.message ?? "")
  assert.equal(result.cohort.count, 1)
  assert.deepEqual(
    result.cohort.items.map((entry) => entry.work_item_id),
    [completed],
  )

  // Selection is on a declaration. Saying so in the payload is the whole
  // honesty of this route: nothing here verifies that delivery really happened.
  assert.equal(result.cohort.class, "declared")
  assert.match(result.cohort.selected_by, /complet/i)
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
  assert.equal(result.cohort.count, 0)
  // An empty cohort must carry a reason. A silent zero reads as "nothing
  // happened", which is exactly the false conclusion this route must not invite.
  assert.equal(result.cohort.empty.class, "unavailable")
  assert.match(result.cohort.empty.reason, /no work item was declared complete/i)
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
  assert.equal(result.cohort.count, 0)
  assert.equal(
    result.cohort.items.some((entry) => entry.work_item_id === abandoned),
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
  const byId = new Map(result.cohort.items.map((entry) => [entry.work_item_id, entry]))

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

  const entry = (await review(fixture)).cohort.items[0]
  assert.equal(entry.delivery.class, "declared")
  assert.equal(entry.delivery.endpoint, ENDPOINT)
  assert.equal(entry.delivery.evidence, "Run 34394778641 is green on the exact source.")
  assert.equal(entry.delivery.matches_committed_endpoint, true)
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
  assert.equal(result.cohort.count, 0)
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
  assert.deepEqual(entry.fields, ["since", "until"])

  const off = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "set_recording", enabled: false, reason: "the owner stops new capture" },
    }),
  )
  assert.equal(off.status, "recording_disabled", off.message ?? "")

  const result = await review(fixture)
  assert.equal(result.status, "reviewed", result.message ?? "")
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
  assert.equal(result.status, "reviewed", result.message ?? "")
  assert.equal(result.cohort.count, 2)
  assert.deepEqual(
    result.cohort.items.map((item) => item.work_item_id),
    expected,
    "a same-second tie is settled on the work item id, not on row order",
  )
})
