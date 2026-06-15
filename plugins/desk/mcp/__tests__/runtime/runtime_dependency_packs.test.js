import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { gzipSync } from "node:zlib"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const packageLockPath = path.join(mcpRoot, "package-lock.json")
const targetNodeAbi = "127"
const supportedTargets = [
  { platform: "darwin", arch: "arm64", sqliteVecPackage: "sqlite-vec-darwin-arm64" },
  { platform: "darwin", arch: "x64", sqliteVecPackage: "sqlite-vec-darwin-x64" },
  { platform: "linux", arch: "arm64", sqliteVecPackage: "sqlite-vec-linux-arm64" },
  { platform: "linux", arch: "x64", sqliteVecPackage: "sqlite-vec-linux-x64" },
  { platform: "win32", arch: "x64", sqliteVecPackage: "sqlite-vec-windows-x64" },
]
const target = supportedTargets[0]
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

function writePackFixture({
  archiveEntries,
  checksum,
  manifest,
} = {}) {
  const packDir = makeTempDir()
  const archiveBytes = createTarGz(archiveEntries)
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveBytes)
  writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${checksum ?? sha256(archiveBytes)}  runtime-deps.tgz\n`, "utf8")
  writeFileSync(
    path.join(packDir, "runtime-deps.manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  )
  return packDir
}

function createTarGz(entries) {
  const blocks = []
  for (const entry of entries) {
    const body = Buffer.from(`fixture for ${entry}\n`, "utf8")
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

function tarHeader({ name, size }) {
  assert.ok(Buffer.byteLength(name) <= 100, `tar fixture path too long for ustar header: ${name}`)
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, "utf8")
  header.write("0000644\0", 100, 8, "ascii")
  header.write("0000000\0", 108, 8, "ascii")
  header.write("0000000\0", 116, 8, "ascii")
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii")
  header.write("00000000000\0", 136, 12, "ascii")
  header.fill(0x20, 148, 156)
  header.write("0", 156, 1, "ascii")
  header.write("ustar\0", 257, 6, "ascii")
  header.write("00", 263, 2, "ascii")
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii")
  return header
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

function dependencyNames(dependencies) {
  return dependencies.map((dependency) => dependency.name).sort()
}

function packageNameFromLockPath(lockPath) {
  return lockPath.replace(/^node_modules\//u, "")
}

function packageLockPathForName(name) {
  return `node_modules/${name}`
}

function supportsTarget(entry, { platform, arch }) {
  return (!Array.isArray(entry.os) || entry.os.includes(platform))
    && (!Array.isArray(entry.cpu) || entry.cpu.includes(arch))
}

function isNativeRuntimeDependency(lockPath) {
  return /^node_modules\/(?:better-sqlite3|sqlite-vec(?:-|$))/u.test(lockPath)
}

function expectedProductionDependencyClosure({ packageJson, packageLock, platform, arch }) {
  const queue = Object.keys(packageJson.dependencies).map(packageLockPathForName)
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
      queue.push(packageLockPathForName(name))
    }
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      queue.push(packageLockPathForName(name))
    }
    for (const [name, range] of Object.entries(entry.peerDependencies ?? {})) {
      if (entry.peerDependenciesMeta?.[name]?.optional !== true && range !== undefined) {
        queue.push(packageLockPathForName(name))
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
  const packageJson = loadJson(path.join(packageDir, "package.json"))
  const candidatePaths = [
    ...packageEntrypointCandidates(packageJson),
    "index.js",
    "index.cjs",
    "index.mjs",
    "dist/index.js",
    "dist/index.mjs",
    "lib/index.js",
  ]
  const runtimeFiles = []
  for (const candidatePath of unique(candidatePaths)) {
    const normalizedPath = normalizePackageRuntimePath(candidatePath)
    if (normalizedPath === undefined) {
      continue
    }
    const resolvedPath = path.join(packageDir, normalizedPath)
    if (isRuntimeFilePath(resolvedPath)) {
      runtimeFiles.push(normalizedPath)
      continue
    }
    if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
      runtimeFiles.push(...runtimeFilesUnderPackageDir(packageDir, resolvedPath).slice(0, 1))
    }
  }
  if (runtimeFiles.length === 0) {
    runtimeFiles.push(...runtimeFilesUnderPackageDir(packageDir, packageDir).slice(0, 1))
  }
  return unique(runtimeFiles)
}

function packageEntrypointCandidates(packageJson) {
  const candidates = []
  for (const field of ["main", "module"]) {
    if (typeof packageJson[field] === "string") {
      candidates.push(packageJson[field])
    }
  }
  if (typeof packageJson.bin === "string") {
    candidates.push(packageJson.bin)
  } else if (typeof packageJson.bin === "object" && packageJson.bin !== null) {
    candidates.push(...Object.values(packageJson.bin).filter((value) => typeof value === "string"))
  }
  candidates.push(...exportEntrypointCandidates(packageJson.exports))
  return candidates
}

function exportEntrypointCandidates(value) {
  if (typeof value === "string") {
    return [value]
  }
  if (typeof value !== "object" || value === null) {
    return []
  }
  return Object.values(value).flatMap(exportEntrypointCandidates)
}

function normalizePackageRuntimePath(packagePath) {
  const normalizedPath = packagePath.replace(/^\.\//u, "")
  if (
    normalizedPath === "package.json"
    || normalizedPath.includes("*")
    || normalizedPath.startsWith("../")
  ) {
    return undefined
  }
  return normalizedPath
}

function runtimeFilesUnderPackageDir(packageDir, startDir) {
  const runtimeFiles = []
  for (const entry of readdirSync(startDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["test", "tests", "docs", "examples", "benchmark"].includes(entry.name)) {
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

function workflowRunCommands(workflow) {
  return [...workflow.matchAll(/^\s*run:\s+(.+?)\s*$/gmu)]
    .map((match) => match[1])
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
  assert.deepEqual(
    validateRuntimeDependencyArchiveShape({
      entries: validEntries,
      productionDependencies,
    }),
    [],
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
  const archiveSha = sha256(createTarGz(validEntries))
  const manifest = fixtureManifest({
    archiveSha,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const packDir = writePackFixture({ archiveEntries: validEntries, checksum: archiveSha, manifest })
  const corruptPackDir = writePackFixture({
    archiveEntries: validEntries,
    checksum: "0".repeat(64),
    manifest,
  })
  const missingRuntimeFileEntries = validEntries
    .filter((entry) => entry !== "node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js")
  const missingRuntimeFileManifest = fixtureManifest({
    archiveSha: sha256(createTarGz(missingRuntimeFileEntries)),
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies,
  })
  const missingRuntimeFilePackDir = writePackFixture({
    archiveEntries: missingRuntimeFileEntries,
    manifest: missingRuntimeFileManifest,
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
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(corruptPackDir, { recursive: true, force: true })
    rmSync(missingRuntimeFilePackDir, { recursive: true, force: true })
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
  const validManifest = fixtureManifest({
    archiveSha: sha256(createTarGz(validEntries)),
    prodDependencyLockHash,
    productionDependencies,
  })
  const validPackDir = writePackFixture({
    archiveEntries: validEntries,
    manifest: validManifest,
  })
  const invalidEntries = validEntries
    .filter((entry) => entry !== "node_modules/sqlite-vec/index.cjs")
  const invalidManifest = fixtureManifest({
    archiveSha: sha256(createTarGz(invalidEntries)),
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
      assert.equal(existsSync(path.join(builtPackDir, "runtime-deps.tgz")), true)
      assert.equal(existsSync(path.join(builtPackDir, "runtime-deps.manifest.json")), true)
      assert.equal(existsSync(path.join(builtPackDir, "runtime-deps.sha256")), true)

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

test("CI workflow verifies runtime dependency packs for release-maintained artifacts", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml"), "utf8")
  const pullRequestPathFilters = workflowPathFilters(workflow, "pull_request")
  const pushPathFilters = workflowPathFilters(workflow, "push")
  const runCommands = workflowRunCommands(workflow)

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
  assert.ok(runCommands.includes("npm run runtime:deps-pack:verify"))
  for (const pathFilters of [pullRequestPathFilters, pushPathFilters]) {
    assert.ok(pathFilters.includes("plugins/desk/mcp/artifacts/runtime-deps/**"))
    assert.ok(pathFilters.includes("plugins/desk/mcp/scripts/build-runtime-deps-pack.js"))
    assert.ok(pathFilters.includes("plugins/desk/mcp/scripts/verify-runtime-deps-pack.js"))
  }
})
