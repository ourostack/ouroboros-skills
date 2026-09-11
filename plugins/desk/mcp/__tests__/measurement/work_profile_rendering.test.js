import { test } from "node:test"
import { strict as assert } from "node:assert"
import { buildWorkProfile, renderWorkProfile } from "../../src/measurement/work-profile.js"

test("reading summaries label missing endpoints and preserve supplied declared binding references", () => {
  const fact = (id, kind, agent_id, fields, extra = {}) => ({
    fact_id: id, kind, agent_id, fields, ...extra,
    native_session_id: "session-a", timestamp: "2026-01-01T00:00:00Z",
    source_ref: { source_id: "events-a", native_session_id: "session-a", event_id: id },
  })
  const input = {
    schema_version: 1,
    binding: { native_session_id: "session-a", root_agent_id: "worker-a", dispatch_tool_call_id: "dispatch-a", title: "Synthetic partial work", work_item_id: "work-a", task_ref: "task:synthetic-work" },
    facts: [
      fact("dispatch", "tool.execution_start", null, { toolCallId: "dispatch-a" }),
      fact("started", "subagent.started", "worker-a", { toolCallId: "dispatch-a" }),
      fact("returned", "tool.execution_complete", null, { toolCallId: "dispatch-a" }, { returned_agent_id: "worker-a" }),
      fact("unfinished", "tool.execution_start", "worker-a", { toolCallId: "unfinished-call" }),
      fact("orphan-hook", "hook.end", "worker-a", { hookInvocationId: "orphan-hook-call" }),
      fact("orphan-return", "tool.execution_complete", "worker-a", { toolCallId: "orphan-call" }),
    ],
  }
  const profile = buildWorkProfile(Buffer.from(JSON.stringify(input)))
  const markdown = renderWorkProfile(profile, "markdown")
  assert.ok(markdown.includes("| Tool calls | 0 | 1 | 1 |"))
  assert.ok(markdown.includes("| Hook callbacks | 0 | 1 | 0 |"))
  assert.ok(markdown.includes("| Tool calls | unknown | unknown |"))
  assert.ok(markdown.includes("| Transport status not reported | 1 |"))
  assert.ok(markdown.includes("| Underlying exit code not reported | 1 |"))
  assert.ok(markdown.includes("Declared work item: work-a. Canonical ledger identity: unverified."))
  assert.ok(markdown.includes("Declared task reference: task:synthetic-work"))
  assert.ok(markdown.includes("No episode annotations supplied"))
  assert.equal(profile.coverage.missing_operation_endpoints, 3)
})
