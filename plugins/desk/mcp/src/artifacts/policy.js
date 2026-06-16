import { promises as fs } from "node:fs"
import * as path from "node:path"

const ARTIFACT_POLICY_PATH = path.join("artifacts", "publication-policy.json")
const ARTIFACT_POLICY_SCHEMA_PATH = path.join("artifacts", "publication-policy.schema.json")
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T/u

export async function loadPublicationPolicy({ pluginRoot } = {}) {
  const policyPath = path.join(pluginRoot, ARTIFACT_POLICY_PATH)
  const schemaPath = path.join(pluginRoot, ARTIFACT_POLICY_SCHEMA_PATH)
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"))
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"))
  const diagnostics = validatePublicationPolicy({ policy, schema })
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    policy,
    policy_path: policyPath,
    schema_path: schemaPath,
  }
}

export function validatePublicationPolicy({ policy, schema }) {
  const requiredFields = schema.required
  const properties = schema.properties
  const diagnostics = requiredFields
    .filter((field) => !Object.hasOwn(policy, field))
    .map((field) => `publication policy missing ${field}`)
  for (const field of Object.keys(policy)) {
    if (!Object.hasOwn(properties, field)) {
      diagnostics.push(`publication policy has unsupported field ${field}`)
    }
  }
  const checks = [
    [
      policy.schema_version === properties.schema_version.const,
      "publication policy schema_version is unsupported",
    ],
    [
      properties.default_publication.enum.includes(policy.default_publication),
      "publication policy default_publication is unsupported",
    ],
    [
      properties.repo_visibility.enum.includes(policy.repo_visibility),
      "publication policy repo_visibility is unsupported",
    ],
    [
      typeof policy.sensitive_repo === properties.sensitive_repo.type,
      "publication policy sensitive_repo must be boolean",
    ],
    [
      typeof policy.approval_required === properties.approval_required.type,
      "publication policy approval_required must be boolean",
    ],
    [
      Array.isArray(policy.approved_artifact_types),
      "publication policy approved_artifact_types must be an array",
    ],
    [
      Array.isArray(policy.approvals),
      "publication policy approvals must be an array",
    ],
    [
      isDateTime(policy.updated_at),
      "publication policy updated_at must be a date-time string",
    ],
  ]
  for (const [ok, message] of checks) {
    if (!ok) diagnostics.push(message)
  }
  validateApprovedArtifactTypes({
    approvedTypes: policy.approved_artifact_types,
    allowedTypes: properties.approved_artifact_types.items.enum,
    diagnostics,
  })
  validateApprovals({
    approvals: policy.approvals,
    schema: properties.approvals.items,
    diagnostics,
  })
  return diagnostics
}

export function evaluateArtifactPublication({ policy, artifact_type, operation }) {
  const approvedTypes = new Set(policy.approved_artifact_types)
  if (!approvedTypes.has(artifact_type)) {
    return {
      allowed: false,
      reason: "artifact_type_not_approved",
      message: `${artifact_type} publication is not approved for ${operation}`,
    }
  }

  const approval = policy.approvals
    .find((candidate) => candidate.artifact_type === artifact_type)
  if (approval) {
    return {
      allowed: true,
      reason: "approved",
      approval_scope: approval.scope,
      approval_actor: approval.approved_by,
    }
  }

  return {
    allowed: false,
    reason: "approval_required",
    message: `${artifact_type} publication requires explicit approval`,
  }
}

export async function assertArtifactPublicationAllowed(args = {}) {
  const decision = evaluateArtifactPublication(args)
  if (decision.allowed) return decision

  const error = new Error(decision.message)
  error.code = "artifact_publication_not_approved"
  error.reason = decision.reason
  error.artifact_type = args.artifact_type
  error.relative_path = args.relative_path
  throw error
}

export async function policyForArtifactWrite({ pluginRoot, policy }) {
  const loaded = policy
    ? await validateSuppliedPublicationPolicy({ pluginRoot, policy })
    : await loadPublicationPolicy({ pluginRoot })
  if (loaded.valid) return loaded.policy
  const error = new Error("artifact publication policy is invalid")
  error.code = "artifact_publication_policy_invalid"
  error.diagnostics = loaded.diagnostics
  throw error
}

async function validateSuppliedPublicationPolicy({ pluginRoot, policy }) {
  const schemaPath = path.join(pluginRoot, ARTIFACT_POLICY_SCHEMA_PATH)
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"))
  const diagnostics = validatePublicationPolicy({ policy, schema })
  return {
    valid: diagnostics.length === 0,
    diagnostics,
    policy,
    schema_path: schemaPath,
  }
}

function validateApprovedArtifactTypes({ approvedTypes, allowedTypes, diagnostics }) {
  if (!Array.isArray(approvedTypes)) return
  const seen = new Set()
  for (const artifactType of approvedTypes) {
    if (!allowedTypes.includes(artifactType)) {
      diagnostics.push(`publication policy approved_artifact_types includes unsupported ${artifactType}`)
    }
    if (seen.has(artifactType)) {
      diagnostics.push(`publication policy approved_artifact_types duplicates ${artifactType}`)
    }
    seen.add(artifactType)
  }
}

function validateApprovals({ approvals, schema, diagnostics }) {
  if (!Array.isArray(approvals)) return
  const properties = schema.properties
  for (let index = 0; index < approvals.length; index += 1) {
    const approval = approvals[index]
    if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
      diagnostics.push(`publication policy approvals[${index}] must be an object`)
      continue
    }
    for (const field of schema.required) {
      if (!Object.hasOwn(approval, field)) {
        diagnostics.push(`publication policy approvals[${index}] missing ${field}`)
      }
    }
    for (const field of Object.keys(approval)) {
      if (!Object.hasOwn(properties, field)) {
        diagnostics.push(`publication policy approvals[${index}] has unsupported field ${field}`)
      }
    }
    if (!properties.scope.enum.includes(approval.scope)) {
      diagnostics.push(`publication policy approvals[${index}].scope is unsupported`)
    }
    if (!properties.artifact_type.enum.includes(approval.artifact_type)) {
      diagnostics.push(`publication policy approvals[${index}].artifact_type is unsupported`)
    }
    if (!hasNonEmptyText(approval.approved_by)) {
      diagnostics.push(`publication policy approvals[${index}].approved_by must be non-empty text`)
    }
    if (!isDateTime(approval.approved_at)) {
      diagnostics.push(`publication policy approvals[${index}].approved_at must be a date-time string`)
    }
    if (!hasNonEmptyText(approval.reason)) {
      diagnostics.push(`publication policy approvals[${index}].reason must be non-empty text`)
    }
  }
}

function isDateTime(value) {
  return typeof value === "string" && DATE_TIME_RE.test(value)
}

function hasNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== ""
}
