import { parseReportResult, parseReportCriteria, checkCriteriaConsistency } from "./vendor/gauntlet/src/agent/validators.ts";
import { MAX_FILE_BYTES, canonicalJson, exactKeys, hashString, nonblank, parseRawJson, plainObject, readRawReference, relativeName, requireCondition, sha256 } from "./core.mjs";
import { validateCleanupReceipt } from "./copilot-runner.mjs";

const rootAgent = event => event.agentId ?? null;
const callKey = (sessionId, agentId, toolCallId) => JSON.stringify([sessionId, agentId, toolCallId]);
const argumentHash = value => sha256(JSON.stringify(value));
const badReport = reason => ({ ok: false, reason });
function immutable(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) immutable(member);
  }
  return value;
}
const payload = canonicalJson;
function observedRecord(entry) {
  requireCondition(plainObject(entry) && nonblank(entry.sessionId) && Buffer.isBuffer(entry.rawRecord) && entry.rawRecord.length <= MAX_FILE_BYTES && plainObject(entry.ref), "INVALID_OBSERVATION", "Expected a bounded session-bound raw observation");
  const { ref, rawRecord } = entry;
  relativeName(ref.path);
  requireCondition(ref.sessionId === entry.sessionId && nonblank(ref.eventId) && Number.isSafeInteger(ref.byteOffset) && ref.byteOffset >= 0 && ref.byteLength === rawRecord.length && ref.sha256 === sha256(rawRecord), "OBSERVATION_REFERENCE_MISMATCH", "Observed bytes do not match their session-bound raw reference");
  const event = parseRawJson(rawRecord);
  requireCondition(plainObject(event) && event.id === ref.eventId && nonblank(event.type), "INVALID_OBSERVED_EVENT", "A raw event must retain its actual identity and type");
  return { ...entry, event };
}
function rootRequests(records, sessionId, rootAgentId, expectedMode) {
  const requests = new Map();
  const conflicts = new Set();
  const eventPayloads = new Map();
  const eventConflicts = [];
  const rootStarts = records.flatMap((record, index) => record.sessionId === sessionId && rootAgent(record.event) === rootAgentId && record.event.type === "assistant.turn_start" ? [{ eventId: record.event.id, index, turnId: record.event.data?.turnId }] : []);
  const firstRootIndex = rootStarts[0]?.index ?? Infinity;
  const knownTurns = new Set(rootStarts.map(start => start.turnId).filter(nonblank));
  const turnWindows = new Map(rootStarts.filter(start => nonblank(start.turnId)).map(start => [start.turnId, start]));
  let activeRootWindow;
  const supportedTurnIds = new Set();
  let rootIdle = { eligible: false };
  let lastRootRequestIndex = -1;
  for (const [index, record] of records.entries()) {
    const { event, ref } = record;
    const agentId = rootAgent(event);
    const eventKey = JSON.stringify([record.sessionId, agentId, event.id]);
    const serialized = payload(event);
    if (eventPayloads.has(eventKey) && eventPayloads.get(eventKey) !== serialized) eventConflicts.push(ref);
    eventPayloads.set(eventKey, serialized);
    const data = plainObject(event.data) ? event.data : {};
    if (record.sessionId === sessionId && agentId === rootAgentId && event.type === "assistant.turn_start") activeRootWindow = { eventId: event.id };
    const inRoot = record.sessionId === sessionId && agentId === rootAgentId && index >= firstRootIndex && (!nonblank(data.turnId) || knownTurns.size === 0 || knownTurns.has(data.turnId));
    if (inRoot && nonblank(data.turnId)) supportedTurnIds.add(data.turnId);
    if (inRoot && event.type === "session.idle") rootIdle = { eligible: data.mode === expectedMode && data.aborted === false, eventId: event.id, index, receivedAt: record.receivedAt, ref, mode: data.mode, aborted: data.aborted };
    const calls = event.type === "assistant.message" && Array.isArray(data.toolRequests)
      ? data.toolRequests.filter(call => plainObject(call) && call.name === "report_result")
      : event.type === "assistant.tool_call_delta" && data.toolName === "report_result"
        ? [{ toolCallId: data.toolCallId, name: "report_result", partial: true }] : [];
    for (const call of calls) {
      const toolCallId = nonblank(call.toolCallId) ? call.toolCallId : null;
      const scopeWindow = inRoot ? turnWindows.get(data.turnId) ?? activeRootWindow : activeRootWindow;
      const key = JSON.stringify([callKey(record.sessionId, agentId, toolCallId), inRoot, scopeWindow?.eventId ?? null]);
      const argumentsState = event.type === "assistant.tool_call_delta" ? "partial" : Object.hasOwn(call, "arguments") ? "complete" : "unobserved";
      const request = {
        sessionId: record.sessionId, agentId, toolCallId, argumentsState,
        turnId: nonblank(data.turnId) ? data.turnId : null,
        scopeStartEventId: scopeWindow?.eventId ?? null,
        scopeBasis: nonblank(data.turnId) ? "supported-turn-id" : "observed-root-window",
        arguments: call.arguments, requestRefs: [ref], inRoot,
      };
      const previous = requests.get(key);
      if (!previous) {
        requests.set(key, request);
        if (inRoot) lastRootRequestIndex = index;
      }
      else {
        if (previous.argumentsState === "complete" && argumentsState === "complete" && payload(previous.arguments) !== payload(call.arguments)) conflicts.add(key);
        if (previous.argumentsState !== "complete" && argumentsState === "complete") {
          requests.set(key, { ...request, requestRefs: [...previous.requestRefs, ref] });
          if (inRoot) lastRootRequestIndex = index;
        }
        else previous.requestRefs.push(ref);
      }
    }
  }
  rootIdle.eligible = rootIdle.eligible && rootStarts.length > 0 && rootStarts[0].index < rootIdle.index && lastRootRequestIndex < rootIdle.index;
  const all = [...requests.values()];
  const root = all.filter(request => request.inRoot);
  const completeRootRequests = root.filter(request => request.argumentsState === "complete");
  const partialRootRequests = root.filter(request => request.argumentsState === "partial");
  const unobservedRootRequests = root.filter(request => request.argumentsState === "unobserved");
  const conflictingCalls = [...conflicts].filter(key => requests.get(key).inRoot).map(key => requests.get(key));
  const complete = rootIdle.eligible && partialRootRequests.length === 0 && unobservedRootRequests.length === 0 && root.every(request => request.toolCallId !== null) && conflictingCalls.length === 0 && eventConflicts.length === 0 && !all.some(request => request.sessionId === sessionId && request.agentId === rootAgentId && !request.inRoot);
  return {
    completeRootRequests, partialRootRequests, unobservedRootRequests, conflictingCalls, eventConflicts, rootIdle, rootStarts,
    supportedTurnIds: [...supportedTurnIds].sort(),
    excludedChildRequests: all.filter(request => request.sessionId === sessionId && request.agentId !== rootAgentId),
    outOfScopeRequests: all.filter(request => request.sessionId !== sessionId || (request.agentId === rootAgentId && !request.inRoot)),
    availability: complete ? "available" : "unavailable", admissionEligible: complete, modelProtocolViolation: false,
  };
}
export function normalizeJudgeObservations({ sessionId, rootAgentId, expectedMode, events }) {
  const records = [];
  const captureErrors = [];
  for (const entry of events) {
    try { records.push(observedRecord(entry)); }
    catch (error) { captureErrors.push(error.message); }
  }
  const result = rootRequests(records, sessionId, rootAgentId, expectedMode);
  return { ...result, captureErrors, availability: captureErrors.length ? "unavailable" : result.availability, admissionEligible: captureErrors.length === 0 && result.admissionEligible };
}
export function validateTerminalReport(value, { criteria, evidenceIndex } = {}) {
  try {
    if (!Array.isArray(criteria) || criteria.length === 0 || !criteria.every(nonblank) || new Set(criteria).size !== criteria.length || !Array.isArray(evidenceIndex?.files)) return badReport("A nonempty frozen rubric and evidence index are required");
    if (!exactKeys(value, ["status", "summary", "reasoning", "criteria"], ["observations"]) || !nonblank(value.summary) || !nonblank(value.reasoning) || !Array.isArray(value.criteria) || (value.observations !== undefined && !Array.isArray(value.observations))) return badReport("Report fields must use their strict, nonblank declared shapes");
    const parsed = parseReportResult(value);
    if (!parsed.ok) return parsed;
    const table = parseReportCriteria(value.criteria, criteria);
    if (!table.ok) return table;
    if (!value.criteria.every((row, index) => exactKeys(row, ["criterion", "verdict", "evidence"]) && row.criterion === criteria[index])) return badReport("Report criteria must match the frozen rubric exactly and in order");
    if (!parsed.value.observations.every(row => nonblank(row.description))) return badReport("Observation descriptions must be nonblank");
    for (const file of evidenceIndex.files) relativeName(file);
    if (!table.value.every(row => evidenceIndex.files.some(file => {
      const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[\\s\\[(])${escaped}(?::[1-9]\\d*(?:-[1-9]\\d*)?)?(?=$|[\\s\\]).,;])`).test(row.evidence);
    }))) return badReport("Each criterion must cite a listed evidence path");
    const consistent = checkCriteriaConsistency(parsed.value.status, table.value);
    if (!consistent.ok) return consistent;
    if (parsed.value.status === "fail" && !table.value.some(row => row.verdict === "fail")) return badReport("An overall fail requires a failed frozen criterion");
    if (parsed.value.status === "investigate" && !table.value.some(row => row.verdict === "unclear")) return badReport("Investigate requires an unclear frozen criterion");
    return { ok: true, value: { ...parsed.value, criteria: table.value, unexpectedConcerns: parsed.value.observations } };
  } catch (error) { return badReport(error.message); }
}
function coverageMatches(coverage, sdk, schema, observed, sessionId, rootAgentId, readArtifact) {
  try {
    requireCondition(plainObject(coverage) && coverage.status === "complete" && coverage.sessionId === sessionId && coverage.observedFromSessionStart === true && coverage.historyReconciled === true && coverage.truncated === false && Array.isArray(coverage.pendingCallIds) && coverage.pendingCallIds.length === 0 && Array.isArray(coverage.captureErrors) && coverage.captureErrors.length === 0, "INCOMPLETE_ATTEMPT_COVERAGE", "Attempt coverage is not complete");
    requireCondition(coverage.recordCount === sdk.length && coverage.rawEventsSha256 === sha256(Buffer.concat(sdk.map(record => record.rawRecord))) && coverage.rawSchemaEventsSha256 === sha256(Buffer.concat(schema.map(record => record.rawRecord))), "CAPTURE_STREAM_MISMATCH", "Coverage does not match both captured raw streams");
    const window = coverage.rootWindow;
    requireCondition(plainObject(window) && window.dispatchCount === 1 && window.unambiguous === true && window.rootAgentId === rootAgentId && window.startEventId === observed.rootStarts[0]?.eventId && window.terminalEventId === observed.rootIdle.eventId && coverage.terminalEventId === observed.rootIdle.eventId && payload(window.supportedTurnIds) === payload(observed.supportedTurnIds), "ROOT_WINDOW_UNAVAILABLE", "The observed root dispatch window is not reconciled");
    const historyBytes = readRawReference(coverage.historyResponseRef, readArtifact);
    requireCondition(coverage.historyResponseRef.byteLength === historyBytes.length, "HISTORY_REFERENCE_MISMATCH", "History response length differs from its raw reference");
    const history = parseRawJson(historyBytes);
    requireCondition(Array.isArray(history), "INVALID_HISTORY_RESPONSE", "Expected the actual SDK event-history response");
    const historical = rootRequests(history.map(event => ({ event, sessionId, ref: null })), sessionId, rootAgentId, observed.rootIdle.mode);
    const signature = requests => requests.map(request => [request.toolCallId, request.scopeStartEventId, request.turnId, request.argumentsState, request.arguments]).sort((a, b) => a[0].localeCompare(b[0]));
    requireCondition(historical.conflictingCalls.length === 0 && historical.eventConflicts.length === 0 && payload(signature(historical.completeRootRequests)) === payload(signature(observed.completeRootRequests)), "HISTORY_RECONCILIATION_FAILED", "History and observed complete root requests disagree");
    return true;
  } catch { return false; }
}
export function createReportAdmission({ runId, sessionId, rootAgentId, expectedMode, criteria, evidenceIndex, schemaSha256, deadlineAt, clock = Date.now, readArtifact }) {
  requireCondition(nonblank(runId) && nonblank(sessionId) && (rootAgentId === null || nonblank(rootAgentId)) && nonblank(expectedMode) && hashString(schemaSha256) && Number.isFinite(deadlineAt) && typeof clock === "function" && Array.isArray(criteria) && criteria.length > 0 && criteria.every(nonblank) && Array.isArray(evidenceIndex?.files), "INVALID_ADMISSION_CONTRACT", "Admission requires a fixed session, mode, rubric, schema and deadline");
  const rubric = { criteria: [...criteria], evidenceIndex: { files: [...evidenceIndex.files] } };
  const sdk = [];
  const schema = [];
  const handlers = [];
  const captureErrors = [];
  const offsets = new Map();
  let finished;
  function observe(entry, destination) {
    if (finished) return { accepted: false, reason: "run_already_finished" };
    try {
      const copy = { ...entry, rawRecord: Buffer.from(entry.rawRecord), ref: { ...entry.ref }, receivedAt: clock() };
      const record = observedRecord(copy);
      const expectedOffset = offsets.get(record.ref.path) ?? 0;
      requireCondition(record.ref.byteOffset === expectedOffset && expectedOffset + record.rawRecord.length <= MAX_FILE_BYTES && destination.length < 100000, "CAPTURE_OFFSET_OR_LIMIT", "Raw capture has a gap, overlap or exceeded bound");
      offsets.set(record.ref.path, expectedOffset + record.rawRecord.length);
      destination.push(record);
      return { accepted: true };
    } catch (error) {
      captureErrors.push(error.message);
      return { accepted: false, reason: error.message };
    }
  }
  return Object.freeze({
    observeSdkEvent(entry) { return observe(entry, sdk); },
    observeSchemaEvent(entry) { return observe(entry, schema); },
    handle(value, invocation) {
      const validation = validateTerminalReport(value, rubric);
      const enteredAt = clock();
      let argumentsSha256 = null;
      try { argumentsSha256 = argumentHash(value); } catch { /* Non-JSON callback input cannot be joined to a model request. */ }
      const scoped = invocation?.sessionId === sessionId && invocation.toolName === "report_result" && nonblank(invocation.toolCallId);
      const successful = !finished && enteredAt < deadlineAt && scoped && validation.ok;
      const returned = successful
        ? { resultType: "success", textResultForLlm: "Terminal report accepted for execution; final admission still requires complete raw evidence." }
        : { resultType: "failure", error: validation.ok ? "Report is outside the active run or deadline" : validation.reason, textResultForLlm: validation.ok ? "Report is outside the active run or deadline" : validation.reason };
      if (!finished) handlers.push({ sessionId: invocation?.sessionId, toolCallId: invocation?.toolCallId, argumentsSha256, enteredAt, resultType: returned.resultType, scoped });
      return returned;
    },
    finish({ endReason, attemptCoverage, sourceVerified, evidenceVerified, runtimeVerified, cleanupReceipt }) {
      if (finished) return finished;
      const observed = rootRequests(sdk, sessionId, rootAgentId, expectedMode);
      const attempts = observed.completeRootRequests.map(request => {
        const argumentsSha256 = argumentHash(request.arguments);
        const ambiguous = observed.excludedChildRequests.some(child => child.toolCallId === request.toolCallId) || observed.completeRootRequests.some(other => other !== request && other.toolCallId === request.toolCallId);
        const entered = handlers.filter(handler => handler.scoped && handler.sessionId === request.sessionId && handler.toolCallId === request.toolCallId && handler.argumentsSha256 === argumentsSha256);
        const decisions = schema.filter(record => record.sessionId === sessionId && record.event.sessionId === sessionId && record.event.type === "report.schema_decision" && record.event.toolCallId === request.toolCallId && record.event.schemaSha256 === schemaSha256 && record.event.argumentsSha256 === argumentsSha256 && ["accepted", "rejected"].includes(record.event.decision) && ["handler", "runtime_event"].includes(record.event.origin));
        const completions = sdk.filter(record => record.sessionId === sessionId && rootAgent(record.event) === rootAgentId && record.event.type === "tool.execution_complete" && record.event.data?.toolCallId === request.toolCallId);
        const validation = validateTerminalReport(request.arguments, rubric);
        const accepted = !ambiguous && decisions.some(record => record.event.decision === "accepted" && record.event.origin === "handler");
        return {
          ...request, ambiguous, argumentsSha256, handlerEntered: entered.length > 0,
          schemaAcceptedHandlerCount: accepted ? entered.length : 0,
          handlerSucceeded: entered.some(handler => handler.resultType === "success"),
          validatorAccepted: validation.ok, report: validation.ok ? validation.value : null,
          validationReason: validation.ok ? null : validation.reason,
          schemaEventRefs: decisions.map(record => record.ref), executionCompletionRefs: completions.map(record => record.ref),
          executionSucceeded: completions.some(record => record.event.data.success === true),
          executionFailed: completions.some(record => record.event.data.success === false),
          rejectionObserved: decisions.some(record => record.event.decision === "rejected") || entered.some(handler => handler.resultType === "failure"),
        };
      });
      const valid = attempts.filter(attempt => attempt.validatorAccepted);
      const counts = { observedRequests: attempts.length, schemaAcceptedHandlers: attempts.reduce((sum, attempt) => sum + attempt.schemaAcceptedHandlerCount, 0), validatorAcceptedReports: valid.length, admittedGrades: 0 };
      const result = { schemaVersion: 1, runId, sessionId, status: "unavailable", grade: null, modelProtocolViolation: false, counts, attempts, observation: observed, attemptCoverage, captureErrors: [...captureErrors], qualificationBasis: "caller-supplied-source-evidence-runtime-verification" };
      if (endReason === "cancelled") result.status = "cancelled";
      else if (endReason === "deadline" || endReason === "timed_out" || (observed.rootIdle.receivedAt ?? clock()) >= deadlineAt) result.status = "timed_out";
      else if (endReason !== "idle" || sourceVerified !== true || evidenceVerified !== true || runtimeVerified !== true || captureErrors.length > 0 || !observed.admissionEligible || !coverageMatches(attemptCoverage, sdk, schema, observed, sessionId, rootAgentId, readArtifact) || !validateCleanupReceipt(cleanupReceipt, { runId, readArtifact }).ok) result.reason = "required_observation_or_verification_unavailable";
      else if (valid.length > 1) {
        result.status = "protocol_failure";
        result.modelProtocolViolation = true;
        result.reason = "multiple_validator_accepted_terminal_requests";
      } else if (valid.length === 1) {
        const terminal = valid[0];
        if (attempts.some(attempt => attempt.ambiguous) || terminal.schemaAcceptedHandlerCount === 0 || !terminal.handlerEntered) result.reason = "schema_or_handler_scope_unavailable";
        else if (terminal.executionFailed) result.status = "infrastructure_failure";
        else if (!terminal.executionSucceeded || !terminal.handlerSucceeded || attempts.some(attempt => !attempt.validatorAccepted && (!attempt.rejectionObserved || attempt.executionCompletionRefs.length === 0))) result.reason = "execution_or_attempt_completeness_unavailable";
        else {
          result.grade = terminal.report;
          result.status = terminal.report.status === "pass" ? "passed" : terminal.report.status === "fail" ? "product_failure" : "inconclusive";
          counts.admittedGrades = 1;
        }
      } else if (attempts.length > 0 && attempts.every(attempt => attempt.rejectionObserved && attempt.executionFailed)) {
        result.status = "protocol_failure";
        result.modelProtocolViolation = true;
        result.reason = "no_validator_accepted_terminal_request";
      } else result.reason = "terminal_report_unavailable";
      finished = immutable(structuredClone(result));
      return finished;
    },
  });
}
