/**
 * LLM boundary validators.
 *
 * The LLM is an untrusted producer of JSON. Everything it hands us is
 * `unknown` until we narrow it. Historically we cast with `as T` and hoped
 * for the best — bad output got silently persisted to result.json, or a
 * mis-typed selector propagated as a string "[object Object]" all the way
 * down to the CDP call. These helpers catch the bad shapes at the seam and
 * let callers return a typed error instead.
 *
 * Scope note: we do not implement full JSON Schema. The tools' parameter
 * schemas only use a narrow subset — `type`, `enum`, `required`, and
 * `properties` — so a 50-line validator handles what actually ships.
 */
import type { ToolDefinition } from "../models/provider";
import type { CriterionVerdict, Observation, ObservationKind } from "../types";

/**
 * The statuses the LLM is allowed to report via `report_result`. Note that
 * `"errored"` is NOT included — that variant is reserved for internal
 * emitters (shutdown drain, etc.) and never comes through the LLM seam.
 */
export type ReportableStatus = "pass" | "fail" | "investigate";

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; reason: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

const OBSERVATION_KINDS: readonly ObservationKind[] = [
  "bug",
  "ux",
  "typo",
  "suggestion",
  "a11y",
  "performance",
];
const VET_STATUSES: readonly ReportableStatus[] = ["pass", "fail", "investigate"];
const CRITERION_VERDICTS: readonly CriterionVerdict["verdict"][] = [
  "pass",
  "fail",
  "unclear",
];

/**
 * Validate the required verdict fields of a `report_result` call:
 * status (enum), summary (string), reasoning (string). Shared by the
 * strict parser and the salvage path — the "core" is what makes a
 * verdict substantive; observations are a sidecar.
 */
function parseCoreFields(args: Record<string, unknown>): ParseResult<{
  status: ReportableStatus;
  summary: string;
  reasoning: string;
}> {
  const statusRaw = args.status;
  if (typeof statusRaw !== "string") {
    return { ok: false, reason: `status: expected string, got ${typeName(statusRaw)}` };
  }
  if (!VET_STATUSES.includes(statusRaw as ReportableStatus)) {
    return {
      ok: false,
      reason: `status: "${statusRaw}" not in [${VET_STATUSES.join(", ")}]`,
    };
  }

  if (typeof args.summary !== "string") {
    return { ok: false, reason: `summary: expected string, got ${typeName(args.summary)}` };
  }
  if (typeof args.reasoning !== "string") {
    return { ok: false, reason: `reasoning: expected string, got ${typeName(args.reasoning)}` };
  }

  return {
    ok: true,
    value: {
      status: statusRaw as ReportableStatus,
      summary: args.summary,
      reasoning: args.reasoning,
    },
  };
}

/**
 * Decode an array-valued field. Some models (observed on Sonnet 4.6)
 * sometimes hand us the array already stringified —
 * `observations: "[{...}, {...}]"`. The data is valid, just one level
 * too encoded. Try a single JSON.parse before failing; if it doesn't
 * decode to an array we report the type error.
 */
function decodeArrayField(value: unknown, fieldName: string): ParseResult<unknown[]> {
  let decodedValue: unknown = value;
  if (typeof decodedValue === "string") {
    try {
      const decoded = JSON.parse(decodedValue);
      if (Array.isArray(decoded)) decodedValue = decoded;
    } catch {
      // not JSON; fall through to the type error below
    }
  }
  if (!Array.isArray(decodedValue)) {
    return {
      ok: false,
      reason: `${fieldName}: expected array, got ${typeName(decodedValue)}`,
    };
  }
  return { ok: true, value: decodedValue };
}

function parseObservation(obs: unknown, i: number): ParseResult<Observation> {
  if (!isRecord(obs)) {
    return { ok: false, reason: `observations[${i}]: expected object, got ${typeName(obs)}` };
  }
  if (typeof obs.kind !== "string" || !OBSERVATION_KINDS.includes(obs.kind as ObservationKind)) {
    return {
      ok: false,
      reason: `observations[${i}].kind: "${String(obs.kind)}" not in [${OBSERVATION_KINDS.join(", ")}]`,
    };
  }
  if (typeof obs.description !== "string") {
    return {
      ok: false,
      reason: `observations[${i}].description: expected string, got ${typeName(obs.description)}`,
    };
  }
  return {
    ok: true,
    value: { kind: obs.kind as ObservationKind, description: obs.description },
  };
}

/**
 * Validate `report_result` tool call arguments against the VetResult shape.
 *
 * Required fields: status (enum), summary (string), reasoning (string).
 * Optional: observations (array of {kind, description}).
 */
export function parseReportResult(args: unknown): ParseResult<{
  status: ReportableStatus;
  summary: string;
  reasoning: string;
  observations: Observation[];
}> {
  if (!isRecord(args)) {
    return { ok: false, reason: `expected object, got ${typeName(args)}` };
  }

  const core = parseCoreFields(args);
  if (!core.ok) return core;

  const observations: Observation[] = [];
  if (args.observations !== undefined && args.observations !== null) {
    const decoded = decodeArrayField(args.observations, "observations");
    if (!decoded.ok) return decoded;
    for (let i = 0; i < decoded.value.length; i++) {
      const obs = parseObservation(decoded.value[i], i);
      if (!obs.ok) return obs;
      observations.push(obs.value);
    }
  }

  return { ok: true, value: { ...core.value, observations } };
}

/**
 * Last-resort acceptance of a `report_result` whose core verdict is valid
 * but whose observations sidecar is (partially) malformed. Never let a
 * corrupt enum in one observation discard a substantive pass/fail — see
 * PRI-2140, where `kind: "ug"` (truncated "bug") converted a real pass
 * into investigate.
 *
 * Core fields (status/summary/reasoning) are validated as strictly as
 * `parseReportResult` — a bad verdict is NOT salvageable. Observations
 * are kept individually when valid; invalid entries are dropped and
 * reported in `dropped` so the caller can log them. An entirely
 * unusable observations field drops the whole sidecar (index -1).
 */
export function salvageReportResult(args: unknown): ParseResult<{
  status: ReportableStatus;
  summary: string;
  reasoning: string;
  observations: Observation[];
  dropped: Array<{ index: number; reason: string }>;
}> {
  if (!isRecord(args)) {
    return { ok: false, reason: `expected object, got ${typeName(args)}` };
  }

  const core = parseCoreFields(args);
  if (!core.ok) return core;

  const observations: Observation[] = [];
  const dropped: Array<{ index: number; reason: string }> = [];
  if (args.observations !== undefined && args.observations !== null) {
    const decoded = decodeArrayField(args.observations, "observations");
    if (!decoded.ok) {
      dropped.push({ index: -1, reason: decoded.reason });
    } else {
      for (let i = 0; i < decoded.value.length; i++) {
        const obs = parseObservation(decoded.value[i], i);
        if (obs.ok) observations.push(obs.value);
        else dropped.push({ index: i, reason: obs.reason });
      }
    }
  }

  return { ok: true, value: { ...core.value, observations, dropped } };
}

/**
 * Validate the per-criterion verdict citations of a `report_result` call
 * (PRI-2160). When the card declares acceptance criteria, the report
 * must carry exactly one entry per criterion, in order, each with a
 * verdict and non-empty evidence — a verdict the agent can't back with
 * something it observed is invalid and gets re-asked. Cards without
 * acceptance criteria require nothing; any stray `criteria` value is
 * ignored (the field IS the per-criterion table, and there are no
 * criteria for it to describe).
 */
export function parseReportCriteria(
  value: unknown,
  acceptanceCriteria: readonly string[],
): ParseResult<CriterionVerdict[]> {
  if (acceptanceCriteria.length === 0) {
    return { ok: true, value: [] };
  }

  if (value === undefined || value === null) {
    return {
      ok: false,
      reason:
        `criteria: missing — the story has ${acceptanceCriteria.length} acceptance ` +
        `criteria; provide one entry per criterion, in order, each with a verdict ` +
        `and the evidence you observed`,
    };
  }

  const decoded = decodeArrayField(value, "criteria");
  if (!decoded.ok) return decoded;

  if (decoded.value.length !== acceptanceCriteria.length) {
    return {
      ok: false,
      reason:
        `criteria: expected ${acceptanceCriteria.length} entries (one per ` +
        `acceptance criterion, in order), got ${decoded.value.length}`,
    };
  }

  const entries: CriterionVerdict[] = [];
  for (let i = 0; i < decoded.value.length; i++) {
    const entry = decoded.value[i];
    if (!isRecord(entry)) {
      return { ok: false, reason: `criteria[${i}]: expected object, got ${typeName(entry)}` };
    }
    if (typeof entry.criterion !== "string") {
      return {
        ok: false,
        reason: `criteria[${i}].criterion: expected string, got ${typeName(entry.criterion)}`,
      };
    }
    if (
      typeof entry.verdict !== "string" ||
      !CRITERION_VERDICTS.includes(entry.verdict as CriterionVerdict["verdict"])
    ) {
      return {
        ok: false,
        reason: `criteria[${i}].verdict: "${String(entry.verdict)}" not in [${CRITERION_VERDICTS.join(", ")}]`,
      };
    }
    if (typeof entry.evidence !== "string" || entry.evidence.trim() === "") {
      return {
        ok: false,
        reason:
          `criteria[${i}].evidence: must be a non-empty string quoting what you ` +
          `observed (screen text, file content + path, log line, or command output)`,
      };
    }
    entries.push({
      criterion: entry.criterion,
      verdict: entry.verdict as CriterionVerdict["verdict"],
      evidence: entry.evidence,
    });
  }

  return { ok: true, value: entries };
}

/**
 * Cross-field consistency between the overall verdict and the
 * per-criterion table (PRI-2160): an overall `pass` asserts the
 * acceptance criteria are met, so it may not carry a `fail` or
 * `unclear` criterion verdict. The reverse is NOT enforced — an
 * overall fail/investigate with all-passing criteria is legitimate
 * (something outside the listed criteria can still sink the run).
 */
export function checkCriteriaConsistency(
  status: ReportableStatus,
  criteria: readonly CriterionVerdict[],
): ParseResult<true> {
  if (status !== "pass") return { ok: true, value: true };
  for (let i = 0; i < criteria.length; i++) {
    if (criteria[i].verdict !== "pass") {
      return {
        ok: false,
        reason:
          `status: "pass" contradicts criteria[${i}].verdict: "${criteria[i].verdict}" — ` +
          `an overall pass requires every criterion verdict to be "pass"; ` +
          `either correct the criterion verdict or change the overall status`,
      };
    }
  }
  return { ok: true, value: true };
}

/**
 * Validate tool-call arguments against a tool's declared JSON schema.
 *
 * Handles the narrow JSON Schema subset the tools actually declare today:
 * - `type: "string" | "number" | "boolean" | "array" | "object"`
 * - `enum`
 * - `required`
 *
 * Unknown/unsupported schema constructs are passed through (permissive).
 * The goal is to catch obviously-broken LLM output like
 * `{selector: {css: "#foo"}}` when a string is expected, not to be a full
 * JSON Schema validator.
 */
export function validateToolArgs(
  toolName: string,
  args: unknown,
  schema: ToolDefinition["parameters"],
): ParseResult<Record<string, unknown>> {
  if (!isRecord(args)) {
    return {
      ok: false,
      reason: `${toolName}: args must be an object, got ${typeName(args)}`,
    };
  }

  const schemaType = (schema as Record<string, unknown>).type;
  if (schemaType !== undefined && schemaType !== "object") {
    // Top-level schema isn't an object — nothing we know how to check.
    return { ok: true, value: args };
  }

  const required = (schema as Record<string, unknown>).required;
  const requiredKeys = new Set<string>();
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key !== "string") continue;
      requiredKeys.add(key);
      if (!(key in args)) {
        return { ok: false, reason: `${toolName}: missing required property "${key}"` };
      }
      const v = args[key];
      if (v === null || v === undefined) {
        return { ok: false, reason: `${toolName}: required property "${key}" is ${v === null ? "null" : "undefined"}` };
      }
    }
  }

  const props = (schema as Record<string, unknown>).properties;
  if (!isRecord(props)) {
    return { ok: true, value: args };
  }

  for (const [key, rawDecl] of Object.entries(props)) {
    if (!(key in args)) continue;
    const value = args[key];
    // Non-required null/undefined fields are skipped (treat as absent).
    // Required nulls are caught above.
    if (value === null || value === undefined) continue;
    const propSchema = rawDecl as Record<string, unknown>;
    const err = checkValue(`${toolName}.${key}`, value, propSchema);
    if (err) return { ok: false, reason: err };
  }

  return { ok: true, value: args };
}

function checkValue(path: string, value: unknown, schema: Record<string, unknown>): string | null {
  const type = schema.type;
  if (typeof type === "string") {
    if (type === "string" && typeof value !== "string") {
      return `${path}: expected string, got ${typeName(value)}`;
    }
    if (type === "number" && typeof value !== "number") {
      return `${path}: expected number, got ${typeName(value)}`;
    }
    if (type === "boolean" && typeof value !== "boolean") {
      return `${path}: expected boolean, got ${typeName(value)}`;
    }
    if (type === "array" && !Array.isArray(value)) {
      return `${path}: expected array, got ${typeName(value)}`;
    }
    if (type === "object" && !isRecord(value)) {
      return `${path}: expected object, got ${typeName(value)}`;
    }
  }

  const enumVals = schema.enum;
  if (Array.isArray(enumVals) && !enumVals.includes(value as never)) {
    return `${path}: "${String(value)}" not in [${enumVals.join(", ")}]`;
  }

  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
