# Bounded batch work profile

Profile one accountable agent's job, including structurally linked descendants, from one explicit normalized snapshot. This is an opt-in local command, not an MCP action, recording switch, live-source importer, work ledger, or installation change. It does not read referenced files, query native history, fetch URLs, write reports, or add reporting duties to working agents.

## Invocation

Run from the repository root with the Desk MCP package's existing dependencies available:

```sh
node plugins/desk/mcp/scripts/profile-work.js --input snapshot.json --format json
node plugins/desk/mcp/scripts/profile-work.js --input snapshot.json --format markdown
```

Both flags are required, in either order, exactly once. Successful output goes to stdout. Invalid input or an exceeded limit produces a nonzero exit and no stdout profile. Diagnostics do not quote JSON payloads. The JSON envelope contains `schema_version: 1`, `kind: "desk_work_profile"`, and `source_snapshot_sha256`, computed from the actual input bytes, including whitespace. Markdown visibly includes the same SHA-256.

The command is not a retention service. A private caller owns protected output destinations, complete-result capture, integrity read-back, and publication of a fresh generation after successful command completion. Never treat a partial stdout capture as a retained successful profile. Input contents and resulting profiles can be sensitive even though the renderer excludes raw content fields.

The reusable package APIs are `readProfileInput(filename)` in `mcp/src/measurement/profile-input.js`, and `buildWorkProfile(bytes)` / `renderWorkProfile(profile, format)` in `mcp/src/measurement/work-profile.js`. The builder accepts a Buffer, not a filename; the reader only reads its explicitly supplied path. Existing native timestamp and usage normalization is reused without calling the native database reader.

## Bounds and file safety

| Boundary | Limit / rule |
| --- | --- |
| Input bytes | At most 16 MiB, checked on the opened descriptor before allocating the read buffer; the buffer includes one extra byte to detect growth |
| Facts | 1 through 10,000 input facts, including repeated imports; overflow refuses rather than truncates |
| JSON structure | At most 32 levels below the root and 500,000 values |
| Retained strings | Nonblank, at most 2,048 UTF-16 code units each |
| Annotations | At most 100 episodes; at most 100 fact IDs per episode |
| Inert references | At most 100 strings in each reference array |
| Rendered output | At most 32 MiB per format; overflow refuses before stdout |
| Input file | Regular file with one hard link; no symlink in its resolved path or ancestors |
| Concurrent changes | Descriptor, pathname and ancestor identities are compared; size, timestamps, link count, unexpected EOF and growth detect changes during reading |

No reference, field, path, URL, or instruction embedded in the snapshot is followed. The reader closes its descriptor on success or failure. A source changing during the read is a refusal, not a partial profile.

## Snapshot schema

The minimal complete binding proof looks like this synthetic snapshot:

```json
{
  "schema_version": 1,
  "binding": {
    "native_session_id": "session-a",
    "root_agent_id": "worker-a",
    "dispatch_tool_call_id": "dispatch-a",
    "title": "Synthetic bounded job",
    "work_item_id": null,
    "task_ref": null
  },
  "facts": [
    {
      "fact_id": "dispatch",
      "kind": "tool.execution_start",
      "agent_id": null,
      "native_session_id": "session-a",
      "timestamp": "2026-01-01T00:00:00Z",
      "source_ref": { "source_id": "events-a", "native_session_id": "session-a", "event_id": "dispatch" },
      "fields": { "toolCallId": "dispatch-a", "toolName": "task" }
    },
    {
      "fact_id": "started",
      "kind": "subagent.started",
      "agent_id": "worker-a",
      "native_session_id": "session-a",
      "timestamp": "2026-01-01T00:00:01Z",
      "source_ref": { "source_id": "events-a", "native_session_id": "session-a", "event_id": "started" },
      "fields": { "toolCallId": "dispatch-a" },
      "structural_parent_agent_id": null
    },
    {
      "fact_id": "returned",
      "kind": "tool.execution_complete",
      "agent_id": null,
      "native_session_id": "session-a",
      "timestamp": "2026-01-01T00:00:02Z",
      "source_ref": { "source_id": "events-a", "native_session_id": "session-a", "event_id": "returned" },
      "fields": { "toolCallId": "dispatch-a" },
      "returned_agent_id": "worker-a",
      "status": "success"
    }
  ]
}
```

All binding fields shown are required; `work_item_id` and `task_ref` may be null. This association is declared input, not a fabricated or verified canonical ledger row. Native evidence must uniquely connect the originating dispatch start, its completion's `returned_agent_id`, and the root's `subagent.started` in the same source/session. The root dispatch itself is parent context and is excluded from job operation totals.

Each fact requires `fact_id`, `kind`, nullable `agent_id`, `native_session_id`, `timestamp`, and `source_ref`. Subagent facts require a nonnull agent ID. Timestamps use the existing native normalizer: an offset-bearing instant, or SQLite's space-separated UTC timestamp. Usage creation timestamps do not establish execution intervals.

`source_ref` requires `source_id`, a matching `native_session_id`, and exactly one nonblank `event_id` or nonnegative safe integer `row_id`. Optional retained fields are `record_sha256`, `snapshot_row_sha256` (lowercase SHA-256), `logical_table`, `line`, `byte_offset`, and `byte_length`. Numeric pointers must be nonnegative safe integers. Preserve supplied hashes and pointers from the normalized source, rather than reconstructing them from report text.

Identity is `(source_id, native_session_id, event_id OR row_id)`, not `fact_id`. Identical repeats collapse without inflating counts; all fact-ID aliases remain in the event trail. Any differing payload under the same native identity rejects the whole snapshot, including differences in otherwise ignored fields. A fact-ID alias cannot name different native identities. Input reordering and object-key reordering cannot select a different winner.

### Supported event kinds and metadata

| Kind | Relevant metadata |
| --- | --- |
| `tool.execution_start`, `tool.execution_complete` | `fields.toolCallId`; optional `fields.toolName`, top-level `status`, nullable integer `exit_code`, `returned_agent_id` |
| `hook.start`, `hook.end` | `fields.hookInvocationId`; hook input echoes never become tool operations |
| `assistant.turn_start`, `assistant.turn_end` | `fields.turnId`, a bounded string or nonnegative safe integer |
| `user.message` | Establishes a new interaction for subsequent assistant steps |
| `assistant.message` | Message count only; `fields.api_call_id_sha256` is not a unique call count |
| `subagent.started`, `subagent.configured` | `dispatch_tool_call_id` or `fields.toolCallId`; if both exist they must agree; optional `structural_parent_agent_id` |
| `subagent.completed` | Required `native_aggregate` object, which may be empty |
| `model.usage_observation` | Required row ID, `usage` object and nullable nonnegative `native_history_turn_index`; attribution needs `parent_tool_call_id` matching the agent's originating dispatch |
| `session.compaction_complete` | Required `usage` object, which may be empty |
| `system.message`, `session.start`, `session.compaction_start`, `skill.invoked` | Event/source trail, not invented operations |

Other event kinds are refused. Retained `fields` are limited to `toolCallId`, `hookInvocationId`, `turnId`, `interactionId`, `parentToolCallId`, `toolName`, `hookType`, `model`, and `api_call_id_sha256`. Top-level native source predecessor, dispatch, structural parent, returned-agent, transport status, command exit, model and initiator metadata are retained where supplied. Unknown fields are not echoed. Content, arguments, reasoning text, encrypted content and transcripts never appear in the profile.

Descendants are established by `subagent.started.structural_parent_agent_id` or the owning agent of the originating dispatch in the same source/session. Conflicting parents, cycles and ambiguous agent dispatches refuse. Top-level `source_event_parent_id` is retained only as a predecessor reference, never used for agent ancestry. This first schema binds one native session; records from other sessions are excluded, not silently joined into the job.

### Usage and aggregate shapes

Each supplied dimension is `{ "value": <nonnegative number or null>, "unit": "<unit>" }`. Missing dimensions stay unknown; they are not zero. Counters are safe integers. Durations and request multipliers may be fractional within the safe numeric range. Invalid dimensions, units, values or unsafe sums reject the snapshot.

| Observation | Accepted dimensions and units |
| --- | --- |
| Native usage rows | `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`: `tokens`; `total_nano_aiu`: `nano_aiu`; `request_multiplier`: `native_request_multiplier`; `duration_ms`, `inter_token_latency_ms`, `output_ttft_ms`, `time_to_first_token_ms`: `milliseconds` |
| Completion aggregate | `totalTokens`: `tokens`; `totalToolCalls`: `tool_calls`; `durationMs`: `milliseconds` |
| Compaction | `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`: `tokens`; `totalNanoAiu`: `nano_aiu`; `duration`: `native_duration_unit_unspecified` |

Usage rows may also carry nullable `model` and `initiator`. Groups are scoped by source, session, rooted agent, originating call, model and initiator. Every dimension includes known-row and unknown-row counts. Subtotals cover only the selected source rows, not a full job. Cache and reasoning counters must not be added again to input/output. Native accounting units are not dollars. Latency dimensions are reported separately and are not wall time.

Completion aggregates may duplicate usage rows and cover only an earlier interaction. They remain separate observations, never additive usage or final job closure. Compaction usage also remains separate because non-overlap with usage rows has not been established; its unspecified native duration is not converted to milliseconds.

### Optional references, episodes and outcome

Top-level `source_refs` and `coverage_refs` are arrays of inert strings. All reference arrays default only when the containing optional annotation is absent; malformed supplied annotations refuse.

```json
{
  "source_refs": ["source:synthetic-capture"],
  "coverage_refs": ["coverage:selected-rows"],
  "episodes": [
    {
      "episode_id": "scope-correction",
      "label": "Scope correction",
      "class": "declared",
      "fact_ids": ["started"],
      "output_refs": ["artifact:revision-b"],
      "evidence_refs": ["evidence:correction"]
    }
  ],
  "outcome": {
    "acceptance": "declared",
    "status": "accepted",
    "evidence_refs": ["receipt:declared-acceptance"],
    "artifact_refs": ["artifact:revision-b"]
  }
}
```

Episode IDs must be unique, `class` is `declared` or `inferred`, and each episode cites at least one actual in-scope fact ID. Both reference arrays are required. Multiple annotations may cite the same evidence without duplicating resource allocation. Per-episode token use is always unavailable in this schema: there is no supported exact native usage-row-to-model-event join, and timestamp-nearest matching is forbidden. Scope correction is not automatically defect rework or evidence of internal reasoning.

Outcome `acceptance` is `unassessed` or `declared`; `status` is `unknown`, `accepted`, or `not_accepted`. Unassessed acceptance requires unknown status. Declared acceptance requires nonempty evidence references. If absent, outcome is unassessed/unknown with empty references. Publication, a returned worker and independent acceptance are distinct; this command does not assess those references.

## Reading the profile

`observations.events` is the bounded event/source trail, with native hashes/pointers, fact-ID aliases and included/excluded scope. Parent and foreign facts never contribute usage or operation totals. The rooted agent view carries the dispatch evidence.

Tool and hook endpoints pair within source/session/agent using their native call identifiers. Assistant steps pair using an interaction-local turn ID, reset by each `user.message`, not the usage row's history index. Native line order is used when the stream has complete sequence pointers; otherwise timestamps order it. Equal-time interaction boundaries without a unique native sequence are refused rather than arbitrarily assigned. Reversed intervals and duplicate operation endpoints refuse. Missing endpoints remain explicit gaps with null duration.

Summed latency includes overlap. Interval union measures only the union of matched operation intervals, not active agent time, job lead time, parent overhead, a critical path, or human effort. Transport success and underlying command success are separate: only an explicit command exit code establishes the latter. Counts do not become productivity scores. Whole-job usage, independent outcome acceptance and causal productivity remain unavailable; deriving a method-improvement claim requires additional outcome and attribution evidence, not more arithmetic on activity counts.

Markdown escapes controls, bidirectional formatting controls and table-breaking metadata. JSON preserves whitelisted metadata using JSON escaping. Both formats show coverage limitations and the same input hash; neither format upgrades declared annotations into observed facts.
