import { promises as fs } from "node:fs"
import * as path from "node:path"

const ARTIFACT_POLICY_PATH = path.join("artifacts", "publication-policy.json")

export async function loadPublicationPolicy({ pluginRoot } = {}) {
  const policyPath = path.join(pluginRoot, ARTIFACT_POLICY_PATH)
  const policy = JSON.parse(await fs.readFile(policyPath, "utf8"))
  return {
    valid: true,
    diagnostics: [],
    policy,
    policy_path: policyPath,
  }
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
