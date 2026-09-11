import { test } from "node:test"
import { strict as assert } from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildWorkProfile } from "../../src/measurement/work-profile.js"

const script = fileURLToPath(new URL("../../scripts/profile-work.js", import.meta.url))
const bytes = (value) => Buffer.from(JSON.stringify(value))
function fact(id, kind, agent, call, second, extra = {}) {
  return {
    fact_id: id, kind, agent_id: agent, native_session_id: "session-a",
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(),
    source_ref: { source_id: "events-a", native_session_id: "session-a", event_id: id },
    fields: { toolCallId: call }, ...extra,
  }
}
function snapshot() {
  return {
    schema_version: 1,
    binding: { native_session_id: "session-a", root_agent_id: "worker-a", dispatch_tool_call_id: "dispatch-a", title: "Synthetic review case", work_item_id: null, task_ref: null },
    facts: [
      fact("dispatch", "tool.execution_start", null, "dispatch-a", 0),
      fact("started", "subagent.started", "worker-a", "dispatch-a", 1),
      fact("returned", "tool.execution_complete", null, "dispatch-a", 2, { returned_agent_id: "worker-a" }),
    ],
  }
}
function cli(t, input, format = "json") {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-profile-review-")))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, "snapshot.json")
  fs.writeFileSync(filename, Buffer.isBuffer(input) ? input : bytes(input))
  return spawnSync(process.execPath, [script, "--input", filename, "--format", format], { encoding: "utf8" })
}
function accepted(t, input) {
  const result = cli(t, input)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, "")
  return JSON.parse(result.stdout)
}
function refused(t, input, diagnostic) {
  for (const format of ["json", "markdown"]) {
    const result = cli(t, input, format)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, diagnostic)
  }
}

test("root completion uniqueness includes contradictory returns before checking the returned agent", (t) => {
  for (const returned_agent_id of ["worker-other", null, undefined]) {
    const input = snapshot()
    input.facts.push(fact("second-return", "tool.execution_complete", null, "dispatch-a", 2, { returned_agent_id }))
    refused(t, input, /root binding/i)
    input.facts.reverse()
    refused(t, input, /root binding/i)
  }
})

test("root completion matching remains source, session, owning-agent and call scoped", (t) => {
  const input = snapshot()
  input.facts.push(
    fact("other-owner-return", "tool.execution_complete", "worker-other", "dispatch-a", 2, { returned_agent_id: "worker-other" }),
    fact("other-call-return", "tool.execution_complete", null, "other-call", 2),
  )
  const otherSource = fact("other-source-return", "tool.execution_complete", null, "dispatch-a", 2)
  otherSource.source_ref.source_id = "events-b"
  const otherSession = fact("other-session-return", "tool.execution_complete", null, "dispatch-a", 2)
  otherSession.native_session_id = otherSession.source_ref.native_session_id = "session-b"
  input.facts.push(otherSource, otherSession)
  assert.equal(accepted(t, input).observations.agents.length, 1)
})

function sharedCalls() {
  const input = snapshot()
  input.facts.push(
    fact("dispatch-b", "tool.execution_start", "worker-a", "dispatch-b", 3),
    fact("started-b", "subagent.started", "worker-b", "dispatch-b", 4, { structural_parent_agent_id: "worker-a" }),
    fact("returned-b", "tool.execution_complete", "worker-a", "dispatch-b", 5, { returned_agent_id: "worker-b" }),
    fact("dispatch-c", "tool.execution_start", "worker-a", "shared-call", 6),
    fact("dispatch-d", "tool.execution_start", "worker-b", "shared-call", 7),
    fact("started-c", "subagent.started", "worker-c", "shared-call", 8, { structural_parent_agent_id: "worker-a" }),
    fact("started-d", "subagent.started", "worker-d", "shared-call", 8, { structural_parent_agent_id: "worker-b" }),
    fact("returned-c", "tool.execution_complete", "worker-a", "shared-call", 9, { returned_agent_id: "worker-c" }),
    fact("returned-d", "tool.execution_complete", "worker-b", "shared-call", 10, { returned_agent_id: "worker-d" }),
  )
  return input
}
test("structural parents disambiguate reused dispatch call IDs and keep only the correct owner evidence", (t) => {
  const input = sharedCalls()
  const p = accepted(t, input)
  assert.deepEqual(p.observations.agents.map((a) => [a.agent_id, a.parent_agent_id]), [
    ["worker-a", null], ["worker-b", "worker-a"], ["worker-c", "worker-a"], ["worker-d", "worker-b"],
  ])
  assert.deepEqual(p.observations.agents[2].evidence_fact_ids, ["dispatch-c", "started-c"])
  assert.deepEqual(p.observations.agents[3].evidence_fact_ids, ["dispatch-d", "started-d"])
  assert.equal(p.observations.operations.tool.matched, 3)
  assert.equal(p.observations.operations.tool.summed_latency_ms, 8000)
  assert.equal(p.observations.operations.tool.interval_union_ms, 6000)
  input.facts.reverse()
  const reversed = accepted(t, input)
  delete p.source_snapshot_sha256
  delete reversed.source_snapshot_sha256
  assert.deepEqual(p, reversed)
})

test("structural parent evidence survives a missing own dispatch and an unrelated call-ID reuse", (t) => {
  const input = snapshot()
  input.facts.push(
    fact("started-b", "subagent.started", "worker-b", "shared-call", 3, { structural_parent_agent_id: "worker-a" }),
    fact("unrelated-dispatch", "tool.execution_start", "worker-other", "shared-call", 3),
  )
  assert.deepEqual(accepted(t, input).observations.agents[1], {
    agent_id: "worker-b", parent_agent_id: "worker-a", dispatch_tool_call_id: "shared-call", evidence_fact_ids: ["started-b"],
  })
})

test("root dispatch reuse also resolves by its supplied structural parent", (t) => {
  const input = snapshot()
  input.facts[0].agent_id = input.facts[2].agent_id = "parent-a"
  input.facts[1].structural_parent_agent_id = "parent-a"
  input.facts.push(fact("unrelated-dispatch", "tool.execution_start", "parent-b", "dispatch-a", 0))
  assert.equal(accepted(t, input).observations.agents[0].parent_agent_id, "parent-a")
})

test("owner scoping preserves unknown-parent ambiguity, duplicate endpoints, conflicting children and cycles", (t) => {
  for (const absentParent of [null, undefined]) {
    const input = sharedCalls()
    input.facts.find((f) => f.fact_id === "started-c").structural_parent_agent_id = absentParent
    refused(t, input, /ambiguous dispatch lineage/i)
  }
  const duplicateStart = sharedCalls()
  duplicateStart.facts.push(fact("same-owner-start", "tool.execution_start", "worker-a", "shared-call", 6))
  refused(t, duplicateStart, /ambiguous dispatch lineage/i)
  const duplicateEnd = sharedCalls()
  duplicateEnd.facts.push(fact("same-owner-end", "tool.execution_complete", "worker-a", "shared-call", 9, { returned_agent_id: "worker-other" }))
  refused(t, duplicateEnd, /ambiguous operation endpoint/i)
  const conflictingChild = sharedCalls()
  conflictingChild.facts.push(fact("conflicting-child", "subagent.started", "worker-c", "shared-call", 8, { structural_parent_agent_id: "worker-b" }))
  refused(t, conflictingChild, /lineage/i)
  const cycle = snapshot()
  cycle.facts[0].agent_id = cycle.facts[2].agent_id = "worker-b"
  cycle.facts[1].structural_parent_agent_id = "worker-b"
  cycle.facts.push(fact("cycle", "subagent.started", "worker-b", "dispatch-b", 3, { structural_parent_agent_id: "worker-a" }))
  refused(t, cycle, /cyclic rooted agent lineage/i)
})

function collidingLines(userId, userSecond = 4) {
  const input = snapshot()
  input.facts[1].source_ref.line = 1
  for (const [id, kind, second, line] of [
    ["z-start", "assistant.turn_start", 3, 3],
    [userId, "user.message", userSecond, 3],
    ["zz-end", "assistant.turn_end", 5, 4],
  ]) {
    const next = fact(id, kind, "worker-a", "unused", second, { fields: { turnId: "0" } })
    next.source_ref.line = line
    input.facts.push(next)
  }
  return input
}
test("colliding native lines use timestamps instead of event IDs across interaction resets", (t) => {
  for (const userId of ["a-user", "zz-user"]) {
    const input = collidingLines(userId)
    for (let order = 0; order < 2; order++) {
      const p = accepted(t, input)
      assert.equal(p.observations.operations.assistant_step.matched, 0)
      assert.equal(p.coverage.missing_operation_endpoints, 2)
      assert.equal(p.observations.operations.assistant_step.summed_latency_ms, null)
      input.facts.reverse()
    }
  }
})
test("equal-time colliding interaction lines still refuse instead of falling back to event IDs", (t) => {
  refused(t, collidingLines("a-user", 3), /ambiguous.*interaction/i)
})
test("unique native sequence remains decisive even when timestamps tie", (t) => {
  const input = collidingLines("a-user", 3)
  input.facts.find((f) => f.fact_id === "a-user").source_ref.line = 2
  assert.equal(accepted(t, input).observations.operations.assistant_step.matched, 1)
})

function numericBytes(first, second, reverse = false) {
  const input = snapshot()
  input.facts[1].ignored_numeric = "NUMBER_A"
  input.facts.push({ ...input.facts[1], fact_id: "alias", ignored_numeric: "NUMBER_B" })
  if (reverse) input.facts.reverse()
  return Buffer.from(JSON.stringify(input).replace('"NUMBER_A"', first).replace('"NUMBER_B"', second))
}
for (const [name, first, second] of [
  ["non-finite exponent versus null", "1e400", "null"],
  ["negative non-finite exponent versus null", "-1e400", "null"],
  ["unsafe integer metadata", "9007199254740993", "9007199254740992"],
  ["negative unsafe integer metadata", "-9007199254740993", "-9007199254740992"],
]) {
  test(`raw bytes refuse ${name} before lossy duplicate canonicalization`, (t) => {
    for (const reverse of [false, true]) {
      const input = numericBytes(first, second, reverse)
      refused(t, input, /numeric|finite/i)
      assert.throws(() => buildWorkProfile(input), /numeric|finite/i)
    }
  })
}
test("safe numeric metadata and fractional usage keep existing numeric semantics", (t) => {
  for (const [first, second] of [["1", "1.0"], ["0.5", "5e-1"], ["-9007199254740991", "-9007199254740991"]]) {
    const p = accepted(t, numericBytes(first, second))
    assert.equal(p.coverage.duplicate_facts, 1)
    assert.equal(p.observations.events.find((f) => f.fact_id === "alias").ignored_numeric, undefined)
  }
  const input = snapshot()
  input.facts.push({
    ...fact("usage", "model.usage_observation", "worker-a", "unused", 6),
    source_ref: { source_id: "rows-a", native_session_id: "session-a", row_id: 1 },
    parent_tool_call_id: "dispatch-a", native_history_turn_index: 4, model: "model-a", initiator: "agent",
    usage: { duration_ms: { value: 1.5, unit: "milliseconds" }, request_multiplier: { value: 0.5, unit: "native_request_multiplier" }, input_tokens: { value: null, unit: "tokens" } },
  })
  const p = accepted(t, input)
  assert.equal(p.observations.usage.dimensions.duration_ms.value, 1.5)
  assert.equal(p.observations.usage.dimensions.request_multiplier.value, 0.5)
  assert.equal(p.observations.usage.dimensions.input_tokens.value, null)
})
