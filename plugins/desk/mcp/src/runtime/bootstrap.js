import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { gunzipSync } from "node:zlib"
import { deriveRuntimeDependencyPackPaths } from "./runtime-deps.js"

const cacheMarkerFile = ".desk-runtime-cache.json"
const sourceMirrorDir = "source-mirror"
const embeddedArchiveShaMarker = "<archive-sha256-recorded-in-sidecar>"

export async function importRuntimeServer({
  mcpRoot,
  env = process.env,
  runtimeCacheDir,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
} = {}) {
  const prepared = prepareRuntime({
    mcpRoot,
    env,
    runtimeCacheDir,
    platform,
    arch,
    nodeAbi,
  })
  const runtimeServer = await import(pathToFileURL(path.join(prepared.sourceMirrorPath, "src", "server.js")).href)
  return {
    ...runtimeServer,
    _deskRuntime: {
      runtime_cache_dir: prepared.runtimeCacheDir,
      source_mirror_path: prepared.sourceMirrorPath,
      target: prepared.target,
      pack_dir: prepared.packDir,
      loaded_from_source_mirror: true,
    },
  }
}

export function prepareRuntime({
  mcpRoot,
  env = process.env,
  runtimeCacheDir,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
} = {}) {
  if (!hasText(mcpRoot)) {
    throw new Error("desk-mcp: mcpRoot is required for runtime dependency bootstrap")
  }
  const resolvedMcpRoot = path.resolve(mcpRoot)
  const packageJson = readJson(path.join(resolvedMcpRoot, "package.json"))
  const packageLockPath = path.join(resolvedMcpRoot, "package-lock.json")
  const packageLock = readJson(packageLockPath)
  const target = `${platform}-${arch}-node-${nodeAbi}`
  const packPaths = deriveRuntimeDependencyPackPaths({
    mcpRoot: resolvedMcpRoot,
    packageJson,
    packageLock,
    platform,
    arch,
    nodeAbi,
  })
  const resolvedRuntimeCacheDir = resolveRuntimeCacheDir({
    configuredRuntimeCacheDir: runtimeCacheDir,
    env,
    packageJson,
    target,
    prodDependencyLockHash: path.basename(packPaths.packDir),
  })
  restoreRuntimeDependencies({
    mcpRoot: resolvedMcpRoot,
    packageJson,
    packageLockPath,
    packPaths,
    runtimeCacheDir: resolvedRuntimeCacheDir,
    target,
    platform,
    arch,
    nodeAbi,
  })
  const sourceMirrorPath = syncSourceMirror({
    mcpRoot: resolvedMcpRoot,
    runtimeCacheDir: resolvedRuntimeCacheDir,
  })
  return {
    runtimeCacheDir: resolvedRuntimeCacheDir,
    sourceMirrorPath,
    target,
    packDir: packPaths.packDir,
  }
}

export function resolveRuntimeCacheDir({
  configuredRuntimeCacheDir,
  env = process.env,
  packageJson,
  target,
  prodDependencyLockHash,
} = {}) {
  if (hasText(configuredRuntimeCacheDir)) {
    return path.resolve(expandHome(configuredRuntimeCacheDir, env))
  }
  if (hasText(env.DESK_RUNTIME_CACHE_DIR)) {
    return path.resolve(expandHome(env.DESK_RUNTIME_CACHE_DIR, env))
  }
  const cacheHome = hasText(env.XDG_CACHE_HOME)
    ? expandHome(env.XDG_CACHE_HOME, env)
    : path.join(env.HOME ?? os.homedir(), ".cache")
  return path.resolve(
    cacheHome,
    "ouroboros-skills",
    "desk",
    packageJson.version,
    target,
    prodDependencyLockHash,
  )
}

export function restoreRuntimeDependencies({
  mcpRoot,
  packageJson,
  packageLockPath,
  packPaths,
  runtimeCacheDir,
  target,
  platform = process.platform,
  arch = process.arch,
  nodeAbi = process.versions.modules,
}) {
  const verification = verifyBootstrapRuntimeDependencyPack({
    packageJson,
    packageLockPath,
    packPaths,
    target,
    platform,
    arch,
    nodeAbi,
  })
  if (!verification.ok) {
    throw runtimeDependencyPackError({
      mcpRoot,
      packageJson,
      packPaths,
      target,
      errors: verification.errors,
    })
  }
  const archiveSha = verification.manifest.archive.sha256
  if (runtimeCacheIsCurrent({
    runtimeCacheDir,
    archiveSha,
    target,
    expectedPlugin: verification.manifest.plugin,
    requiredCacheEntries: verification.archiveEntries,
  })) {
    return { restored: false, runtimeCacheDir }
  }
  mkdirSync(runtimeCacheDir, { recursive: true })
  for (const entry of ["node_modules", "package.json", "package-lock.json", "runtime-deps.manifest.json"]) {
    rmSync(path.join(runtimeCacheDir, entry), { recursive: true, force: true })
  }
  extractRuntimeArchive({
    archivePath: packPaths.archivePath,
    destinationDir: runtimeCacheDir,
  })
  writeFileSync(
    path.join(runtimeCacheDir, cacheMarkerFile),
    JSON.stringify({
      schema_version: 1,
      archive_sha256: archiveSha,
      target,
      plugin: {
        name: verification.manifest.plugin.name,
        version: verification.manifest.plugin.version,
      },
    }, null, 2),
    "utf8",
  )
  return { restored: true, runtimeCacheDir }
}

export function verifyBootstrapRuntimeDependencyPack({
  packageJson,
  packageLockPath,
  packPaths,
  target,
  platform,
  arch,
  nodeAbi,
}) {
  const errors = []
  const manifest = readOptionalJson(packPaths.manifestPath, errors, "runtime-deps.manifest.json")
  const checksum = readOptionalChecksum(packPaths.checksumPath, errors)
  const archiveBytes = readOptionalBytes(packPaths.archivePath, errors)
  const archiveSha = archiveBytes === undefined ? undefined : sha256(archiveBytes)

  if (checksum !== undefined && archiveSha !== undefined && checksum !== archiveSha) {
    errors.push("runtime dependency pack checksum mismatch for runtime-deps.tgz")
  }
  if (manifest !== undefined) {
    if (manifest.schema_version !== 1) {
      errors.push("runtime dependency pack manifest schema_version must be 1")
    }
    if (manifest.plugin?.name !== packageJson.name) {
      errors.push("runtime dependency pack manifest plugin.name must match package.json")
    }
    if (manifest.plugin?.version !== packageJson.version) {
      errors.push("runtime dependency pack manifest plugin.version must match package.json")
    }
    if (manifest.platform?.os !== platform || manifest.platform?.arch !== arch || manifest.platform?.node_abi !== nodeAbi) {
      errors.push(`runtime dependency pack manifest platform must match ${target}`)
    }
    if (manifest.package_lock?.sha256 !== sha256(readFileSync(packageLockPath))) {
      errors.push("runtime dependency pack manifest package_lock.sha256 must match package-lock.json")
    }
    if (manifest.package_lock?.prod_dependency_lock_hash !== path.basename(packPaths.packDir)) {
      errors.push("runtime dependency pack manifest production dependency lock hash must match artifact path")
    }
    if (manifest.archive?.file !== "runtime-deps.tgz") {
      errors.push("runtime dependency pack manifest archive.file must be runtime-deps.tgz")
    }
    if (manifest.archive?.sha256 !== archiveSha) {
      errors.push("runtime dependency pack manifest archive.sha256 must match runtime-deps.tgz")
    }
    for (const rootEntry of manifest.archive?.root_entries ?? []) {
      if (rootEntry === "index.js" || rootEntry.startsWith("src/")) {
        errors.push(`runtime dependency pack must not include mutable MCP source ${rootEntry}`)
      }
    }
  }
  const archiveEntries = archiveBytes === undefined ? undefined : readRuntimeArchiveEntries(archiveBytes, errors)
  if (manifest !== undefined && archiveEntries !== undefined) {
    const archivePackageJson = parseArchiveJson(archiveEntries.get("package.json"), "package.json", errors)
    const archivePackageLock = archiveEntries.get("package-lock.json")
    parseArchiveJson(archivePackageLock, "package-lock.json", errors)
    const archiveManifest = parseArchiveJson(
      archiveEntries.get("runtime-deps.manifest.json"),
      "runtime-deps.manifest.json",
      errors,
    )
    if (archivePackageJson !== undefined) {
      if (archivePackageJson.name !== manifest.plugin?.name || archivePackageJson.version !== manifest.plugin?.version) {
        errors.push("runtime dependency archive package.json must match sidecar manifest plugin metadata")
      }
    }
    if (archiveManifest !== undefined && !isDeepStrictEqual(archiveManifest, embeddedManifestForArchive(manifest))) {
      errors.push("runtime dependency archive embedded manifest must match sidecar manifest metadata")
    }
    if (archivePackageLock !== undefined && sha256(archivePackageLock) !== manifest.package_lock?.sha256) {
      errors.push("runtime dependency archive package-lock.json sha256 must match sidecar manifest")
    }
    for (const entry of archiveEntries.keys()) {
      if (entry === "index.js" || entry.startsWith("src/")) {
        errors.push(`runtime dependency archive must not include mutable MCP source ${entry}`)
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    manifest,
    archiveEntries: archiveEntries === undefined ? [] : [...archiveEntries.keys()].sort(),
  }
}

function readRuntimeArchiveEntries(archiveBytes, errors) {
  let data
  try {
    data = gunzipSync(archiveBytes)
  } catch {
    errors.push("runtime dependency archive runtime-deps.tgz must be a readable gzip tar archive")
    return undefined
  }
  const entries = new Map()
  let pendingLongName
  let pendingPaxPath
  for (let offset = 0; offset < data.length;) {
    const header = data.subarray(offset, offset + 512)
    if (header.length < 512 || header.every((byte) => byte === 0)) {
      break
    }
    const type = header.toString("ascii", 156, 157)
    const size = parseTarSize(header)
    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    const body = data.subarray(bodyStart, bodyEnd)
    const name = pendingPaxPath
      ?? pendingLongName
      ?? tarEntryName(header)
    if (type === "L") {
      pendingLongName = body.toString("utf8").replace(/\0.*$/u, "")
    } else if (type === "x") {
      pendingPaxPath = paxPath(body)
    } else {
      if (type === "0" || type === "\0") {
        try {
          entries.set(safeArchivePath(name), Buffer.from(body))
        } catch (err) {
          errors.push(err.message)
        }
      }
      pendingLongName = undefined
      pendingPaxPath = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

export function syncSourceMirror({ mcpRoot, runtimeCacheDir }) {
  const sourceHash = hashCurrentSource(mcpRoot)
  const mirrorPath = path.join(runtimeCacheDir, sourceMirrorDir, sourceHash)
  if (existsSync(mirrorPath)) {
    return mirrorPath
  }
  const stagingPath = `${mirrorPath}.tmp-${process.pid}`
  rmSync(stagingPath, { recursive: true, force: true })
  mkdirSync(stagingPath, { recursive: true })
  for (const entry of ["index.js", "package.json", "package-lock.json", "src"]) {
    cpSync(path.join(mcpRoot, entry), path.join(stagingPath, entry), {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes("node_modules"),
    })
  }
  mkdirSync(path.dirname(mirrorPath), { recursive: true })
  rmSync(mirrorPath, { recursive: true, force: true })
  cpSync(stagingPath, mirrorPath, { recursive: true })
  rmSync(stagingPath, { recursive: true, force: true })
  return mirrorPath
}

export function hashCurrentSource(mcpRoot) {
  const hash = createHash("sha256")
  for (const file of sourceFilesForHash(mcpRoot)) {
    hash.update(file)
    hash.update("\0")
    hash.update(readFileSync(path.join(mcpRoot, file)))
    hash.update("\0")
  }
  return hash.digest("hex")
}

export function sourceFilesForHash(mcpRoot) {
  const roots = ["index.js", "package.json", "package-lock.json", "src"]
  const files = []
  for (const entry of roots) {
    const absolute = path.join(mcpRoot, entry)
    if (!existsSync(absolute)) {
      continue
    }
    if (statSync(absolute).isDirectory()) {
      files.push(...walkFiles(mcpRoot, absolute))
    } else {
      files.push(entry)
    }
  }
  return files.sort()
}

export function extractRuntimeArchive({ archivePath, destinationDir }) {
  const data = gunzipSync(readFileSync(archivePath))
  let pendingLongName
  let pendingPaxPath
  for (let offset = 0; offset < data.length;) {
    const header = data.subarray(offset, offset + 512)
    if (header.length < 512 || header.every((byte) => byte === 0)) {
      break
    }
    const type = header.toString("ascii", 156, 157)
    const size = parseTarSize(header)
    const bodyStart = offset + 512
    const bodyEnd = bodyStart + size
    const body = data.subarray(bodyStart, bodyEnd)
    const name = pendingPaxPath
      ?? pendingLongName
      ?? tarEntryName(header)

    if (type === "L") {
      pendingLongName = body.toString("utf8").replace(/\0.*$/u, "")
    } else if (type === "x") {
      pendingPaxPath = paxPath(body)
    } else {
      if (type === "0" || type === "\0") {
        writeArchiveFile({ destinationDir, name, body })
      }
      pendingLongName = undefined
      pendingPaxPath = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
}

export function runtimeDependencyPackError({
  mcpRoot,
  packageJson,
  packPaths,
  target,
  errors = [],
}) {
  const targetRoot = path.join(mcpRoot, "artifacts", "runtime-deps", packageJson.version, target)
  const availableTargets = listAvailableTargets(path.dirname(targetRoot))
  return new Error([
    `desk-mcp: runtime dependency pack is unavailable for ${target}.`,
    `Expected target directory: ${targetRoot}`,
    `Expected artifact directory: ${packPaths.packDir}`,
    `Available targets: ${availableTargets.length ? availableTargets.join(", ") : "(none)"}`,
    "Remediation: run `npm --prefix plugins/desk/mcp run runtime:deps-pack:build` for this platform/arch/Node ABI and commit the generated artifacts.",
    ...(errors.length ? [`Validation errors: ${errors.join("; ")}`] : []),
  ].join("\n"))
}

function runtimeCacheIsCurrent({ runtimeCacheDir, archiveSha, target, expectedPlugin, requiredCacheEntries = [] }) {
  const markerPath = path.join(runtimeCacheDir, cacheMarkerFile)
  if (!existsSync(markerPath)) {
    return false
  }
  try {
    const marker = readJson(markerPath)
    const cachedPackageJson = readJson(path.join(runtimeCacheDir, "package.json"))
    const cachedRuntimeManifest = readJson(path.join(runtimeCacheDir, "runtime-deps.manifest.json"))
    return marker.schema_version === 1
      && marker.archive_sha256 === archiveSha
      && marker.target === target
      && marker.plugin?.name === expectedPlugin?.name
      && marker.plugin?.version === expectedPlugin?.version
      && cachedPackageJson.name === expectedPlugin?.name
      && cachedPackageJson.version === expectedPlugin?.version
      && cachedRuntimeManifest.plugin?.name === expectedPlugin?.name
      && cachedRuntimeManifest.plugin?.version === expectedPlugin?.version
      && runtimeManifestArchiveShaIsCurrent(cachedRuntimeManifest, archiveSha)
      && existsSync(path.join(runtimeCacheDir, "node_modules"))
      && existsSync(path.join(runtimeCacheDir, "package-lock.json"))
      && requiredCacheEntries.every((entry) => existsSync(path.join(runtimeCacheDir, entry)))
  } catch {
    return false
  }
}

function runtimeManifestArchiveShaIsCurrent(manifest, archiveSha) {
  return manifest.archive?.sha256 === archiveSha ||
    manifest.archive?.sha256 === embeddedArchiveShaMarker
}

function walkFiles(root, startDir) {
  const files = []
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue
    }
    const absolute = path.join(startDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolute))
    } else if (entry.isFile()) {
      files.push(normalizePath(path.relative(root, absolute)))
    }
  }
  return files
}

function writeArchiveFile({ destinationDir, name, body }) {
  const safeName = safeArchivePath(name)
  const destinationPath = path.join(destinationDir, safeName)
  mkdirSync(path.dirname(destinationPath), { recursive: true })
  writeFileSync(destinationPath, body)
}

function safeArchivePath(name) {
  const normalized = normalizePath(name)
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`desk-mcp: runtime dependency pack contains unsafe path ${name}`)
  }
  return normalized
}

function parseTarSize(header) {
  const rawSize = readTarString(header, 124, 12).trim()
  return Number.parseInt(rawSize || "0", 8)
}

function tarEntryName(header) {
  const rawName = readTarString(header, 0, 100)
  const rawPrefix = readTarString(header, 345, 155)
  return rawPrefix.length > 0 ? `${rawPrefix}/${rawName}` : rawName
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

function readTarString(header, offset, length) {
  return header.toString("utf8", offset, offset + length).replace(/\0.*$/u, "")
}

function listAvailableTargets(versionArtifactRoot) {
  if (!existsSync(versionArtifactRoot)) {
    return []
  }
  return readdirSync(versionArtifactRoot)
    .filter((entry) => statSync(path.join(versionArtifactRoot, entry)).isDirectory())
    .sort()
}

function readOptionalJson(file, errors, label) {
  if (!existsSync(file)) {
    errors.push(`runtime dependency pack manifest ${label} is missing`)
    return undefined
  }
  try {
    return readJson(file)
  } catch {
    errors.push(`runtime dependency pack manifest ${label} must be valid JSON`)
    return undefined
  }
}

function readOptionalChecksum(file, errors) {
  if (!existsSync(file)) {
    errors.push("runtime dependency pack checksum runtime-deps.sha256 is missing")
    return undefined
  }
  const checksum = readFileSync(file, "utf8").trim().split(/\s+/u)[0]
  if (!/^[a-f0-9]{64}$/u.test(checksum)) {
    errors.push("runtime dependency pack checksum runtime-deps.sha256 must contain a sha256 digest")
    return undefined
  }
  return checksum
}

function readOptionalBytes(file, errors) {
  if (!existsSync(file)) {
    errors.push("runtime dependency pack archive runtime-deps.tgz is missing")
    return undefined
  }
  return readFileSync(file)
}

function expandHome(value, env) {
  if (value === "~") {
    return env.HOME ?? os.homedir()
  }
  if (value.startsWith("~/")) {
    return path.join(env.HOME ?? os.homedir(), value.slice(2))
  }
  return value
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function parseArchiveJson(bytes, entry, errors) {
  if (bytes === undefined) {
    errors.push(`runtime dependency archive must include root ${entry}`)
    return undefined
  }
  try {
    return JSON.parse(bytes.toString("utf8"))
  } catch {
    errors.push(`runtime dependency archive ${entry} must be valid JSON`)
    return undefined
  }
}

function embeddedManifestForArchive(manifest) {
  const embeddedManifest = structuredClone(manifest)
  if (embeddedManifest.archive !== undefined && typeof embeddedManifest.archive === "object") {
    embeddedManifest.archive.sha256 = embeddedArchiveShaMarker
  }
  return embeddedManifest
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizePath(file) {
  return file.replaceAll(path.sep, "/")
}
