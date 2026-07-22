import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultMcpRoot = path.resolve(moduleDir, "..", "..")
const packageLockRelativePath = "plugins/desk/mcp/package-lock.json"
const embeddedArchiveShaMarker = "<archive-sha256-recorded-in-sidecar>"
const supportedTargets = [
  { platform: "darwin", arch: "arm64" },
  { platform: "darwin", arch: "x64" },
  { platform: "linux", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "win32", arch: "x64" },
]
const requiredRuntimeFilesByPackage = new Map([
  ["@modelcontextprotocol/sdk", [
    "dist/esm/server/index.js",
    "dist/esm/server/stdio.js",
    "dist/esm/types.js",
  ]],
  ["better-sqlite3", [
    "lib/index.js",
    "lib/database.js",
    "build/Release/better_sqlite3.node",
  ]],
  ["gray-matter", [
    "index.js",
    "lib/parse.js",
  ]],
  ["js-yaml", [
    "index.js",
    "lib/js-yaml.js",
    "lib/js-yaml/loader.js",
  ]],
  ["sqlite-vec", [
    "index.cjs",
    "index.mjs",
  ]],
  ["sqlite-vec-darwin-arm64", ["vec0.dylib"]],
  ["sqlite-vec-darwin-x64", ["vec0.dylib"]],
  ["sqlite-vec-linux-arm64", ["vec0.so"]],
  ["sqlite-vec-linux-x64", ["vec0.so"]],
  ["sqlite-vec-windows-x64", ["vec0.dll"]],
  ["zod", [
    "index.cjs",
    "index.js",
  ]],
])

export function productionDependencyLockHash({ packageJson, packageLock }) {
  const dependencies = collectAllSupportedProductionDependencies({ packageJson, packageLock })
  const payload = {
    dependencies: packageJson.dependencies ?? {},
    lock_entries: dependencies.map((dependency) => ({
      name: dependency.name,
      lock_path: dependency.lock_path,
      native: dependency.native,
      package: relevantLockFields(packageLock.packages[dependency.lock_path]),
    })),
  }
  return sha256(stableStringify(payload))
}

export function deriveRuntimeDependencyPackPaths({
  mcpRoot = defaultMcpRoot,
  packageJson,
  packageLock,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
}) {
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  const target = `${platform}-${arch}-node-${nodeAbi}`
  const packDir = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    target,
    prodDependencyLockHash,
  )
  const relativeArchivePath = normalizePath(path.relative(
    path.resolve(mcpRoot, "..", "..", ".."),
    path.join(packDir, "runtime-deps.tgz"),
  ))
  return {
    packDir,
    archivePath: path.join(packDir, "runtime-deps.tgz"),
    manifestPath: path.join(packDir, "runtime-deps.manifest.json"),
    checksumPath: path.join(packDir, "runtime-deps.sha256"),
    relativeArchivePath,
  }
}

export function deriveRuntimeSupportMatrixPath({ mcpRoot = defaultMcpRoot, packageJson }) {
  return path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    "support-matrix.json",
  )
}

export const runtimeSupportMatrixPath = deriveRuntimeSupportMatrixPath

export function buildRuntimeSupportMatrix({
  mcpRoot = defaultMcpRoot,
  packageJson,
} = {}) {
  const versionRoot = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
  )
  const targets = []
  if (existsSync(versionRoot)) {
    for (const targetId of readdirSync(versionRoot).sort()) {
      const targetDir = path.join(versionRoot, targetId)
      if (!statSync(targetDir).isDirectory()) continue
      for (const lockHash of readdirSync(targetDir).sort()) {
        const packDir = path.join(targetDir, lockHash)
        if (!statSync(packDir).isDirectory()) continue
        const manifestPath = path.join(packDir, "runtime-deps.manifest.json")
        const archivePath = path.join(packDir, "runtime-deps.tgz")
        if (!existsSync(manifestPath) || !existsSync(archivePath)) continue
        const manifest = readJson(manifestPath)
        targets.push({
          id: targetId,
          platform: manifest.platform.os,
          arch: manifest.platform.arch,
          node_abi: String(manifest.platform.node_abi),
          prod_dependency_lock_hash: manifest.package_lock.prod_dependency_lock_hash,
          archive_sha256: sha256(readFileSync(archivePath)),
          artifact_path: `${targetId}/${lockHash}`,
        })
      }
    }
  }

  return {
    schema_version: 1,
    plugin: {
      name: packageJson.name,
      version: packageJson.version,
    },
    targets: targets.sort((left, right) => left.id.localeCompare(right.id)),
  }
}

export const generateRuntimeSupportMatrix = buildRuntimeSupportMatrix

export function validateRuntimeSupportMatrix({
  matrix,
  mcpRoot = defaultMcpRoot,
  packageJson,
} = {}) {
  const errors = []
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) {
    return ["runtime support matrix must be a JSON object"]
  }
  if (matrix.schema_version !== 1) {
    errors.push("runtime support matrix schema_version must be 1")
  }
  if (matrix.plugin?.name !== packageJson?.name) {
    errors.push("runtime support matrix plugin.name must match package.json")
  }
  if (matrix.plugin?.version !== packageJson?.version) {
    errors.push("runtime support matrix plugin.version must match package.json")
  }
  if (!Array.isArray(matrix.targets)) {
    errors.push("runtime support matrix targets must be an array")
    return errors
  }
  const ids = new Set()
  for (const target of matrix.targets) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      errors.push("runtime support matrix target entries must be JSON objects")
      continue
    }
    for (const field of [
      "id",
      "platform",
      "arch",
      "node_abi",
      "prod_dependency_lock_hash",
      "archive_sha256",
      "artifact_path",
    ]) {
      if (typeof target[field] !== "string" || target[field].length === 0) {
        errors.push(`runtime support matrix target ${target.id ?? "<unknown>"} is missing ${field}`)
      }
    }
    if (ids.has(target.id)) {
      errors.push(`runtime support matrix contains duplicate target ${target.id}`)
    }
    ids.add(target.id)
    const expectedId = `${target.platform}-${target.arch}-node-${target.node_abi}`
    if (target.id !== expectedId) {
      errors.push(`runtime support matrix target id must match platform, arch, and node_abi: expected ${expectedId}, got ${target.id}`)
    }
  }

  const expected = buildRuntimeSupportMatrix({
    mcpRoot,
    packageJson,
  })
  const expectedById = new Map(expected.targets.map((target) => [target.id, target]))
  if (
    matrix.targets.length !== expected.targets.length
    || matrix.targets.some((target) => !expectedById.has(target?.id))
  ) {
    errors.push("runtime support matrix targets must exactly match physically shipped runtime packs")
  }
  for (const target of matrix.targets) {
    const expectedTarget = expectedById.get(target?.id)
    if (!expectedTarget) continue
    for (const field of [
      "platform",
      "arch",
      "node_abi",
      "prod_dependency_lock_hash",
      "archive_sha256",
      "artifact_path",
    ]) {
      if (target[field] !== expectedTarget[field]) {
        errors.push(`runtime support matrix target ${target.id} ${field} must match the shipped pack`)
      }
    }
  }
  return errors
}

export function loadRuntimeSupportMatrix({
  mcpRoot = defaultMcpRoot,
  packageJson,
} = {}) {
  const matrixPath = deriveRuntimeSupportMatrixPath({ mcpRoot, packageJson })
  if (!existsSync(matrixPath)) {
    throw new Error(`runtime support matrix is missing: ${matrixPath}`)
  }
  const matrix = readJson(matrixPath)
  const errors = validateRuntimeSupportMatrix({
    matrix,
    mcpRoot,
    packageJson,
  })
  if (errors.length > 0) {
    throw new Error(errors.join("; "))
  }
  return matrix
}

export function verifyRuntimeSupportMatrix({
  mcpRoot = defaultMcpRoot,
  packageJson,
} = {}) {
  try {
    return {
      ok: true,
      matrix: loadRuntimeSupportMatrix({
        mcpRoot,
        packageJson,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

export function collectProductionDependencyClosure({
  packageJson,
  packageLock,
  platform = process.platform,
  arch = process.arch,
}) {
  const queue = Object.keys(packageJson.dependencies ?? {})
    .map((name) => packageLockPathForName(name, packageLock))
  const seen = new Set()
  while (queue.length > 0) {
    const lockPath = queue.shift()
    if (seen.has(lockPath)) {
      continue
    }
    const entry = packageLock.packages?.[lockPath]
    if (entry === undefined) {
      throw new Error(`lock entry must exist for ${lockPath}`)
    }
    if (entry.dev || !supportsTarget(entry, { platform, arch })) {
      continue
    }
    seen.add(lockPath)
    for (const name of Object.keys(entry.dependencies ?? {})) {
      queue.push(packageLockPathForName(name, packageLock, lockPath))
    }
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      queue.push(packageLockPathForName(name, packageLock, lockPath))
    }
    for (const [name, range] of Object.entries(entry.peerDependencies ?? {})) {
      if (entry.peerDependenciesMeta?.[name]?.optional !== true && range !== undefined) {
        queue.push(packageLockPathForName(name, packageLock, lockPath))
      }
    }
  }
  return [...seen].sort().map((lockPath) => ({
    name: packageNameFromLockPath(lockPath),
    version: packageLock.packages[lockPath].version,
    lock_path: lockPath,
    native: isNativeRuntimeDependency(lockPath),
  }))
}

export function validateRuntimeDependencyPackManifest({
  manifest,
  mcpRoot = defaultMcpRoot,
  packageJson,
  packageLock,
  platform,
  arch,
  nodeAbi,
}) {
  const errors = []
  if (manifest?.schema_version !== 1) {
    errors.push("runtime dependency pack manifest schema_version must be 1")
  }
  if (!isIsoTimestamp(manifest?.created_at)) {
    errors.push("runtime dependency pack manifest created_at must be an ISO timestamp")
  }
  if (manifest?.plugin?.name !== packageJson.name) {
    errors.push("runtime dependency pack manifest plugin.name must match package.json")
  }
  if (manifest?.plugin?.version !== packageJson.version) {
    errors.push("runtime dependency pack manifest plugin.version must match package.json")
  }
  if (manifest?.platform?.os !== platform) {
    errors.push("runtime dependency pack manifest platform.os must match target platform")
  }
  if (manifest?.platform?.arch !== arch) {
    errors.push("runtime dependency pack manifest platform.arch must match target arch")
  }
  if (manifest?.platform?.node_abi !== nodeAbi) {
    errors.push("runtime dependency pack manifest platform.node_abi must match target Node ABI")
  }
  if (manifest?.package_lock?.path !== packageLockRelativePath) {
    errors.push("runtime dependency pack manifest package_lock.path must be plugins/desk/mcp/package-lock.json")
  }
  if (!isSha256(manifest?.package_lock?.sha256)) {
    errors.push("runtime dependency pack manifest package_lock.sha256 must be a sha256 hex digest")
  } else if (manifest.package_lock.sha256 !== sha256(readFileText(path.join(mcpRoot, "package-lock.json")))) {
    errors.push("runtime dependency pack manifest package_lock.sha256 must match plugins/desk/mcp/package-lock.json")
  }
  const expectedProdHash = productionDependencyLockHash({ packageJson, packageLock })
  if (!isSha256(manifest?.package_lock?.prod_dependency_lock_hash)) {
    errors.push("runtime dependency pack manifest package_lock.prod_dependency_lock_hash must be a sha256 hex digest")
  } else if (manifest.package_lock.prod_dependency_lock_hash !== expectedProdHash) {
    errors.push("runtime dependency pack manifest package_lock.prod_dependency_lock_hash must match production dependency closure")
  }
  if (manifest?.archive?.file !== "runtime-deps.tgz") {
    errors.push("runtime dependency pack manifest archive.file must be runtime-deps.tgz")
  }
  if (!isSha256(manifest?.archive?.sha256)) {
    errors.push("runtime dependency pack manifest archive.sha256 must be a sha256 hex digest")
  }
  if (manifest?.archive?.contains_server_source === true) {
    errors.push("runtime dependency pack manifest must not mark server source as archived")
  }
  if (!Array.isArray(manifest?.archive?.root_entries)) {
    errors.push("runtime dependency pack manifest archive.root_entries must be an array")
  } else {
    for (const entry of manifest.archive.root_entries) {
      if (isMutableMcpSourceEntry(entry)) {
        errors.push(`runtime dependency pack archive root_entries must not include server source path ${entry}`)
      }
    }
  }
  if (!Array.isArray(manifest?.production_dependencies) || manifest.production_dependencies.length === 0) {
    errors.push("runtime dependency pack manifest production_dependencies must not be empty")
  }
  if (manifest?.provenance?.builder !== "runtime:deps-pack:build") {
    errors.push("runtime dependency pack manifest provenance.builder must be runtime:deps-pack:build")
  }
  if (!hasText(manifest?.provenance?.source)) {
    errors.push("runtime dependency pack manifest provenance.source is required")
  }

  if (Array.isArray(manifest?.production_dependencies) && manifest.production_dependencies.length > 0) {
    errors.push(...validateManifestDependencies({
      dependencies: manifest.production_dependencies,
      expectedDependencies: collectProductionDependencyClosure({ packageJson, packageLock, platform, arch }),
    }))
  }
  return errors
}

export function validateRuntimeDependencyArchiveShape({
  entries,
  productionDependencies,
  mcpRoot = defaultMcpRoot,
}) {
  const errors = []
  const entrySet = new Set(entries)
  const expectedEntries = archiveEntriesForProductionDependencies(productionDependencies, { mcpRoot })
  const expectedSet = new Set(expectedEntries)
  for (const rootEntry of ["package.json", "package-lock.json", "runtime-deps.manifest.json"]) {
    if (!entrySet.has(rootEntry)) {
      errors.push(`runtime dependency archive must include root ${rootEntry}`)
    }
  }
  for (const dependency of productionDependencies) {
    if (!entrySet.has(`${dependency.lock_path}/package.json`)) {
      errors.push(`runtime dependency archive must include non-native dependency ${dependency.name}`)
    }
    for (const runtimeFile of runtimeFilesForDependency(dependency, { mcpRoot })) {
      const entry = `${dependency.lock_path}/${runtimeFile}`
      if (!entrySet.has(entry)) {
        errors.push(`runtime dependency archive must include runtime file ${entry}`)
      }
    }
  }

  const unexpectedDependencyNames = new Set()
  for (const entry of entries) {
    if (expectedSet.has(entry)) {
      continue
    }
    if (isMutableMcpSourceEntry(entry)) {
      errors.push(`runtime dependency archive must not include mutable MCP source ${entry}`)
      continue
    }
    if (entry.startsWith("node_modules/")) {
      const packageRoot = packageRootFromArchiveEntry(entry)
      if (packageRoot !== undefined) {
        unexpectedDependencyNames.add(packageNameFromLockPath(packageRoot))
      }
      continue
    }
    if (!entry.includes("/")) {
      errors.push(`runtime dependency archive must not include unexpected root file ${entry}`)
      continue
    }
    errors.push(`runtime dependency archive must not include unexpected root path ${entry}`)
  }
  for (const name of unexpectedDependencyNames) {
    errors.push(`runtime dependency archive must not include non-production dependency ${name}`)
  }
  return errors
}

export function verifyRuntimeDependencyPack({
  packDir,
  mcpRoot = defaultMcpRoot,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
}) {
  const errors = []
  const manifestPath = path.join(packDir, "runtime-deps.manifest.json")
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      errors: ["runtime dependency pack manifest runtime-deps.manifest.json is missing"],
      manifest: undefined,
    }
  }
  const manifest = readJson(manifestPath)
  if (!isSupportedRuntimeTarget({ platform, arch })) {
    return {
      ok: false,
      errors: [`unsupported runtime dependency pack target ${platform}-${arch}-node-${nodeAbi}`],
      manifest,
    }
  }

  const packageJson = readJson(path.join(mcpRoot, "package.json"))
  const packageLock = readJson(path.join(mcpRoot, "package-lock.json"))
  const archivePath = path.join(packDir, "runtime-deps.tgz")
  const checksumPath = path.join(packDir, "runtime-deps.sha256")
  const archiveBytes = existsSync(archivePath) ? readFileSync(archivePath) : undefined
  const archiveSha = archiveBytes === undefined ? undefined : sha256(archiveBytes)
  if (archiveBytes === undefined) {
    errors.push("runtime dependency pack archive runtime-deps.tgz is missing")
  }
  const checksumSha = existsSync(checksumPath) ? readChecksum(checksumPath) : undefined
  if (checksumSha === undefined) {
    errors.push("runtime dependency pack checksum runtime-deps.sha256 is missing")
  } else if (archiveSha !== undefined && checksumSha !== archiveSha) {
    errors.push("runtime dependency pack checksum mismatch for runtime-deps.tgz")
  }

  errors.push(...validateRuntimeDependencyPackManifest({
    manifest,
    mcpRoot,
    packageJson,
    packageLock,
    platform,
    arch,
    nodeAbi,
  }).filter((error) => error !== "runtime dependency pack manifest archive.sha256 must match runtime-deps.tgz"))

  if (archiveSha !== undefined && manifest?.archive?.sha256 !== archiveSha) {
    errors.push("runtime dependency pack manifest archive.sha256 must match runtime-deps.tgz")
  }

  let archiveContents
  if (archiveBytes !== undefined) {
    try {
      archiveContents = extractTarGzContents(archivePath)
    } catch {
      errors.push("runtime dependency archive runtime-deps.tgz must be a readable gzip tar archive")
    }
  }
  if (archiveContents !== undefined) {
    const archivePackageJson = parseArchiveJson(archiveContents.get("package.json"), "package.json", errors)
    const archivePackageLock = parseArchiveJson(archiveContents.get("package-lock.json"), "package-lock.json", errors)
    const archivePackageLockBytes = archiveContents.get("package-lock.json")
    if (archivePackageLockBytes !== undefined && sha256(archivePackageLockBytes) !== manifest?.package_lock?.sha256) {
      errors.push("runtime dependency archive package-lock.json sha256 must match sidecar manifest")
    }
    if (archivePackageJson !== undefined && archivePackageLock !== undefined) {
      if (archivePackageJson.name !== manifest?.plugin?.name || archivePackageJson.version !== manifest?.plugin?.version) {
        errors.push("runtime dependency archive package.json must match sidecar manifest plugin metadata")
      }
      try {
        const embeddedProdDependencyLockHash = productionDependencyLockHash({
          packageJson: archivePackageJson,
          packageLock: archivePackageLock,
        })
        if (embeddedProdDependencyLockHash !== manifest?.package_lock?.prod_dependency_lock_hash) {
          errors.push("runtime dependency archive production dependency lock hash must match embedded package metadata")
        }
      } catch {
        errors.push("runtime dependency archive production dependency lock hash must be computable from embedded package metadata")
      }
    }
    const embeddedManifest = parseEmbeddedManifest(archiveContents.get("runtime-deps.manifest.json"))
    if (!deepEqual(embeddedManifest, embeddedManifestForArchive(manifest))) {
      errors.push("runtime dependency archive embedded manifest must match sidecar manifest metadata")
    }
    errors.push(...validateRuntimeDependencyArchiveShape({
      entries: [...archiveContents.keys()].sort(),
      productionDependencies: manifest.production_dependencies ?? [],
      mcpRoot,
    }))
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
  }
}

export function buildRuntimeDependencyPack({
  mcpRoot = defaultMcpRoot,
  outputRoot,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
  createdAt,
  provenanceSource = "runtime dependency pack build script",
} = {}) {
  const packageJson = readJson(path.join(mcpRoot, "package.json"))
  const packageLock = readJson(path.join(mcpRoot, "package-lock.json"))
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  const productionDependencies = collectProductionDependencyClosure({ packageJson, packageLock, platform, arch })
  const entries = archiveEntriesForProductionDependencies(productionDependencies, { mcpRoot })
  const root = outputRoot ?? path.join(mcpRoot, "artifacts", "runtime-deps")
  const packDir = path.join(root, packageJson.version, `${platform}-${arch}-node-${nodeAbi}`, prodDependencyLockHash)
  const effectiveCreatedAt = createdAt
    ?? existingRuntimeDependencyPackCreatedAt(path.join(packDir, "runtime-deps.manifest.json"))
    ?? new Date().toISOString()
  const provisionalManifest = runtimeDependencyPackManifest({
    archiveSha: "0".repeat(64),
    createdAt: effectiveCreatedAt,
    mcpRoot,
    packageJson,
    packageLock,
    prodDependencyLockHash,
    productionDependencies,
    platform,
    arch,
    nodeAbi,
    provenanceSource,
  })
  const archiveBytes = createRuntimeDependencyArchive({
    entries,
    manifest: provisionalManifest,
    mcpRoot,
  })
  const archiveSha = sha256(archiveBytes)
  const manifest = runtimeDependencyPackManifest({
    archiveSha,
    createdAt: effectiveCreatedAt,
    mcpRoot,
    packageJson,
    packageLock,
    prodDependencyLockHash,
    productionDependencies,
    platform,
    arch,
    nodeAbi,
    provenanceSource,
  })
  mkdirSync(packDir, { recursive: true })
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveBytes)
  writeFileSync(path.join(packDir, "runtime-deps.manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${archiveSha}  runtime-deps.tgz\n`, "utf8")
  return {
    packDir,
    archivePath: path.join(packDir, "runtime-deps.tgz"),
    manifestPath: path.join(packDir, "runtime-deps.manifest.json"),
    checksumPath: path.join(packDir, "runtime-deps.sha256"),
    manifest,
  }
}

function existingRuntimeDependencyPackCreatedAt(manifestPath) {
  if (!existsSync(manifestPath)) {
    return undefined
  }
  let manifest
  try {
    manifest = readJson(manifestPath)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined
    }
    throw error
  }
  return typeof manifest.created_at === "string" && Number.isFinite(Date.parse(manifest.created_at))
    ? manifest.created_at
    : undefined
}

export function runRuntimeDependencyPackBuildCli({ argv = process.argv.slice(2), io = process } = {}) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    io.stdout.write(buildHelpText())
    return 0
  }
  const result = buildRuntimeDependencyPack({
    outputRoot: parsed.options["output-root"],
    platform: parsed.options.platform,
    arch: parsed.options.arch,
    nodeAbi: parsed.options["node-abi"],
  })
  io.stdout.write(`runtime dependency pack built: ${result.packDir}\n`)
  return 0
}

export function runRuntimeDependencyPackVerifyCli({ argv = process.argv.slice(2), io = process } = {}) {
  const parsed = parseArgs(argv)
  if (parsed.help) {
    io.stdout.write(verifyHelpText())
    return 0
  }
  const packageJson = readJson(path.join(defaultMcpRoot, "package.json"))
  const packageLock = readJson(path.join(defaultMcpRoot, "package-lock.json"))
  const paths = deriveRuntimeDependencyPackPaths({
    mcpRoot: defaultMcpRoot,
    packageJson,
    packageLock,
    platform: parsed.options.platform ?? process.platform,
    arch: parsed.options.arch ?? process.arch,
    nodeAbi: parsed.options["node-abi"] ?? process.versions.modules,
  })
  const result = verifyRuntimeDependencyPack({
    packDir: parsed.options["pack-dir"] ?? paths.packDir,
    platform: parsed.options.platform ?? process.platform,
    arch: parsed.options.arch ?? process.arch,
    nodeAbi: parsed.options["node-abi"] ?? process.versions.modules,
  })
  if (result.ok) {
    io.stdout.write("runtime dependency pack verified\n")
    return 0
  }
  for (const error of result.errors) {
    io.stderr.write(`${error}\n`)
  }
  return 1
}

export function buildHelpText() {
  return [
    "Build a runtime dependency pack for the desk MCP server.",
    "",
    "Usage: build-runtime-deps-pack.js [--output-root DIR] [--platform OS] [--arch ARCH] [--node-abi ABI]",
    "",
  ].join("\n")
}

export function verifyHelpText() {
  return [
    "Verify a runtime dependency pack for the desk MCP server.",
    "",
    "Usage: verify-runtime-deps-pack.js [--pack-dir DIR] [--platform OS] [--arch ARCH] [--node-abi ABI]",
    "",
  ].join("\n")
}

function validateManifestDependencies({ dependencies, expectedDependencies }) {
  const errors = []
  const expectedByLockPath = new Map(expectedDependencies.map((dependency) => [dependency.lock_path, dependency]))
  const expectedByName = new Map()
  for (const dependency of expectedDependencies) {
    const existing = expectedByName.get(dependency.name) ?? []
    existing.push(dependency)
    expectedByName.set(dependency.name, existing)
  }
  const seenLockPaths = new Set()
  const duplicates = []
  const nonProduction = []
  for (const dependency of dependencies) {
    if (seenLockPaths.has(dependency.lock_path)) {
      duplicates.push(dependency.name)
      continue
    }
    seenLockPaths.add(dependency.lock_path)
    const expected = expectedByLockPath.get(dependency.lock_path)
    if (expected !== undefined) {
      if (dependency.version !== expected.version) {
        errors.push(`runtime dependency pack manifest dependency ${dependency.name} version must match package-lock.json`)
      }
      if (dependency.native !== expected.native) {
        errors.push(`runtime dependency pack manifest dependency ${dependency.name} native flag must match production closure`)
      }
      continue
    }
    const expectedBySameName = expectedByName.get(dependency.name)?.[0]
    if (expectedBySameName !== undefined) {
      if (dependency.version !== expectedBySameName.version) {
        errors.push(`runtime dependency pack manifest dependency ${dependency.name} version must match package-lock.json`)
      }
      errors.push(`runtime dependency pack manifest dependency ${dependency.name} lock_path must match production closure`)
      if (dependency.native !== expectedBySameName.native) {
        errors.push(`runtime dependency pack manifest dependency ${dependency.name} native flag must match production closure`)
      }
      continue
    }
    nonProduction.push(dependency.name)
  }
  for (const expected of expectedDependencies) {
    const manifestHasUniqueSameName = expectedByName.get(expected.name).length === 1
      && dependencies.some((dependency) => dependency.name === expected.name)
    if (!seenLockPaths.has(expected.lock_path) && !manifestHasUniqueSameName) {
      errors.push(`runtime dependency pack manifest must include production dependency ${expected.name}`)
    }
  }
  for (const name of duplicates) {
    errors.push(`runtime dependency pack manifest must not include duplicate production dependency ${name}`)
  }
  for (const name of nonProduction) {
    errors.push(`runtime dependency pack manifest must not include non-production dependency ${name}`)
  }
  return errors
}

function collectAllSupportedProductionDependencies({ packageJson, packageLock }) {
  const byLockPath = new Map()
  for (const target of supportedTargets) {
    for (const dependency of collectProductionDependencyClosure({ packageJson, packageLock, ...target })) {
      byLockPath.set(dependency.lock_path, dependency)
    }
  }
  return [...byLockPath.values()].sort((left, right) => left.lock_path.localeCompare(right.lock_path))
}

function packageNameFromLockPath(lockPath) {
  const match = lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u)
  if (match === null) {
    throw new Error(`lock path must end in a package node_modules segment: ${lockPath}`)
  }
  return match[1]
}

function packageLockPathForName(name, packageLock, fromLockPath) {
  if (fromLockPath !== undefined) {
    for (const candidateRoot of packageAncestorLockPaths(fromLockPath)) {
      const nestedCandidate = `${candidateRoot}/node_modules/${name}`
      if (packageLock.packages[nestedCandidate] !== undefined) {
        return nestedCandidate
      }
    }
  }
  return `node_modules/${name}`
}

function packageAncestorLockPaths(lockPath) {
  const ancestors = []
  let current = lockPath
  while (current !== undefined) {
    ancestors.push(current)
    current = parentPackageLockPath(current)
  }
  return ancestors
}

function parentPackageLockPath(lockPath) {
  const nestedMarkerIndex = lockPath.lastIndexOf("/node_modules/")
  if (nestedMarkerIndex === -1) {
    return undefined
  }
  return lockPath.slice(0, nestedMarkerIndex)
}

function supportsTarget(entry, { platform, arch }) {
  return (!Array.isArray(entry.os) || entry.os.includes(platform))
    && (!Array.isArray(entry.cpu) || entry.cpu.includes(arch))
}

function isSupportedRuntimeTarget({ platform, arch }) {
  return supportedTargets.some((target) => target.platform === platform && target.arch === arch)
}

function isNativeRuntimeDependency(lockPath) {
  return /^node_modules\/(?:better-sqlite3|sqlite-vec(?:-|$))/u.test(lockPath)
}

function relevantLockFields(entry = {}) {
  return {
    version: entry.version,
    resolved: entry.resolved,
    integrity: entry.integrity,
    dependencies: entry.dependencies ?? {},
    optionalDependencies: entry.optionalDependencies ?? {},
    peerDependencies: entry.peerDependencies ?? {},
    peerDependenciesMeta: entry.peerDependenciesMeta ?? {},
    os: entry.os ?? [],
    cpu: entry.cpu ?? [],
    dev: entry.dev === true,
  }
}

function runtimeDependencyPackManifest({
  archiveSha,
  createdAt,
  mcpRoot = defaultMcpRoot,
  packageJson,
  packageLock,
  prodDependencyLockHash,
  productionDependencies,
  platform,
  arch,
  nodeAbi,
  provenanceSource,
}) {
  return {
    schema_version: 1,
    created_at: createdAt,
    plugin: {
      name: packageJson.name,
      version: packageJson.version,
    },
    platform: {
      os: platform,
      arch,
      node_abi: nodeAbi,
    },
    package_lock: {
      path: packageLockRelativePath,
      sha256: sha256(readFileText(path.join(mcpRoot, "package-lock.json"))),
      prod_dependency_lock_hash: prodDependencyLockHash,
    },
    archive: {
      file: "runtime-deps.tgz",
      sha256: archiveSha,
      root_entries: [
        "node_modules/",
        "package.json",
        "package-lock.json",
        "runtime-deps.manifest.json",
      ],
      contains_server_source: false,
    },
    production_dependencies: productionDependencies,
    provenance: {
      builder: "runtime:deps-pack:build",
      source: provenanceSource,
    },
  }
}

function archiveEntriesForProductionDependencies(productionDependencies, { mcpRoot = defaultMcpRoot } = {}) {
  const entries = [
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
  ]
  for (const dependency of productionDependencies) {
    entries.push(`${dependency.lock_path}/package.json`)
    for (const runtimeFile of runtimeFilesForDependency(dependency, { mcpRoot })) {
      entries.push(`${dependency.lock_path}/${runtimeFile}`)
    }
  }
  return entries.sort()
}

function runtimeFilesForDependency(dependency, { mcpRoot = defaultMcpRoot } = {}) {
  const explicitFiles = requiredRuntimeFilesByPackage.get(dependency.name) ?? []
  const inferredFiles = runtimeFilesUnderPackageDir(
    path.join(mcpRoot, dependency.lock_path),
    path.join(mcpRoot, dependency.lock_path),
  )
  const runtimeFiles = unique([...explicitFiles, ...inferredFiles])
  if (runtimeFiles.length === 0) {
    throw new Error(`runtime dependency archive must require a non-marker runtime file for ${dependency.name}`)
  }
  return runtimeFiles
}

function runtimeFilesUnderPackageDir(packageDir, startDir) {
  const runtimeFiles = []
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["test", "tests", "docs", "examples", "benchmark", "node_modules"].includes(entry.name)) {
      continue
    }
    const entryPath = path.join(startDir, entry.name)
    if (entry.isDirectory()) {
      runtimeFiles.push(...runtimeFilesUnderPackageDir(packageDir, entryPath))
    } else if (isRuntimeFilePath(entryPath)) {
      runtimeFiles.push(normalizePath(path.relative(packageDir, entryPath)))
    }
  }
  return runtimeFiles.sort((left, right) => runtimeFileRank(left) - runtimeFileRank(right) || left.localeCompare(right))
}

function runtimeFileRank(filePath) {
  if (/^(?:index|dist\/index|lib\/index)\.(?:js|cjs|mjs)$/u.test(filePath)) {
    return 0
  }
  if (/\.(?:js|cjs|mjs)$/u.test(filePath)) {
    return 1
  }
  if (/\.(?:node|dylib|so|dll)$/u.test(filePath)) {
    return 2
  }
  return 3
}

function isRuntimeFilePath(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false
  }
  if (/\/package\.json$/u.test(normalizePath(filePath))) {
    return false
  }
  return /\.(?:js|cjs|mjs|json|node|dylib|so|dll)$/u.test(filePath)
}

function createRuntimeDependencyArchive({ entries, manifest, mcpRoot }) {
  const blocks = []
  for (const entry of entries) {
    const body = runtimeArchiveEntryBytes({ entry, manifest, mcpRoot })
    blocks.push(tarHeader({ name: entry, size: body.length }))
    blocks.push(body)
    const padding = (512 - (body.length % 512)) % 512
    if (padding > 0) {
      blocks.push(Buffer.alloc(padding))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function runtimeArchiveEntryBytes({ entry, manifest, mcpRoot }) {
  if (entry === "runtime-deps.manifest.json") {
    return Buffer.from(JSON.stringify(embeddedManifestForArchive(manifest), null, 2), "utf8")
  }
  return readFileSync(path.join(mcpRoot, entry))
}

function embeddedManifestForArchive(manifest) {
  const embeddedManifest = structuredClone(manifest)
  embeddedManifest.archive.sha256 = embeddedArchiveShaMarker
  return embeddedManifest
}

function tarHeader({ name, size }) {
  const { headerName, prefix } = splitTarPath(name)
  const header = Buffer.alloc(512, 0)
  header.write(headerName, 0, 100, "utf8")
  header.write("0000644\0", 100, 8, "ascii")
  header.write("0000000\0", 108, 8, "ascii")
  header.write("0000000\0", 116, 8, "ascii")
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii")
  header.write("00000000000\0", 136, 12, "ascii")
  header.fill(0x20, 148, 156)
  header.write("0", 156, 1, "ascii")
  header.write("ustar\0", 257, 6, "ascii")
  header.write("00", 263, 2, "ascii")
  if (prefix.length > 0) {
    header.write(prefix, 345, 155, "utf8")
  }
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii")
  return header
}

function splitTarPath(name) {
  if (Buffer.byteLength(name) <= 100) {
    return { headerName: name, prefix: "" }
  }
  const parts = name.split("/")
  for (let index = 1; index < parts.length; index += 1) {
    const prefix = parts.slice(0, index).join("/")
    const headerName = parts.slice(index).join("/")
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(headerName) <= 100) {
      return { headerName, prefix }
    }
  }
  throw new Error(`runtime dependency archive path is too long for tar header: ${name}`)
}

function extractTarGzContents(archivePath) {
  const data = gunzipSync(readFileSync(archivePath))
  const entries = new Map()
  let pendingLongName
  let pendingPaxPath
  for (let offset = 0; offset < data.length;) {
    const header = data.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      break
    }
    const rawName = readTarString(header, 0, 100)
    const rawPrefix = readTarString(header, 345, 155)
    const rawSize = readTarString(header, 124, 12).trim()
    const type = header.toString("ascii", 156, 157)
    const size = Number.parseInt(rawSize || "0", 8)
    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    const body = data.subarray(bodyStart, bodyEnd)
    const name = pendingPaxPath
      ?? pendingLongName
      ?? (rawPrefix.length > 0 ? `${rawPrefix}/${rawName}` : rawName)
    if (type === "L") {
      pendingLongName = body.toString("utf8").replace(/\0.*$/u, "")
    } else if (type === "x") {
      pendingPaxPath = paxPath(body)
    } else {
      if (type === "0" || type === "\0") {
        entries.set(name, Buffer.from(body))
      }
      pendingLongName = undefined
      pendingPaxPath = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

function readTarString(header, offset, length) {
  return header.toString("utf8", offset, offset + length).replace(/\0.*$/u, "")
}

function paxPath(body) {
  for (const line of body.toString("utf8").split("\n")) {
    const match = line.match(/^\d+ path=(.+)$/u)
    if (match !== null) {
      return match[1]
    }
  }
  return undefined
}

function parseEmbeddedManifest(bytes) {
  if (bytes === undefined) {
    return undefined
  }
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    return undefined
  }
}

function parseArchiveJson(bytes, entry, errors) {
  if (bytes === undefined) {
    return undefined
  }
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    errors.push(`runtime dependency archive ${entry} must be valid JSON`)
    return undefined
  }
}

function packageRootFromArchiveEntry(entry) {
  const parts = entry.split("/")
  let rootEnd = -1
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== "node_modules") {
      continue
    }
    const nameIndex = index + 1
    if (parts[nameIndex]?.startsWith("@")) {
      rootEnd = nameIndex + 2
    } else {
      rootEnd = nameIndex + 1
    }
  }
  return parts.slice(0, rootEnd).join("/")
}

function isMutableMcpSourceEntry(entry) {
  return entry === "index.js" || entry.startsWith("src/")
}

function isIsoTimestamp(value) {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
}

function readChecksum(file) {
  const text = readFileText(file).trim()
  return text.split(/\s+/u)[0]
}

function readJson(file) {
  return JSON.parse(readFileText(file))
}

function readFileText(file) {
  return readFileSync(file, "utf8")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right)
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

function normalizePath(file) {
  return file.replaceAll(path.sep, "/")
}

function unique(values) {
  return [...new Set(values)]
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      return { help: true, options }
    }
    if (!arg.startsWith("--")) {
      continue
    }
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (value !== undefined && !value.startsWith("--")) {
      options[key] = value
      index += 1
    } else {
      options[key] = "true"
    }
  }
  return { help: false, options }
}
