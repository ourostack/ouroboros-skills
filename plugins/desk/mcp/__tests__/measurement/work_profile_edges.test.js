import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { buildWorkProfile, renderWorkProfile } from "../../src/measurement/work-profile.js"

const time = (second) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`
const hash = (value) => createHash("sha256").update(value).digest("hex")
function event(id, kind, second, agent, fields = {}) {
  return { fact_id: id, kind, timestamp: time(second), native_session_id: "session-a", agent_id: agent, source_ref: { source_id: "events-a", native_session_id: "session-a", event_id: id, record_sha256: hash(id) }, fields }
}
function fixture() {
  const dispatched = event("dispatch", "tool.execution_start", 0, null, { toolCallId: "dispatch-a" })
  const started = { ...event("start", "subagent.started", 1, "worker-a", { toolCallId: "dispatch-a" }), dispatch_tool_call_id: "dispatch-a", structural_parent_agent_id: null }
  const returned = { ...event("return", "tool.execution_complete", 2, null, { toolCallId: "dispatch-a" }), returned_agent_id: "worker-a" }
  return { schema_version: 1, binding: { native_session_id: "session-a", root_agent_id: "worker-a", dispatch_tool_call_id: "dispatch-a", title: "Synthetic job", work_item_id: null, task_ref: null }, facts: [dispatched, started, returned] }
}
const profile = (input) => buildWorkProfile(Buffer.from(JSON.stringify(input)))
function row(id, dimensions = {}) {
  return {
    ...event(`row-${id}`, "model.usage_observation", 30, "worker-a"),
    source_ref: { source_id: "rows-a", native_session_id: "session-a", row_id: id },
    parent_tool_call_id: "dispatch-a", native_history_turn_index: null, usage: dimensions,
  }
}

test("refuse reversed root dispatch, rooted cycles and explicitly null annotations", () => {
  const input = fixture()
  input.facts[2].timestamp = "2025-12-31T23:59:59.000Z"
  assert.throws(() => profile(input), /reversed interval/i)
  const cycle = fixture()
  cycle.facts[0].agent_id = "worker-b"
  cycle.facts[2].agent_id = "worker-b"
  cycle.facts.push({ ...event("child", "subagent.started", 3, "worker-b", { toolCallId: "dispatch-b" }), structural_parent_agent_id: "worker-a" })
  assert.throws(() => profile(cycle), /lineage/i)
  for (const name of ["episodes", "outcome"]) assert.throws(() => profile({ ...fixture(), [name]: null }), /annotation/i)
})

test("record key reordering cannot change deduplicated output beyond the input byte hash", () => {
  const input = fixture()
  const original = row(1, { input_tokens: { value: 1, unit: "tokens" }, output_tokens: { value: 2, unit: "tokens" } })
  original.ignored = ["inert", { nested: "metadata" }]
  input.facts.push(original, { ...original, usage: Object.fromEntries(Object.entries(original.usage).reverse()) })
  const first = profile(input)
  input.facts.reverse()
  const second = profile(input)
  delete first.source_snapshot_sha256
  delete second.source_snapshot_sha256
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})

test("retained events state timestamp semantics and retain predecessor references without treating them as ancestry", () => {
  const input = fixture()
  input.facts[1].source_event_parent_id = "foreign-predecessor"
  input.facts.push(row(1))
  const p = profile(input)
  assert.equal(p.observations.events.find((f) => f.fact_id === "start").source_event_parent_id, "foreign-predecessor")
  assert.equal(p.observations.events.find((f) => f.fact_id === "row-1").timestamp_semantics, "usage_row_creation_not_execution")
  assert.equal(p.observations.events.find((f) => f.fact_id === "start").timestamp_semantics, "native_event_timestamp")
})

test("valid sparse metadata, native pointers, unknown lineage and repeated source groups remain explicit", () => {
  const input = fixture()
  const child = event("orphan", "subagent.started", 5, "worker-orphan", { toolCallId: "dispatch-orphan" })
  input.facts.push(child)
  const first = event("turn-start", "assistant.turn_start", 3, "worker-a", { turnId: 0 })
  const last = event("turn-end", "assistant.turn_end", 4, "worker-a", { turnId: 0 })
  first.source_ref.line = 3
  first.source_ref.byte_offset = 20
  first.source_ref.byte_length = 80
  last.source_ref.line = 4
  const sameLine = event("system-message", "system.message", 3, "worker-a")
  sameLine.source_ref.line = 3
  delete sameLine.fields
  input.facts.push(first, last, sameLine, row(1), row(2, { duration_ms: { value: 1.5, unit: "milliseconds" } }))
  const p = profile(input)
  assert.equal(p.observations.operations.assistant_step.spans[0].interaction, 0)
  assert.equal(p.observations.usage.groups.length, 1)
  assert.equal(p.observations.usage.groups[0].model, null)
  assert.equal(p.observations.usage.dimensions.duration_ms.value, 1.5)
  assert.equal(p.observations.agents.length, 1)
  input.facts.push({ ...event("configured", "subagent.configured", 3, "worker-a"), dispatch_tool_call_id: "dispatch-a" })
  assert.ok(profile(input))
})

test("markdown renders sparse observations, provenance-labelled episodes and all source metadata safely", () => {
  assert.match(renderWorkProfile(profile(fixture()), "markdown"), /unknown/)
  const input = fixture()
  input.episodes = [
    { episode_id: "b", label: "Scope correction", class: "inferred", fact_ids: ["start"], evidence_refs: ["declared:one"], output_refs: [] },
    { episode_id: "a", label: "Initial work", class: "declared", fact_ids: ["start"], evidence_refs: ["declared:two"], output_refs: [] },
  ]
  input.outcome = { acceptance: "declared", status: "not_accepted", evidence_refs: ["declared:receipt"], artifact_refs: [] }
  const p = profile(input)
  assert.deepEqual(p.episodes.map((e) => e.episode_id), ["a", "b"])
  assert.match(renderWorkProfile(p, "markdown"), /Scope correction/)
  p.binding.title = "a".repeat(32 * 1024 * 1024)
  for (const format of ["json", "markdown"]) assert.throws(() => renderWorkProfile(p, format), /output limit/i)
})

test("malformed native usage and ambiguous operation endpoints reject at the actual CLI stdout boundary", (t) => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-profile-cli-")))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const filename = path.join(directory, "input.json")
  const script = fileURLToPath(new URL("../../scripts/profile-work.js", import.meta.url))
  const invalid = []
  const counters = fixture()
  counters.facts.push(row(1, { input_tokens: { value: -1, unit: "tokens" } }))
  invalid.push(counters)
  const duplicate = fixture()
  duplicate.facts.push({ ...duplicate.facts[0], timestamp: time(3) })
  invalid.push(duplicate)
  const reverse = fixture()
  reverse.facts.push(event("tool-start", "tool.execution_start", 5, "worker-a", { toolCallId: "tool-a" }), event("tool-end", "tool.execution_complete", 4, "worker-a", { toolCallId: "tool-a" }))
  invalid.push(reverse)
  const tooMany = fixture()
  tooMany.facts = Array(10001).fill(tooMany.facts[0])
  invalid.push(tooMany)
  for (const input of invalid) {
    fs.writeFileSync(filename, JSON.stringify(input))
    const result = spawnSync(process.execPath, [script, "--input", filename, "--format", "json"], { encoding: "utf8" })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, /profile-work:/)
  }
})
