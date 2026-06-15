import { ACTIVATION_SCHEMA_VERSION, activationManifestSchema } from "./schema.js"

const ID_RE = /^[a-z0-9][a-z0-9._:-]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const RANGE_RE = /^(?:\^|~)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const DEPENDENCY_KINDS = new Set(["substrate", "plugin"])
const ACTIVATION_TARGET_KINDS = new Set(["agent"])
const OVERLAY_AGENT_KINDS = new Set(["agent-overlay"])
const MCP_LAUNCH_MODES = new Set(["host-native"])
const DESK_ROOT_POLICIES = new Set(["global-default"])
const DESK_ROOT_PRECEDENCE = new Set(["activation", "DESK", "safe-default"])
const DESK_ROOT_OPT_OUT_MODES = new Set(["project-local", "manual-only"])
const VECTOR_PACK_POLICIES = new Set(["read-and-import"])
const SNAPSHOT_RESTORE_POLICIES = new Set(["newest-compatible"])
const SNAPSHOT_RECONCILE_POLICIES = new Set(["incremental"])
const HOST_SUPPORT_STATUSES = new Set(["supported", "degraded", "unsupported"])
const DEPENDENCY_RESOLUTION_MODES = new Set(["flattened", "native-or-flattened", "manual-host"])
const HOST_CAPABILITIES = new Set(["skills", "mcp", "global-default-agent", "agents", "hooks"])
const UNSUPPORTED_PRIMITIVES = new Set([
  "agent-defaults",
  "agent-view-dispatch",
  "background-session-inheritance",
  "host-activation",
])
const REQUESTED_CAPABILITIES = new Set(["Read", "Write", "Interactive"])
const GENERATED_ARTIFACTS = new Set(["owned-host-config", "activation-ledger"])
const NEVER_DELETE = new Set(["desk-root-data"])
const ENTRYPOINT_HOSTS = new Set(["claude", "codex", "copilot"])

export function validateActivationManifest(manifest) {
  const errors = []

  if (!isObject(manifest)) {
    return {
      ok: false,
      errors: [diagnostic("$", "invalid_manifest", "activation manifest must be an object")],
    }
  }

  for (const field of activationManifestSchema.required) {
    if (manifest[field] == null) {
      errors.push(diagnostic(field, "missing_required_field", `${field} is required`))
    }
  }

  if (manifest.schema_version !== ACTIVATION_SCHEMA_VERSION) {
    errors.push(diagnostic(
      "schema_version",
      "unknown_schema_version",
      `activation schema version ${String(manifest.schema_version)} is not supported`,
      "upgrade the host adapter, regenerate activation artifacts, or treat this activation as unsupported",
    ))
  }
  validateId(manifest.id, "id", "invalid_activation_id", "activation id must be a stable lowercase id", errors)
  validateSemver(manifest.version, "version", "invalid_activation_version", "activation version must be an exact semantic version", errors)

  const dependencyIds = validateDependencies(manifest.dependencies, errors)
  validateMcpServers(manifest.mcp_servers, errors)
  validateDeskRoot(manifest.desk_root, errors)
  validateArtifacts(manifest.artifacts, errors)
  validateHostSupport(manifest.host_support, errors)
  validatePermissions(manifest.permissions, errors)
  validateProvides(manifest.provides, dependencyIds, errors)

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? manifest : undefined,
    errors,
  }
}

export function orderActivationDependencies(manifest) {
  const dependencies = [...arrayOrEmpty(manifest?.dependencies)]
    .sort((left, right) => dependencyRank(left) - dependencyRank(right) || left.id.localeCompare(right.id))
  const activationTargets = [...arrayOrEmpty(manifest?.provides?.activation_targets)]
    .sort((left, right) => left.id.localeCompare(right.id))
  const overlayAgents = [...arrayOrEmpty(manifest?.provides?.overlay_agents)]
    .sort((left, right) => left.id.localeCompare(right.id))
  return [...dependencies, ...activationTargets, ...overlayAgents]
}

export function diagnoseHostSupport(manifest, { host }) {
  const hostSupport = Array.isArray(manifest?.host_support) ? manifest.host_support : []
  const match = hostSupport.find((entry) => isObject(entry) && entry.host === host)
  if (!match) {
    return {
      host,
      status: "unsupported",
      unsupported_primitives: ["host-activation"],
      fallback_behavior: "manual host configuration required",
    }
  }
  return {
    host,
    status: match.status,
    unsupported_primitives: match.unsupported_primitives ?? [],
    fallback_behavior: match.fallback_behavior,
    capabilities: match.capabilities ?? [],
  }
}

function validateDependencies(dependencies, errors) {
  const ids = new Set()
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    errors.push(diagnostic("dependencies", "missing_dependencies", "dependencies must contain at least one dependency"))
    return ids
  }

  dependencies.forEach((dependency, index) => {
    const path = `dependencies[${index}]`
    if (!isObject(dependency)) {
      errors.push(diagnostic(path, "invalid_dependency", "dependency must be an object"))
      return
    }

    if (validateId(dependency.id, `${path}.id`, "invalid_dependency_id", "dependency id must be a stable lowercase id", errors)) {
      if (ids.has(dependency.id)) {
        errors.push(diagnostic(`${path}.id`, "duplicate_dependency_id", `duplicate dependency id ${dependency.id}`))
      } else {
        ids.add(dependency.id)
      }
    }

    if (!hasText(dependency.kind)) {
      errors.push(diagnostic(`${path}.kind`, "missing_dependency_kind", "dependency kind is required"))
    } else {
      validateEnum(dependency.kind, `${path}.kind`, DEPENDENCY_KINDS, "invalid_dependency_kind", "dependency kind is not supported", errors)
    }

    const hasVersion = hasText(dependency.version)
    const hasRange = hasText(dependency.version_range)
    if (!hasVersion && !hasRange) {
      errors.push(diagnostic(`${path}.version`, "missing_version_intent", "dependency requires version or version_range"))
    }
    if (hasVersion && !isSemver(dependency.version)) {
      errors.push(diagnostic(`${path}.version`, "invalid_semver", "dependency version must be an exact semantic version"))
    }
    if (hasRange && !isSemverRange(dependency.version_range)) {
      errors.push(diagnostic(`${path}.version_range`, "invalid_semver_range", "dependency version_range must be a semantic version range"))
    }

    validateRequiredObject(dependency.provenance, `${path}.provenance`, ["source", "package"], errors)
    validateRequiredObject(dependency.lock, `${path}.lock`, ["version", "integrity"], errors)
    if (isObject(dependency.provenance)) {
      validateText(dependency.provenance.source, `${path}.provenance.source`, "invalid_dependency_provenance", "dependency provenance source must be text", errors)
      validateText(dependency.provenance.package, `${path}.provenance.package`, "invalid_dependency_provenance", "dependency provenance package must be text", errors)
    }
    if (isObject(dependency.lock)) {
      validateText(dependency.lock.integrity, `${path}.lock.integrity`, "invalid_dependency_integrity", "dependency lock integrity must be text", errors)
    }
    if (!isObject(dependency.lock) || !hasText(dependency.lock.version)) return

    if (!isSemver(dependency.lock.version)) {
      errors.push(diagnostic(`${path}.lock.version`, "invalid_semver", "lock version must be an exact semantic version"))
    }
    if (hasVersion && isSemver(dependency.version) && dependency.lock.version !== dependency.version) {
      errors.push(diagnostic(`${path}.lock.version`, "lock_version_mismatch", "lock version must match exact dependency version"))
    }
    if (hasRange && isSemverRange(dependency.version_range) && !satisfiesRange(dependency.lock.version, dependency.version_range)) {
      errors.push(diagnostic(
        `${path}.lock.version`,
        "incompatible_dependency_version",
        "locked dependency version does not satisfy version_range",
        "pin a compatible version or regenerate the dependency lock data",
      ))
    }
  })

  return ids
}

function validateMcpServers(servers, errors) {
  if (!Array.isArray(servers) || servers.length === 0) {
    errors.push(diagnostic("mcp_servers", "missing_mcp_servers", "mcp_servers must contain at least one server"))
    return
  }
  servers.forEach((server, index) => {
    const path = `mcp_servers[${index}]`
    validateRequiredObject(server, path, ["id", "command", "args", "launch"], errors)
    if (isObject(server) && server.required !== true) {
      errors.push(diagnostic(`${path}.required`, "missing_required_mcp", "Desk MCP server must be marked required"))
    }
    if (isObject(server) && (!Array.isArray(server.args) || server.args.length === 0)) {
      errors.push(diagnostic(`${path}.args`, "missing_mcp_args", "MCP server args must be a non-empty array"))
    }
    if (isObject(server)) {
      validateId(server.id, `${path}.id`, "invalid_mcp_id", "MCP server id must be a stable lowercase id", errors)
      validateText(server.command, `${path}.command`, "invalid_mcp_command", "MCP server command must be text", errors)
      validateStringList(server.args, `${path}.args`, "invalid_mcp_args", "MCP server args must be strings", errors)
      validateEnum(server.launch, `${path}.launch`, MCP_LAUNCH_MODES, "invalid_mcp_launch", "MCP launch mode is not supported", errors)
    }
  })
}

function validateDeskRoot(deskRoot, errors) {
  validateRequiredObject(deskRoot, "desk_root", ["policy", "precedence", "opt_out_modes"], errors)
  if (!isObject(deskRoot)) return
  if (!Array.isArray(deskRoot.precedence) || !deskRoot.precedence.includes("activation")) {
    errors.push(diagnostic("desk_root.precedence", "missing_activation_precedence", "desk root precedence must include activation"))
  }
  if (!Array.isArray(deskRoot.opt_out_modes) || !deskRoot.opt_out_modes.includes("manual-only")) {
    errors.push(diagnostic("desk_root.opt_out_modes", "missing_opt_out_modes", "desk root policy must declare opt-out modes"))
  }
  validateEnum(deskRoot.policy, "desk_root.policy", DESK_ROOT_POLICIES, "invalid_desk_root_policy", "desk root policy is not supported", errors)
  validateStringList(deskRoot.precedence, "desk_root.precedence", "invalid_desk_root_precedence", "desk root precedence entries are not supported", errors, DESK_ROOT_PRECEDENCE)
  validateStringList(deskRoot.opt_out_modes, "desk_root.opt_out_modes", "invalid_opt_out_mode", "desk root opt-out modes are not supported", errors, DESK_ROOT_OPT_OUT_MODES)
}

function validateArtifacts(artifacts, errors) {
  validateRequiredObject(artifacts, "artifacts", ["embeddings", "snapshots"], errors)
  if (!isObject(artifacts)) return

  validateRequiredObject(artifacts.embeddings, "artifacts.embeddings", ["shared", "spec_id", "vector_packs"], errors)
  if (isObject(artifacts.embeddings) && artifacts.embeddings.shared !== true) {
    errors.push(diagnostic("artifacts.embeddings.shared", "missing_shared_embeddings", "embedding policy must declare shared embeddings"))
  }
  if (isObject(artifacts.embeddings)) {
    validateText(artifacts.embeddings.spec_id, "artifacts.embeddings.spec_id", "invalid_embedding_spec", "embedding spec id must be text", errors)
    validateEnum(artifacts.embeddings.vector_packs, "artifacts.embeddings.vector_packs", VECTOR_PACK_POLICIES, "invalid_vector_pack_policy", "vector pack policy is not supported", errors)
  }

  validateRequiredObject(artifacts.snapshots, "artifacts.snapshots", ["restore", "stale_reconcile"], errors)
  if (isObject(artifacts.snapshots)) {
    validateEnum(artifacts.snapshots.restore, "artifacts.snapshots.restore", SNAPSHOT_RESTORE_POLICIES, "invalid_snapshot_restore", "snapshot restore must use newest-compatible", errors)
    validateEnum(artifacts.snapshots.stale_reconcile, "artifacts.snapshots.stale_reconcile", SNAPSHOT_RECONCILE_POLICIES, "invalid_snapshot_reconcile", "snapshot reconcile policy is not supported", errors)
  }
}

function validateHostSupport(hostSupport, errors) {
  if (!Array.isArray(hostSupport) || hostSupport.length === 0) {
    errors.push(diagnostic("host_support", "missing_host_support", "host_support must contain host dispositions"))
    return
  }
  hostSupport.forEach((entry, index) => {
    const path = `host_support[${index}]`
    validateRequiredObject(entry, path, ["host", "status", "dependency_resolution", "fallback_behavior", "capabilities"], errors)
    if (isObject(entry) && (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0)) {
      errors.push(diagnostic(`${path}.capabilities`, "missing_host_capabilities", "host support must declare capabilities"))
    }
    if (isObject(entry) && !Array.isArray(entry.unsupported_primitives)) {
      errors.push(diagnostic(`${path}.unsupported_primitives`, "missing_unsupported_primitives", "host support must declare unsupported_primitives"))
    }
    if (isObject(entry)) {
      validateId(entry.host, `${path}.host`, "invalid_host_id", "host id must be a stable lowercase id", errors)
      validateEnum(entry.status, `${path}.status`, HOST_SUPPORT_STATUSES, "invalid_host_status", "host support status is not supported", errors)
      validateEnum(entry.dependency_resolution, `${path}.dependency_resolution`, DEPENDENCY_RESOLUTION_MODES, "invalid_dependency_resolution", "dependency resolution mode is not supported", errors)
      validateText(entry.fallback_behavior, `${path}.fallback_behavior`, "invalid_fallback_behavior", "fallback behavior must be text", errors)
      validateStringList(entry.capabilities, `${path}.capabilities`, "invalid_host_capability", "host capability is not supported", errors, HOST_CAPABILITIES)
      validateStringList(entry.unsupported_primitives, `${path}.unsupported_primitives`, "invalid_unsupported_primitive", "unsupported primitive is not supported", errors, UNSUPPORTED_PRIMITIVES)
    }
  })
}

function validatePermissions(permissions, errors) {
  validateRequiredObject(permissions, "permissions", ["requested_capabilities", "generated_artifacts", "never_delete"], errors)
  if (!isObject(permissions)) return
  if (!Array.isArray(permissions.requested_capabilities) || permissions.requested_capabilities.length === 0) {
    errors.push(diagnostic("permissions.requested_capabilities", "missing_requested_capabilities", "permissions must declare requested host capabilities"))
  }
  if (!Array.isArray(permissions.generated_artifacts) || permissions.generated_artifacts.length === 0) {
    errors.push(diagnostic("permissions.generated_artifacts", "missing_generated_artifacts", "permissions must declare generated artifact classes"))
  }
  if (!Array.isArray(permissions.never_delete) || !permissions.never_delete.includes("desk-root-data")) {
    errors.push(diagnostic("permissions.never_delete", "missing_desk_data_boundary", "permissions must never delete desk-root-data"))
  }
  validateStringList(permissions.requested_capabilities, "permissions.requested_capabilities", "invalid_requested_capability", "requested capability is not supported", errors, REQUESTED_CAPABILITIES)
  validateStringList(permissions.generated_artifacts, "permissions.generated_artifacts", "invalid_generated_artifact", "generated artifact class is not supported", errors, GENERATED_ARTIFACTS)
  validateStringList(permissions.never_delete, "permissions.never_delete", "invalid_never_delete_boundary", "never-delete boundary is not supported", errors, NEVER_DELETE)
}

function validateProvides(provides, dependencyIds, errors) {
  validateRequiredObject(provides, "provides", ["activation_targets", "overlay_agents"], errors)
  if (!isObject(provides)) return

  if (!Array.isArray(provides.activation_targets)) {
    errors.push(diagnostic("provides.activation_targets", "invalid_activation_targets", "activation_targets must be an array"))
  }
  if (!Array.isArray(provides.overlay_agents)) {
    errors.push(diagnostic("provides.overlay_agents", "invalid_overlay_agents", "overlay_agents must be an array"))
  }
  const targets = Array.isArray(provides.activation_targets) ? provides.activation_targets : []
  const overlays = Array.isArray(provides.overlay_agents) ? provides.overlay_agents : []
  const targetIds = new Set()
  const allActivationIds = new Set()
  let deskWorker = null

  for (const [index, target] of targets.entries()) {
    const path = `provides.activation_targets[${index}]`
    validateRequiredObject(target, path, ["id", "kind", "depends_on", "entrypoints"], errors)
    if (!isObject(target)) continue
    validateId(target.id, `${path}.id`, "invalid_activation_target_id", "activation target id must be a stable lowercase id", errors)
    validateEnum(target.kind, `${path}.kind`, ACTIVATION_TARGET_KINDS, "invalid_activation_target_kind", "activation target kind is not supported", errors)
    if (target.default != null && typeof target.default !== "boolean") {
      errors.push(diagnostic(`${path}.default`, "invalid_activation_default", "activation target default must be a boolean"))
    }
    validateEntrypoints(target.entrypoints, `${path}.entrypoints`, errors)
    if (allActivationIds.has(target.id)) {
      errors.push(diagnostic(`${path}.id`, "duplicate_activation_id", `duplicate activation id ${target.id}`))
    }
    allActivationIds.add(target.id)
    targetIds.add(target.id)
    if (target.id === "desk:worker") deskWorker = target
    validateDependsOn(`${target.id}.depends_on`, target.depends_on, dependencyIds, errors)
  }

  if (!deskWorker) {
    errors.push(diagnostic("provides.activation_targets", "missing_desk_worker", "activation targets must provide desk:worker"))
  } else if (deskWorker.default !== true) {
    errors.push(diagnostic("provides.activation_targets.desk:worker.default", "desk_worker_not_default", "desk:worker must be the default target"))
  }

  for (const [index, overlay] of overlays.entries()) {
    const path = `provides.overlay_agents[${index}]`
    validateRequiredObject(overlay, path, ["id", "kind", "depends_on", "launch_as", "inherits"], errors)
    if (!isObject(overlay)) continue
    validateId(overlay.id, `${path}.id`, "invalid_overlay_agent_id", "overlay agent id must be a stable lowercase id", errors)
    validateEnum(overlay.kind, `${path}.kind`, OVERLAY_AGENT_KINDS, "invalid_overlay_agent_kind", "overlay agent kind is not supported", errors)
    validateText(overlay.launch_as, `${path}.launch_as`, "invalid_overlay_launch_as", "overlay launch_as must be text", errors)
    if (!Array.isArray(overlay.inherits)) {
      errors.push(diagnostic(`${path}.inherits`, "invalid_overlay_inherits", "overlay inherits must be an array"))
    } else {
      validateStringList(overlay.inherits, `${path}.inherits`, "invalid_overlay_inherits", "overlay inherits must contain text activation ids", errors)
    }
    if (allActivationIds.has(overlay.id)) {
      errors.push(diagnostic(`${path}.id`, "duplicate_activation_id", `duplicate activation id ${overlay.id}`))
    }
    allActivationIds.add(overlay.id)
    validateDependsOn(`${overlay.id}.depends_on`, overlay.depends_on, dependencyIds, errors)
    if (Array.isArray(overlay.inherits)) {
      for (const inherited of overlay.inherits) {
        if (typeof inherited === "string" && !targetIds.has(inherited)) {
          errors.push(diagnostic(`${overlay.id}.inherits`, "unknown_activation_inherit", `${overlay.id} inherits unknown target ${inherited}`))
        }
      }
    }
  }
}

function validateDependsOn(path, dependsOn, dependencyIds, errors) {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) {
    errors.push(diagnostic(path, "missing_depends_on", "activation must declare dependencies"))
    return
  }
  for (const dependencyId of dependsOn) {
    if (!dependencyIds.has(dependencyId)) {
      errors.push(diagnostic(path, "unknown_dependency", `${path} references unknown dependency ${dependencyId}`))
    }
  }
}

function validateEntrypoints(entrypoints, path, errors) {
  if (!isObject(entrypoints)) {
    errors.push(diagnostic(path, "invalid_activation_entrypoint", "activation entrypoints must map supported hosts to text paths"))
    return
  }
  const entries = Object.entries(entrypoints)
  if (entries.length === 0) {
    errors.push(diagnostic(path, "invalid_activation_entrypoint", "activation entrypoints must map supported hosts to text paths"))
    return
  }
  for (const [host, entrypoint] of entries) {
    if (!ENTRYPOINT_HOSTS.has(host) || !hasText(entrypoint)) {
      errors.push(diagnostic(path, "invalid_activation_entrypoint", "activation entrypoints must map supported hosts to text paths"))
      return
    }
  }
}

function validateRequiredObject(value, path, fields, errors) {
  if (!isObject(value)) {
    errors.push(diagnostic(path, "missing_required_object", `${path} must be an object`))
    return
  }
  for (const field of fields) {
    if (value[field] == null) {
      errors.push(diagnostic(`${path}.${field}`, "missing_required_field", `${path}.${field} is required`))
    }
  }
}

function validateId(value, path, code, message, errors) {
  if (!isValidId(value)) {
    errors.push(diagnostic(path, code, message))
    return false
  }
  return true
}

function validateSemver(value, path, code, message, errors) {
  if (!isSemver(value)) {
    errors.push(diagnostic(path, code, message))
    return false
  }
  return true
}

function validateText(value, path, code, message, errors) {
  if (!hasText(value)) {
    errors.push(diagnostic(path, code, message))
    return false
  }
  return true
}

function validateEnum(value, path, allowed, code, message, errors) {
  if (!allowed.has(value)) {
    errors.push(diagnostic(path, code, message))
  }
}

function validateStringList(value, path, code, message, errors, allowed = undefined) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item !== "string" || (allowed && !allowed.has(item))) {
      errors.push(diagnostic(path, code, message))
      return
    }
  }
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function dependencyRank(dependency) {
  return dependency.kind === "substrate" ? 0 : 1
}

function isValidId(value) {
  return hasText(value) && ID_RE.test(value)
}

function isSemver(value) {
  return hasText(value) && SEMVER_RE.test(value)
}

function isSemverRange(value) {
  return hasText(value) && RANGE_RE.test(value)
}

function satisfiesRange(version, range) {
  if (!isSemver(version)) return false
  const cleanRange = range.replace(/^[~^]/, "")
  const [major, minor, patch] = parseSemver(version)
  const [baseMajor, baseMinor, basePatch] = parseSemver(cleanRange)
  if (range.startsWith("^")) {
    if (compareSemver([major, minor, patch], [baseMajor, baseMinor, basePatch]) < 0) return false
    if (baseMajor > 0) return major === baseMajor
    if (baseMinor > 0) return major === 0 && minor === baseMinor
    return major === 0 && minor === 0 && patch === basePatch
  }
  if (range.startsWith("~")) {
    return major === baseMajor && minor === baseMinor && patch >= basePatch
  }
  return version === range
}

function parseSemver(value) {
  return value.split(/[+-]/)[0].split(".").map((part) => Number(part))
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function diagnostic(path, code, message, action = undefined) {
  return { path, code, message, action }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}
