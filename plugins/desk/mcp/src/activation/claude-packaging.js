const CLAUDE_WORKER_AGENT_PATH = "./agents/worker.md"
const CLAUDE_WORKER_SOURCE = "agents/worker.md"
const SUPPORTED_SESSION_STATUSES = new Set([
  "supported",
  "supported-with-version-floor",
  "validated",
])
const DISPATCHED_SESSION_SMOKE_RE =
  /(?:dispatched-session smoke|background session loads|unit-\d+[a-z]? .*smoke)/iu

export function validateClaudePackagingContract(input) {
  const errors = []
  const method = selectEngineeringMethod(input.activation.provides.activation_targets.find((target) => target.id === "desk:worker").depends_on)
  const label = method === "superpowers" ? "Superpowers" : "Work Suite"
  const methodPlugin = method === "superpowers" ? input.superpowersPlugin : input.workSuitePlugin
  const selectedDependency = input.deskPlugin.dependencies.find((dependency) => (
    dependency.name === method
  ))
  const declaredMethod = input.activation.dependencies.find((dependency) => (
    dependency.id === method
  ))
  if (declaredMethod === undefined) {
    return [`missing ${label} dependency in activation manifest`]
  }
  const lockedVersion = declaredMethod.lock.version
  const expectedRange = declaredMethod.version_range

  if (selectedDependency === undefined) {
    errors.push(`missing ${label} dependency in Claude plugin metadata`)
  } else if (selectedDependency.version !== expectedRange) {
    errors.push(`Claude ${label} dependency range must be ${expectedRange}`)
  }

  if (method === "superpowers" && input.deskPlugin.dependencies.some((dependency) => dependency.name === "work-suite")) {
    errors.push("Claude alpha plugin metadata must not include work-suite dependency")
  }
  if (methodPlugin.version !== lockedVersion) {
    errors.push(`${label} Claude version must match activation lock ${lockedVersion}`)
  }

  if (!input.deskPlugin.agents.includes(CLAUDE_WORKER_AGENT_PATH)) {
    errors.push("Claude plugin metadata must expose ./agents/worker.md")
  }

  if (input.claudeActivation.targets["desk:worker"].source !== CLAUDE_WORKER_SOURCE) {
    errors.push("Claude activation target desk:worker must use agents/worker.md")
  }

  for (const pluginManifest of [input.deskPlugin, methodPlugin]) {
    if (Object.hasOwn(pluginManifest, "activation")) {
      errors.push("Claude plugin manifest must not include host activation metadata")
    }
  }

  for (const [label, disposition] of [
    ["Agent View", input.claudeActivation.agentView],
    ["background-session", input.claudeActivation.backgroundSessionInheritance],
  ]) {
    if (claimsSupportedPluginContext(disposition)) {
      if (!hasDispatchedSessionSmokeEvidence(disposition)) {
        errors.push(`${label} support requires dispatched-session smoke evidence`)
      }
    }
  }

  return errors
}

function claimsSupportedPluginContext(disposition) {
  return SUPPORTED_SESSION_STATUSES.has(disposition.status)
    && disposition.inheritsPluginContext === true
}

function hasDispatchedSessionSmokeEvidence(disposition) {
  return DISPATCHED_SESSION_SMOKE_RE.test([
    disposition.evidence,
    disposition.evidenceCommandOrDoc,
    disposition.validatedBy,
    disposition.validation,
  ].join("\n"))
}
import { selectEngineeringMethod } from "./validate.js"
