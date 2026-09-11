import { createHash } from "node:crypto"
import { normalizeRow, normalizeTimestamp } from "./copilot-usage.js"
import { MAX_INPUT_BYTES } from "./profile-input.js"

const KINDS = new Set([
  "tool.execution_start", "tool.execution_complete", "hook.start", "hook.end",
  "assistant.turn_start", "assistant.turn_end", "assistant.message", "user.message",
  "system.message", "session.start", "session.compaction_start", "session.compaction_complete",
  "skill.invoked", "subagent.started", "subagent.configured", "subagent.completed", "model.usage_observation",
])
const USAGE_UNITS = {
  input_tokens: "tokens", output_tokens: "tokens", cache_read_tokens: "tokens",
  cache_write_tokens: "tokens", reasoning_tokens: "tokens", total_nano_aiu: "nano_aiu",
  request_multiplier: "native_request_multiplier", duration_ms: "milliseconds",
  inter_token_latency_ms: "milliseconds", output_ttft_ms: "milliseconds", time_to_first_token_ms: "milliseconds",
}
const AGGREGATE_UNITS = { durationMs: "milliseconds", totalTokens: "tokens", totalToolCalls: "tool_calls" }
const COMPACTION_UNITS = { inputTokens: "tokens", outputTokens: "tokens", cacheReadTokens: "tokens", cacheWriteTokens: "tokens", totalNanoAiu: "nano_aiu", duration: "native_duration_unit_unspecified" }
const FIELD_NAMES = ["toolCallId", "hookInvocationId", "turnId", "interactionId", "parentToolCallId", "toolName", "hookType", "model", "api_call_id_sha256"]
const OPERATION_KINDS = {
  "tool.execution_start": ["tool", "start", "toolCallId"],
  "tool.execution_complete": ["tool", "end", "toolCallId"],
  "hook.start": ["hook", "start", "hookInvocationId"],
  "hook.end": ["hook", "end", "hookInvocationId"],
  "assistant.turn_start": ["assistant_step", "start", "turnId"],
  "assistant.turn_end": ["assistant_step", "end", "turnId"],
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const text = (value) => typeof value === "string" && value.trim() !== "" && value.length <= 2048
const nullableText = (value) => value === null || text(value)
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const key = (...parts) => JSON.stringify(parts)
const compare = (a, b) => a < b ? -1 : Number(a > b)
const unavailable = (reason) => ({ class: "unavailable", value: null, reason })
function requireFact(condition, message) {
  if (!condition) throw new Error(message)
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])]))
  return value
}
function parseSnapshot(bytes) {
  requireFact(Buffer.isBuffer(bytes), "Snapshot requires input bytes as a Buffer")
  requireFact(bytes.length <= MAX_INPUT_BYTES, "Input exceeds the 16 MiB byte limit")
  let input
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new Error("Input is not valid UTF-8 JSON")
  }
  const pending = [[input, 0]]
  let nodes = 0
  while (pending.length) {
    const [value, depth] = pending.pop()
    requireFact(depth <= 32 && ++nodes <= 500000, "Snapshot structure exceeds 32 levels or 500000 values")
    if (value !== null && typeof value === "object") {
      const children = Object.values(value)
      requireFact(nodes + pending.length + children.length <= 500000, "Snapshot structure exceeds 500000 values")
      for (const child of children) pending.push([child, depth + 1])
    }
  }
  requireFact(object(input) && input.schema_version === 1, "Expected snapshot schema_version 1")
  requireFact(Array.isArray(input.facts) && input.facts.length > 0 && input.facts.length <= 10000, "Snapshot requires 1 to 10000 facts")
  return input
}
function refs(value) {
  requireFact(Array.isArray(value) && value.length <= 100 && value.every(text), "Expected at most 100 bounded inert reference strings")
  return [...new Set(value)].sort()
}
function readBinding(value) {
  requireFact(object(value) && ["native_session_id", "root_agent_id", "dispatch_tool_call_id", "title"].every((name) => text(value[name])) && nullableText(value.work_item_id) && nullableText(value.task_ref), "Invalid snapshot binding")
  return Object.fromEntries(["native_session_id", "root_agent_id", "dispatch_tool_call_id", "title", "work_item_id", "task_ref"].map((name) => [name, value[name]]))
}
function sourceReference(value, session) {
  requireFact(object(value) && text(value.source_id) && value.native_session_id === session, "Invalid source reference/session")
  requireFact((text(value.event_id) && value.row_id === undefined) || (integer(value.row_id) && value.event_id === undefined), "Source reference needs exactly one event_id or safe row_id")
  const result = { source_id: value.source_id, native_session_id: session }
  for (const name of ["event_id", "row_id", "record_sha256", "snapshot_row_sha256", "logical_table", "line", "byte_offset", "byte_length"]) {
    if (value[name] === undefined) continue
    const entry = value[name]
    if (name.endsWith("sha256")) requireFact(typeof entry === "string" && /^[a-f0-9]{64}$/u.test(entry), "Invalid source record hash")
    else if (["row_id", "line", "byte_offset", "byte_length"].includes(name)) requireFact(integer(entry), "Invalid source record pointer")
    else requireFact(text(entry), "Invalid source record metadata")
    result[name] = entry
  }
  return result
}
function quantities(value, units) {
  requireFact(object(value), "Invalid usage counters")
  const result = {}
  for (const [name, entry] of Object.entries(value).sort(([a], [b]) => compare(a, b))) {
    requireFact(Object.hasOwn(units, name) && object(entry) && entry.unit === units[name], "Invalid usage dimension or unit")
    const amount = entry.value
    const fractional = ["milliseconds", "native_request_multiplier", "native_duration_unit_unspecified"].includes(entry.unit)
    requireFact(amount === null || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER && (fractional || Number.isSafeInteger(amount))), "Invalid or unsafe usage counter")
    result[name] = { value: amount, unit: entry.unit }
  }
  return result
}
function normalizedFact(raw) {
  requireFact(object(raw) && text(raw.fact_id) && KINDS.has(raw.kind) && nullableText(raw.agent_id) && text(raw.native_session_id), "Invalid normalized fact")
  if (raw.kind.startsWith("subagent.")) requireFact(text(raw.agent_id), "Invalid subagent identity")
  const timestamp = normalizeTimestamp(raw.timestamp)
  requireFact(timestamp !== null, "Invalid fact timestamp")
  const source = sourceReference(raw.source_ref, raw.native_session_id)
  const fields = raw.fields === undefined ? {} : raw.fields
  requireFact(object(fields), "Invalid fact fields")
  const keptFields = {}
  for (const name of FIELD_NAMES) {
    if (fields[name] === undefined) continue
    requireFact(fields[name] === null || text(fields[name]) || (name === "turnId" && integer(fields[name])), "Invalid fact field metadata")
    keptFields[name] = fields[name]
  }
  const operation = OPERATION_KINDS[raw.kind]
  if (operation) requireFact(text(keptFields[operation[2]]) || (operation[2] === "turnId" && integer(keptFields.turnId)), "Missing operation identity")
  const result = { fact_id: raw.fact_id, kind: raw.kind, agent_id: raw.agent_id, native_session_id: raw.native_session_id, timestamp, timestamp_semantics: raw.kind === "model.usage_observation" ? "usage_row_creation_not_execution" : "native_event_timestamp", source_ref: source, fields: keptFields }
  for (const name of ["dispatch_tool_call_id", "structural_parent_agent_id", "returned_agent_id", "source_event_parent_id", "status", "parent_tool_call_id", "model", "initiator"]) {
    if (raw[name] === undefined) continue
    requireFact(nullableText(raw[name]), "Invalid fact identity/status metadata")
    result[name] = raw[name]
  }
  if (raw.exit_code !== undefined) {
    requireFact(raw.exit_code === null || Number.isSafeInteger(raw.exit_code), "Invalid command exit_code")
    result.exit_code = raw.exit_code
  }
  if (raw.kind.startsWith("subagent.") && raw.kind !== "subagent.completed") {
    requireFact(text(raw.dispatch_tool_call_id) || text(fields.toolCallId), "Missing subagent dispatch identity")
    requireFact(raw.dispatch_tool_call_id === undefined || fields.toolCallId === undefined || raw.dispatch_tool_call_id === fields.toolCallId, "Conflicting subagent dispatch identity")
    result.dispatch_tool_call_id = raw.dispatch_tool_call_id ?? fields.toolCallId
  }
  if (raw.kind === "model.usage_observation") {
    requireFact(integer(source.row_id) && (raw.native_history_turn_index === null || integer(raw.native_history_turn_index)), "Invalid native usage row identity/index")
    result.usage = quantities(raw.usage, USAGE_UNITS)
    // Reuse the existing native row semantics without invoking its live reader.
    const normalized = normalizeRow({ id: source.row_id, created_at: raw.timestamp, ...Object.fromEntries(Object.entries(result.usage).map(([name, entry]) => [name, entry.value])) })
    requireFact(!normalized.malformed, "Invalid native usage observation")
    result.native_history_turn_index = raw.native_history_turn_index
    result.model = raw.model ?? null
    result.initiator = raw.initiator ?? null
  }
  if (raw.kind === "subagent.completed") result.native_aggregate = quantities(raw.native_aggregate, AGGREGATE_UNITS)
  if (raw.kind === "session.compaction_complete") result.usage = quantities(raw.usage, COMPACTION_UNITS)
  return result
}
function deduplicate(rawFacts) {
  const byIdentity = new Map()
  const aliases = new Map()
  for (const raw of rawFacts) {
    const fact = normalizedFact(raw)
    const ref = fact.source_ref
    const identity = key(ref.source_id, fact.native_session_id, ref.event_id ?? ref.row_id)
    const { fact_id: alias, ...payload } = raw
    const fingerprint = JSON.stringify(canonical(payload))
    requireFact(!aliases.has(alias) || aliases.get(alias) === identity, "Conflicting fact_id alias")
    aliases.set(alias, identity)
    if (byIdentity.has(identity)) {
      const existing = byIdentity.get(identity)
      requireFact(existing.fingerprint === fingerprint, "Conflicting duplicate source identity")
      existing.fact_ids.add(alias)
    } else {
      byIdentity.set(identity, { ...fact, identity, fingerprint, fact_ids: new Set([alias]) })
    }
  }
  return [...byIdentity.values()].map(({ fingerprint, ...fact }) => {
    const fact_ids = [...fact.fact_ids].sort()
    return { ...fact, fact_id: fact_ids[0], fact_ids }
  }).sort((a, b) => compare(a.identity, b.identity))
}
const sourceScope = (fact) => key(fact.source_ref.source_id, fact.native_session_id)
const agentScope = (fact) => key(sourceScope(fact), fact.agent_id)
function lineage(facts, binding) {
  const candidates = facts.filter((f) => f.native_session_id === binding.native_session_id)
  const starts = candidates.filter((f) => f.kind === "subagent.started")
  const dispatches = candidates.filter((f) => f.kind === "tool.execution_start")
  const completions = candidates.filter((f) => f.kind === "tool.execution_complete")
  const dispatchIndex = new Map()
  for (const dispatch of dispatches) {
    const identity = key(sourceScope(dispatch), dispatch.fields.toolCallId)
    if (!dispatchIndex.has(identity)) dispatchIndex.set(identity, [])
    dispatchIndex.get(identity).push(dispatch)
  }
  const rootStarts = starts.filter((f) => f.agent_id === binding.root_agent_id && f.dispatch_tool_call_id === binding.dispatch_tool_call_id)
  requireFact(rootStarts.length === 1, "Native root binding requires one matching subagent start")
  const rootDispatches = dispatchIndex.get(key(sourceScope(rootStarts[0]), binding.dispatch_tool_call_id)) ?? []
  requireFact(rootDispatches.length === 1 && rootDispatches[0].agent_id !== binding.root_agent_id, "Native root binding requires one parent dispatch")
  const rootCompletions = completions.filter((f) => agentScope(f) === agentScope(rootDispatches[0]) && f.fields.toolCallId === binding.dispatch_tool_call_id && f.returned_agent_id === binding.root_agent_id)
  requireFact(rootCompletions.length === 1, "Native root binding requires one dispatch completion with the returned agent")
  requireFact(Date.parse(rootCompletions[0].timestamp) >= Date.parse(rootDispatches[0].timestamp), "Reversed interval in root dispatch")
  const links = new Map()
  for (const started of starts) {
    const owners = dispatchIndex.get(key(sourceScope(started), started.dispatch_tool_call_id)) ?? []
    requireFact(owners.length <= 1, "Ambiguous dispatch lineage")
    const structural = started.structural_parent_agent_id
    if (structural != null && owners.length) requireFact(structural === owners[0].agent_id, "Conflicting structural/dispatch lineage")
    const parent = structural ?? (owners.length ? owners[0].agent_id : null)
    const link = { agent_id: started.agent_id, parent_agent_id: parent, dispatch_tool_call_id: started.dispatch_tool_call_id, evidence_fact_ids: [started.fact_id, ...owners.map((f) => f.fact_id)].sort() }
    requireFact(!links.has(started.agent_id) && started.agent_id !== parent, "Conflicting or cyclic agent lineage")
    links.set(started.agent_id, link)
  }
  const selected = new Set([binding.root_agent_id])
  let changed
  do {
    changed = false
    for (const link of links.values()) {
      if (!selected.has(link.agent_id) && selected.has(link.parent_agent_id)) {
        selected.add(link.agent_id)
        changed = true
      }
    }
  } while (changed)
  requireFact(!selected.has(links.get(binding.root_agent_id).parent_agent_id), "Cyclic rooted agent lineage")
  const agents = [...selected].sort().map((id) => links.get(id))
  const included = (f) => f.native_session_id === binding.native_session_id && selected.has(f.agent_id) && (f.kind !== "model.usage_observation" || f.parent_tool_call_id === links.get(f.agent_id).dispatch_tool_call_id)
  return { agents, included, proof: [rootDispatches[0].fact_id, rootCompletions[0].fact_id, rootStarts[0].fact_id].sort() }
}
function safeSum(left, right) {
  const value = left + right
  requireFact(Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER, "Observation sum exceeds safe numeric range")
  return value
}
function intervalUnion(spans) {
  const intervals = spans.filter((s) => s.duration_ms !== null).map((s) => [Date.parse(s.started_at), Date.parse(s.ended_at)]).sort((a, b) => a[0] - b[0])
  if (!intervals.length) return null
  let [start, end] = intervals[0]
  let total = 0
  for (const [nextStart, nextEnd] of intervals.slice(1)) {
    if (nextStart > end) {
      total = safeSum(total, end - start)
      start = nextStart
    }
    end = Math.max(end, nextEnd)
  }
  return safeSum(total, end - start)
}
function operations(facts) {
  const groups = new Map()
  const interactions = new Map()
  const ties = new Map()
  for (const fact of facts.filter((f) => f.kind === "user.message" || f.kind.startsWith("assistant.turn_"))) {
    const identity = key(agentScope(fact), fact.timestamp)
    if (!ties.has(identity)) ties.set(identity, [])
    ties.get(identity).push(fact)
  }
  for (const members of ties.values()) {
    if (members.length > 1 && members.some((f) => f.kind === "user.message")) {
      requireFact(members.every((f) => f.source_ref.line !== undefined) && new Set(members.map((f) => f.source_ref.line)).size === members.length, "Ambiguous timestamp-tied interaction boundary without native sequence")
    }
  }
  const missingSequence = new Set(facts.filter((f) => f.source_ref.line === undefined).map(agentScope))
  const ordered = [...facts].sort((a, b) => {
    const scopeOrder = compare(agentScope(a), agentScope(b))
    if (scopeOrder) return scopeOrder
    if (!missingSequence.has(agentScope(a))) return a.source_ref.line - b.source_ref.line || compare(a.identity, b.identity)
    return compare(a.timestamp, b.timestamp) || compare(a.source_ref.line ?? -1, b.source_ref.line ?? -1) || compare(a.identity, b.identity)
  })
  for (const fact of ordered) {
    const scope = agentScope(fact)
    if (fact.kind === "user.message") interactions.set(scope, (interactions.get(scope) ?? 0) + 1)
    const spec = OPERATION_KINDS[fact.kind]
    if (!spec) continue
    const [type, endpoint, field] = spec
    const interaction = type === "assistant_step" ? interactions.get(scope) ?? 0 : null
    const identity = key(scope, type, interaction, fact.fields[field])
    if (!groups.has(identity)) groups.set(identity, { type, interaction, operation_id: fact.fields[field] })
    const pair = groups.get(identity)
    requireFact(pair[endpoint] === undefined, "Ambiguous operation endpoint")
    pair[endpoint] = fact
  }
  const result = {}
  const allSpans = []
  for (const type of ["tool", "hook", "assistant_step"]) {
    const spans = []
    for (const [, pair] of [...groups.entries()].sort(([a], [b]) => compare(a, b))) {
      if (pair.type !== type) continue
      const { start, end } = pair
      const evidence = start ?? end
      const duration = start && end ? Date.parse(end.timestamp) - Date.parse(start.timestamp) : null
      requireFact(duration === null || (duration >= 0 && Number.isSafeInteger(duration)), "Reversed interval or unsafe operation duration")
      const exit = end?.exit_code ?? null
      spans.push({
        source_id: evidence.source_ref.source_id, native_session_id: evidence.native_session_id, agent_id: evidence.agent_id,
        operation_id: pair.operation_id, interaction: pair.interaction,
        start_fact_id: start?.fact_id ?? null, end_fact_id: end?.fact_id ?? null,
        started_at: start?.timestamp ?? null, ended_at: end?.timestamp ?? null, duration_ms: duration,
        transport_status: end?.status ?? null, exit_code: exit,
        operation_status: exit === null ? "unknown" : exit === 0 ? "success" : "failure",
      })
    }
    const matched = spans.filter((s) => s.duration_ms !== null)
    result[type] = {
      matched: matched.length, unmatched_starts: spans.filter((s) => s.end_fact_id === null).length,
      unmatched_ends: spans.filter((s) => s.start_fact_id === null).length,
      summed_latency_ms: matched.length ? matched.reduce((sum, s) => safeSum(sum, s.duration_ms), 0) : null,
      interval_union_ms: intervalUnion(spans), spans,
    }
    allSpans.push(...spans)
  }
  result.interval_union_ms = intervalUnion(allSpans)
  result.semantics = "Raw observed operation intervals only; summed latency includes overlap. Interval union is not active agent time or job lead time."
  return result
}
function dimensions(rows) {
  return Object.fromEntries(Object.entries(USAGE_UNITS).map(([name, unit]) => {
    const known = rows.map((f) => f.usage[name]?.value).filter((v) => v !== undefined && v !== null)
    return [name, { value: known.length ? known.reduce(safeSum, 0) : null, unit, known_rows: known.length, unknown_rows: rows.length - known.length }]
  }))
}
function usageView(facts) {
  const rows = facts.filter((f) => f.kind === "model.usage_observation")
  const groups = new Map()
  for (const row of rows) {
    const identity = key(row.source_ref.source_id, row.native_session_id, row.agent_id, row.parent_tool_call_id, row.model, row.initiator)
    if (!groups.has(identity)) groups.set(identity, [])
    groups.get(identity).push(row)
  }
  return {
    class: "measured", scope: "selected-source subtotals, not a full-job total", selected_rows: rows.length,
    dimensions: dimensions(rows),
    groups: [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, members]) => ({
      source_id: members[0].source_ref.source_id, native_session_id: members[0].native_session_id,
      agent_id: members[0].agent_id, parent_tool_call_id: members[0].parent_tool_call_id,
      model: members[0].model, initiator: members[0].initiator, fact_ids: members.map((f) => f.fact_id).sort(),
      dimensions: dimensions(members),
    })),
    caution: "Input/output/cache/reasoning are source dimensions, not additive token categories. Native accounting units are not dollars. Usage creation timestamps do not anchor execution intervals; no exact model-event or episode join is available.",
  }
}
function annotations(input, included) {
  const supplied = input.episodes === undefined ? [] : input.episodes
  requireFact(Array.isArray(supplied) && supplied.length <= 100, "Expected at most 100 episode annotations")
  const known = new Set(included.flatMap((f) => f.fact_ids))
  const seen = new Set()
  const episodes = supplied.map((episode) => {
    requireFact(object(episode) && text(episode.episode_id) && text(episode.label) && ["declared", "inferred"].includes(episode.class) && !seen.has(episode.episode_id) && Array.isArray(episode.fact_ids) && episode.fact_ids.length > 0 && episode.fact_ids.length <= 100 && episode.fact_ids.every((id) => known.has(id)), "Invalid episode annotation or out-of-scope fact reference")
    seen.add(episode.episode_id)
    return {
      episode_id: episode.episode_id, label: episode.label, class: episode.class,
      fact_ids: [...new Set(episode.fact_ids)].sort(), output_refs: refs(episode.output_refs), evidence_refs: refs(episode.evidence_refs),
      token_usage: unavailable("No supported exact usage-row attribution to episodes; no nearest-timestamp allocation"),
    }
  }).sort((a, b) => compare(a.episode_id, b.episode_id))
  const outcome = input.outcome === undefined ? { acceptance: "unassessed", status: "unknown", evidence_refs: [], artifact_refs: [] } : input.outcome
  requireFact(object(outcome) && ["unassessed", "declared"].includes(outcome.acceptance) && ["unknown", "accepted", "not_accepted"].includes(outcome.status), "Invalid outcome annotation")
  const evidence_refs = refs(outcome.evidence_refs)
  requireFact(outcome.acceptance === "unassessed" ? outcome.status === "unknown" : evidence_refs.length > 0, "Outcome acceptance requires declared evidence; unassessed acceptance is unknown")
  return { episodes, outcome: { acceptance: outcome.acceptance, status: outcome.status, evidence_refs, artifact_refs: refs(outcome.artifact_refs) } }
}

export function buildWorkProfile(bytes) {
  const input = parseSnapshot(bytes)
  const binding = readBinding(input.binding)
  const facts = deduplicate(input.facts)
  const root = lineage(facts, binding)
  const included = facts.filter(root.included)
  const operationView = operations(included)
  const annotationsView = annotations(input, included)
  return {
    schema_version: 1, kind: "desk_work_profile",
    source_snapshot_sha256: createHash("sha256").update(bytes).digest("hex"),
    binding: { ...binding, class: "declared", canonical_ledger_identity: "unverified", evidence_fact_ids: root.proof },
    coverage: {
      input_facts: input.facts.length, unique_facts: facts.length, duplicate_facts: input.facts.length - facts.length,
      included_facts: included.length, excluded_facts: facts.length - included.length,
      missing_operation_endpoints: ["tool", "hook", "assistant_step"].reduce((sum, type) => sum + operationView[type].unmatched_starts + operationView[type].unmatched_ends, 0),
      source_refs: refs(input.source_refs === undefined ? [] : input.source_refs),
      coverage_refs: refs(input.coverage_refs === undefined ? [] : input.coverage_refs),
      full_job_usage: unavailable("Only selected source rows with session, rooted agent and originating dispatch match are attributable"),
      parent_overhead: unavailable("Shared parent context and foreign workers are excluded"),
      independent_acceptance: unavailable("Supplied acceptance is an annotation, not independently assessed here"),
      causal_productivity: unavailable("Activity and usage do not establish causal productivity"),
      note: "Coverage is limited to this explicit snapshot and bound native session. Missing endpoints are gaps, not zero durations. Source references are inert. Scope correction does not imply defect rework.",
    },
    observations: {
      agents: root.agents, operations: operationView, usage: usageView(included),
      assistant_messages: included.filter((f) => f.kind === "assistant.message").length,
      model_calls: unavailable("Assistant messages and repeated apiCallId hashes are not model call counts"),
      critical_path: unavailable("Complete dependency evidence is absent"),
      aggregates: included.filter((f) => f.kind === "subagent.completed").map((f) => ({ fact_id: f.fact_id, values: f.native_aggregate, caution: "Separate native aggregate; never added to usage rows. Completion may cover only an earlier interaction and is not final job closure." })),
      compactions: included.filter((f) => f.kind === "session.compaction_complete").map((f) => ({ fact_id: f.fact_id, values: f.usage, caution: "Separate compaction observation; overlap with usage rows is not disproven. Native duration has no known unit." })),
      events: facts.map(({ identity, ...f }) => ({ ...f, scope: root.included(f) ? "included" : "excluded" })),
    },
    ...annotationsView,
  }
}

function escapeMarkdown(value) {
  return String(value).replace(/[&<>|`\\*_[\]{}\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code >= 127 ? `\\u${code.toString(16).padStart(4, "0")}` : `&#${code};`
  })
}
export function renderWorkProfile(profile, format) {
  requireFact(["json", "markdown"].includes(format), "Expected format json or markdown")
  let output
  if (format === "json") output = `${JSON.stringify(profile, null, 2)}\n`
  else {
    const escape = escapeMarkdown
    const rows = []
    function table(headers, values) {
      rows.push(`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`)
      for (const row of values) rows.push(`| ${row.map((value) => escape(value === null ? "unknown" : value)).join(" | ")} |`)
      rows.push("")
    }
    function references(label, values) {
      if (values.length) rows.push(`### ${label}`, "", ...values.map((value) => `- ${escape(value)}`), "")
    }
    rows.push(`# Desk work profile: ${escape(profile.binding.title)}`, "", `Input SHA-256: ${profile.source_snapshot_sha256}`, "", "## Outcome and episodes", "", `Outcome: ${escape(profile.outcome.status.replaceAll("_", " "))}. Acceptance: ${escape(profile.outcome.acceptance)}; independent acceptance is unavailable.`, "", `${profile.outcome.artifact_refs.length} artifact references supplied. Publication and a returned worker do not establish acceptance.`, "")
    if (!profile.episodes.length) rows.push("No episode annotations supplied; episode token usage is unavailable.", "")
    for (const episode of profile.episodes) {
      rows.push(`### ${escape(episode.label)}`, "", `Classification: ${escape(episode.class)}. Source facts: ${episode.fact_ids.length}; output references: ${episode.output_refs.length}. Token allocation: unavailable.`, "")
    }
    rows.push("Scope correction is not automatically defect rework. Episode evidence and output references are preserved in the JSON output and the references below.", "", "## Activity summary", "", `Structurally bound agents: ${profile.observations.agents.length}. Facts: ${profile.coverage.included_facts} included, ${profile.coverage.excluded_facts} excluded, ${profile.coverage.duplicate_facts} duplicate imports.`, "")
    const operationTypes = { tool: "Tool calls", hook: "Hook callbacks", assistant_step: "Assistant steps" }
    const activity = Object.entries(operationTypes).map(([type, label]) => [label, profile.observations.operations[type]])
    table(["Observation", "Matched", "Missing start", "Missing end"], activity.map(([label, group]) => [label, group.matched, group.unmatched_ends, group.unmatched_starts]))
    rows.push("Missing endpoints are gaps, not zero durations. Assistant step IDs are interaction-local; step counts are not external turns or model-call counts.", "", "### Observed intervals", "", escape(profile.observations.operations.semantics), "")
    table(["Observation", "Sum (ms)", "Union (ms)"], activity.map(([label, group]) => [label, group.summed_latency_ms, group.interval_union_ms]))
    rows.push(`Combined interval union (ms): ${profile.observations.operations.interval_union_ms ?? "unknown"}. This does not establish job lead time or active reasoning time.`, "")
    const returns = profile.observations.operations.tool.spans.filter((span) => span.end_fact_id !== null)
    const knownTransport = returns.filter((span) => span.transport_status !== null)
    const successfulTransport = knownTransport.filter((span) => span.transport_status === "success").length
    const knownExits = returns.filter((span) => span.exit_code !== null)
    const zeroExits = knownExits.filter((span) => span.exit_code === 0).length
    rows.push("### Tool returns and command evidence", "")
    table(["Reported signal", "Returns"], [
      ["Successful transport", successfulTransport],
      ["Other reported transport status", knownTransport.length - successfulTransport],
      ["Transport status not reported", returns.length - knownTransport.length],
      ["Explicit zero exit code", zeroExits],
      ["Explicit nonzero exit code", knownExits.length - zeroExits],
      ["Underlying exit code not reported", returns.length - knownExits.length],
    ])
    rows.push("Transport success does not establish command success. A nonzero exit can be a probe result or a dependency failure; it is not automatically a product defect.", "", "## Selected native usage", "", escape(profile.observations.usage.scope), "", `Selected rows: ${profile.observations.usage.selected_rows}; source groups: ${profile.observations.usage.groups.length}. Unknown rows are not zero; the JSON output retains each group's dimensions and source identities.`, "")
    table(["Dimension", "Subtotal", "Known / selected", "Unit"], Object.entries(profile.observations.usage.dimensions).map(([name, dimension]) => [name.replaceAll("_", " "), dimension.value, `${dimension.known_rows} / ${dimension.known_rows + dimension.unknown_rows}`, dimension.unit.replaceAll("_", " ")]))
    rows.push(escape(profile.observations.usage.caution), "", "## Separate observations", "", `Completion aggregates: ${profile.observations.aggregates.length}. They may overlap selected usage, cover only an earlier interaction, and do not establish final job closure.`, "", `Compaction observations: ${profile.observations.compactions.length}. These are not added to usage rows; non-overlap is unproven and the native duration unit is unspecified. Exact quantities remain in the JSON output.`, "", `Assistant messages: ${profile.observations.assistant_messages}. Model calls: unavailable. ${escape(profile.observations.model_calls.reason)}`, "", "## Coverage limits", "", escape(profile.coverage.note), "")
    for (const name of ["full_job_usage", "parent_overhead", "independent_acceptance", "causal_productivity"]) rows.push(`- ${name.replaceAll("_", " ")}: unavailable. ${escape(profile.coverage[name].reason)}`)
    rows.push(`- Critical path: unavailable. ${escape(profile.observations.critical_path.reason)}`, "", "## Binding and references", "", `Root agent: ${escape(profile.binding.root_agent_id)}`, "", `Native session: ${escape(profile.binding.native_session_id)}`, "", `Originating dispatch: ${escape(profile.binding.dispatch_tool_call_id)}`, "", `Declared work item: ${escape(profile.binding.work_item_id ?? "not supplied")}. Canonical ledger identity: ${escape(profile.binding.canonical_ledger_identity)}.`, "", `Declared task reference: ${escape(profile.binding.task_ref ?? "not supplied")}`, "", "### Event/source trail", "", `The JSON output with this input hash retains all ${profile.observations.events.length} deduplicated source records, fact-ID aliases, hashes, timestamps, rooted relationships and complete operation spans. This Markdown is a reading summary, not a replacement for that evidence.`, "")
    references("Source references", profile.coverage.source_refs)
    references("Coverage references", profile.coverage.coverage_refs)
    references("Outcome evidence", profile.outcome.evidence_refs)
    references("Artifact references", profile.outcome.artifact_refs)
    for (const episode of profile.episodes) {
      references(`Outputs: ${escape(episode.label)}`, episode.output_refs)
      references(`Evidence: ${escape(episode.label)}`, episode.evidence_refs)
    }
    output = `${rows.join("\n")}\n`
  }
  requireFact(Buffer.byteLength(output) <= 32 * 1024 * 1024, "Profile exceeds the 32 MiB output limit")
  return output
}
