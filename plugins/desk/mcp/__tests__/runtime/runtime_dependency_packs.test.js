import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { gunzipSync, gzipSync } from "node:zlib"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const packageLockPath = path.join(mcpRoot, "package-lock.json")
const targetNodeAbi = "127"
const embeddedArchiveShaMarker = "<archive-sha256-recorded-in-sidecar>"
const supportedTargets = [
  { platform: "darwin", arch: "arm64", sqliteVecPackage: "sqlite-vec-darwin-arm64" },
  { platform: "darwin", arch: "x64", sqliteVecPackage: "sqlite-vec-darwin-x64" },
  { platform: "linux", arch: "arm64", sqliteVecPackage: "sqlite-vec-linux-arm64" },
  { platform: "linux", arch: "x64", sqliteVecPackage: "sqlite-vec-linux-x64" },
  { platform: "win32", arch: "x64", sqliteVecPackage: "sqlite-vec-windows-x64" },
]
const target = supportedTargets.find((supportedTarget) => (
  supportedTarget.platform === process.platform && supportedTarget.arch === process.arch
)) ?? supportedTargets[0]
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

async function loadRuntimeDeps() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")))
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), "desk-runtime-deps-"))
}

function writeTextFile(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, "utf8")
}

function writePackFixture({
  archiveEntryBytes,
  archiveEntries,
  checksum,
  manifest,
} = {}) {
  const packDir = makeTempDir()
  const archiveBytes = createTarGz(archiveEntries, archiveEntryBytes ?? archiveEntryBytesForManifest(manifest))
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveBytes)
  writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${checksum ?? sha256(archiveBytes)}  runtime-deps.tgz\n`, "utf8")
  writeFileSync(path.join(packDir, "runtime-deps.manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  return packDir
}

function writePartialPackFixture({
  archiveBytes,
  checksum,
  manifest,
  omitArchive = false,
  omitChecksum = false,
  omitManifest = false,
} = {}) {
  const packDir = makeTempDir()
  if (!omitArchive) {
    writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveBytes ?? Buffer.from("not gzip\n", "utf8"))
  }
  if (!omitChecksum) {
    writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${checksum ?? "0".repeat(64)}  runtime-deps.tgz\n`, "utf8")
  }
  if (!omitManifest) {
    writeFileSync(path.join(packDir, "runtime-deps.manifest.json"), JSON.stringify(manifest ?? { schema_version: 1 }, null, 2), "utf8")
  }
  return packDir
}

function createTarGz(entries, entryBytes = {}) {
  const blocks = []
  for (const entry of entries) {
    const body = entryBytes[entry] ?? Buffer.from(`fixture for ${entry}\n`, "utf8")
    appendTarEntry(blocks, { name: entry, body })
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function createTarGzWithHeaderModes(entries, entryBytes = {}, headerModes = {}) {
  const blocks = []
  for (const entry of entries) {
    const body = entryBytes[entry] ?? Buffer.from(`fixture for ${entry}\n`, "utf8")
    if (headerModes[entry] === "gnu-long-name") {
      appendTarEntry(blocks, {
        name: "././@LongLink",
        body: Buffer.from(`${entry}\0`, "utf8"),
        type: "L",
      })
      appendTarEntry(blocks, { name: path.basename(entry), body })
    } else if (headerModes[entry] === "pax-path") {
      appendTarEntry(blocks, {
        name: "PaxHeader",
        body: Buffer.from(paxPathRecord(entry), "utf8"),
        type: "x",
      })
      appendTarEntry(blocks, { name: path.basename(entry), body })
    } else if (headerModes[entry] === "pax-without-path") {
      appendTarEntry(blocks, {
        name: "PaxHeader",
        body: Buffer.from("comment=no-path\n", "utf8"),
        type: "x",
      })
      appendTarEntry(blocks, { name: entry, body })
    } else if (headerModes[entry] === "nul-type") {
      appendTarEntry(blocks, { name: entry, body, type: "\0" })
    } else if (headerModes[entry] === "blank-size") {
      appendTarEntry(blocks, { name: entry, body: Buffer.alloc(0), blankSize: true })
    } else {
      appendTarEntry(blocks, { name: entry, body })
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function appendTarEntry(blocks, { name, body, blankSize = false, type = "0" }) {
  blocks.push(tarHeader({ blankSize, name, size: body.length, type }))
  blocks.push(body)
  const padding = (512 - (body.length % 512)) % 512
  if (padding > 0) {
    blocks.push(Buffer.alloc(padding))
  }
}

function paxPathRecord(filePath) {
  let record = `0 path=${filePath}\n`
  while (true) {
    const next = `${Buffer.byteLength(record)} path=${filePath}\n`
    if (next === record) {
      return record
    }
    record = next
  }
}

function archiveEntryBytesForManifest(manifest, overrides = {}) {
  return {
    "package.json": readFileSync(packageJsonPath),
    "package-lock.json": readFileSync(packageLockPath),
    "runtime-deps.manifest.json": Buffer.from(
      JSON.stringify(embeddedManifestForArchive(manifest), null, 2),
      "utf8",
    ),
    ...overrides,
  }
}

function embeddedManifestForArchive(manifest) {
  const embeddedManifest = structuredClone(manifest)
  embeddedManifest.archive.sha256 = embeddedArchiveShaMarker
  return embeddedManifest
}

function tarHeader({ blankSize = false, name, size, type = "0" }) {
  assert.ok(Buffer.byteLength(name) <= 100, `tar fixture path too long for ustar header: ${name}`)
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, "utf8")
  header.write("0000644\0", 100, 8, "ascii")
  header.write("0000000\0", 108, 8, "ascii")
  header.write("0000000\0", 116, 8, "ascii")
  if (!blankSize) {
    header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii")
  }
  header.write("00000000000\0", 136, 12, "ascii")
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, "ascii")
  header.write("ustar\0", 257, 6, "ascii")
  header.write("00", 263, 2, "ascii")
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii")
  return header
}

function listTarGzEntries(archivePath) {
  return [...extractTarGzContents(archivePath).keys()].sort()
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
      if (type === "0" || type === "\0" || type === "") {
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

function assertArchiveFileMatchesInstalledNodeModule(archiveContents, entry) {
  const installedPath = path.join(mcpRoot, entry)
  assert.equal(existsSync(installedPath), true, `installed runtime file must exist for ${entry}`)
  assert.equal(archiveContents.has(entry), true, `runtime dependency archive must include ${entry}`)
  assert.deepEqual(
    archiveContents.get(entry),
    readFileSync(installedPath),
    `built runtime dependency archive bytes for ${entry} must match installed node_modules bytes`,
  )
}

function assertArchiveFilesMatchInstalledRuntime(archiveContents, expectedEntries, { manifestPath } = {}) {
  assert.deepEqual(
    [...archiveContents.keys()].sort(),
    expectedEntries,
    "built runtime dependency archive must contain exactly the expected production runtime files",
  )
  for (const entry of expectedEntries) {
    if (entry === "runtime-deps.manifest.json") {
      assert.notEqual(manifestPath, undefined, "built runtime dependency archive manifest sidecar path is required")
      assert.deepEqual(
        JSON.parse(archiveContents.get(entry).toString("utf8")),
        embeddedManifestForArchive(loadJson(manifestPath)),
        "built runtime dependency archive embedded manifest must match sidecar manifest metadata",
      )
      continue
    }
    assertArchiveFileMatchesInstalledNodeModule(archiveContents, entry)
  }
}

function fixtureManifest({
  archiveSha,
  packageLockSha,
  prodDependencyLockHash,
  productionDependencies,
  pluginVersion,
} = {}) {
  return {
    schema_version: 1,
    created_at: "2026-06-14T00:00:00.000Z",
    plugin: {
      name: "@ourostack/desk-mcp",
      version: pluginVersion ?? loadJson(packageJsonPath).version,
    },
    platform: {
      os: target.platform,
      arch: target.arch,
      node_abi: targetNodeAbi,
    },
    package_lock: {
      path: "plugins/desk/mcp/package-lock.json",
      sha256: packageLockSha ?? sha256(readFileSync(packageLockPath, "utf8")),
      prod_dependency_lock_hash: prodDependencyLockHash ?? "a".repeat(64),
    },
    archive: {
      file: "runtime-deps.tgz",
      sha256: archiveSha ?? "b".repeat(64),
      root_entries: [
        "node_modules/",
        "package.json",
        "package-lock.json",
        "runtime-deps.manifest.json",
      ],
      contains_server_source: false,
    },
    production_dependencies: productionDependencies ?? [
      { name: "@modelcontextprotocol/sdk", version: "1.29.0", native: false },
      { name: "better-sqlite3", version: "11.10.0", native: true },
      { name: "gray-matter", version: "4.0.3", native: false },
      { name: "sqlite-vec", version: "0.1.9", native: true },
      { name: "js-yaml", version: "3.14.2", native: false },
    ],
    provenance: {
      builder: "runtime:deps-pack:build",
      source: "unit-6d fixture",
    },
  }
}

function fixtureManifestForArchiveEntries({
  archiveEntryBytes,
  archiveEntries,
  packageLockSha,
  prodDependencyLockHash,
  productionDependencies,
  pluginVersion,
} = {}) {
  const provisionalManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    packageLockSha,
    prodDependencyLockHash,
    productionDependencies,
    pluginVersion,
  })
  const archiveSha = sha256(createTarGz(
    archiveEntries,
    archiveEntryBytes ?? archiveEntryBytesForManifest(provisionalManifest),
  ))
  return fixtureManifest({
    archiveSha,
    packageLockSha,
    prodDependencyLockHash,
    productionDependencies,
    pluginVersion,
  })
}

function fixtureManifestForSpecialArchiveEntries({
  archiveEntries,
  headerModes,
  packageLockSha,
  prodDependencyLockHash,
  productionDependencies,
  pluginVersion,
} = {}) {
  const provisionalManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    packageLockSha,
    prodDependencyLockHash,
    productionDependencies,
    pluginVersion,
  })
  const archiveSha = sha256(createTarGzWithHeaderModes(
    archiveEntries,
    archiveEntryBytesForManifest(provisionalManifest),
    headerModes,
  ))
  return fixtureManifest({
    archiveSha,
    packageLockSha,
    prodDependencyLockHash,
    productionDependencies,
    pluginVersion,
  })
}

function writeSpecialPackFixture({
  archiveEntries,
  headerModes,
  manifest,
}) {
  const packDir = makeTempDir()
  const archiveBytes = createTarGzWithHeaderModes(
    archiveEntries,
    archiveEntryBytesForManifest(manifest),
    headerModes,
  )
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveBytes)
  writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${sha256(archiveBytes)}  runtime-deps.tgz\n`, "utf8")
  writeFileSync(path.join(packDir, "runtime-deps.manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
  return packDir
}

function writeSyntheticMcpRoot({
  dependencyFiles = ["index.js"],
  dependencyName = "unit-runtime",
  dependencyPackage = {},
} = {}) {
  const root = makeTempDir()
  const packageJson = {
    name: "@ourostack/desk-mcp",
    version: "9.9.9",
    dependencies: {
      [dependencyName]: "1.0.0",
    },
  }
  const lockPath = `node_modules/${dependencyName}`
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: packageJson.dependencies,
      },
      [lockPath]: {
        version: "1.0.0",
        ...dependencyPackage,
      },
    },
  }
  writeTextFile(path.join(root, "package.json"), JSON.stringify(packageJson, null, 2))
  writeTextFile(path.join(root, "package-lock.json"), JSON.stringify(packageLock, null, 2))
  writeTextFile(path.join(root, lockPath, "package.json"), JSON.stringify({
    name: dependencyName,
    version: "1.0.0",
  }, null, 2))
  for (const file of dependencyFiles) {
    writeTextFile(path.join(root, lockPath, file), `export default ${JSON.stringify(file)}\n`)
  }
  return {
    root,
    packageJson,
    packageLock,
    lockPath,
  }
}

function dependencyNames(dependencies) {
  return dependencies.map((dependency) => dependency.name).sort()
}

function packageNameFromLockPath(lockPath) {
  const match = lockPath.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/u)
  assert.notEqual(match, null, `lock path must end in a package node_modules segment: ${lockPath}`)
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

function isNativeRuntimeDependency(lockPath) {
  return /^node_modules\/(?:better-sqlite3|sqlite-vec(?:-|$))/u.test(lockPath)
}

function expectedProductionDependencyClosure({ packageJson, packageLock, platform, arch }) {
  const queue = Object.keys(packageJson.dependencies)
    .map((name) => packageLockPathForName(name, packageLock))
  const seen = new Set()
  while (queue.length > 0) {
    const lockPath = queue.shift()
    if (seen.has(lockPath)) {
      continue
    }
    const entry = packageLock.packages[lockPath]
    assert.ok(entry, `lock entry must exist for ${lockPath}`)
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

function archiveEntriesForProductionDependencies(dependencies) {
  const entries = [
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
  ]
  for (const dependency of dependencies) {
    entries.push(`${dependency.lock_path}/package.json`)
    for (const runtimeFile of runtimeFilesForDependency(dependency)) {
      entries.push(`${dependency.lock_path}/${runtimeFile}`)
    }
  }
  return entries.sort()
}

function runtimeFilesForDependency(dependency) {
  const explicitFiles = requiredRuntimeFilesByPackage.get(dependency.name) ?? []
  const inferredFiles = inferRuntimeFilesForDependency(dependency)
  const runtimeFiles = unique([...explicitFiles, ...inferredFiles])
  assert.ok(
    runtimeFiles.length > 0,
    `runtime dependency archive fixture must require a non-marker runtime file for ${dependency.name}`,
  )
  return runtimeFiles
}

function inferRuntimeFilesForDependency(dependency) {
  const packageDir = path.join(mcpRoot, dependency.lock_path)
  return runtimeFilesUnderPackageDir(packageDir, packageDir)
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
      runtimeFiles.push(path.relative(packageDir, entryPath).replaceAll(path.sep, "/"))
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
  if (/\/package\.json$/u.test(filePath)) {
    return false
  }
  return /\.(?:js|cjs|mjs|json|node|dylib|so|dll)$/u.test(filePath)
}

function unique(values) {
  return [...new Set(values)]
}

function workflowPathFilters(workflow, eventName) {
  const lines = workflow.split(/\r?\n/u)
  const eventStart = lines.findIndex((line) => line === `  ${eventName}:`)
  assert.notEqual(eventStart, -1, `workflow must define ${eventName}`)
  const eventEnd = lines.findIndex((line, index) => (
    index > eventStart
    && (/^[a-z_]+:/u.test(line) || /^  [a-z_]+:/u.test(line))
  ))
  const eventLines = lines.slice(eventStart, eventEnd === -1 ? lines.length : eventEnd)
  const pathsStart = eventLines.findIndex((line) => line === "    paths:")
  assert.notEqual(pathsStart, -1, `${eventName} must define paths`)
  const paths = []
  for (const line of eventLines.slice(pathsStart + 1)) {
    if (/^\s*$/.test(line)) {
      continue
    }
    const match = line.match(/^      - "([^"]+)"$/u)
    if (match === null) {
      break
    }
    paths.push(match[1])
  }
  return paths
}

function workflowJob(workflow, jobName) {
  const lines = workflow.split(/\r?\n/u)
  const jobStart = lines.findIndex((line) => line === `  ${jobName}:`)
  assert.notEqual(jobStart, -1, `workflow must define job ${jobName}`)
  const jobEnd = lines.findIndex((line, index) => (
    index > jobStart
    && /^  [A-Za-z0-9_-]+:\s*$/u.test(line)
  ))
  return lines.slice(jobStart, jobEnd === -1 ? lines.length : jobEnd).join("\n")
}

function workflowStepBlocks(jobSection) {
  const blocks = []
  let currentBlock
  for (const line of jobSection.split(/\r?\n/u)) {
    if (/^      - /u.test(line)) {
      if (currentBlock !== undefined) {
        blocks.push(currentBlock.join("\n"))
      }
      currentBlock = [line]
      continue
    }
    if (currentBlock !== undefined) {
      currentBlock.push(line)
    }
  }
  if (currentBlock !== undefined) {
    blocks.push(currentBlock.join("\n"))
  }
  return blocks
}

function workflowStepRunText(stepBlock) {
  const lines = stepBlock.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^\s*run:\s+(.+?)\s*$/u)
    if (inline !== null && inline[1] !== "|" && inline[1] !== ">") {
      return inline[1]
    }
    if (/^\s*run:\s*[|>]\s*$/u.test(lines[index])) {
      return lines
        .slice(index + 1)
        .filter((line) => /^\s{10,}\S/u.test(line))
        .map((line) => line.replace(/^\s{10}/u, ""))
        .join("\n")
    }
  }
  return ""
}

function workflowStepWorkingDirectory(stepBlock) {
  const match = stepBlock.match(/^\s*working-directory:\s+(.+?)\s*$/mu)
  return match?.[1]?.replace(/^["']|["']$/gu, "")
}

function workflowStepAllowsFailure(stepBlock) {
  const match = stepBlock.match(/^\s*continue-on-error:\s+(.+?)\s*$/mu)
  return match !== null && !/^["']?false["']?$/iu.test(match[1])
}

function workflowStepRunsMcpScript(stepBlock, scriptName) {
  if (workflowStepAllowsFailure(stepBlock)) {
    return false
  }
  const runText = workflowStepRunText(stepBlock)
  const runsCommand = runText.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => workflowLineRunsMcpScript(line, scriptName))
  if (!runsCommand) {
    return false
  }
  return (
    workflowStepWorkingDirectory(stepBlock) === "plugins/desk/mcp"
    || runText.split(/\r?\n/u)
      .map((line) => line.trim())
      .some((line) => workflowLineRunsMcpScript(line, scriptName, { requirePrefix: true }))
  )
}

function workflowLineRunsMcpScript(line, scriptName, { requirePrefix = false } = {}) {
  const envPrefix = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*`
  const escapedScriptName = escapeRegExp(scriptName)
  const prefixPattern = String.raw`npm\s+--prefix\s+plugins/desk/mcp\s+run\s+${escapedScriptName}(?:\s+(?<prefixArgs>.*)|$)`
  const workingDirPattern = String.raw`npm\s+run\s+${escapedScriptName}(?:\s+(?<workingDirArgs>.*)|$)`
  const match = line.match(new RegExp(`^${envPrefix}(?:${prefixPattern}${requirePrefix ? "" : `|${workingDirPattern}`})`, "u"))
  const args = match?.groups?.prefixArgs ?? match?.groups?.workingDirArgs ?? ""
  return match !== null && workflowScriptArgsAreReal(args)
}

function workflowScriptArgsAreReal(args) {
  return !/(?:^|\s)--help(?:\s|$)/u.test(args)
    && !/(?:^|\s)(?:\|\||&&|\||;)(?:\s|$)/u.test(args)
}

function assertWorkflowJobRunsMcpScript(jobSection, jobName, scriptName) {
  assert.ok(
    workflowStepBlocks(jobSection).some((stepBlock) => workflowStepRunsMcpScript(stepBlock, scriptName)),
    `workflow job ${jobName} must run ${scriptName} from plugins/desk/mcp or via npm --prefix plugins/desk/mcp`,
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

function scriptHelp(scriptName) {
  const result = spawnSync(
    process.execPath,
    [path.join(mcpRoot, "scripts", scriptName), "--help"],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return `${result.stdout}${result.stderr}`
}

function runNpmScript(scriptName, args = []) {
  return spawnSync(
    "npm",
    ["--prefix", "plugins/desk/mcp", "run", scriptName, "--", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  )
}

function assertIncludesAll(actual, expected, label) {
  for (const item of expected) {
    assert.ok(actual.includes(item), `${label} must include ${item}`)
  }
}

test("runtime dependency pack artifact paths are deterministic and repo-relative", async () => {
  const {
    deriveRuntimeDependencyPackPaths,
    productionDependencyLockHash,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)

  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  assert.match(prodDependencyLockHash, /^[a-f0-9]{64}$/u)

  const paths = deriveRuntimeDependencyPackPaths({
    mcpRoot,
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
    nodeAbi: targetNodeAbi,
  })

  const expectedDir = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    `${target.platform}-${target.arch}-node-${targetNodeAbi}`,
    prodDependencyLockHash,
  )
  assert.equal(paths.packDir, expectedDir)
  assert.equal(paths.archivePath, path.join(expectedDir, "runtime-deps.tgz"))
  assert.equal(paths.manifestPath, path.join(expectedDir, "runtime-deps.manifest.json"))
  assert.equal(paths.checksumPath, path.join(expectedDir, "runtime-deps.sha256"))
  assert.equal(
    paths.relativeArchivePath,
    `plugins/desk/mcp/artifacts/runtime-deps/${packageJson.version}/${target.platform}-${target.arch}-node-${targetNodeAbi}/${prodDependencyLockHash}/runtime-deps.tgz`,
  )

  for (const supportedTarget of supportedTargets) {
    const targetPaths = deriveRuntimeDependencyPackPaths({
      mcpRoot,
      packageJson,
      packageLock,
      platform: supportedTarget.platform,
      arch: supportedTarget.arch,
      nodeAbi: targetNodeAbi,
    })
    assert.match(
      targetPaths.relativeArchivePath,
      new RegExp(`${supportedTarget.platform}-${supportedTarget.arch}-node-${targetNodeAbi}/[a-f0-9]{64}/runtime-deps\\.tgz$`, "u"),
    )
  }

  const changedLock = structuredClone(packageLock)
  changedLock.packages["node_modules/gray-matter"].version = "4.0.4"
  assert.notEqual(
    productionDependencyLockHash({ packageJson, packageLock: changedLock }),
    prodDependencyLockHash,
  )

  const changedTransitiveLock = structuredClone(packageLock)
  changedTransitiveLock.packages["node_modules/zod"].version = "3.25.77"
  assert.notEqual(
    productionDependencyLockHash({ packageJson, packageLock: changedTransitiveLock }),
    prodDependencyLockHash,
  )

  const changedNativeLock = structuredClone(packageLock)
  changedNativeLock.packages["node_modules/sqlite-vec-darwin-arm64"].version = "0.1.10"
  assert.notEqual(
    productionDependencyLockHash({ packageJson, packageLock: changedNativeLock }),
    prodDependencyLockHash,
  )

  const changedNestedLock = structuredClone(packageLock)
  changedNestedLock.packages["node_modules/type-is/node_modules/content-type"].version = "2.0.1"
  assert.notEqual(
    productionDependencyLockHash({ packageJson, packageLock: changedNestedLock }),
    prodDependencyLockHash,
  )

  const devOnlyLock = structuredClone(packageLock)
  devOnlyLock.packages["node_modules/unit-6d-dev-only"] = {
    version: "1.0.0",
    dev: true,
    license: "MIT",
  }
  assert.equal(
    productionDependencyLockHash({ packageJson, packageLock: devOnlyLock }),
    prodDependencyLockHash,
  )
})

test("production dependency closure includes native packages and non-native transitive packages", async () => {
  const { collectProductionDependencyClosure } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)

  for (const supportedTarget of supportedTargets) {
    const dependencies = collectProductionDependencyClosure({
      packageJson,
      packageLock,
      platform: supportedTarget.platform,
      arch: supportedTarget.arch,
    })
    const expectedDependencies = expectedProductionDependencyClosure({
      packageJson,
      packageLock,
      platform: supportedTarget.platform,
      arch: supportedTarget.arch,
    })
    const names = dependencyNames(dependencies)

    assert.deepEqual(dependencies, expectedDependencies)
    assertIncludesAll(names, [
      "@modelcontextprotocol/sdk",
      "better-sqlite3",
      "gray-matter",
      "js-yaml",
      "prebuild-install",
      "section-matter",
      "sqlite-vec",
      "zod",
      supportedTarget.sqliteVecPackage,
    ], `production dependency closure for ${supportedTarget.platform}-${supportedTarget.arch}`)
    for (const otherTarget of supportedTargets) {
      if (otherTarget.sqliteVecPackage !== supportedTarget.sqliteVecPackage) {
        assert.equal(names.includes(otherTarget.sqliteVecPackage), false)
      }
    }
  }

  const dependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const sqlite = dependencies.find((dependency) => dependency.name === "better-sqlite3")
  assert.equal(sqlite.native, true)
  assert.match(sqlite.lock_path, /^node_modules\/better-sqlite3$/u)

  const jsYaml = dependencies.find((dependency) => dependency.name === "js-yaml")
  assert.equal(jsYaml.native, false)
  assert.equal(jsYaml.version, "3.14.2")

  assert.deepEqual(
    dependencies
      .filter((dependency) => dependency.name === "content-type")
      .map((dependency) => ({ lock_path: dependency.lock_path, version: dependency.version }))
      .sort((left, right) => left.lock_path.localeCompare(right.lock_path)),
    [
      { lock_path: "node_modules/content-type", version: "1.0.5" },
      { lock_path: "node_modules/type-is/node_modules/content-type", version: "2.0.0" },
    ],
  )
})

test("production dependency closure fails closed for malformed lock inputs", async () => {
  const { collectProductionDependencyClosure } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)

  const missingLockEntry = structuredClone(packageLock)
  delete missingLockEntry.packages["node_modules/gray-matter"]
  assert.throws(
    () => collectProductionDependencyClosure({
      packageJson,
      packageLock: missingLockEntry,
      platform: target.platform,
      arch: target.arch,
    }),
    /lock entry must exist for node_modules\/gray-matter/u,
  )

  assert.throws(
    () => collectProductionDependencyClosure({
      packageJson: {
        dependencies: {
          "../bad": "1.0.0",
        },
      },
      packageLock: {
        packages: {
          "node_modules/../bad": {
            version: "1.0.0",
          },
        },
      },
      platform: target.platform,
      arch: target.arch,
    }),
    /lock path must end in a package node_modules segment/u,
  )

  assert.deepEqual(
    collectProductionDependencyClosure({
      packageJson: {
        dependencies: {
          parent: "1.0.0",
        },
      },
      packageLock: {
        packages: {
          "node_modules/parent": {
            version: "1.0.0",
            dependencies: {
              child: "1.0.0",
            },
          },
          "node_modules/parent/node_modules/child": {
            version: "1.0.0",
            dependencies: {
              grandchild: "1.0.0",
            },
          },
          "node_modules/parent/node_modules/grandchild": {
            version: "1.0.0",
          },
        },
      },
      platform: target.platform,
      arch: target.arch,
    }).map((dependency) => dependency.lock_path),
    [
      "node_modules/parent",
      "node_modules/parent/node_modules/child",
      "node_modules/parent/node_modules/grandchild",
    ],
  )
})

test("runtime dependency pack manifest validates lock provenance and dependency-only shape", async () => {
  const {
    collectProductionDependencyClosure,
    productionDependencyLockHash,
    validateRuntimeDependencyPackManifest,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })

  const manifest = fixtureManifest({
    prodDependencyLockHash,
    productionDependencies,
  })
  assert.deepEqual(
    validateRuntimeDependencyPackManifest({
      manifest,
      packageJson,
      packageLock,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
    }),
    [],
  )

  const malformed = {
    schema_version: "1",
    created_at: "",
    plugin: {
      name: "desk-mcp",
      version: "0.0.0",
    },
    platform: {
      os: "",
      arch: "ppc",
    },
    package_lock: {
      path: "package-lock.json",
    },
    archive: {
      file: "deps.tgz",
      root_entries: "node_modules/",
    },
    production_dependencies: [],
    provenance: {},
  }
  assert.deepEqual(
    validateRuntimeDependencyPackManifest({
      manifest: malformed,
      packageJson,
      packageLock,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
    }),
    [
      "runtime dependency pack manifest schema_version must be 1",
      "runtime dependency pack manifest created_at must be an ISO timestamp",
      "runtime dependency pack manifest plugin.name must match package.json",
      "runtime dependency pack manifest plugin.version must match package.json",
      "runtime dependency pack manifest platform.os must match target platform",
      "runtime dependency pack manifest platform.arch must match target arch",
      "runtime dependency pack manifest platform.node_abi must match target Node ABI",
      "runtime dependency pack manifest package_lock.path must be plugins/desk/mcp/package-lock.json",
      "runtime dependency pack manifest package_lock.sha256 must be a sha256 hex digest",
      "runtime dependency pack manifest package_lock.prod_dependency_lock_hash must be a sha256 hex digest",
      "runtime dependency pack manifest archive.file must be runtime-deps.tgz",
      "runtime dependency pack manifest archive.sha256 must be a sha256 hex digest",
      "runtime dependency pack manifest archive.root_entries must be an array",
      "runtime dependency pack manifest production_dependencies must not be empty",
      "runtime dependency pack manifest provenance.builder must be runtime:deps-pack:build",
      "runtime dependency pack manifest provenance.source is required",
    ],
  )

  const drifted = structuredClone(manifest)
  drifted.package_lock.sha256 = "0".repeat(64)
  drifted.package_lock.prod_dependency_lock_hash = "1".repeat(64)
  drifted.archive.contains_server_source = true
  drifted.archive.root_entries.push("src/server.js")
  drifted.production_dependencies = drifted.production_dependencies.map((dependency) => {
    if (dependency.name === "gray-matter") {
      return { ...dependency, version: "0.0.0", lock_path: "node_modules/not-gray-matter", native: true }
    }
    return dependency
  })
    .filter((dependency) => dependency.name !== "js-yaml")
  drifted.production_dependencies.push(
    drifted.production_dependencies.find((dependency) => dependency.name === "zod"),
    { name: "left-pad", version: "1.3.0", lock_path: "node_modules/left-pad", native: false },
  )

  assert.deepEqual(
    validateRuntimeDependencyPackManifest({
      manifest: drifted,
      packageJson,
      packageLock,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
    }),
    [
      "runtime dependency pack manifest package_lock.sha256 must match plugins/desk/mcp/package-lock.json",
      "runtime dependency pack manifest package_lock.prod_dependency_lock_hash must match production dependency closure",
      "runtime dependency pack manifest must not mark server source as archived",
      "runtime dependency pack archive root_entries must not include server source path src/server.js",
      "runtime dependency pack manifest dependency gray-matter version must match package-lock.json",
      "runtime dependency pack manifest dependency gray-matter lock_path must match production closure",
      "runtime dependency pack manifest dependency gray-matter native flag must match production closure",
      "runtime dependency pack manifest must include production dependency js-yaml",
      "runtime dependency pack manifest must not include duplicate production dependency zod",
      "runtime dependency pack manifest must not include non-production dependency left-pad",
    ],
  )

  const staleDependencyMetadata = structuredClone(manifest)
  staleDependencyMetadata.production_dependencies = staleDependencyMetadata.production_dependencies.map((dependency) => (
    dependency.name === "zod"
      ? { ...dependency, version: "0.0.0", native: true }
      : dependency
  ))
  assert.deepEqual(
    validateRuntimeDependencyPackManifest({
      manifest: staleDependencyMetadata,
      packageJson,
      packageLock,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
    }),
    [
      "runtime dependency pack manifest dependency zod version must match package-lock.json",
      "runtime dependency pack manifest dependency zod native flag must match production closure",
    ],
  )
})

test("runtime dependency archive shape rejects server source and missing dependencies", async () => {
  const {
    collectProductionDependencyClosure,
    validateRuntimeDependencyArchiveShape,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })

  const validEntries = archiveEntriesForProductionDependencies(productionDependencies)
  assert.ok(validEntries.includes("node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js"))
  assert.ok(validEntries.includes("node_modules/express/lib/express.js"))
  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries,
      productionDependencies,
    }),
    [],
  )

  const extraDependencyErrors = validateRuntimeDependencyArchiveShape({
    entries: [
      ...validEntries,
      "node_modules/@types/node/package.json",
      "node_modules/@types/node/index.d.ts",
      "node_modules/unit-6d-dev-only/package.json",
      "node_modules/unit-6d-dev-only/index.js",
    ],
    productionDependencies,
  })
  assert.deepEqual(
    [...extraDependencyErrors].sort(),
    [
      "runtime dependency archive must not include non-production dependency @types/node",
      "runtime dependency archive must not include non-production dependency unit-6d-dev-only",
    ].sort(),
  )

  const unexpectedRootErrors = validateRuntimeDependencyArchiveShape({
    entries: [
      ...validEntries,
      "README.md",
      "release-notes.txt",
      "scripts/evil.js",
      "lib/evil.js",
      "plugins/desk/mcp/src/server.js",
    ],
    productionDependencies,
  })
  assert.deepEqual(
    [...unexpectedRootErrors].sort(),
    [
      "runtime dependency archive must not include unexpected root file README.md",
      "runtime dependency archive must not include unexpected root file release-notes.txt",
      "runtime dependency archive must not include unexpected root path lib/evil.js",
      "runtime dependency archive must not include unexpected root path plugins/desk/mcp/src/server.js",
      "runtime dependency archive must not include unexpected root path scripts/evil.js",
    ].sort(),
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: [
        ...validEntries.filter((entry) => entry !== "node_modules/js-yaml/package.json"),
        "index.js",
        "src/server.js",
      ],
      productionDependencies,
    }),
    [
      "runtime dependency archive must include non-native dependency js-yaml",
      "runtime dependency archive must not include mutable MCP source index.js",
      "runtime dependency archive must not include mutable MCP source src/server.js",
    ],
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries
        .filter((entry) => entry !== "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js"),
      productionDependencies,
    }),
    [
      "runtime dependency archive must include runtime file node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js",
    ],
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries
        .filter((entry) => entry !== "node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js"),
      productionDependencies,
    }),
    [
      "runtime dependency archive must include runtime file node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js",
    ],
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries
        .filter((entry) => entry !== "node_modules/express/lib/express.js"),
      productionDependencies,
    }),
    [
      "runtime dependency archive must include runtime file node_modules/express/lib/express.js",
    ],
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries
        .filter((entry) => entry !== "node_modules/sqlite-vec/index.cjs"),
      productionDependencies,
    }),
    ["runtime dependency archive must include runtime file node_modules/sqlite-vec/index.cjs"],
  )

  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: [
        ...validEntries.filter((entry) => entry !== "node_modules/zod/package.json"),
      ],
      productionDependencies,
    }),
    ["runtime dependency archive must include non-native dependency zod"],
  )
})

test("runtime dependency archive shape scans package runtime files defensively", async () => {
  const {
    collectProductionDependencyClosure,
    validateRuntimeDependencyArchiveShape,
  } = await loadRuntimeDeps()
  const synthetic = writeSyntheticMcpRoot({
    dependencyFiles: [
      "index.js",
      "dist/runtime.json",
      "native.node",
      "README.md",
    ],
  })
  const emptyRuntime = writeSyntheticMcpRoot({
    dependencyFiles: [],
    dependencyName: "empty-runtime",
  })

  try {
    mkdirSync(path.join(synthetic.root, synthetic.lockPath, "linked-dir"), { recursive: true })
    symlinkSync("linked-dir", path.join(synthetic.root, synthetic.lockPath, "linked-dir-symlink.js"))
    symlinkSync("missing-target.js", path.join(synthetic.root, synthetic.lockPath, "broken-runtime.js"))

    const dependencies = collectProductionDependencyClosure({
      packageJson: synthetic.packageJson,
      packageLock: synthetic.packageLock,
      platform: target.platform,
      arch: target.arch,
    })
    assert.deepEqual(
      validateRuntimeDependencyArchiveShape({
        entries: [
          "package.json",
          "package-lock.json",
          "runtime-deps.manifest.json",
          `${synthetic.lockPath}/package.json`,
          `${synthetic.lockPath}/index.js`,
          `${synthetic.lockPath}/dist/runtime.json`,
          `${synthetic.lockPath}/native.node`,
        ],
        productionDependencies: dependencies,
        mcpRoot: synthetic.root,
      }),
      [],
    )

    const emptyRuntimeDependencies = collectProductionDependencyClosure({
      packageJson: emptyRuntime.packageJson,
      packageLock: emptyRuntime.packageLock,
      platform: target.platform,
      arch: target.arch,
    })
    assert.throws(
      () => validateRuntimeDependencyArchiveShape({
        entries: [
          "package.json",
          "package-lock.json",
          "runtime-deps.manifest.json",
          `${emptyRuntime.lockPath}/package.json`,
        ],
        productionDependencies: emptyRuntimeDependencies,
        mcpRoot: emptyRuntime.root,
      }),
      /runtime dependency archive must require a non-marker runtime file for empty-runtime/u,
    )
  } finally {
    rmSync(synthetic.root, { recursive: true, force: true })
    rmSync(emptyRuntime.root, { recursive: true, force: true })
  }
})

test("runtime dependency pack verification checks checksums and unsupported platforms", async () => {
  const {
    collectProductionDependencyClosure,
    productionDependencyLockHash,
    verifyRuntimeDependencyPack,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const validEntries = archiveEntriesForProductionDependencies(productionDependencies)
  const manifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const archiveSha = manifest.archive.sha256
  const packDir = writePackFixture({ archiveEntries: validEntries, checksum: archiveSha, manifest })
  const corruptPackDir = writePackFixture({
    archiveEntries: validEntries,
    checksum: "0".repeat(64),
    manifest,
  })
  const missingManifestPackDir = writePartialPackFixture({
    archiveBytes: createTarGz(validEntries, archiveEntryBytesForManifest(manifest)),
    checksum: archiveSha,
    omitManifest: true,
  })
  const missingArchivePackDir = writePartialPackFixture({
    checksum: archiveSha,
    manifest,
    omitArchive: true,
  })
  const missingChecksumPackDir = writePartialPackFixture({
    archiveBytes: createTarGz(validEntries, archiveEntryBytesForManifest(manifest)),
    manifest,
    omitChecksum: true,
  })
  const invalidArchiveBytes = Buffer.from("not gzip\n", "utf8")
  const invalidArchiveManifest = fixtureManifest({
    archiveSha: sha256(invalidArchiveBytes),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const invalidArchivePackDir = writePartialPackFixture({
    archiveBytes: invalidArchiveBytes,
    checksum: sha256(invalidArchiveBytes),
    manifest: invalidArchiveManifest,
  })
  const staleManifestArchiveShaManifest = fixtureManifest({
    archiveSha: "f".repeat(64),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const staleManifestArchiveShaPackDir = writePackFixture({
    archiveEntries: validEntries,
    checksum: archiveSha,
    manifest: staleManifestArchiveShaManifest,
  })
  const embeddedManifestMismatchBytes = archiveEntryBytesForManifest(fixtureManifest({
    archiveSha: "0".repeat(64),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  }), {
    "runtime-deps.manifest.json": Buffer.from("placeholder embedded manifest\n", "utf8"),
  })
  const embeddedManifestMismatchManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    archiveEntryBytes: embeddedManifestMismatchBytes,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const embeddedManifestMismatchPackDir = writePackFixture({
    archiveEntries: validEntries,
    archiveEntryBytes: embeddedManifestMismatchBytes,
    manifest: embeddedManifestMismatchManifest,
  })
  const missingArchivePackageJsonEntries = validEntries
    .filter((entry) => entry !== "package.json")
  const missingArchivePackageJsonManifest = fixtureManifestForArchiveEntries({
    archiveEntries: missingArchivePackageJsonEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingArchivePackageJsonPackDir = writePackFixture({
    archiveEntries: missingArchivePackageJsonEntries,
    manifest: missingArchivePackageJsonManifest,
  })
  const missingArchivePackageLockEntries = validEntries
    .filter((entry) => entry !== "package-lock.json")
  const missingArchivePackageLockManifest = fixtureManifestForArchiveEntries({
    archiveEntries: missingArchivePackageLockEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingArchivePackageLockPackDir = writePackFixture({
    archiveEntries: missingArchivePackageLockEntries,
    manifest: missingArchivePackageLockManifest,
  })
  const tamperedPackageLock = structuredClone(packageLock)
  tamperedPackageLock.packages["node_modules/zod"].version = "3.25.77"
  const tamperedPackageLockProvisionalManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const tamperedPackageLockBytes = archiveEntryBytesForManifest(tamperedPackageLockProvisionalManifest, {
    "package-lock.json": Buffer.from(JSON.stringify(tamperedPackageLock, null, 2), "utf8"),
  })
  const tamperedPackageLockManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    archiveEntryBytes: tamperedPackageLockBytes,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const tamperedPackageLockPackDir = writePackFixture({
    archiveEntries: validEntries,
    archiveEntryBytes: tamperedPackageLockBytes,
    manifest: tamperedPackageLockManifest,
  })
  const mismatchedPackageJsonProvisionalManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const mismatchedPackageJsonBytes = archiveEntryBytesForManifest(mismatchedPackageJsonProvisionalManifest, {
    "package.json": Buffer.from(JSON.stringify({ ...packageJson, version: "0.0.0" }, null, 2), "utf8"),
  })
  const mismatchedPackageJsonManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    archiveEntryBytes: mismatchedPackageJsonBytes,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const mismatchedPackageJsonPackDir = writePackFixture({
    archiveEntries: validEntries,
    archiveEntryBytes: mismatchedPackageJsonBytes,
    manifest: mismatchedPackageJsonManifest,
  })
  const invalidPackageJsonBytes = archiveEntryBytesForManifest(mismatchedPackageJsonProvisionalManifest, {
    "package.json": Buffer.from("{not json\n", "utf8"),
  })
  const invalidPackageJsonManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    archiveEntryBytes: invalidPackageJsonBytes,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const invalidPackageJsonPackDir = writePackFixture({
    archiveEntries: validEntries,
    archiveEntryBytes: invalidPackageJsonBytes,
    manifest: invalidPackageJsonManifest,
  })
  const malformedPackageLockBytes = Buffer.from(JSON.stringify({
    lockfileVersion: 3,
    packages: {},
  }, null, 2), "utf8")
  const malformedPackageLockProvisionalManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    packageLockSha: sha256(malformedPackageLockBytes),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const malformedPackageLockArchiveBytes = archiveEntryBytesForManifest(malformedPackageLockProvisionalManifest, {
    "package-lock.json": malformedPackageLockBytes,
  })
  const malformedPackageLockManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    archiveEntryBytes: malformedPackageLockArchiveBytes,
    packageLockSha: sha256(malformedPackageLockBytes),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const malformedPackageLockPackDir = writePackFixture({
    archiveEntries: validEntries,
    archiveEntryBytes: malformedPackageLockArchiveBytes,
    manifest: malformedPackageLockManifest,
  })
  const missingEmbeddedManifestEntries = validEntries
    .filter((entry) => entry !== "runtime-deps.manifest.json")
  const missingEmbeddedManifest = fixtureManifestForArchiveEntries({
    archiveEntries: missingEmbeddedManifestEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingEmbeddedManifestPackDir = writePackFixture({
    archiveEntries: missingEmbeddedManifestEntries,
    manifest: missingEmbeddedManifest,
  })
  const specialHeaderModes = {
    "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js": "pax-path",
    "node_modules/express/lib/express.js": "gnu-long-name",
  }
  const specialHeaderManifest = fixtureManifestForSpecialArchiveEntries({
    archiveEntries: validEntries,
    headerModes: specialHeaderModes,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const specialHeaderPackDir = writeSpecialPackFixture({
    archiveEntries: validEntries,
    headerModes: specialHeaderModes,
    manifest: specialHeaderManifest,
  })
  const paxWithoutPathEntries = [
    ...validEntries,
    "EMPTY",
    "NULLTYPE.md",
    "README.md",
  ]
  const paxWithoutPathManifest = fixtureManifestForSpecialArchiveEntries({
    archiveEntries: paxWithoutPathEntries,
    headerModes: {
      EMPTY: "blank-size",
      "NULLTYPE.md": "nul-type",
      "README.md": "pax-without-path",
    },
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const paxWithoutPathPackDir = writeSpecialPackFixture({
    archiveEntries: paxWithoutPathEntries,
    headerModes: {
      EMPTY: "blank-size",
      "NULLTYPE.md": "nul-type",
      "README.md": "pax-without-path",
    },
    manifest: paxWithoutPathManifest,
  })
  const noProductionDependenciesEntries = [
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
  ]
  const noProductionDependenciesManifest = fixtureManifest({
    archiveSha: "0".repeat(64),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies: [],
  })
  delete noProductionDependenciesManifest.production_dependencies
  noProductionDependenciesManifest.archive.sha256 = sha256(createTarGz(
    noProductionDependenciesEntries,
    archiveEntryBytesForManifest(noProductionDependenciesManifest),
  ))
  const noProductionDependenciesPackDir = writePackFixture({
    archiveEntries: noProductionDependenciesEntries,
    manifest: noProductionDependenciesManifest,
  })
  const missingRuntimeFileEntries = validEntries
    .filter((entry) => entry !== "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js")
  const missingRuntimeFileManifest = fixtureManifestForArchiveEntries({
    archiveEntries: missingRuntimeFileEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingRuntimeFilePackDir = writePackFixture({
    archiveEntries: missingRuntimeFileEntries,
    manifest: missingRuntimeFileManifest,
  })
  const missingInferredRuntimeFileEntries = validEntries
    .filter((entry) => entry !== "node_modules/section-matter/index.js")
  const missingInferredRuntimeFileManifest = fixtureManifestForArchiveEntries({
    archiveEntries: missingInferredRuntimeFileEntries,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingInferredRuntimeFilePackDir = writePackFixture({
    archiveEntries: missingInferredRuntimeFileEntries,
    manifest: missingInferredRuntimeFileManifest,
  })
  try {
    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      { ok: true, errors: [], manifest },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: corruptPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack checksum mismatch for runtime-deps.tgz"],
        manifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingManifestPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack manifest runtime-deps.manifest.json is missing"],
        manifest: undefined,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingArchivePackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack archive runtime-deps.tgz is missing"],
        manifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingChecksumPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack checksum runtime-deps.sha256 is missing"],
        manifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: invalidArchivePackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive runtime-deps.tgz must be a readable gzip tar archive"],
        manifest: invalidArchiveManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: staleManifestArchiveShaPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack manifest archive.sha256 must match runtime-deps.tgz"],
        manifest: staleManifestArchiveShaManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: embeddedManifestMismatchPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive embedded manifest must match sidecar manifest metadata"],
        manifest: embeddedManifestMismatchManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingArchivePackageJsonPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive must include root package.json"],
        manifest: missingArchivePackageJsonManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingArchivePackageLockPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive must include root package-lock.json"],
        manifest: missingArchivePackageLockManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: tamperedPackageLockPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency archive package-lock.json sha256 must match sidecar manifest",
          "runtime dependency archive production dependency lock hash must match embedded package metadata",
        ],
        manifest: tamperedPackageLockManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: mismatchedPackageJsonPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive package.json must match sidecar manifest plugin metadata"],
        manifest: mismatchedPackageJsonManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: invalidPackageJsonPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency archive package.json must be valid JSON"],
        manifest: invalidPackageJsonManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: malformedPackageLockPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency pack manifest package_lock.sha256 must match plugins/desk/mcp/package-lock.json",
          "runtime dependency archive production dependency lock hash must be computable from embedded package metadata",
        ],
        manifest: malformedPackageLockManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingEmbeddedManifestPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency archive embedded manifest must match sidecar manifest metadata",
          "runtime dependency archive must include root runtime-deps.manifest.json",
        ],
        manifest: missingEmbeddedManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: specialHeaderPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      { ok: true, errors: [], manifest: specialHeaderManifest },
    )
    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: specialHeaderPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      { ok: true, errors: [], manifest: specialHeaderManifest },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: paxWithoutPathPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency archive must not include unexpected root file EMPTY",
          "runtime dependency archive must not include unexpected root file NULLTYPE.md",
          "runtime dependency archive must not include unexpected root file README.md",
        ],
        manifest: paxWithoutPathManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: noProductionDependenciesPackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: ["runtime dependency pack manifest production_dependencies must not be empty"],
        manifest: noProductionDependenciesManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir,
        mcpRoot,
        platform: "freebsd",
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [`unsupported runtime dependency pack target freebsd-${target.arch}-node-${targetNodeAbi}`],
        manifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingRuntimeFilePackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency archive must include runtime file node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js",
        ],
        manifest: missingRuntimeFileManifest,
      },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: missingInferredRuntimeFilePackDir,
        mcpRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      {
        ok: false,
        errors: [
          "runtime dependency archive must include runtime file node_modules/section-matter/index.js",
        ],
        manifest: missingInferredRuntimeFileManifest,
      },
    )
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(corruptPackDir, { recursive: true, force: true })
    rmSync(missingManifestPackDir, { recursive: true, force: true })
    rmSync(missingArchivePackDir, { recursive: true, force: true })
    rmSync(missingChecksumPackDir, { recursive: true, force: true })
    rmSync(invalidArchivePackDir, { recursive: true, force: true })
    rmSync(staleManifestArchiveShaPackDir, { recursive: true, force: true })
    rmSync(embeddedManifestMismatchPackDir, { recursive: true, force: true })
    rmSync(missingArchivePackageJsonPackDir, { recursive: true, force: true })
    rmSync(missingArchivePackageLockPackDir, { recursive: true, force: true })
    rmSync(tamperedPackageLockPackDir, { recursive: true, force: true })
    rmSync(mismatchedPackageJsonPackDir, { recursive: true, force: true })
    rmSync(invalidPackageJsonPackDir, { recursive: true, force: true })
    rmSync(malformedPackageLockPackDir, { recursive: true, force: true })
    rmSync(missingEmbeddedManifestPackDir, { recursive: true, force: true })
    rmSync(specialHeaderPackDir, { recursive: true, force: true })
    rmSync(paxWithoutPathPackDir, { recursive: true, force: true })
    rmSync(noProductionDependenciesPackDir, { recursive: true, force: true })
    rmSync(missingRuntimeFilePackDir, { recursive: true, force: true })
    rmSync(missingInferredRuntimeFilePackDir, { recursive: true, force: true })
  }
})

test("runtime dependency pack verify CLI reports missing and corrupt artifacts cleanly", async () => {
  const {
    collectProductionDependencyClosure,
    productionDependencyLockHash,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const invalidArchiveBytes = Buffer.from("not gzip\n", "utf8")
  const invalidArchiveManifest = fixtureManifest({
    archiveSha: sha256(invalidArchiveBytes),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingArtifactsPackDir = makeTempDir()
  const corruptArchivePackDir = writePartialPackFixture({
    archiveBytes: invalidArchiveBytes,
    checksum: sha256(invalidArchiveBytes),
    manifest: invalidArchiveManifest,
  })

  try {
    const missingRun = runNpmScript("runtime:deps-pack:verify", [
      "--pack-dir",
      missingArtifactsPackDir,
      "--platform",
      target.platform,
      "--arch",
      target.arch,
      "--node-abi",
      targetNodeAbi,
    ])
    assert.notEqual(missingRun.status, 0)
    assert.match(missingRun.stderr, /runtime dependency pack manifest runtime-deps\.manifest\.json is missing/u)
    assert.doesNotMatch(missingRun.stderr, /(?:Error:|ENOENT|at file:|at async|incorrect header check)/u)

    const corruptRun = runNpmScript("runtime:deps-pack:verify", [
      "--pack-dir",
      corruptArchivePackDir,
      "--platform",
      target.platform,
      "--arch",
      target.arch,
      "--node-abi",
      targetNodeAbi,
    ])
    assert.notEqual(corruptRun.status, 0)
    assert.match(corruptRun.stderr, /runtime dependency archive runtime-deps\.tgz must be a readable gzip tar archive/u)
    assert.doesNotMatch(corruptRun.stderr, /(?:Error:|ENOENT|at file:|at async|incorrect header check)/u)
  } finally {
    rmSync(missingArtifactsPackDir, { recursive: true, force: true })
    rmSync(corruptArchivePackDir, { recursive: true, force: true })
  }
})

test("package declares CI/release scripts for runtime dependency packs", async () => {
  const {
    collectProductionDependencyClosure,
    productionDependencyLockHash,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)

  assert.equal(
    packageJson.scripts["runtime:deps-pack:build"],
    "node scripts/build-runtime-deps-pack.js",
  )
  assert.equal(
    packageJson.scripts["runtime:deps-pack:verify"],
    "node scripts/verify-runtime-deps-pack.js",
  )
  assert.equal(
    readFileSync(path.join(mcpRoot, "scripts", "build-runtime-deps-pack.js"), "utf8")
      .startsWith("#!/usr/bin/env node\n"),
    true,
  )
  assert.equal(
    readFileSync(path.join(mcpRoot, "scripts", "verify-runtime-deps-pack.js"), "utf8")
      .startsWith("#!/usr/bin/env node\n"),
    true,
  )

  const buildHelp = scriptHelp("build-runtime-deps-pack.js")
  assert.match(buildHelp, /runtime dependency pack/i)
  assert.match(buildHelp, /--platform/u)
  assert.match(buildHelp, /--arch/u)
  assert.match(buildHelp, /--node-abi/u)

  const verifyHelp = scriptHelp("verify-runtime-deps-pack.js")
  assert.match(verifyHelp, /runtime dependency pack/i)
  assert.match(verifyHelp, /--pack-dir/u)
  assert.match(verifyHelp, /--platform/u)

  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  const validEntries = archiveEntriesForProductionDependencies(productionDependencies)
  const validManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    prodDependencyLockHash,
    productionDependencies,
  })
  const validPackDir = writePackFixture({
    archiveEntries: validEntries,
    manifest: validManifest,
  })
  const invalidEntries = validEntries
    .filter((entry) => entry !== "node_modules/sqlite-vec/index.cjs")
  const invalidManifest = fixtureManifestForArchiveEntries({
    archiveEntries: invalidEntries,
    prodDependencyLockHash,
    productionDependencies,
  })
  const invalidPackDir = writePackFixture({
    archiveEntries: invalidEntries,
    manifest: invalidManifest,
  })
  try {
    const validRun = runNpmScript("runtime:deps-pack:verify", [
      "--pack-dir",
      validPackDir,
      "--platform",
      target.platform,
      "--arch",
      target.arch,
      "--node-abi",
      targetNodeAbi,
    ])
    assert.equal(validRun.status, 0, validRun.stderr || validRun.stdout)
    assert.match(`${validRun.stdout}${validRun.stderr}`, /runtime dependency pack verified/i)

    const invalidRun = runNpmScript("runtime:deps-pack:verify", [
      "--pack-dir",
      invalidPackDir,
      "--platform",
      target.platform,
      "--arch",
      target.arch,
      "--node-abi",
      targetNodeAbi,
    ])
    assert.notEqual(invalidRun.status, 0)
    assert.match(
      `${invalidRun.stdout}${invalidRun.stderr}`,
      /runtime dependency archive must include runtime file node_modules\/sqlite-vec\/index\.cjs/u,
    )

    const buildOutputRoot = makeTempDir()
    try {
      const buildRun = runNpmScript("runtime:deps-pack:build", [
        "--output-root",
        buildOutputRoot,
        "--platform",
        target.platform,
        "--arch",
        target.arch,
        "--node-abi",
        targetNodeAbi,
      ])
      assert.equal(buildRun.status, 0, buildRun.stderr || buildRun.stdout)
      assert.match(`${buildRun.stdout}${buildRun.stderr}`, /runtime dependency pack built/i)

      const builtPackDir = path.join(
        buildOutputRoot,
        packageJson.version,
        `${target.platform}-${target.arch}-node-${targetNodeAbi}`,
        prodDependencyLockHash,
      )
      const builtArchivePath = path.join(builtPackDir, "runtime-deps.tgz")
      assert.equal(existsSync(builtArchivePath), true)
      assert.equal(existsSync(path.join(builtPackDir, "runtime-deps.manifest.json")), true)
      assert.equal(existsSync(path.join(builtPackDir, "runtime-deps.sha256")), true)
      const builtEntries = listTarGzEntries(builtArchivePath)
      assert.ok(builtEntries.includes("node_modules/section-matter/index.js"))
      assert.ok(builtEntries.includes("node_modules/@hono/node-server/dist/index.js"))
      assert.ok(builtEntries.includes("node_modules/sqlite-vec/index.cjs"))
      assert.ok(builtEntries.includes("node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js"))
      assert.ok(builtEntries.includes("node_modules/express/lib/express.js"))
      assert.equal(requiredRuntimeFilesByPackage.has("section-matter"), false)
      const builtArchiveContents = extractTarGzContents(builtArchivePath)
      assertArchiveFilesMatchInstalledRuntime(
        builtArchiveContents,
        validEntries,
        { manifestPath: path.join(builtPackDir, "runtime-deps.manifest.json") },
      )

      const builtVerifyRun = runNpmScript("runtime:deps-pack:verify", [
        "--pack-dir",
        builtPackDir,
        "--platform",
        target.platform,
        "--arch",
        target.arch,
        "--node-abi",
        targetNodeAbi,
      ])
      assert.equal(builtVerifyRun.status, 0, builtVerifyRun.stderr || builtVerifyRun.stdout)
    } finally {
      rmSync(buildOutputRoot, { recursive: true, force: true })
    }
  } finally {
    rmSync(validPackDir, { recursive: true, force: true })
    rmSync(invalidPackDir, { recursive: true, force: true })
  }
})

test("runtime dependency pack builder handles long paths and CLI argument edge cases", async () => {
  const {
    buildRuntimeDependencyPack,
    collectProductionDependencyClosure,
    deriveRuntimeDependencyPackPaths,
    productionDependencyLockHash,
    runRuntimeDependencyPackBuildCli,
    runRuntimeDependencyPackVerifyCli,
    verifyRuntimeDependencyPack,
  } = await loadRuntimeDeps()
  assert.match(
    productionDependencyLockHash({
      packageJson: {},
      packageLock: { packages: {} },
    }),
    /^[a-f0-9]{64}$/u,
  )
  assert.deepEqual(
    collectProductionDependencyClosure({
      packageJson: {},
      packageLock: { packages: {} },
    }),
    [],
  )

  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const productionDependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: target.platform,
    arch: target.arch,
  })
  const prodDependencyLockHash = productionDependencyLockHash({ packageJson, packageLock })
  const validEntries = archiveEntriesForProductionDependencies(productionDependencies)
  const longPackageName = `unit-${"a".repeat(70)}`
  const longRuntimeFile = `dist/${"b".repeat(60)}.js`
  const splittableLongPathRoot = writeSyntheticMcpRoot({
    dependencyFiles: [longRuntimeFile],
    dependencyName: longPackageName,
  })
  const splittableOutputRoot = makeTempDir()
  const tooLongPackageName = `unit-${"c".repeat(160)}`
  const tooLongRuntimeFile = `${"d".repeat(101)}.js`
  const unsplittableLongPathRoot = writeSyntheticMcpRoot({
    dependencyFiles: [tooLongRuntimeFile],
    dependencyName: tooLongPackageName,
  })
  const unsplittableOutputRoot = makeTempDir()
  const defaultOutputRoot = writeSyntheticMcpRoot({
    dependencyFiles: ["index.js"],
    dependencyName: "default-output-runtime",
  })
  const cliOutputRoot = makeTempDir()
  const cliInvalidManifest = fixtureManifestForArchiveEntries({
    archiveEntries: validEntries,
    prodDependencyLockHash,
    productionDependencies,
  })
  const cliInvalidPackDir = writePackFixture({
    archiveEntries: validEntries,
    checksum: "0".repeat(64),
    manifest: cliInvalidManifest,
  })
  const stdout = []
  const stderr = []
  const io = {
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  }
  const resetIo = () => {
    stdout.length = 0
    stderr.length = 0
  }

  try {
    const built = buildRuntimeDependencyPack({
      mcpRoot: splittableLongPathRoot.root,
      outputRoot: splittableOutputRoot,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
      createdAt: "2026-06-15T00:00:00.000Z",
      provenanceSource: "unit 6f long path fixture",
    })
    assert.ok(
      listTarGzEntries(built.archivePath).includes(`node_modules/${longPackageName}/${longRuntimeFile}`),
      "builder must write splittable long tar paths",
    )
    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: built.packDir,
        mcpRoot: splittableLongPathRoot.root,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
      }),
      { ok: true, errors: [], manifest: built.manifest },
    )

    const defaultOutputPack = buildRuntimeDependencyPack({
      mcpRoot: defaultOutputRoot.root,
      platform: target.platform,
      arch: target.arch,
      nodeAbi: targetNodeAbi,
      createdAt: "2026-06-15T00:00:00.000Z",
      provenanceSource: "unit 6f default output root fixture",
    })
    assert.equal(
      defaultOutputPack.packDir.startsWith(path.join(defaultOutputRoot.root, "artifacts", "runtime-deps")),
      true,
    )

    assert.throws(
      () => buildRuntimeDependencyPack({
        mcpRoot: unsplittableLongPathRoot.root,
        outputRoot: unsplittableOutputRoot,
        platform: target.platform,
        arch: target.arch,
        nodeAbi: targetNodeAbi,
        createdAt: "2026-06-15T00:00:00.000Z",
        provenanceSource: "unit 6f too-long path fixture",
      }),
      /runtime dependency archive path is too long for tar header/u,
    )

    assert.equal(runRuntimeDependencyPackBuildCli({ argv: ["-h"], io }), 0)
    assert.match(stdout.join(""), /Build a runtime dependency pack/u)
    assert.equal(stderr.join(""), "")
    resetIo()

    assert.equal(
      runRuntimeDependencyPackBuildCli({
        argv: [
          "ignored-positional",
          "--output-root",
          cliOutputRoot,
          "--platform",
          process.platform,
          "--arch",
          process.arch,
          "--node-abi",
        ],
        io,
      }),
      0,
    )
    assert.match(stdout.join(""), /runtime dependency pack built/u)
    assert.equal(stderr.join(""), "")
    resetIo()

    assert.equal(runRuntimeDependencyPackVerifyCli({ argv: ["--help"], io }), 0)
    assert.match(stdout.join(""), /Verify a runtime dependency pack/u)
    assert.equal(stderr.join(""), "")
    resetIo()

    const defaultPackPaths = deriveRuntimeDependencyPackPaths({
      mcpRoot,
      packageJson,
      packageLock,
      platform: process.platform,
      arch: process.arch,
      nodeAbi: process.versions.modules,
    })
    const defaultVerifyStatus = runRuntimeDependencyPackVerifyCli({ argv: [], io })
    if (existsSync(defaultPackPaths.packDir)) {
      assert.equal(defaultVerifyStatus, 0)
      assert.match(stdout.join(""), /runtime dependency pack verified/u)
      assert.equal(stderr.join(""), "")
    } else {
      assert.equal(defaultVerifyStatus, 1)
      assert.equal(stdout.join(""), "")
      assert.match(stderr.join(""), /runtime dependency pack manifest runtime-deps\.manifest\.json is missing/u)
    }
    resetIo()

    assert.equal(
      runRuntimeDependencyPackVerifyCli({
        argv: [
          "ignored-positional",
          "--pack-dir",
          cliInvalidPackDir,
          "--platform",
          target.platform,
          "--arch",
          target.arch,
          "--node-abi",
          targetNodeAbi,
        ],
        io,
      }),
      1,
    )
    assert.match(stderr.join(""), /runtime dependency pack checksum mismatch/u)
  } finally {
    rmSync(splittableLongPathRoot.root, { recursive: true, force: true })
    rmSync(splittableOutputRoot, { recursive: true, force: true })
    rmSync(unsplittableLongPathRoot.root, { recursive: true, force: true })
    rmSync(unsplittableOutputRoot, { recursive: true, force: true })
    rmSync(defaultOutputRoot.root, { recursive: true, force: true })
    rmSync(cliOutputRoot, { recursive: true, force: true })
    rmSync(cliInvalidPackDir, { recursive: true, force: true })
  }
})

test("CI workflow verifies runtime dependency packs for release-maintained artifacts", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml"), "utf8")
  const pullRequestPathFilters = workflowPathFilters(workflow, "pull_request")
  const pushPathFilters = workflowPathFilters(workflow, "push")
  const deskMcpJob = workflowJob(workflow, "desk-mcp-tests")

  assert.throws(
    () => workflowPathFilters([
      "name: fake",
      "on:",
      "  push:",
      "    branches:",
      "      - main",
      "jobs:",
      "  desk-mcp-tests:",
      "    paths:",
      "      - \"plugins/desk/mcp/artifacts/runtime-deps/**\"",
      "      - \"plugins/desk/mcp/scripts/build-runtime-deps-pack.js\"",
      "      - \"plugins/desk/mcp/scripts/verify-runtime-deps-pack.js\"",
    ].join("\n"), "push"),
    /push must define paths/u,
  )
  assert.throws(
    () => {
      const fakeWorkflow = [
        "name: fake",
        "on:",
        "  pull_request:",
        "    paths:",
        "      - \"plugins/desk/mcp/**\"",
        "jobs:",
        "  desk-mcp-tests:",
        "    steps:",
        "      - name: Run desk MCP coverage gate",
        "        working-directory: plugins/desk/mcp",
        "        run: npm run test:coverage",
        "  unrelated-release:",
        "    steps:",
        "      - name: Loose runtime dependency verification",
        "        run: npm --prefix plugins/desk/mcp run runtime:deps-pack:verify",
      ].join("\n")
      assertWorkflowJobRunsMcpScript(
        workflowJob(fakeWorkflow, "desk-mcp-tests"),
        "desk-mcp-tests",
        "runtime:deps-pack:verify",
      )
    },
    /workflow job desk-mcp-tests must run runtime:deps-pack:verify/u,
  )
  assert.throws(
    () => {
      const fakeWorkflow = [
        "name: fake",
        "on:",
        "  pull_request:",
        "    paths:",
        "      - \"plugins/desk/mcp/**\"",
        "jobs:",
        "  desk-mcp-tests:",
        "    steps:",
        "      - name: Pretend runtime dependency build",
        "        working-directory: plugins/desk/mcp",
        "        run: echo npm run runtime:deps-pack:build",
      ].join("\n")
      assertWorkflowJobRunsMcpScript(
        workflowJob(fakeWorkflow, "desk-mcp-tests"),
        "desk-mcp-tests",
        "runtime:deps-pack:build",
      )
    },
    /workflow job desk-mcp-tests must run runtime:deps-pack:build/u,
  )
  for (const fakeRunLine of [
    "npm run runtime:deps-pack:build -- --help",
    "npm run runtime:deps-pack:build || true",
    "npm run runtime:deps-pack:build:fake",
  ]) {
    assert.throws(
      () => {
        const fakeWorkflow = [
          "name: fake",
          "on:",
          "  pull_request:",
          "    paths:",
          "      - \"plugins/desk/mcp/**\"",
          "jobs:",
          "  desk-mcp-tests:",
          "    steps:",
          "      - name: Fake runtime dependency build",
          "        working-directory: plugins/desk/mcp",
          `        run: ${fakeRunLine}`,
        ].join("\n")
        assertWorkflowJobRunsMcpScript(
          workflowJob(fakeWorkflow, "desk-mcp-tests"),
          "desk-mcp-tests",
          "runtime:deps-pack:build",
        )
      },
      /workflow job desk-mcp-tests must run runtime:deps-pack:build/u,
    )
  }
  assert.throws(
    () => {
      const fakeWorkflow = [
        "name: fake",
        "on:",
        "  pull_request:",
        "    paths:",
        "      - \"plugins/desk/mcp/**\"",
        "jobs:",
        "  desk-mcp-tests:",
        "    steps:",
        "      - name: Failure-masked runtime dependency build",
        "        working-directory: plugins/desk/mcp",
        "        continue-on-error: true",
        "        run: npm run runtime:deps-pack:build",
      ].join("\n")
      assertWorkflowJobRunsMcpScript(
        workflowJob(fakeWorkflow, "desk-mcp-tests"),
        "desk-mcp-tests",
        "runtime:deps-pack:build",
      )
    },
    /workflow job desk-mcp-tests must run runtime:deps-pack:build/u,
  )
  assertWorkflowJobRunsMcpScript(deskMcpJob, "desk-mcp-tests", "runtime:deps-pack:build")
  assertWorkflowJobRunsMcpScript(deskMcpJob, "desk-mcp-tests", "runtime:deps-pack:verify")
  for (const [eventName, pathFilters] of [
    ["pull_request", pullRequestPathFilters],
    ["push", pushPathFilters],
  ]) {
    assertIncludesAll(pathFilters, [
      "plugins/desk/mcp/artifacts/runtime-deps/**",
      "plugins/desk/mcp/scripts/build-runtime-deps-pack.js",
      "plugins/desk/mcp/scripts/verify-runtime-deps-pack.js",
    ], `${eventName} path filters`)
  }
})
