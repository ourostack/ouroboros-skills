import { test, mock } from "node:test"
import { strict as assert } from "node:assert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { buildWorkProfile, renderWorkProfile } from "../../src/measurement/work-profile.js"
import { readProfileInput, MAX_INPUT_BYTES } from "../../src/measurement/profile-input.js"

const hash = (value) => createHash("sha256").update(value).digest("hex")
const bytes = (value) => Buffer.from(JSON.stringify(value))
const instant = (seconds) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()
const script = fileURLToPath(new URL("../../scripts/profile-work.js", import.meta.url))
function fact(id, kind, time, agent = "worker-a", fields = {}, extra = {}) {
  return {
    fact_id: id, kind, agent_id: agent, native_session_id: "session-a",
    timestamp: instant(time),
    source_ref: { source_id: "events-a", native_session_id: "session-a", event_id: id, record_sha256: hash(id) },
    fields, ...extra,
  }
}
function usage(id, agent, call, usage = {}, extra = {}) {
  return fact(id, "model.usage_observation", 500, agent, {}, {
    source_ref: { source_id: "rows-a", native_session_id: "session-a", row_id: Number(id.slice(1)), snapshot_row_sha256: hash(id), logical_table: "usage_rows" },
    parent_tool_call_id: call, native_history_turn_index: 4,
    model: "model-a", initiator: "agent", usage, ...extra,
  })
}
const dimension = (value, unit = "tokens") => ({ value, unit })
function snapshot() {
  return {
    schema_version: 1,
    binding: { native_session_id: "session-a", root_agent_id: "worker-a", dispatch_tool_call_id: "dispatch-a", title: "Synthetic bounded job", work_item_id: null, task_ref: null },
    facts: [
      fact("dispatch", "tool.execution_start", 0, null, { toolCallId: "dispatch-a", toolName: "task" }),
      fact("started", "subagent.started", 1, "worker-a", { toolCallId: "dispatch-a" }, { dispatch_tool_call_id: "dispatch-a", structural_parent_agent_id: null, source_event_parent_id: "foreign-event" }),
      fact("returned", "tool.execution_complete", 2, null, { toolCallId: "dispatch-a" }, { returned_agent_id: "worker-a", status: "success" }),
    ],
  }
}
function richSnapshot() {
  const input = snapshot()
  input.facts.push(
    fact("user-1", "user.message", 3),
    fact("turn-1-start", "assistant.turn_start", 4, "worker-a", { turnId: "0", interactionId: "interaction-a" }),
    fact("tool-1-start", "tool.execution_start", 5, "worker-a", { toolCallId: "tool-a", toolName: "command" }),
    fact("hook-1-start", "hook.start", 6, "worker-a", { hookInvocationId: "hook-a", parentToolCallId: "tool-a" }),
    fact("hook-1-end", "hook.end", 7, "worker-a", { hookInvocationId: "hook-a" }, { status: "success" }),
    fact("child-dispatch", "tool.execution_start", 7, "worker-a", { toolCallId: "dispatch-b", toolName: "task" }),
    fact("child-started", "subagent.started", 8, "worker-b", { toolCallId: "dispatch-b" }),
    fact("child-returned", "tool.execution_complete", 9, "worker-a", { toolCallId: "dispatch-b" }, { returned_agent_id: "worker-b", status: "success" }),
    fact("tool-1-end", "tool.execution_complete", 10, "worker-a", { toolCallId: "tool-a" }, { status: "success", exit_code: 2 }),
    fact("turn-1-end", "assistant.turn_end", 11, "worker-a", { turnId: "0" }),
    fact("aggregate", "subagent.completed", 12, "worker-a", {}, { native_aggregate: { totalTokens: dimension(99), totalToolCalls: dimension(2, "tool_calls"), durationMs: dimension(10000, "milliseconds") } }),
    fact("user-2", "user.message", 13),
    fact("turn-2-start", "assistant.turn_start", 14, "worker-a", { turnId: "0" }),
    fact("message-1", "assistant.message", 15, "worker-a", { api_call_id_sha256: hash("same-call") }),
    fact("message-2", "assistant.message", 16, "worker-a", { api_call_id_sha256: hash("same-call") }),
    fact("turn-2-end", "assistant.turn_end", 17, "worker-a", { turnId: "0" }),
    fact("compaction", "session.compaction_complete", 18, "worker-a", {}, { usage: { inputTokens: dimension(100), duration: dimension(3, "native_duration_unit_unspecified") } }),
    fact("child-tool-start", "tool.execution_start", 6, "worker-b", { toolCallId: "child-tool" }),
    fact("child-tool-end", "tool.execution_complete", 9, "worker-b", { toolCallId: "child-tool" }, { status: "failure" }),
    fact("foreign-start", "tool.execution_start", 0, "foreign-worker", { toolCallId: "foreign-tool" }),
    fact("foreign-end", "tool.execution_complete", 90, "foreign-worker", { toolCallId: "foreign-tool" }),
    usage("u1", "worker-a", "dispatch-a", { input_tokens: dimension(10), output_tokens: dimension(null), cache_read_tokens: dimension(5), total_nano_aiu: dimension(100, "nano_aiu"), request_multiplier: dimension(0.5, "native_request_multiplier") }),
    usage("u2", "worker-b", "dispatch-b", { input_tokens: dimension(20), output_tokens: dimension(2) }, { model: "model-b", initiator: null }),
    usage("u3", "worker-a", "another-dispatch", { input_tokens: dimension(999) }),
    usage("u4", null, null, { input_tokens: dimension(999) }),
  )
  return input
}
const profile = (value = snapshot()) => buildWorkProfile(bytes(value))
function temporary(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-profile-test-")))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
function cli(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" })
}

test("binding requires native dispatch, completion and root start; ancestry ignores event predecessor", () => {
  const p = profile(richSnapshot())
  assert.equal(p.schema_version, 1)
  assert.equal(p.kind, "desk_work_profile")
  assert.equal(p.binding.class, "declared")
  assert.equal(p.binding.canonical_ledger_identity, "unverified")
  assert.deepEqual(p.binding.evidence_fact_ids, ["dispatch", "returned", "started"])
  assert.deepEqual(p.observations.agents.map((a) => a.agent_id), ["worker-a", "worker-b"])
  assert.equal(p.coverage.excluded_facts, 6)
  assert.equal(p.observations.usage.selected_rows, 2)
  assert.equal(p.observations.usage.dimensions.input_tokens.value, 30)
  for (const id of ["dispatch", "returned", "started"]) {
    const input = snapshot()
    input.facts = input.facts.filter((f) => f.fact_id !== id)
    assert.throws(() => profile(input), /root binding/i)
  }
  const wrong = snapshot()
  wrong.facts[2].returned_agent_id = "other-worker"
  assert.throws(() => profile(wrong), /root binding/i)
})

test("structural descendants are admitted, foreign sessions and contradictory parents are not", () => {
  const input = snapshot()
  input.facts.push(fact("child", "subagent.started", 3, "worker-b", { toolCallId: "dispatch-b" }, { structural_parent_agent_id: "worker-a" }))
  input.facts.push(usage("u1", "worker-b", "dispatch-b"))
  const foreign = fact("foreign-session", "subagent.started", 4, "worker-c", { toolCallId: "dispatch-c" }, { structural_parent_agent_id: "worker-a", native_session_id: "session-b" })
  foreign.source_ref.native_session_id = "session-b"
  input.facts.push(foreign)
  assert.deepEqual(profile(input).observations.agents.map((a) => a.agent_id), ["worker-a", "worker-b"])
  input.facts.push(fact("conflicting-owner", "tool.execution_start", 2, "worker-z", { toolCallId: "dispatch-b" }))
  assert.throws(() => profile(input), /lineage/i)
  const cycle = snapshot()
  cycle.facts.push(fact("root-again", "subagent.started", 5, "worker-a", { toolCallId: "different-call" }, { structural_parent_agent_id: "worker-a" }))
  assert.throws(() => profile(cycle), /lineage/i)
})

test("native identity dedup is order independent, alias aware, and rejects every conflicting duplicate", () => {
  const input = richSnapshot()
  const repeat = structuredClone(input.facts[4])
  repeat.fact_id = "alias"
  input.facts.push(repeat, structuredClone(repeat))
  const p = profile(input)
  assert.equal(p.coverage.duplicate_facts, 2)
  assert.equal(p.observations.events.find((f) => f.fact_ids.includes("alias")).fact_ids.length, 2)
  const reversed = structuredClone(input)
  reversed.facts.reverse()
  const q = profile(reversed)
  delete p.source_snapshot_sha256
  delete q.source_snapshot_sha256
  assert.deepEqual(p, q)
  for (const mutate of [
    (f) => { f.timestamp = instant(80) },
    (f) => { f.content = "not retained but conflicting" },
    (f) => { f.source_ref.record_sha256 = hash("changed") },
    (f) => { f.agent_id = "foreign-worker" },
  ]) {
    const copy = structuredClone(input)
    mutate(copy.facts.at(-1))
    assert.throws(() => profile(copy), /conflicting duplicate/i)
    copy.facts.reverse()
    assert.throws(() => profile(copy), /conflicting duplicate/i)
  }
  const aliasConflict = snapshot()
  aliasConflict.facts[1].fact_id = "dispatch"
  assert.throws(() => profile(aliasConflict), /fact_id/i)
  const rows = snapshot()
  rows.facts.push(usage("u1", "worker-a", "dispatch-a"), usage("u1", "worker-a", "dispatch-a", { input_tokens: dimension(1) }))
  assert.throws(() => profile(rows), /conflicting duplicate/i)
})

test("turn IDs reset per interaction; spans distinguish summed latency from interval union and messages", () => {
  const p = profile(richSnapshot())
  const steps = p.observations.operations.assistant_step
  assert.equal(steps.matched, 2)
  assert.equal(steps.summed_latency_ms, 10000)
  assert.equal(steps.interval_union_ms, 10000)
  assert.deepEqual(steps.spans.map((s) => s.interaction), [1, 2])
  assert.equal(p.observations.operations.tool.matched, 3)
  assert.equal(p.observations.operations.tool.summed_latency_ms, 10000)
  assert.equal(p.observations.operations.tool.interval_union_ms, 5000)
  assert.equal(p.observations.operations.hook.matched, 1)
  assert.equal(p.observations.operations.interval_union_ms, 10000)
  assert.equal(p.observations.model_calls.class, "unavailable")
  assert.equal(p.observations.assistant_messages, 2)
  assert.equal(p.observations.critical_path.class, "unavailable")
  const input = snapshot()
  input.facts.push(fact("end", "assistant.turn_end", 3, "worker-a", { turnId: "0" }))
  assert.equal(profile(input).observations.operations.assistant_step.unmatched_ends, 1)
})

test("missing endpoints are gaps and successful transport does not imply successful command", () => {
  const input = richSnapshot()
  input.facts.push(
    fact("missing-end", "tool.execution_start", 20, "worker-a", { toolCallId: "unfinished" }),
    fact("missing-start", "hook.end", 21, "worker-a", { hookInvocationId: "orphan" }),
    fact("zero-end", "tool.execution_complete", 22, "worker-a", { toolCallId: "zero" }, { exit_code: 0 }),
  )
  const p = profile(input)
  assert.equal(p.observations.operations.tool.unmatched_starts, 1)
  assert.equal(p.observations.operations.tool.unmatched_ends, 1)
  assert.equal(p.observations.operations.hook.unmatched_ends, 1)
  assert.equal(p.observations.operations.tool.spans.find((s) => s.operation_id === "unfinished").duration_ms, null)
  assert.equal(p.observations.operations.tool.spans.find((s) => s.operation_id === "tool-a").transport_status, "success")
  assert.equal(p.observations.operations.tool.spans.find((s) => s.operation_id === "tool-a").operation_status, "failure")
  assert.equal(p.observations.operations.tool.spans.find((s) => s.operation_id === "dispatch-b").operation_status, "unknown")
  assert.equal(p.observations.operations.tool.spans.find((s) => s.operation_id === "zero").operation_status, "success")
  assert.equal(p.coverage.missing_operation_endpoints, 3)
  input.facts.find((f) => f.fact_id === "tool-1-end").timestamp = instant(4)
  assert.throws(() => profile(input), /reversed interval/i)
  const ambiguous = richSnapshot()
  ambiguous.facts.push(fact("second-start", "tool.execution_start", 5, "worker-a", { toolCallId: "tool-a" }))
  assert.throws(() => profile(ambiguous), /ambiguous operation/i)
})

test("usage dimensions preserve unknowns, partial coverage, native units and separate aggregates", () => {
  const input = richSnapshot()
  const p = profile(input)
  const u = p.observations.usage
  assert.deepEqual(u.dimensions.input_tokens, { value: 30, unit: "tokens", known_rows: 2, unknown_rows: 0 })
  assert.deepEqual(u.dimensions.output_tokens, { value: 2, unit: "tokens", known_rows: 1, unknown_rows: 1 })
  assert.equal(u.dimensions.reasoning_tokens.value, null)
  assert.equal(u.dimensions.reasoning_tokens.unknown_rows, 2)
  assert.equal(u.dimensions.total_nano_aiu.unit, "nano_aiu")
  assert.equal(u.groups.length, 2)
  assert.equal(p.observations.aggregates[0].values.totalTokens.value, 99)
  assert.equal(p.observations.compactions[0].values.duration.unit, "native_duration_unit_unspecified")
  assert.match(p.observations.aggregates[0].caution, /not final/i)
  assert.match(p.observations.compactions[0].caution, /overlap/i)
  assert.equal(p.outcome.acceptance, "unassessed")
  assert.equal(p.outcome.status, "unknown")
  assert.equal(profile().observations.usage.dimensions.input_tokens.value, null)
  assert.equal(profile().observations.operations.tool.interval_union_ms, null)
  const row = input.facts.find((f) => f.fact_id === "u1")
  row.usage.input_tokens = dimension(Number.MAX_SAFE_INTEGER)
  assert.throws(() => profile(input), /safe|overflow/i)
})

test("episodes cite actual facts without allocating tokens or claiming defect rework or acceptance", () => {
  const input = richSnapshot()
  input.source_refs = ["source:synthetic"]
  input.coverage_refs = ["coverage:synthetic"]
  input.episodes = [{ episode_id: "correction", label: "Scope correction", class: "declared", fact_ids: ["user-2", "turn-2-end"], output_refs: ["artifact:one"], evidence_refs: ["evidence:one"] }]
  input.outcome = { acceptance: "declared", status: "accepted", evidence_refs: ["receipt:one"], artifact_refs: ["artifact:one"] }
  const p = profile(input)
  assert.equal(p.episodes[0].token_usage.class, "unavailable")
  assert.equal(p.episodes[0].class, "declared")
  assert.equal(p.outcome.acceptance, "declared")
  assert.equal(p.coverage.independent_acceptance.class, "unavailable")
  assert.deepEqual(p.coverage.source_refs, input.source_refs)
  input.episodes[0].class = "inferred"
  assert.equal(profile(input).episodes[0].class, "inferred")
  input.episodes[0].fact_ids = ["not-a-fact"]
  assert.throws(() => profile(input), /episode/i)
  input.episodes[0].fact_ids = ["dispatch"]
  assert.throws(() => profile(input), /episode/i)
})

test("output is deterministic, bounded, sanitized and carries the actual byte hash in both formats", () => {
  const input = richSnapshot()
  input.binding.title = "x|\n\u001b[31m<unsafe>&`"
  input.facts[4].content = "PRIVATE_PAYLOAD"
  input.facts[4].fields.arguments = "PRIVATE_PAYLOAD"
  input.facts[4].fields.reasoning = "PRIVATE_PAYLOAD"
  input.facts[4].fields.encrypted_content = "PRIVATE_PAYLOAD"
  const raw = Buffer.concat([bytes(input), Buffer.from("\n ")])
  const p = buildWorkProfile(raw)
  assert.equal(p.source_snapshot_sha256, hash(raw))
  const json = renderWorkProfile(p, "json")
  const markdown = renderWorkProfile(p, "markdown")
  assert.equal(JSON.parse(json).source_snapshot_sha256, hash(raw))
  assert.ok(markdown.includes(hash(raw)))
  assert.ok(markdown.includes("Event/source trail"))
  assert.ok(markdown.includes("Scope") && markdown.includes("unknown"))
  assert.ok(!markdown.includes("\u001b") && !markdown.includes("<unsafe>"))
  assert.ok(!json.includes("PRIVATE_PAYLOAD") && !markdown.includes("PRIVATE_PAYLOAD"))
  assert.ok(markdown.includes("&#124;") && markdown.includes("\\u000a"))
  assert.throws(() => renderWorkProfile(p, "html"), /format/i)
})

test("malformed snapshots, records, counters and annotations refuse instead of dropping errors", () => {
  for (const raw of [Buffer.from(""), Buffer.from("{"), Buffer.from([0xff]), bytes(null), bytes([]), bytes({}), bytes({ schema_version: 2 }), bytes({ ...snapshot(), facts: [] })]) {
    assert.throws(() => buildWorkProfile(raw))
  }
  assert.throws(() => buildWorkProfile("not bytes"), /bytes|buffer/i)
  const mutations = [
    (s) => { s.binding = null },
    (s) => { s.binding.work_item_id = 9 },
    (s) => { s.binding.root_agent_id = "" },
    (s) => { s.binding.title = "x".repeat(2049) },
    (s) => { s.facts = {} },
    (s) => { s.facts[0] = null },
    (s) => { s.facts[0].kind = "unsupported.kind" },
    (s) => { s.facts[0].timestamp = "2026-01-01" },
    (s) => { s.facts[0].agent_id = 4 },
    (s) => { s.facts[0].source_ref = {} },
    (s) => { s.facts[0].source_ref.native_session_id = "wrong" },
    (s) => { s.facts[0].source_ref.record_sha256 = "bad" },
    (s) => { s.facts[0].source_ref.byte_offset = -1 },
    (s) => { s.facts[0].source_ref.row_id = 4 },
    (s) => { s.facts[0].fields = [] },
    (s) => { s.facts[0].fields.toolCallId = null },
    (s) => { s.facts[0].fields.toolName = {} },
    (s) => { s.facts[1].dispatch_tool_call_id = "conflict" },
    (s) => { s.facts[2].exit_code = 0.1 },
    (s) => { s.source_refs = [42] },
    (s) => { s.coverage_refs = null },
    (s) => { s.episodes = {} },
    (s) => { s.episodes = [{ episode_id: "bad" }] },
    (s) => { s.outcome = { acceptance: "independent" } },
    (s) => { s.outcome = { acceptance: "unassessed", status: "accepted", evidence_refs: [], artifact_refs: [] } },
    (s) => { s.outcome = { acceptance: "declared", status: "accepted", evidence_refs: [], artifact_refs: [] } },
  ]
  for (const mutate of mutations) {
    const input = snapshot()
    mutate(input)
    assert.throws(() => profile(input), mutate.toString())
  }
  for (const invalid of [-1, 0.2, Number.MAX_SAFE_INTEGER + 1, "2", {}, false]) {
    const input = snapshot()
    input.facts.push(usage("u1", "worker-a", "dispatch-a", { input_tokens: dimension(invalid) }))
    assert.throws(() => profile(input), /usage|counter/i)
  }
  for (const bad of [
    { input_tokens: dimension(1, "dollars") },
    { unsupported_counter: dimension(1) },
    { duration_ms: dimension(-1, "milliseconds") },
    { output_ttft_ms: dimension(-1, "milliseconds") },
    { input_tokens: null },
  ]) {
    const input = snapshot()
    input.facts.push(usage("u1", "worker-a", "dispatch-a", bad))
    assert.throws(() => profile(input), /usage|counter/i)
  }
})

test("byte, fact, annotation and structure ceilings refuse without truncation", () => {
  assert.equal(MAX_INPUT_BYTES, 16 * 1024 * 1024)
  assert.throws(() => buildWorkProfile(Buffer.alloc(MAX_INPUT_BYTES + 1)), /limit/i)
  const input = snapshot()
  input.facts = Array.from({ length: 10001 }, () => input.facts[0])
  assert.throws(() => profile(input), /10000|10,000|limit/i)
  const atLimit = snapshot()
  while (atLimit.facts.length < 10000) atLimit.facts.push(structuredClone(atLimit.facts[0]))
  assert.equal(profile(atLimit).coverage.input_facts, 10000)
  const deep = snapshot()
  deep.ignored = Array.from({ length: 40 }).reduce((v) => [v], 0)
  assert.throws(() => profile(deep), /structure|depth/i)
  const wide = snapshot()
  wide.ignored = Array(500001).fill(0)
  assert.throws(() => profile(wide), /structure|values/i)
  const refs = snapshot()
  refs.source_refs = Array(101).fill("ref")
  assert.throws(() => profile(refs), /limit|reference/i)
})

test("bounded reader admits exact bytes and refuses links, directories, missing files and overflow", (t) => {
  const dir = temporary(t)
  const file = path.join(dir, "snapshot.json")
  const raw = bytes(snapshot())
  fs.writeFileSync(file, raw)
  assert.deepEqual(readProfileInput(file), raw)
  const link = path.join(dir, "link.json")
  fs.symlinkSync(file, link)
  assert.throws(() => readProfileInput(link), /link|regular/i)
  fs.unlinkSync(link)
  fs.linkSync(file, link)
  assert.throws(() => readProfileInput(file), /link|regular/i)
  fs.unlinkSync(link)
  assert.throws(() => readProfileInput(dir), /regular/i)
  assert.throws(() => readProfileInput(path.join(dir, "absent")), /ENOENT/)
  fs.truncateSync(file, MAX_INPUT_BYTES + 1)
  assert.throws(() => readProfileInput(file), /limit/i)
  fs.truncateSync(file, MAX_INPUT_BYTES)
  assert.equal(readProfileInput(file).length, MAX_INPUT_BYTES)
  assert.throws(() => readProfileInput(""), /path/i)
  const directoryLink = path.join(dir, "parent-link")
  fs.symlinkSync(dir, directoryLink)
  assert.throws(() => readProfileInput(path.join(directoryLink, "snapshot.json")), /link/i)
})

test("reader closes its descriptor and rejects file or ancestor replacement, growth and read failures", (t) => {
  const dir = temporary(t)
  const file = path.join(dir, "snapshot.json")
  const originalRead = fs.readSync
  const originalFstat = fs.fstatSync
  for (const change of ["growth", "shrink", "replace", "hardlink", "read-error", "opened-identity", "opened-not-regular", "timestamp", "ancestor"]) {
    fs.writeFileSync(file, bytes(snapshot()))
    let closeCalls = 0
    let changed = false
    let inputFd
    const close = fs.closeSync
    mock.method(fs, "closeSync", (...args) => { if (args[0] === inputFd) closeCalls++; return close(...args) })
    mock.method(fs, "fstatSync", (...args) => {
      inputFd ??= args[0]
      const stat = originalFstat(...args)
      if (change === "opened-identity") return { ...stat, ino: stat.ino + 1n, isFile: () => true }
      if (change === "opened-not-regular") return { ...stat, isFile: () => false }
      return stat
    })
    if (!change.startsWith("opened-")) {
      mock.method(fs, "readSync", (...args) => {
        if (!changed) {
          changed = true
          if (change === "growth") fs.appendFileSync(file, "more")
          if (change === "shrink") fs.truncateSync(file, 1)
          if (change === "replace") { fs.renameSync(file, `${file}.old`); fs.writeFileSync(file, bytes(snapshot())) }
          if (change === "hardlink") fs.linkSync(file, `${file}.link`)
          if (change === "read-error") throw new Error("synthetic read failure")
          if (change === "timestamp") fs.utimesSync(file, new Date(0), new Date(0))
          if (change === "ancestor") { fs.renameSync(dir, `${dir}-moved`); fs.mkdirSync(dir); fs.writeFileSync(file, bytes(snapshot())) }
        }
        return originalRead(...args)
      })
    }
    try {
      assert.throws(() => readProfileInput(file), /changed|regular|read failure/i, change)
      assert.equal(closeCalls, 1, change)
    } finally {
      mock.restoreAll()
      if (change === "ancestor") fs.rmSync(`${dir}-moved`, { recursive: true })
      for (const suffix of [".old", ".link"]) fs.rmSync(`${file}${suffix}`, { force: true })
    }
  }
})

test("actual CLI only writes a profile after complete validation; both formats bind exact input bytes", (t) => {
  const dir = temporary(t)
  const file = path.join(dir, "snapshot.json")
  const raw = bytes(richSnapshot())
  fs.writeFileSync(file, raw)
  for (const format of ["json", "markdown"]) {
    const result = cli(["--input", file, "--format", format])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, "")
    assert.ok(result.stdout.includes(hash(raw)))
    if (format === "json") assert.equal(JSON.parse(result.stdout).kind, "desk_work_profile")
  }
  assert.equal(cli(["--format", "json", "--input", file]).status, 0)
  for (const args of [[], ["--input", file], ["--input", file, "--format", "xml"], ["--input", file, "--input", file], ["--unknown", file, "--format", "json"], ["--input", file, "--format", "json", "extra"], ["--input", `${file}.absent`, "--format", "json"]]) {
    const result = cli(args)
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, /profile-work:/)
  }
  for (const raw of [Buffer.from("{PRIVATE_PAYLOAD"), bytes({ schema_version: 2 }), bytes({ ...snapshot(), facts: [] }), Buffer.alloc(MAX_INPUT_BYTES + 1)]) {
    fs.writeFileSync(file, raw)
    const result = cli(["--input", file, "--format", "json"])
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, "")
    assert.ok(!result.stderr.includes("PRIVATE_PAYLOAD"))
  }
})
