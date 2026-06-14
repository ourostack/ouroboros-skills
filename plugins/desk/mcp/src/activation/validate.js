import { ACTIVATION_SCHEMA_VERSION, activationManifestSchema } from "./schema.js"

const ID_RE = /^[a-z0-9][a-z0-9._:-]*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const RANGE_RE = /^(?:\^|~)?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

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
  const dependencies = [...(manifest.dependencies ?? [])]
    .sort((left, right) => dependencyRank(left) - dependencyRank(right) || left.id.localeCompare(right.id))
  const activationTargets = [...(manifest.provides?.activation_targets ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
  const overlayAgents = [...(manifest.provides?.overlay_agents ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))
  return [...dependencies, ...activationTargets, ...overlayAgents]
}

export function diagnoseHostSupport(manifest, { host }) {
  const match = (manifest.host_support ?? []).find((entry) => entry.host === host)
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

    if (!isValidId(dependency.id)) {
      errors.push(diagnostic(`${path}.id`, "invalid_dependency_id", "dependency id must be a stable lowercase id"))
    } else {
      ids.add(dependency.id)
    }

    if (!hasText(dependency.kind)) {
      errors.push(diagnostic(`${path}.kind`, "missing_dependency_kind", "dependency kind is required"))
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
}

function validateArtifacts(artifacts, errors) {
  validateRequiredObject(artifacts, "artifacts", ["embeddings", "snapshots"], errors)
  if (!isObject(artifacts)) return

  validateRequiredObject(artifacts.embeddings, "artifacts.embeddings", ["shared", "spec_id", "vector_packs"], errors)
  if (isObject(artifacts.embeddings) && artifacts.embeddings.shared !== true) {
    errors.push(diagnostic("artifacts.embeddings.shared", "missing_shared_embeddings", "embedding policy must declare shared embeddings"))
  }

  validateRequiredObject(artifacts.snapshots, "artifacts.snapshots", ["restore", "stale_reconcile"], errors)
  if (isObject(artifacts.snapshots) && artifacts.snapshots.restore !== "newest-compatible") {
    errors.push(diagnostic("artifacts.snapshots.restore", "invalid_snapshot_restore", "snapshot restore must use newest-compatible"))
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
}

function validateProvides(provides, dependencyIds, errors) {
  validateRequiredObject(provides, "provides", ["activation_targets", "overlay_agents"], errors)
  if (!isObject(provides)) return

  const targets = Array.isArray(provides.activation_targets) ? provides.activation_targets : []
  const overlays = Array.isArray(provides.overlay_agents) ? provides.overlay_agents : []
  const targetIds = new Set()
  const allActivationIds = new Set()
  let deskWorker = null

  for (const [index, target] of targets.entries()) {
    const path = `provides.activation_targets[${index}]`
    validateRequiredObject(target, path, ["id", "kind", "depends_on", "entrypoints"], errors)
    if (!isObject(target)) continue
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
    if (allActivationIds.has(overlay.id)) {
      errors.push(diagnostic(`${path}.id`, "duplicate_activation_id", `duplicate activation id ${overlay.id}`))
    }
    allActivationIds.add(overlay.id)
    validateDependsOn(`${overlay.id}.depends_on`, overlay.depends_on, dependencyIds, errors)
    for (const inherited of overlay.inherits ?? []) {
      if (!targetIds.has(inherited)) {
        errors.push(diagnostic(`${overlay.id}.inherits`, "unknown_activation_inherit", `${overlay.id} inherits unknown target ${inherited}`))
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
    return major === baseMajor && compareSemver([major, minor, patch], [baseMajor, baseMinor, basePatch]) >= 0
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
