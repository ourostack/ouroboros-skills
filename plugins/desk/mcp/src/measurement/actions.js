// The dispatch table desk_work_ledger routes on.
//
// This is the single source of truth for which routes exist and which input
// fields each one accepts. `capabilities` is derived from this object rather
// than from a hand-maintained list, so a route cannot be advertised without
// being routable, and a field cannot be accepted without being written down
// here. Every list starts with "action" and contains no field that would let a
// caller choose where the private store lives.

export const LEDGER_ACTIONS = {
  capabilities: ["action"],
  intake: ["action", "request", "requested_by", "request_key"],
  commit: [
    "action",
    "work_item_id",
    "outcome",
    "scope",
    "evidence",
    "delivery_endpoint",
    "operator_go",
    "task_ref",
  ],
  size: [
    "action",
    "work_item_id",
    "work_type",
    "scope",
    "systems",
    "uncertainty",
    "risk",
    "verification",
  ],
  phase: ["action", "work_item_id", "phase", "cycle", "started_at", "ended_at", "state"],
  scope_change: ["action", "work_item_id", "kind", "change", "reason", "agreed_by"],
  link: ["action", "work_item_id", "related_work_item_id", "relation"],
  complete: ["action", "work_item_id", "endpoint", "evidence"],
  close: ["action", "work_item_id", "state", "reason"],
  correct: ["action", "work_item_id", "field", "value", "expected_revision", "reason"],
  delete: ["action", "work_item_id", "confirm"],
  inspect: ["action", "work_item_id"],
  report: ["action", "work_item_id", "include_phase_span"],
  review: ["action", "since", "until", "carry_forward"],
  import_usage: [
    "action",
    "work_item_id",
    "source",
    "session_id",
    "machine_id",
    "since",
    "until",
  ],
  cost_basis: [
    "action",
    "work_item_id",
    "amount",
    "currency",
    "rate",
    "rate_unit",
    "source",
    "effective_date",
    "expected_revision",
  ],
  set_recording: ["action", "enabled", "reason"],
  link_evaluation_receipt: [
    "action",
    "work_item_id",
    "measurement_kind",
    "receipt_ref",
    "receipt_sha256",
    "run_set_id",
    "run_id",
    "case_id",
    "status",
    "grade",
    "availability",
  ],
}

/**
 * Routes that write new observations to the ledger. These are the ones the
 * recording switch governs. Inspection, correction, deletion, reporting and the
 * switch itself stay available while recording is off, because those are the
 * owner's rights over what is already held rather than new capture.
 */
export const CAPTURE_ROUTES = new Set([
  "intake",
  "commit",
  "size",
  "phase",
  "scope_change",
  "link",
  "complete",
  "close",
  "import_usage",
  "cost_basis",
  "link_evaluation_receipt",
])
