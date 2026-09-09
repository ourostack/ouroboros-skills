// desk_work_ledger — private work-item measurement exercised through the real
// MCP dispatch boundary (src/server.js callTool + startServer registration),
// not by calling the tool module directly.
//
// The unit under test is a work item: one request for one specific
// independently assessable outcome. A prompt, a session, a PR and an
// implementation step are not work items, and nothing here may be inferred
// from conversation — every record exists because a call made it.

import { test } from "node:test"
import { strict as assert } from "node:assert"

import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"

import { callTool, startServer, TOOL_NAMES } from "../../src/server.js"
import {
  mkLedgerFixture,
  useHostEnv,
  cleanup,
  writeSessionRecords,
  baseSessionRecords as baseRecords,
  FIXTURE_SESSION_ID as SESSION_ID,
} from "../measurement/_helpers.js"

const PERSON = "rowan"

function body(result) {
  const text = result.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    // The dispatch boundary answers an unroutable name in plain text. Surface
    // it verbatim so a failure here reads as "this capability is not wired"
    // instead of as a JSON parse error.
    return { status: "unroutable", message: text }
  }
}

async function ledger({ deskRoot, person = PERSON, input }) {
  return callTool({ deskRoot, name: "desk_work_ledger", input, person })
}

async function intake(fixture, request = "Make the intake queue survive a restart.") {
  const result = body(
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "intake", request, requested_by: "operator" },
    }),
  )
  assert.equal(result.status, "intake_recorded")
  return result.work_item
}

const COMMITMENT = {
  outcome: "Restart-safe intake queue, verified by an operator-visible replay.",
  scope: "The queue module and its restart path only.",
  evidence: "Replay test output attached to the task card.",
  delivery_endpoint: "desks/rowan/delivery/intake-queue/task.md",
  operator_go: { by: "operator", at: "2026-09-08T18:00:00Z" },
}

test("desk_work_ledger is a registered tool the MCP dispatch boundary routes", async () => {
  assert.ok(
    TOOL_NAMES.includes("desk_work_ledger"),
    "desk_work_ledger must be canonical in TOOL_NAMES so hosts list it",
  )

  const listed = []
  await startServer({
    deskRoot: "/nonexistent-desk-root",
    server: {
      setRequestHandler(_schema, handler) {
        listed.push(handler)
      },
      async connect() {},
    },
    transport: {},
  })
  const tools = await listed[0]()
  const registered = tools.tools.find((tool) => tool.name === "desk_work_ledger")
  assert.ok(registered, "desk_work_ledger must be registered with the host")
  assert.match(registered.description, /private/iu)
})

test("desk_work_ledger records identity at intake before any commitment exists", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    assert.match(item.work_item_id, /^[0-9a-f-]{36}$/u)
    assert.equal(item.state, "intake")
    assert.equal(item.request, "Make the intake queue survive a restart.")
    assert.ok(item.intake_at, "intake must timestamp the identity it creates")
    assert.equal(item.commitment, null)

    const inspected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: item.work_item_id },
      }),
    )
    assert.equal(inspected.work_item.state, "intake")
    assert.deepEqual(inspected.phases, [])
    assert.deepEqual(inspected.usage, [])
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger refuses a commitment for an identity it never took in", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const result = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "commit",
        work_item_id: "11111111-2222-3333-4444-555555555555",
        ...COMMITMENT,
      },
    })
    assert.equal(result.isError, true)
    assert.match(body(result).message, /no work item/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger commitment records outcome, scope, evidence, endpoint and the explicit go", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    const committed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT },
      }),
    )
    assert.equal(committed.status, "committed")
    assert.equal(committed.work_item.state, "committed")
    assert.equal(committed.commitment.outcome, COMMITMENT.outcome)
    assert.equal(committed.commitment.delivery_endpoint, COMMITMENT.delivery_endpoint)
    assert.equal(committed.commitment.operator_go.by, "operator")
    assert.equal(committed.commitment.operator_go.at, "2026-09-08T18:00:00Z")

    for (const missing of ["outcome", "scope", "evidence", "delivery_endpoint", "operator_go"]) {
      const partial = { ...COMMITMENT }
      delete partial[missing]
      const second = await intake(fixture, `Another outcome missing ${missing}.`)
      const result = await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "commit", work_item_id: second.work_item_id, ...partial },
      })
      assert.equal(result.isError, true, `commit must require ${missing}`)
      assert.match(body(result).message, new RegExp(missing, "u"))
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger binds a commitment to a canonical desk task that actually exists", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await callTool({
      deskRoot: fixture.deskRoot,
      name: "task_create",
      person: PERSON,
      input: { track: "delivery", slug: "intake-queue", title: "Intake queue" },
    })
    const item = await intake(fixture)
    const committed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "commit",
          work_item_id: item.work_item_id,
          ...COMMITMENT,
          task_ref: { track: "delivery", slug: "intake-queue" },
        },
      }),
    )
    assert.deepEqual(committed.commitment.task_ref, {
      track: "delivery",
      slug: "intake-queue",
      path: "desks/rowan/delivery/intake-queue/task.md",
    })

    const missing = await intake(fixture, "Outcome pointing at no task.")
    const rejected = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "commit",
        work_item_id: missing.work_item_id,
        ...COMMITMENT,
        task_ref: { track: "delivery", slug: "not-a-real-task" },
      },
    })
    assert.equal(rejected.isError, true)
    assert.match(body(rejected).message, /task does not exist/iu)

    const traversal = await intake(fixture, "Outcome pointing outside the desk.")
    const refused = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "commit",
        work_item_id: traversal.work_item_id,
        ...COMMITMENT,
        task_ref: { track: "..", slug: "escape" },
      },
    })
    assert.equal(refused.isError, true)
    assert.match(body(refused).message, /invalid write path segment/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger requires size features before execution and refuses them after", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    const sized = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "size",
          work_item_id: item.work_item_id,
          work_type: "implementation",
          scope: "one module",
          systems: ["desk-mcp"],
          uncertainty: "unknown",
          risk: "low",
          verification: "unit tests plus an operator replay",
        },
      }),
    )
    assert.equal(sized.status, "size_recorded")
    assert.equal(sized.size.uncertainty, "unknown")
    assert.equal(sized.size.class, "declared")

    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "phase",
        work_item_id: item.work_item_id,
        phase: "implementation",
        started_at: "2026-09-08T18:10:00Z",
        ended_at: "2026-09-08T18:40:00Z",
      },
    })

    const late = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "size",
        work_item_id: item.work_item_id,
        work_type: "implementation",
        scope: "one module, but bigger than we thought",
        systems: ["desk-mcp"],
        uncertainty: "high",
        risk: "high",
        verification: "unit tests",
      },
    })
    assert.equal(late.isError, true)
    assert.match(body(late).message, /before execution/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger keeps rework on the original item and links a genuinely new outcome", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT },
    })

    const revised = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "scope_change",
          work_item_id: item.work_item_id,
          kind: "revision",
          change: "Restart path now includes the retry queue.",
          reason: "The original outcome is unreachable without it.",
        },
      }),
    )
    assert.equal(revised.status, "scope_change_recorded")
    assert.equal(revised.work_item_id, item.work_item_id)

    const followOn = await intake(fixture, "Add a queue dashboard.")
    const linked = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "link",
          work_item_id: item.work_item_id,
          related_work_item_id: followOn.work_item_id,
          relation: "follow_on",
        },
      }),
    )
    assert.equal(linked.status, "linked")

    const laundering = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "link",
        work_item_id: item.work_item_id,
        related_work_item_id: followOn.work_item_id,
        relation: "replaces",
      },
    })
    assert.equal(laundering.isError, true)
    assert.match(body(laundering).message, /relation/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger completion needs the committed endpoint and evidence, not a self-report", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    const premature = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: item.work_item_id,
        endpoint: COMMITMENT.delivery_endpoint,
        evidence: "It works.",
      },
    })
    assert.equal(premature.isError, true)
    assert.match(body(premature).message, /commit/iu)

    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT },
    })

    const wrongEndpoint = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: item.work_item_id,
        endpoint: "somewhere/else.md",
        evidence: "Replay output captured.",
      },
    })
    assert.equal(wrongEndpoint.isError, true)
    assert.match(body(wrongEndpoint).message, /endpoint/iu)

    const noEvidence = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "complete",
        work_item_id: item.work_item_id,
        endpoint: COMMITMENT.delivery_endpoint,
        evidence: "   ",
      },
    })
    assert.equal(noEvidence.isError, true)
    assert.match(body(noEvidence).message, /evidence/iu)

    const completed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "complete",
          work_item_id: item.work_item_id,
          endpoint: COMMITMENT.delivery_endpoint,
          evidence: "Replay output captured on the task card.",
        },
      }),
    )
    assert.equal(completed.status, "completed")
    assert.equal(completed.work_item.state, "completed")

    // The endpoint matched and the evidence is non-empty, but nothing here
    // observed the delivery. Both are the operator's assertion, and the record
    // must say so rather than presenting prose as verified delivery.
    assert.equal(completed.completion.endpoint, COMMITMENT.delivery_endpoint)
    assert.equal(completed.completion.evidence, "Replay output captured on the task card.")
    assert.equal(completed.completion.class, "declared")
    // With no canonical task bound, there is nothing to check the claim against.
    assert.equal(completed.completion.canonical_status.class, "unavailable")
    assert.equal(completed.completion.canonical_status.mismatch, "unavailable")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger keeps cancelled and unfinished work visible", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const abandoned = await intake(fixture, "Explore a queue rewrite.")
    const closed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "close",
          work_item_id: abandoned.work_item_id,
          state: "cancelled",
          reason: "Superseded before any commitment.",
        },
      }),
    )
    assert.equal(closed.status, "closed")
    assert.equal(closed.work_item.state, "cancelled")

    await intake(fixture, "Still in flight.")

    const report = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    const states = report.items.map((entry) => entry.state.value).sort()
    assert.deepEqual(states, ["cancelled", "intake"])
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger supports inspection, correction and deletion of the private record", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    const corrected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "correct",
          work_item_id: item.work_item_id,
          field: "request",
          value: "Make the intake queue survive a restart and a crash.",
          expected_revision: 1,
          reason: "The original wording missed the crash case.",
        },
      }),
    )
    assert.equal(corrected.status, "corrected")
    assert.equal(corrected.work_item.revision, 2)

    const stale = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "correct",
        work_item_id: item.work_item_id,
        field: "request",
        value: "Third wording.",
        expected_revision: 1,
        reason: "Written against a stale read.",
      },
    })
    assert.equal(stale.isError, true)
    assert.match(body(stale).message, /revision/iu)

    const deleted = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "delete", work_item_id: item.work_item_id, confirm: true },
      }),
    )
    assert.equal(deleted.status, "deleted")

    const gone = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "inspect", work_item_id: item.work_item_id },
    })
    assert.equal(gone.isError, true)
    assert.match(body(gone).message, /no work item/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger rejects unknown actions and unknown input fields", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const unknownAction = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "export" },
    })
    assert.equal(unknownAction.isError, true)
    assert.match(body(unknownAction).message, /unknown action/iu)

    const unknownField = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "intake", request: "A request.", desk_root: "/somewhere/else" },
    })
    assert.equal(unknownField.isError, true)
    assert.match(body(unknownField).message, /unknown input field/iu)

    const personOverride = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "intake", request: "A request.", person: "someone-else" },
    })
    assert.equal(personOverride.isError, true)
    assert.match(body(personOverride).message, /unknown input field/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

test("desk_work_ledger keeps separate person bindings in separate private ledgers", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await ledger({
      deskRoot: fixture.deskRoot,
      person: "rowan",
      input: { action: "intake", request: "Rowan's outcome." },
    })
    const otherReport = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        person: "quinn",
        input: { action: "report" },
      }),
    )
    assert.deepEqual(otherReport.items, [])

    const unsafe = await ledger({
      deskRoot: fixture.deskRoot,
      person: "../escape",
      input: { action: "report" },
    })
    assert.equal(unsafe.isError, true)
    assert.match(body(unsafe).message, /invalid --person alias/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

/**
 * A fingerprint of every path under a root, carrying each entry's kind and, for
 * regular files, a hash of its bytes. Path names alone would not notice a
 * rewritten task card or a file swapped for a directory, so they are not enough
 * to support a claim that validation left the workspace untouched.
 */
async function treeSnapshot(root) {
  const found = []
  async function walk(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const relative = path.relative(root, full)
      const kind = entry.isDirectory()
        ? "dir"
        : entry.isSymbolicLink()
          ? "symlink"
          : entry.isFile()
            ? "file"
            : "other"
      const digest =
        kind === "file"
          ? createHash("sha256").update(await fs.readFile(full)).digest("hex")
          : null
      found.push(`${relative}\u0000${kind}\u0000${digest ?? ""}`)
      if (entry.isDirectory()) await walk(full)
    }
  }
  await walk(root)
  return found.sort()
}

// Validating a task reference must never bring the thing it validates into
// existence. The desk workspace is Git-backed and belongs to the operator, so a
// read-only check that quietly creates a person subtree would be both a
// side effect nobody asked for and a write into version control. This is the
// guard: the workspace is byte-for-byte the same shape afterwards, on the
// accepting path and on both refusing paths.
test("desk_work_ledger never creates anything in the desk workspace while checking a task reference", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await callTool({
      deskRoot: fixture.deskRoot,
      name: "task_create",
      person: PERSON,
      input: { track: "delivery", slug: "intake-queue", title: "Intake queue" },
    })
    const before = await treeSnapshot(fixture.deskRoot)

    // The accepted path matters most: a check that succeeds has every excuse to
    // touch the card it just resolved, and must not.
    const accepted = await intake(fixture, "Outcome pointing at a real task.")
    const bound = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "commit",
        work_item_id: accepted.work_item_id,
        ...COMMITMENT,
        task_ref: { track: "delivery", slug: "intake-queue" },
      },
    })
    assert.equal(bound.isError, undefined, "an existing task reference must be accepted")
    assert.deepEqual(
      await treeSnapshot(fixture.deskRoot),
      before,
      "an accepted task reference must leave the card's bytes and every path untouched",
    )

    for (const task_ref of [
      { track: "delivery", slug: "not-a-real-task" },
      { track: "delivery", slug: "another-absent-task" },
      { track: "..", slug: "escape" },
    ]) {
      const item = await intake(fixture, "Outcome pointing at an absent task.")
      const attempted = await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT, task_ref },
      })
      assert.equal(attempted.isError, true, "an absent or unsafe task reference must be refused")

      const after = await treeSnapshot(fixture.deskRoot)
      assert.deepEqual(
        after,
        before,
        `checking ${JSON.stringify(task_ref)} changed the desk workspace; ` +
          "validation must not create a person subtree or any other path",
      )
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Where a canonical task is bound, the ledger reads its state and reports
// whether the private claim agrees with it. Read-only: the ledger owns no
// lifecycle, writes nothing to the card, and never rewrites the card's state to
// match its own record.
test("desk_work_ledger reports canonical task state beside the declared claim, and never edits it", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    await callTool({
      deskRoot: fixture.deskRoot,
      name: "task_create",
      person: PERSON,
      input: { track: "delivery", slug: "intake-queue", title: "Intake queue" },
    })
    const item = await intake(fixture)
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "commit",
        work_item_id: item.work_item_id,
        ...COMMITMENT,
        task_ref: { track: "delivery", slug: "intake-queue" },
      },
    })

    const cardBefore = await treeSnapshot(fixture.deskRoot)
    const claimedDone = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "complete",
          work_item_id: item.work_item_id,
          endpoint: COMMITMENT.delivery_endpoint,
          evidence: "Replay output captured on the task card.",
        },
      }),
    )
    // The private ledger says done; the canonical card still says otherwise.
    // That disagreement is the finding, and it must surface as one.
    assert.equal(claimedDone.completion.class, "declared")
    // Reading the card is an observation of a recorded declaration, not
    // delivery verification, so the class stays inside the five-class wire
    // vocabulary and the card it was read from is cited separately.
    assert.equal(claimedDone.completion.canonical_status.class, "declared")
    assert.equal(claimedDone.completion.canonical_status.source_ref.track, "delivery")
    assert.equal(claimedDone.completion.canonical_status.source_ref.slug, "intake-queue")
    assert.notEqual(claimedDone.completion.canonical_status.state, "done")
    assert.equal(claimedDone.completion.canonical_status.mismatch, true)
    assert.deepEqual(
      await treeSnapshot(fixture.deskRoot),
      cardBefore,
      "reading canonical state must not write to the card",
    )

    await callTool({
      deskRoot: fixture.deskRoot,
      name: "task_update",
      person: PERSON,
      input: { track: "delivery", slug: "intake-queue", frontmatter: { status: "done" } },
    })
    const agreed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: item.work_item_id },
      }),
    )
    assert.equal(agreed.work_item.completion.canonical_status.state, "done")
    assert.equal(agreed.work_item.completion.canonical_status.mismatch, false)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// A lost response must not become a second work item. Intake carries a caller
// request key; replaying it returns the original item rather than counting the
// same outcome twice.
test("desk_work_ledger replays intake on the same request key instead of duplicating the outcome", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const first = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "intake", request: "Ship the intake queue.", request_key: "req-1" },
      }),
    )
    const replay = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "intake", request: "Ship the intake queue.", request_key: "req-1" },
      }),
    )
    assert.equal(replay.work_item_id, first.work_item_id)
    assert.equal(replay.status, "intake_replayed")

    // The same key with a different request is a conflict, not a silent
    // overwrite of what was recorded first.
    const conflict = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "intake", request: "Something else entirely.", request_key: "req-1" },
    })
    assert.equal(conflict.isError, true)
    assert.match(body(conflict).message, /request_key/iu)

    const listed = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }),
    )
    assert.equal(listed.items.length, 1, "a replay must not add a second work item")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Terminal is terminal. Reopening cancelled work, completing it after the fact,
// or committing twice would each let the same outcome be counted again under a
// fresh accounting, which is exactly the laundering the contract forbids.
test("desk_work_ledger refuses illegal transitions and names the state it is in", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT },
    })

    const recommit = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "commit", work_item_id: item.work_item_id, ...COMMITMENT },
    })
    assert.equal(recommit.isError, true)
    assert.match(body(recommit).message, /already committed/iu)

    await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "close", work_item_id: item.work_item_id, state: "cancelled", reason: "Superseded." },
    })

    for (const input of [
      {
        action: "complete",
        work_item_id: item.work_item_id,
        endpoint: COMMITMENT.delivery_endpoint,
        evidence: "Landed after all.",
      },
      // Both of these are otherwise well-formed calls. If they were malformed,
      // a field-validation refusal would satisfy the assertion below without
      // the terminal-state guard ever running, and the test would prove
      // nothing about closure.
      {
        action: "scope_change",
        work_item_id: item.work_item_id,
        kind: "widened",
        change: "Widen it.",
        reason: "The operator asked for more.",
        agreed_by: "operator",
      },
      {
        action: "phase",
        work_item_id: item.work_item_id,
        phase: "implementation",
        started_at: "2026-09-08T18:00:00.000Z",
        ended_at: "2026-09-08T18:10:00.000Z",
      },
    ]) {
      const refused = await ledger({ deskRoot: fixture.deskRoot, input })
      assert.equal(refused.isError, true, `${input.action} must be refused on a cancelled item`)
      assert.match(body(refused).message, /cancelled/iu)
    }

    const still = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "inspect", work_item_id: item.work_item_id } }),
    )
    assert.equal(still.work_item.state, "cancelled")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Correction is an owner right, and it stops at the boundary of what was
// observed. An owner may fix what they declared; nobody may edit a measured
// observation into saying something the source never said.
test("desk_work_ledger corrects declared fields only and never rewrites measured provenance", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture, "Ship the intkae queue.")
    const fixed = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "correct",
          work_item_id: item.work_item_id,
          field: "request",
          value: "Ship the intake queue.",
          // The revision the caller read. Without it the concurrency check is
          // something a caller can simply decline.
          expected_revision: item.revision,
          reason: "Typo in the original request.",
        },
      }),
    )
    assert.equal(fixed.status, "corrected")
    assert.equal(fixed.work_item.request, "Ship the intake queue.")
    assert.equal(fixed.correction.class, "declared")
    assert.match(fixed.correction.reason, /typo/iu)

    const inspected = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "inspect", work_item_id: item.work_item_id } }),
    )
    assert.equal(inspected.corrections.length, 1, "a correction is recorded, not applied silently")
    assert.equal(inspected.corrections[0].previous_value, "Ship the intkae queue.")

    for (const field of ["input_tokens", "source_event_id", "observed_through", "machine_id", "state"]) {
      const refused = await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "correct",
          work_item_id: item.work_item_id,
          field,
          value: "anything",
          expected_revision: fixed.work_item.revision,
          reason: "Trying to reach a measured field.",
        },
      })
      assert.equal(refused.isError, true, `${field} must not be correctable`)
      assert.match(body(refused).message, /not correctable|declared/iu)
    }
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Deletion has to be complete and it has to be honest: the payload goes, in
// every table that referenced it and in both link directions, and what remains
// is a content-free note that coverage shrank.
test("desk_work_ledger deletion clears every dependent row and leaves a content-free tombstone", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const parent = await intake(fixture, "Parent outcome.")
    const child = await intake(fixture, "Child outcome.")

    // Every setup call is asserted. A deletion witness that assumed rows exist
    // would pass just as well against an implementation that never wrote them.
    const ok = async (input, expected) => {
      const result = await ledger({ deskRoot: fixture.deskRoot, input })
      assert.equal(result.isError, undefined, `${input.action} setup failed: ${result.content?.[0]?.text}`)
      const parsed = body(result)
      if (expected !== undefined) assert.equal(parsed.status, expected, `${input.action} status`)
      return parsed
    }

    // Seed every remaining table a work item can own, so the removal list below
    // is a claim about populated rows rather than about empty ones.
    await ok(
      {
        action: "size",
        work_item_id: child.work_item_id,
        work_type: "feature",
        scope: "one module",
        systems: ["queue"],
        uncertainty: "low",
        risk: "low",
        verification: "replay test",
      },
      "size_recorded",
    )

    for (const id of [parent.work_item_id, child.work_item_id]) {
      await ok({ action: "commit", work_item_id: id, ...COMMITMENT }, "committed")
      await ok(
        {
          action: "phase",
          work_item_id: id,
          phase: "implementation",
          cycle: "c1",
          started_at: "2026-09-08T09:00:00.000Z",
          ended_at: "2026-09-08T10:00:00.000Z",
        },
        "phase_recorded",
      )
    }

    const corrected = await ok(
      {
        action: "correct",
        work_item_id: child.work_item_id,
        field: "request",
        value: "Child outcome, restated.",
        expected_revision: child.revision,
        reason: "Sharper wording.",
      },
      "corrected",
    )
    assert.equal(corrected.work_item.request, "Child outcome, restated.")
    await ok(
      {
        action: "scope_change",
        work_item_id: child.work_item_id,
        kind: "widened",
        change: "Restart path added.",
        reason: "The operator asked for it.",
        agreed_by: "operator",
      },
      "scope_change_recorded",
    )
    await ok(
      {
        action: "cost_basis",
        work_item_id: child.work_item_id,
        amount: 4.2,
        currency: "USD",
        rate: 1,
        rate_unit: "request_multiplier",
        source: "an internal rate card",
        effective_date: "2026-09-01",
      },
      "cost_basis_recorded",
    )
    // Replaced once, so the revision-checked replacement path is populated too.
    await ok(
      {
        action: "cost_basis",
        work_item_id: child.work_item_id,
        amount: 5.5,
        currency: "USD",
        rate: 1,
        rate_unit: "request_multiplier",
        source: "a corrected internal rate card",
        effective_date: "2026-09-02",
        expected_revision: 1,
      },
      "cost_basis_replaced",
    )
    await ok(
      {
        action: "link_evaluation_receipt",
        work_item_id: child.work_item_id,
        measurement_kind: "offline_evaluation",
        receipt_ref: "sha256:deadbeef",
        status: "complete",
        grade: "pass",
        availability: "available",
      },
      "evaluation_receipt_linked",
    )
    await ok(
      {
        action: "link",
        work_item_id: child.work_item_id,
        related_work_item_id: parent.work_item_id,
        relation: "follow_on",
      },
      "linked",
    )
    const imported = await ok(
      {
        action: "import_usage",
        work_item_id: child.work_item_id,
        source: "copilot_local_session_records",
        session_id: SESSION_ID,
      },
      "usage_imported",
    )
    assert.ok(imported.imported_events > 0, "the import must actually record observations")
    await ok(
      {
        action: "complete",
        work_item_id: child.work_item_id,
        endpoint: COMMITMENT.delivery_endpoint,
        evidence: "Replay output captured on the task card.",
      },
      "completed",
    )

    const deleted = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "delete", work_item_id: child.work_item_id, confirm: true },
      }),
    )
    assert.equal(deleted.status, "deleted")

    const gone = await ledger({
      deskRoot: fixture.deskRoot,
      input: { action: "inspect", work_item_id: child.work_item_id },
    })
    assert.equal(gone.isError, true)
    assert.match(body(gone).message, /no work item/iu)

    // Every dependent row goes with it, and the link is gone from the surviving
    // side too — a dangling reference would re-expose what was deleted.
    assert.deepEqual(deleted.removed_rows.sort((a, b) => a.table.localeCompare(b.table)).map((r) => r.table), [
      "commitments",
      "completions",
      "corrections",
      "cost_bases",
      "evaluations",
      "imports",
      "phases",
      "scope_changes",
      "session_bindings",
      "sizings",
      "usage_events",
      "work_item_links",
      "work_items",
    ])
    for (const row of deleted.removed_rows) {
      assert.ok(row.count > 0, `${row.table} was reported removed but held no rows`)
    }
    const survivor = body(
      await ledger({ deskRoot: fixture.deskRoot, input: { action: "inspect", work_item_id: parent.work_item_id } }),
    )
    assert.deepEqual(survivor.links, [], "the reverse link direction must be cleared as well")

    // What is left says only that something was removed and when.
    const report = body(await ledger({ deskRoot: fixture.deskRoot, input: { action: "report" } }))
    assert.equal(report.coverage.deleted_items.count, 1)
    assert.match(report.coverage.deleted_items.last_deleted_at, /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal(
      JSON.stringify(report.coverage.deleted_items).includes("Child outcome."),
      false,
      "a tombstone must not retain the deleted request text",
    )
    assert.equal(report.coverage.complete.class, "unavailable")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// Refusing a late size proves the guard fires; it does not prove the size that
// was accepted came before the work. A reader who wants to know whether an
// estimate was honest needs the sizing time itself, next to the first evidence
// of execution, so the ordering can be checked rather than trusted. Usage rows
// are execution evidence too, not only declared phases.
test("desk_work_ledger records when sizing happened and exposes it against the first execution", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    const item = await intake(fixture)
    const sized = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: {
          action: "size",
          work_item_id: item.work_item_id,
          work_type: "implementation",
          scope: "one module",
          systems: ["desk-mcp"],
          uncertainty: "unknown",
          risk: "low",
          verification: "unit tests plus an operator replay",
        },
      }),
    )
    assert.match(
      sized.size.recorded_at,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
      "a size with no recorded time cannot be shown to precede anything",
    )

    const inspected = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: item.work_item_id },
      }),
    )
    assert.equal(inspected.size.recorded_at, sized.size.recorded_at)
    // Nothing has executed yet, so there is no first-execution stamp to compare
    // against, and the ledger says that rather than implying the size was early.
    assert.equal(inspected.size.first_execution_at, null)
    assert.equal(inspected.size.preceded_execution, null)

    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "phase",
        work_item_id: item.work_item_id,
        phase: "implementation",
        started_at: "2026-09-08T18:10:00.000Z",
        ended_at: "2026-09-08T18:40:00.000Z",
      },
    })

    const afterPhase = body(
      await ledger({
        deskRoot: fixture.deskRoot,
        input: { action: "inspect", work_item_id: item.work_item_id },
      }),
    )
    assert.equal(afterPhase.size.first_execution_at, "2026-09-08T18:10:00.000Z")
    assert.equal(typeof afterPhase.size.preceded_execution, "boolean")
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})

// The contract refuses a late size "once a phase or usage row exists". Only the
// phase half was pinned, so an item whose execution evidence arrived as imported
// usage could still be resized afterwards.
test("desk_work_ledger refuses a late size when execution evidence is imported usage", async () => {
  const fixture = await mkLedgerFixture()
  const restore = useHostEnv(fixture)
  try {
    writeSessionRecords(fixture.sourcePath, baseRecords())
    const item = await intake(fixture)
    await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "import_usage",
        work_item_id: item.work_item_id,
        source: "copilot_local_session_records",
        session_id: SESSION_ID,
      },
    })

    const late = await ledger({
      deskRoot: fixture.deskRoot,
      input: {
        action: "size",
        work_item_id: item.work_item_id,
        work_type: "implementation",
        scope: "bigger than we thought",
        systems: ["desk-mcp"],
        uncertainty: "high",
        risk: "high",
        verification: "unit tests",
      },
    })
    assert.equal(late.isError, true, "imported usage is execution evidence, not a neutral record")
    assert.match(body(late).message, /before execution/iu)
  } finally {
    restore()
    await cleanup(fixture.base)
  }
})
