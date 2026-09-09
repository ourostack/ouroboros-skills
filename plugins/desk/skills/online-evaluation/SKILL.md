---
name: online-evaluation
description: Evaluate a real Desk work item's outcome, flow, review burden and resource consumption at an agreed endpoint or observation horizon. Use for a work-item evaluation or retrospective, not for every tool call. Composes canonical Desk records, the private work ledger and existing independent outcome evidence. Does not own the lifecycle, start another implementation loop, run an offline benchmark, grant collection permission or rank people.
---

# Online evaluation

Produce an evidence-backed account of real work. Keep outcome quality, flow and consumption separate.

The selected lifecycle still owns the work and any remediation. This skill reads its evidence and reports what happened. It does not introduce another task store, planner, reviewer-fix loop or model execution service.

## Start from the existing work item

Find the canonical Desk task and active iteration. Keep the same outcome identity through planning, implementation, review, necessary rework and publication. A session, PR, delegated step or report is not another work item. Use the ledger's existing binding rather than creating an item because a report was requested.

Read the request, commitment, intended endpoint and completion evidence. Record the observation horizon. Keep unfinished work censored at that horizon and cancellations separate from delivery, with their recorded cause and time. A missing canonical binding makes the work-item evaluation unavailable; it does not justify inventing one in a private report.

Use the work-type, scope, system, uncertainty, risk and verification features recorded before execution. Preserve their declaration time. If they were captured later, label them post-hoc or unavailable rather than presenting them as predictive sizing. Do not label expensive work complex because it was expensive.

At intake, the normal lifecycle can record the criteria and horizon alongside its existing commitment. At evaluation time, reuse them. Do not add another approval ceremony or retrospectively tune the criteria to the result. Criteria or a horizon first recorded after execution are post-hoc, including on the conclusion; they are not preregistered.

## Check recording and the real capabilities

Use the selected `desk_work_ledger` tool's current schema and capability disclosure. Invoke the real report/inspection routes and retain their status and provenance. Do not infer availability from a skill name or substitute sample data when a route is absent. If the whole ledger tool is absent, mark flow and consumption unavailable and return the supported outcome-only assessment in the response; this does not authorize new artifact capture.

If recording is disabled, inspection of existing records remains possible. Do not enable recording, import new observations, link new measurement receipts or write a new evaluation artifact merely to finish this assessment. Return the disabled-recording limitation in the response. Correction and deletion remain the owner's rights.

For an authorized import, use an explicit evidenced local-session/source binding through the supported ledger route. A child agent's environment identifier, a cloud identifier or a nearby session is not automatically the local source identity. Do not guess from recency. Do not supply an arbitrary database path or collect another person's records.

Missing usage does not erase available outcome evidence. Missing outcome evidence does not become success because usage is available. Missing capabilities and coverage remain visible in the assessment.

## Keep the operated composition attached

Reference the actual selected-source and native-consumption evidence for the observed work segment: lifecycle and contextual components, implementation posture including Ponytail/reuse policy, runtime build, model identity/effort, reviewer configuration, host, authority and interaction mode. Preserve source hashes and the covered interval.

A requested source specification, installed menu entry or author-declared label is not proof that the work ran under that composition. Keep that distinction in the report. Do not label earlier work as V2 exposure simply because its usage was imported into a V2 ledger. A mixed or unknown exposure remains mixed or unknown.

## Assess the outcome before interpreting efficiency

For each criterion fixed by the request, record the observable result, its evidence source and any limitation. Use the appropriate far boundary: delivered behavior, a published artifact in its consuming environment, a system-of-record result or a source-bound check. A document claiming that it works is not the same evidence as the result.

Reuse existing independent review and QA evidence when its source, scope and requirements still match. For code, use the selected independent-review function and its actual review receipt. A passing review, feedback or green diagnostic alone is not endpoint evidence. Do not launch another review solely to manufacture a measurement. A missing or stale assessment is unavailable; if a fresh assessment is necessary, route it through the established independent-review owner without creating another remediation loop.

Keep the following separate:

- The canonical completion claim and its declared evidence.
- What the endpoint observation establishes.
- The independent assessor's judgment, identity, source scope and unresolved findings.
- The evaluation's conclusion: `satisfied`, `not_satisfied` or `unavailable`, with the supporting criterion results. Apply the evaluation owner's published importance/severity ranking and quality floors to those results; if that model is unpublished or unbound, mark the classification unavailable rather than inventing one.

A major defect or unsafe outcome is not redeemed by low cost or short duration. Missing evidence is not a clean verdict. If the canonical completion claim conflicts with the observed result, report the mismatch and hand the finding to the existing lifecycle on the same work item. Do not silently rewrite canonical state while measuring it.

## Account for the work without inventing time or prices

Use the ledger's work/phase/cycle/model/subagent views. Preserve each value's `measured`, `declared`, `inferred`, `estimated` or `unavailable` class, source identity, units and coverage. Do not recompute the ledger's aggregates in another store or upgrade declared attribution into exclusive measured consumption. Never render an unavailable, deleted or out-of-coverage value as zero, or total a partial view without naming the gap. State whether subagent or parent-inclusive records are already contained in the work-level total; do not add them twice.

Anchor intake-to-endpoint lead time to the canonical record's first intake, never to ledger binding or the first observed usage. Preserve a supported intake/endpoint span when detailed recording starts later, with that earlier measurement gap explicit. If intake itself is only known to precede observation, mark the span left-censored and give the coverage start or supported lower bound rather than manufacturing a start. Unfinished work also retains right-censoring at its horizon. Report source-native durations separately. Summed API duration is not item lead time, GPU compute time or human effort. Do not invent request intervals from a timestamp whose producer meaning is unknown.

Attach recorded intervals to their actors/resources. Keep active, queue, blocked and unknown classes distinct, with rework as a purpose annotation that can overlap activity. Preserve censored bounds and `not_applicable` status separately from the activity class rather than folding them into unknown. Show known overlap and dependency information. When the evidence cannot establish unknown-share or the critical chain, mark that analysis unavailable. Do not infer that removing any busy interval would have advanced delivery.

Record interruptions, review burden and failure demand from evidence. An interruption is a human intervention episode with a cause, not every user-shaped message. Review burden counts review occasions and resulting rework cycles, not comments. Failure demand needs a cause linking the work to earlier incorrect output; necessary exploration does not become waste by default. Keep machine and human burden distinct, and do not infer human effort by subtracting time from a wall-clock gap.

Keep token counters, source-named credit/multiplier units and money separate. Use only the ledger's qualified cost basis for monetary assertions. Never convert account totals into a task bill, invent a rate or report counterfactual savings as measured. Preserve repeated-source, shared-attribution, deletion and recording-gap limitations. Use the shared-artifact attribution rule declared before aggregation, never a split selected after seeing the totals.

## Return one useful report

Run the full assessment at the requested horizon or endpoint, not after every tool call. Event capture should reuse facts already produced during the work. Repeatedly asking models to reinterpret the same unchanged progress is not measurement.

The report contains the canonical identity and horizon, composition exposure, criterion-level outcome evidence, flow and consumption views, interruption/review/failure-demand evidence, coverage and any grounded work-design findings. Keep numeric denominators explicit. Retain incomplete and never-approved work; do not silently narrow the view to completed items. Do not create a composite productivity score; cost per completed item is descriptive only.

Separate an observed cause from a hypothesis. A proposed workflow change should name the avoidable failure or wait it targets and the quality constraint it preserves. If the critical chain or attribution is unknown, do not attach a fabricated time or money saving.

Persist only when recording and the artifact location are authorized. Use the already-approved, protected work/iteration/attempt evidence location supplied by the current Desk context. Never use the ledger database partition as an artifact directory, create a second metrics database, overwrite an earlier report, or fall back to a Git-backed desk or harness scratch. If the protected location cannot be established, report storage as unavailable and do not write elsewhere.

Retain the original ledger response and qualified assessment/source references with the report, without copying raw transcripts. Canonical Desk records receive only the permitted reference or explicitly approved summary, not private usage or financial detail.

A real-world failure can become a candidate fixed offline regression case. Preserve its recurrence evidence and propose that case through the existing evaluation owner. Do not silently edit a frozen dataset, discard failed attempts or claim comparative improvement from this observational report.
