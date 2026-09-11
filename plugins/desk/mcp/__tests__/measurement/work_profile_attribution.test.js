import { test } from "node:test"
import { strict as assert } from "node:assert"
import { buildWorkProfile } from "../../src/measurement/work-profile.js"

function snapshot() {
  const fact = (id, kind, agent_id, fields, extra = {}) => ({
    fact_id: id, kind, agent_id, fields, ...extra,
    native_session_id: "session-a", timestamp: "2026-01-01T00:00:00Z",
    source_ref: { source_id: "events-a", native_session_id: "session-a", event_id: id },
  })
  return {
    schema_version: 1,
    binding: { native_session_id: "session-a", root_agent_id: "worker-a", dispatch_tool_call_id: "dispatch-a", title: "Synthetic attribution", work_item_id: null, task_ref: null },
    facts: [
      fact("dispatch", "tool.execution_start", null, { toolCallId: "dispatch-a" }),
      fact("started", "subagent.started", "worker-a", { toolCallId: "dispatch-a" }),
      fact("returned", "tool.execution_complete", null, { toolCallId: "dispatch-a" }, { returned_agent_id: "worker-a" }),
      fact("null-child", "subagent.started", null, { toolCallId: "dispatch-b" }, { structural_parent_agent_id: "worker-a" }),
    ],
  }
}

test("a null descendant identity cannot admit unallocated parent context", () => {
  assert.throws(() => buildWorkProfile(Buffer.from(JSON.stringify(snapshot()))), /subagent.*identity/i)
})

test("ambiguous equal-time interaction boundaries cannot manufacture assistant-step intervals", () => {
  const input = snapshot()
  input.facts.pop()
  const base = { ...input.facts[1], agent_id: "worker-a" }
  for (const [id, kind] of [["a", "assistant.turn_start"], ["b", "user.message"], ["c", "assistant.turn_end"]]) {
    input.facts.push({ ...base, fact_id: id, kind, fields: { turnId: "0" }, source_ref: { ...base.source_ref, event_id: id } })
  }
  // A timestamp tie without a native sequence cannot prove which interaction owns the endpoints. It must be refused, not ordered using arbitrary IDs.
  assert.throws(() => buildWorkProfile(Buffer.from(JSON.stringify(input))), /ambiguous.*interaction/i)
  for (const [index, fact] of input.facts.entries()) fact.source_ref.line = index + 1
  assert.equal(buildWorkProfile(Buffer.from(JSON.stringify(input))).observations.operations.assistant_step.matched, 0)
  input.facts[3].source_ref.line = input.facts[4].source_ref.line
  assert.throws(() => buildWorkProfile(Buffer.from(JSON.stringify(input))), /ambiguous.*interaction/i)
})
