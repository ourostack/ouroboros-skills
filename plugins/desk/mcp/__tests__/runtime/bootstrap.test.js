import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { gzipSync } from "node:zlib"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const fixturePlatform = "unit-os"
const fixtureArch = "unit-arch"
const fixtureNodeAbi = "999"
const embeddedArchiveShaMarker = "<archive-sha256-recorded-in-sidecar>"

async function loadBootstrap() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "bootstrap.js")))
}

async function loadRuntimeDeps() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")))
}

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), "desk-bootstrap-"))
}

function writeText(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, "utf8")
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function makeMcpFixture({ serverMarker = "initial", includePackageLock = true } = {}) {
  const root = makeTempDir()
  const fixtureMcpRoot = path.join(root, "mcp")
  const packageJson = {
    name: "@fixture/desk-mcp",
    version: "1.3.1",
    type: "module",
    dependencies: {},
  }
  const packageLock = {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    packages: {
      "": {
        name: packageJson.name,
        version: packageJson.version,
        dependencies: {},
      },
    },
  }
  writeJson(path.join(fixtureMcpRoot, "package.json"), packageJson)
  if (includePackageLock) {
    writeJson(path.join(fixtureMcpRoot, "package-lock.json"), packageLock)
  }
  writeText(path.join(fixtureMcpRoot, "index.js"), "export const entrypoint = true\n")
  writeServer(fixtureMcpRoot, serverMarker)
  writeText(path.join(fixtureMcpRoot, "scripts", "build-vector-pack.js"), "export const script = true\n")
  writeText(path.join(fixtureMcpRoot, "scripts", "node_modules", "ignored.js"), "ignored\n")
  writeText(path.join(fixtureMcpRoot, "src", "nested", "visible.js"), "export const visible = true\n")
  writeText(path.join(fixtureMcpRoot, "src", "node_modules", "ignored.js"), "ignored\n")
  return {
    root,
    mcpRoot: fixtureMcpRoot,
    packageJson,
    packageLock,
    packageLockPath: path.join(fixtureMcpRoot, "package-lock.json"),
  }
}

function writeServer(fixtureMcpRoot, marker) {
  writeText(
    path.join(fixtureMcpRoot, "src", "server.js"),
    [
      `export const marker = ${JSON.stringify(marker)}`,
      "export let configuredArtifactPluginRoot = null",
      "export function configureRuntimeArtifacts(input) {",
      "  configuredArtifactPluginRoot = input?.pluginRoot ?? null",
      "}",
      "export async function startServer() {}",
      "",
    ].join("\n"),
  )
}

async function writeRuntimePack({
  mcpRoot: fixtureMcpRoot,
  platform = fixturePlatform,
  arch = fixtureArch,
  nodeAbi = fixtureNodeAbi,
  archiveEntries = [
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
    "node_modules/fixture-package/package.json",
  ],
  archiveEntryBytes,
  headerModes = {},
  manifestMutator,
  archiveBytes,
  checksum,
} = {}) {
  const { deriveRuntimeDependencyPackPaths } = await loadRuntimeDeps()
  const packageJson = readJson(path.join(fixtureMcpRoot, "package.json"))
  const packageLockPath = path.join(fixtureMcpRoot, "package-lock.json")
  const packageLock = readJson(packageLockPath)
  const packPaths = deriveRuntimeDependencyPackPaths({
    mcpRoot: fixtureMcpRoot,
    packageJson,
    packageLock,
    platform,
    arch,
    nodeAbi,
  })
  const manifest = {
    schema_version: 1,
    created_at: "2026-06-15T00:00:00.000Z",
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
      path: "plugins/desk/mcp/package-lock.json",
      sha256: sha256(readFileSync(packageLockPath)),
      prod_dependency_lock_hash: path.basename(packPaths.packDir),
    },
    archive: {
      file: "runtime-deps.tgz",
      sha256: "0".repeat(64),
      root_entries: ["node_modules/", "package.json", "package-lock.json", "runtime-deps.manifest.json"],
      contains_server_source: false,
    },
    production_dependencies: [],
    provenance: {
      builder: "runtime:deps-pack:build",
      source: "bootstrap unit fixture",
    },
  }
  manifestMutator?.(manifest)
  const provisionalArchiveBytes = archiveBytes ?? createTarGz(
    archiveEntries,
    {
      "package.json": readFileSync(path.join(fixtureMcpRoot, "package.json")),
      "package-lock.json": readFileSync(packageLockPath),
      "runtime-deps.manifest.json": Buffer.from(JSON.stringify(embeddedManifestForArchive(manifest), null, 2), "utf8"),
      "node_modules/fixture-package/package.json": Buffer.from('{"name":"fixture-package"}\n', "utf8"),
      ...archiveEntryBytes,
    },
    headerModes,
  )
  const archiveSha = sha256(provisionalArchiveBytes)
  manifest.archive.sha256 = archiveSha
  mkdirSync(packPaths.packDir, { recursive: true })
  writeFileSync(packPaths.archivePath, provisionalArchiveBytes)
  writeText(packPaths.checksumPath, `${checksum ?? archiveSha}  runtime-deps.tgz\n`)
  writeJson(packPaths.manifestPath, manifest)
  return {
    packageJson,
    packageLockPath,
    packPaths,
    manifest,
    archiveBytes: provisionalArchiveBytes,
    target: `${platform}-${arch}-node-${nodeAbi}`,
  }
}

function writeRuntimeSupportMatrixFixture({ mcpRoot: fixtureMcpRoot, pack, mutate }) {
  const matrix = {
    schema_version: 1,
    plugin: {
      name: pack.manifest.plugin.name,
      version: pack.manifest.plugin.version,
    },
    targets: [
      {
        id: pack.target,
        platform: pack.manifest.platform.os,
        arch: pack.manifest.platform.arch,
        node_abi: pack.manifest.platform.node_abi,
        prod_dependency_lock_hash: pack.manifest.package_lock.prod_dependency_lock_hash,
        archive_sha256: pack.manifest.archive.sha256,
        artifact_path: `${pack.target}/${pack.manifest.package_lock.prod_dependency_lock_hash}`,
      },
    ],
  }
  mutate?.(matrix)
  const matrixPath = path.join(
    fixtureMcpRoot,
    "artifacts",
    "runtime-deps",
    pack.packageJson.version,
    "support-matrix.json",
  )
  writeJson(matrixPath, matrix)
  return {
    matrix,
    matrixPath,
  }
}

function createTarGz(entries, entryBytes = {}, headerModes = {}) {
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
    } else if (headerModes[entry] === "ustar-prefix") {
      appendTarEntry(blocks, { name: path.basename(entry), prefix: path.dirname(entry), body })
    } else if (headerModes[entry] === "blank-size") {
      appendTarEntry(blocks, { name: entry, body: Buffer.alloc(0), blankSize: true })
    } else if (headerModes[entry] === "nul-type") {
      appendTarEntry(blocks, { name: entry, body, type: "\0" })
    } else if (headerModes[entry] === "directory") {
      appendTarEntry(blocks, { name: entry, body: Buffer.alloc(0), type: "5" })
    } else {
      appendTarEntry(blocks, { name: entry, body })
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function embeddedManifestForArchive(manifest) {
  const embeddedManifest = structuredClone(manifest)
  embeddedManifest.archive.sha256 = embeddedArchiveShaMarker
  return embeddedManifest
}

function appendTarEntry(blocks, { blankSize = false, name, prefix = "", body, type = "0" }) {
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, "utf8")
  header.write("0000644\0", 100, 8, "ascii")
  header.write("0000000\0", 108, 8, "ascii")
  header.write("0000000\0", 116, 8, "ascii")
  if (!blankSize) {
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii")
  }
  header.write("00000000000\0", 136, 12, "ascii")
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1, "ascii")
  header.write("ustar\0", 257, 6, "ascii")
  header.write("00", 263, 2, "ascii")
  if (prefix) {
    header.write(prefix, 345, 155, "utf8")
  }
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii")
  blocks.push(header)
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function listSourceMirrors(runtimeCacheDir) {
  const mirrorRoot = path.join(runtimeCacheDir, "source-mirror")
  if (!existsSync(mirrorRoot)) return []
  return readdirSync(mirrorRoot)
    .map((entry) => path.join(mirrorRoot, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .sort()
}

test("runtime cache resolution honors configured, environment, XDG, and HOME fallbacks", async () => {
  const { resolveRuntimeCacheDir } = await loadBootstrap()
  const packageJson = { version: "1.3.1" }
  const target = "darwin-arm64-node-127"
  const prodDependencyLockHash = "a".repeat(64)
  const home = path.join(makeTempDir(), "home")
  const xdg = path.join(makeTempDir(), "xdg")
  try {
    assert.equal(
      resolveRuntimeCacheDir({
        configuredRuntimeCacheDir: "~/configured-cache",
        env: { HOME: home, DESK_RUNTIME_CACHE_DIR: "~/env-cache", XDG_CACHE_HOME: xdg },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(home, "configured-cache"),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        configuredRuntimeCacheDir: "~",
        env: {},
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      homedir(),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        configuredRuntimeCacheDir: "~/configured-cache",
        env: {},
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(homedir(), "configured-cache"),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        configuredRuntimeCacheDir: "~",
        env: { HOME: home },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      home,
    )
    assert.equal(
      resolveRuntimeCacheDir({
        env: { HOME: home, DESK_RUNTIME_CACHE_DIR: "~/env-cache", XDG_CACHE_HOME: xdg },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(home, "env-cache"),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        env: { HOME: home, XDG_CACHE_HOME: xdg },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(xdg, "ouroboros-skills", "desk", packageJson.version, target, prodDependencyLockHash),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        env: {},
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(homedir(), ".cache", "ouroboros-skills", "desk", packageJson.version, target, prodDependencyLockHash),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        env: { HOME: undefined, XDG_CACHE_HOME: "", DESK_RUNTIME_CACHE_DIR: "" },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(homedir(), ".cache", "ouroboros-skills", "desk", packageJson.version, target, prodDependencyLockHash),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        configuredRuntimeCacheDir: "   ",
        env: { HOME: home, DESK_RUNTIME_CACHE_DIR: "   " },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(home, ".cache", "ouroboros-skills", "desk", packageJson.version, target, prodDependencyLockHash),
    )
    assert.equal(
      resolveRuntimeCacheDir({
        env: { HOME: home },
        packageJson,
        target,
        prodDependencyLockHash,
      }),
      path.join(home, ".cache", "ouroboros-skills", "desk", packageJson.version, target, prodDependencyLockHash),
    )
  } finally {
    rmSync(path.dirname(home), { recursive: true, force: true })
    rmSync(path.dirname(xdg), { recursive: true, force: true })
  }
})

test("prepareRuntime restores dependencies, reuses current cache, and imports updated source mirrors", async () => {
  const {
    importRuntimeServer,
    prepareRuntime,
    restoreRuntimeDependencies,
  } = await loadBootstrap()
  const fixture = makeMcpFixture()
  const runtimeCacheDir = path.join(fixture.root, "runtime-cache")
  try {
    const pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    assert.throws(() => prepareRuntime({}), /mcpRoot is required/u)

    const first = prepareRuntime({
      mcpRoot: fixture.mcpRoot,
      runtimeCacheDir,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(first.runtimeCacheDir, runtimeCacheDir)
    assert.equal(first.target, pack.target)
    assert.equal(existsSync(path.join(runtimeCacheDir, "node_modules", "fixture-package", "package.json")), true)
    assert.equal(existsSync(path.join(fixture.mcpRoot, "node_modules")), false)

    const cached = restoreRuntimeDependencies({
      mcpRoot: fixture.mcpRoot,
      packageJson: pack.packageJson,
      packageLockPath: pack.packageLockPath,
      packPaths: pack.packPaths,
      runtimeCacheDir,
      target: pack.target,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(cached.restored, false)
    rmSync(pack.packPaths.manifestPath)
    assert.throws(
      () => restoreRuntimeDependencies({
        mcpRoot: fixture.mcpRoot,
        packageJson: pack.packageJson,
        packageLockPath: pack.packageLockPath,
        packPaths: pack.packPaths,
        runtimeCacheDir,
        target: pack.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      }),
      /runtime dependency pack.*manifest runtime-deps\.manifest\.json is missing/su,
    )
    await writeRuntimePack({ mcpRoot: fixture.mcpRoot })

    const firstImport = await importRuntimeServer({
      mcpRoot: fixture.mcpRoot,
      runtimeCacheDir,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(firstImport.marker, "initial")
    assert.equal(
      firstImport.configuredArtifactPluginRoot,
      path.resolve(fixture.mcpRoot, ".."),
    )

    writeServer(fixture.mcpRoot, "updated")
    const secondImport = await importRuntimeServer({
      mcpRoot: fixture.mcpRoot,
      runtimeCacheDir,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(secondImport.marker, "updated")
    assert.equal(
      secondImport.configuredArtifactPluginRoot,
      path.resolve(fixture.mcpRoot, ".."),
    )
    assert.equal(listSourceMirrors(runtimeCacheDir).length, 2)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("restoreRuntimeDependencies repairs corrupt or incomplete cache markers", async () => {
  const { restoreRuntimeDependencies } = await loadBootstrap()
  const fixture = makeMcpFixture()
  const runtimeCacheDir = path.join(fixture.root, "runtime-cache")
  try {
    const pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    mkdirSync(runtimeCacheDir, { recursive: true })
    writeText(path.join(runtimeCacheDir, ".desk-runtime-cache.json"), "{not json")
    writeText(path.join(runtimeCacheDir, ".complete.json"), "{}\n")
    writeText(path.join(runtimeCacheDir, "package.json"), "{}\n")

    const restored = restoreRuntimeDependencies({
      mcpRoot: fixture.mcpRoot,
      packageJson: pack.packageJson,
      packageLockPath: pack.packageLockPath,
      packPaths: pack.packPaths,
      runtimeCacheDir,
      target: pack.target,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(restored.restored, true)
    assert.equal(readJson(path.join(runtimeCacheDir, ".desk-runtime-cache.json")).archive_sha256, pack.manifest.archive.sha256)

    rmSync(path.join(runtimeCacheDir, "package-lock.json"), { force: true })
    const repaired = restoreRuntimeDependencies({
      mcpRoot: fixture.mcpRoot,
      packageJson: pack.packageJson,
      packageLockPath: pack.packageLockPath,
      packPaths: pack.packPaths,
      runtimeCacheDir,
      target: pack.target,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(repaired.restored, true)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("restoreRuntimeDependencies fails before extraction when the cache path is not writable as a directory", async () => {
  const { restoreRuntimeDependencies } = await loadBootstrap()
  const fixture = makeMcpFixture()
  const runtimeCacheDir = path.join(fixture.root, "runtime-cache-file")
  try {
    const pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeText(runtimeCacheDir, "not a directory\n")

    assert.throws(
      () => restoreRuntimeDependencies({
        mcpRoot: fixture.mcpRoot,
        packageJson: pack.packageJson,
        packageLockPath: pack.packageLockPath,
        packPaths: pack.packPaths,
        runtimeCacheDir,
        target: pack.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      }),
      /EEXIST|ENOTDIR|not a directory|file already exists/u,
    )
    assert.equal(readFileSync(runtimeCacheDir, "utf8"), "not a directory\n")
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("source hashing ignores nested node_modules and mirrors clean up staging directories", async () => {
  const { hashCurrentSource, sourceFilesForHash, syncSourceMirror } = await loadBootstrap()
  const fixture = makeMcpFixture()
  const runtimeCacheDir = path.join(fixture.root, "runtime-cache")
  try {
    rmSync(path.join(fixture.mcpRoot, "package-lock.json"))
    const files = sourceFilesForHash(fixture.mcpRoot)
    assert.ok(files.includes("index.js"))
    assert.ok(files.includes("package.json"))
    assert.ok(files.includes("scripts/build-vector-pack.js"))
    assert.ok(files.includes("src/server.js"))
    assert.ok(files.includes("src/nested/visible.js"))
    assert.equal(files.includes("package-lock.json"), false)
    assert.equal(files.some((file) => file.includes("node_modules")), false)

    const before = hashCurrentSource(fixture.mcpRoot)
    writeText(path.join(fixture.mcpRoot, "src", "node_modules", "ignored.js"), "changed ignored\n")
    writeText(path.join(fixture.mcpRoot, "scripts", "node_modules", "ignored.js"), "changed ignored\n")
    assert.equal(hashCurrentSource(fixture.mcpRoot), before)
    writeText(path.join(fixture.mcpRoot, "src", "nested", "visible.js"), "changed visible\n")
    assert.notEqual(hashCurrentSource(fixture.mcpRoot), before)
    const afterSrcChange = hashCurrentSource(fixture.mcpRoot)
    writeText(path.join(fixture.mcpRoot, "scripts", "build-vector-pack.js"), "changed script\n")
    assert.notEqual(hashCurrentSource(fixture.mcpRoot), afterSrcChange)

    writeJson(path.join(fixture.mcpRoot, "package-lock.json"), fixture.packageLock)
    const firstMirror = syncSourceMirror({ mcpRoot: fixture.mcpRoot, runtimeCacheDir })
    const secondMirror = syncSourceMirror({ mcpRoot: fixture.mcpRoot, runtimeCacheDir })
    assert.equal(secondMirror, firstMirror)
    assert.equal(existsSync(path.join(firstMirror, "scripts", "build-vector-pack.js")), true)
    assert.equal(existsSync(path.join(firstMirror, "scripts", "node_modules", "ignored.js")), false)
    assert.equal(
      readdirSync(path.dirname(firstMirror)).some((entry) => entry.includes(".tmp-")),
      false,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("bootstrap pack verifier rejects missing metadata, drift, corrupt archives, and bundled source", async () => {
  const { verifyBootstrapRuntimeDependencyPack } = await loadBootstrap()
  const fixture = makeMcpFixture()
  try {
    const valid = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    assert.deepEqual(
      verifyBootstrapRuntimeDependencyPack({
        packageJson: valid.packageJson,
        packageLockPath: valid.packageLockPath,
        packPaths: valid.packPaths,
        target: valid.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      }),
      {
        ok: true,
        errors: [],
        manifest: valid.manifest,
        archiveEntries: [
          "node_modules/fixture-package/package.json",
          "package-lock.json",
          "package.json",
          "runtime-deps.manifest.json",
        ],
      },
    )
    assert.match(
      verifyBootstrapRuntimeDependencyPack({
        packageJson: valid.packageJson,
        packageLockPath: valid.packageLockPath,
        packPaths: valid.packPaths,
        target: "other-os-other-arch-node-000",
        platform: "other-os",
        arch: "other-arch",
        nodeAbi: "000",
      }).errors.join("\n"),
      /platform must match other-os-other-arch-node-000/u,
    )
    const longName = "node_modules/fixture-package/deep/from-long-name.js"
    const paxName = "node_modules/fixture-package/deep/from-pax-name.js"
    const headerVariant = await writeRuntimePack({
      mcpRoot: fixture.mcpRoot,
      archiveEntries: ["package.json", "package-lock.json", "runtime-deps.manifest.json", longName, paxName],
      headerModes: {
        [longName]: "gnu-long-name",
        [paxName]: "pax-path",
      },
    })
    assert.equal(
      verifyBootstrapRuntimeDependencyPack({
        packageJson: headerVariant.packageJson,
        packageLockPath: headerVariant.packageLockPath,
        packPaths: headerVariant.packPaths,
        target: headerVariant.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      }).ok,
      true,
    )
    const directoryVariant = await writeRuntimePack({
      mcpRoot: fixture.mcpRoot,
      archiveEntries: [
        "package.json",
        "package-lock.json",
        "runtime-deps.manifest.json",
        "node_modules/fixture-package/directory",
        "node_modules/fixture-package/nul-type.js",
      ],
      headerModes: {
        "node_modules/fixture-package/directory": "directory",
        "node_modules/fixture-package/nul-type.js": "nul-type",
      },
    })
    assert.equal(
      verifyBootstrapRuntimeDependencyPack({
        packageJson: directoryVariant.packageJson,
        packageLockPath: directoryVariant.packageLockPath,
        packPaths: directoryVariant.packPaths,
        target: directoryVariant.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      }).ok,
      true,
    )

    const cases = [
      {
        name: "missing manifest",
        mutate: () => rmSync(valid.packPaths.manifestPath),
        pattern: /manifest runtime-deps\.manifest\.json is missing/u,
      },
      {
        name: "invalid manifest",
        mutate: () => writeText(valid.packPaths.manifestPath, "{nope"),
        pattern: /must be valid JSON/u,
      },
      {
        name: "missing checksum",
        mutate: () => rmSync(valid.packPaths.checksumPath),
        pattern: /checksum runtime-deps\.sha256 is missing/u,
      },
      {
        name: "invalid checksum",
        mutate: () => writeText(valid.packPaths.checksumPath, "not-a-sha  runtime-deps.tgz\n"),
        pattern: /must contain a sha256 digest/u,
      },
      {
        name: "missing archive",
        mutate: () => rmSync(valid.packPaths.archivePath),
        pattern: /archive runtime-deps\.tgz is missing/u,
      },
      {
        name: "checksum mismatch",
        mutate: () => writeText(valid.packPaths.checksumPath, `${"0".repeat(64)}  runtime-deps.tgz\n`),
        pattern: /checksum mismatch/u,
      },
      {
        name: "manifest drift",
        mutate: (manifest) => {
          manifest.schema_version = 2
          manifest.plugin.name = "wrong"
          manifest.plugin.version = "0.0.0"
          manifest.platform.os = "wrong-os"
          manifest.package_lock.sha256 = "0".repeat(64)
          manifest.package_lock.prod_dependency_lock_hash = "1".repeat(64)
          manifest.archive.file = "wrong.tgz"
          manifest.archive.sha256 = "2".repeat(64)
          manifest.archive.root_entries.push("src/server.js")
        },
        pattern: /schema_version.*plugin\.name.*plugin\.version.*platform.*package_lock\.sha256.*production dependency lock hash.*archive\.file.*archive\.sha256.*mutable MCP source/su,
      },
      {
        name: "manifest missing nested metadata",
        mutate: (manifest) => {
          delete manifest.plugin
          delete manifest.platform
          delete manifest.package_lock
          delete manifest.archive
        },
        pattern: /plugin\.name.*plugin\.version.*platform.*package_lock\.sha256.*production dependency lock hash.*archive\.file.*archive\.sha256/su,
      },
      {
        name: "empty gzip archive with matching checksum",
        rewrite: async () => {
          const bytes = gzipSync(Buffer.alloc(0))
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveBytes: bytes,
            checksum: sha256(bytes),
            manifestMutator: (manifest) => {
              manifest.archive.sha256 = sha256(bytes)
            },
          })
        },
        pattern: /archive must include root package\.json.*archive must include root package-lock\.json.*archive must include root runtime-deps\.manifest\.json/su,
      },
      {
        name: "corrupt gzip archive with matching checksum",
        rewrite: async () => {
          const bytes = Buffer.from("not a gzip\n", "utf8")
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveBytes: bytes,
            checksum: sha256(bytes),
            manifestMutator: (manifest) => {
              manifest.archive.sha256 = sha256(bytes)
            },
          })
        },
        pattern: /readable gzip tar archive/u,
      },
      {
        name: "archive package-lock drift",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntryBytes: {
              "package-lock.json": Buffer.from('{"name":"stale-native-lock"}\n', "utf8"),
            },
          })
        },
        pattern: /archive package-lock\.json sha256 must match/u,
      },
      {
        name: "archive missing root metadata",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntries: ["package-lock.json", "runtime-deps.manifest.json"],
          })
        },
        pattern: /archive must include root package\.json/u,
      },
      {
        name: "archive invalid root metadata",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntryBytes: {
              "package.json": Buffer.from("{not json", "utf8"),
              "runtime-deps.manifest.json": Buffer.from("{not json", "utf8"),
            },
          })
        },
        pattern: /archive package\.json must be valid JSON.*archive runtime-deps\.manifest\.json must be valid JSON/su,
      },
      {
        name: "archive package metadata drift",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntryBytes: {
              "package.json": Buffer.from('{"name":"wrong","version":"0.0.0"}\n', "utf8"),
            },
          })
        },
        pattern: /archive package\.json must match sidecar manifest plugin metadata/u,
      },
      {
        name: "archive embedded manifest drift",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntryBytes: {
              "runtime-deps.manifest.json": Buffer.from(JSON.stringify({
                schema_version: 1,
                plugin: {
                  name: "wrong",
                  version: "0.0.0",
                },
                archive: {
                  sha256: embeddedArchiveShaMarker,
                },
              }, null, 2), "utf8"),
            },
          })
        },
        pattern: /archive embedded manifest must match sidecar manifest metadata/u,
      },
      {
        name: "archive bundles mutable source",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntries: ["package.json", "package-lock.json", "runtime-deps.manifest.json", "src/server.js"],
          })
        },
        pattern: /must not include mutable MCP source src\/server\.js/u,
      },
      {
        name: "archive unsafe path",
        rewrite: async () => {
          await writeRuntimePack({
            mcpRoot: fixture.mcpRoot,
            archiveEntries: ["package.json", "package-lock.json", "runtime-deps.manifest.json", "node_modules/../escape.js"],
          })
        },
        pattern: /unsafe path/u,
      },
    ]

    for (const item of cases) {
      await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
      if (item.rewrite) {
        await item.rewrite()
      } else {
        const manifest = readJson(valid.packPaths.manifestPath)
        item.mutate(manifest)
        if (item.mutate.length > 0) {
          writeJson(valid.packPaths.manifestPath, manifest)
        }
      }
      const result = verifyBootstrapRuntimeDependencyPack({
        packageJson: valid.packageJson,
        packageLockPath: valid.packageLockPath,
        packPaths: valid.packPaths,
        target: valid.target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
      })
      assert.equal(result.ok, false, item.name)
      assert.match(result.errors.join("\n"), item.pattern, item.name)
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("extractRuntimeArchive handles tar name variants and rejects unsafe paths", async () => {
  const { extractRuntimeArchive } = await loadBootstrap()
  const root = makeTempDir()
  try {
    const archivePath = path.join(root, "archive.tgz")
    const destinationDir = path.join(root, "out")
    const longName = "node_modules/fixture-package/deep/from-long-name.js"
    const paxName = "node_modules/fixture-package/deep/from-pax-name.js"
    const paxFallback = "node_modules/fixture-package/pax-fallback.js"
    const prefixedName = "node_modules/fixture-package/from-ustar-prefix.js"
    const blankSizeName = "node_modules/fixture-package/blank-size.js"
    writeFileSync(
      archivePath,
      createTarGz(
        [
          "package.json",
          longName,
          paxName,
          paxFallback,
          prefixedName,
          blankSizeName,
          "node_modules/fixture-package/nul-type.js",
          "node_modules/fixture-package/directory",
        ],
        {
          "package.json": Buffer.from("{}\n", "utf8"),
          [longName]: Buffer.from("long\n", "utf8"),
          [paxName]: Buffer.from("pax\n", "utf8"),
          [paxFallback]: Buffer.from("fallback\n", "utf8"),
          [prefixedName]: Buffer.from("prefix\n", "utf8"),
          "node_modules/fixture-package/nul-type.js": Buffer.from("nul\n", "utf8"),
        },
        {
          [longName]: "gnu-long-name",
          [paxName]: "pax-path",
          [paxFallback]: "pax-without-path",
          [prefixedName]: "ustar-prefix",
          [blankSizeName]: "blank-size",
          "node_modules/fixture-package/nul-type.js": "nul-type",
          "node_modules/fixture-package/directory": "directory",
        },
      ),
    )
    extractRuntimeArchive({ archivePath, destinationDir })
    assert.equal(readFileSync(path.join(destinationDir, longName), "utf8"), "long\n")
    assert.equal(readFileSync(path.join(destinationDir, paxName), "utf8"), "pax\n")
    assert.equal(readFileSync(path.join(destinationDir, paxFallback), "utf8"), "fallback\n")
    assert.equal(readFileSync(path.join(destinationDir, prefixedName), "utf8"), "prefix\n")
    assert.equal(readFileSync(path.join(destinationDir, blankSizeName), "utf8"), "")
    assert.equal(readFileSync(path.join(destinationDir, "node_modules/fixture-package/nul-type.js"), "utf8"), "nul\n")
    assert.equal(existsSync(path.join(destinationDir, "node_modules/fixture-package/directory")), false)

    const emptyArchive = path.join(root, "empty.tgz")
    writeFileSync(emptyArchive, gzipSync(Buffer.alloc(0)))
    extractRuntimeArchive({ archivePath: emptyArchive, destinationDir: path.join(root, "empty-out") })

    for (const unsafeName of ["", "/absolute.js", "node_modules/../escape.js"]) {
      const unsafeArchive = path.join(root, `${unsafeName.replaceAll("/", "_")}.tgz`)
      writeFileSync(unsafeArchive, createTarGz([unsafeName]))
      assert.throws(
        () => extractRuntimeArchive({ archivePath: unsafeArchive, destinationDir: path.join(root, "unsafe") }),
        /unsafe path/u,
      )
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runtime pack diagnostics list expected paths, available targets, and remediation", async () => {
  const { runtimeDependencyPackError } = await loadBootstrap()
  const root = makeTempDir()
  try {
    const mcpFixtureRoot = path.join(root, "mcp")
    const packageJson = { name: "@fixture/desk-mcp", version: "1.3.1" }
    const target = "linux-x64-node-127"
    const packPaths = {
      packDir: path.join(mcpFixtureRoot, "artifacts", "runtime-deps", packageJson.version, target, "hash"),
    }
    mkdirSync(path.join(mcpFixtureRoot, "artifacts", "runtime-deps", packageJson.version, "darwin-arm64-node-127"), { recursive: true })
    mkdirSync(path.join(mcpFixtureRoot, "artifacts", "runtime-deps", packageJson.version, "linux-arm64-node-127"), { recursive: true })
    writeText(path.join(mcpFixtureRoot, "artifacts", "runtime-deps", packageJson.version, "not-a-target-file"), "ignore me\n")

    const message = runtimeDependencyPackError({
      mcpRoot: mcpFixtureRoot,
      packageJson,
      packPaths,
      target,
      errors: ["checksum mismatch"],
    }).message
    assert.match(message, /runtime dependency pack is unavailable/u)
    assert.match(message, new RegExp(target, "u"))
    assert.match(message, /Expected target directory/u)
    assert.match(message, /Available targets: darwin-arm64-node-127, linux-arm64-node-127/u)
    assert.match(message, /runtime:deps-pack:build/u)
    assert.match(message, /checksum mismatch/u)

    rmSync(path.join(mcpFixtureRoot, "artifacts"), { recursive: true, force: true })
    assert.match(
      runtimeDependencyPackError({ mcpRoot: mcpFixtureRoot, packageJson, packPaths, target }).message,
      /Available targets: \(none\)/u,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("runtime pack inspection classifies unsupported, missing, checksum, manifest, and archive failures", async () => {
  const { inspectRuntimeDependencyPack } = await loadBootstrap()
  const fixture = makeMcpFixture()
  try {
    let pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    const ready = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(ready.mode, "ready")
    assert.equal(ready.target.id, pack.target)
    assert.equal(ready.failure_kind, undefined)

    const unsupported = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: "other-os",
      arch: "other-arch",
      nodeAbi: "000",
    })
    assert.equal(unsupported.mode, "diagnostic")
    assert.equal(unsupported.reason, "unsupported_target")
    assert.deepEqual(
      unsupported.shipped_targets.map((target) => target.id),
      [pack.target],
    )
    assert.ok(unsupported.paths_checked.includes(unsupported.support_matrix_path))

    rmSync(pack.packPaths.archivePath)
    const missing = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(missing.mode, "diagnostic")
    assert.equal(missing.reason, "missing_pack")
    assert.equal(missing.failure_kind, "missing_artifact")
    assert.ok(missing.paths_checked.includes(pack.packPaths.archivePath))

    pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    writeText(pack.packPaths.checksumPath, `${"0".repeat(64)}  runtime-deps.tgz\n`)
    const checksumMismatch = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(checksumMismatch.mode, "diagnostic")
    assert.equal(checksumMismatch.reason, "corrupt_pack")
    assert.equal(checksumMismatch.failure_kind, "checksum_mismatch")

    pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    const driftedManifest = readJson(pack.packPaths.manifestPath)
    driftedManifest.plugin.version = "0.0.0"
    writeJson(pack.packPaths.manifestPath, driftedManifest)
    const manifestMismatch = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(manifestMismatch.mode, "diagnostic")
    assert.equal(manifestMismatch.reason, "corrupt_pack")
    assert.equal(manifestMismatch.failure_kind, "manifest_mismatch")

    const corruptBytes = Buffer.from("not a gzip archive\n", "utf8")
    pack = await writeRuntimePack({
      mcpRoot: fixture.mcpRoot,
      archiveBytes: corruptBytes,
      checksum: sha256(corruptBytes),
      manifestMutator: (manifest) => {
        manifest.archive.sha256 = sha256(corruptBytes)
      },
    })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    const corruptArchive = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(corruptArchive.mode, "diagnostic")
    assert.equal(corruptArchive.reason, "corrupt_pack")
    assert.equal(corruptArchive.failure_kind, "archive_corrupt")

    pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    rmSync(pack.packPaths.checksumPath)
    const missingChecksum = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
    })
    assert.equal(missingChecksum.reason, "missing_pack")
    assert.match(missingChecksum.errors.join("\n"), /checksum runtime-deps\.sha256 is missing/u)

    pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    writeRuntimeSupportMatrixFixture({ mcpRoot: fixture.mcpRoot, pack })
    const unreadable = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
      verifyPack: () => {
        throw "fixture verifier failure"
      },
    })
    assert.equal(unreadable.reason, "corrupt_pack")
    assert.equal(unreadable.failure_kind, "archive_corrupt")
    assert.deepEqual(unreadable.errors, ["fixture verifier failure"])

    const missingTargets = inspectRuntimeDependencyPack({
      mcpRoot: fixture.mcpRoot,
      platform: fixturePlatform,
      arch: fixtureArch,
      nodeAbi: fixtureNodeAbi,
      supportMatrix: null,
    })
    assert.equal(missingTargets.reason, "unsupported_target")
    assert.deepEqual(missingTargets.shipped_targets, [])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("atomic publication rejects invalid staging and rolls back invalid destinations", async () => {
  const { publishDirectoryAtomically } = await loadBootstrap()
  const root = makeTempDir()
  const destinationDir = path.join(root, "runtime-cache")
  const stagingDir = path.join(root, "runtime-cache.stage-unit")
  try {
    assert.throws(
      () => publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: () => true,
      }),
      /staging directory is missing/u,
    )

    writeText(path.join(stagingDir, "marker"), "candidate\n")
    assert.throws(
      () => publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: () => {
          throw new Error("validator failed")
        },
      }),
      /staging directory is incomplete/u,
    )
    assert.equal(existsSync(stagingDir), false)

    writeText(path.join(stagingDir, "marker"), "candidate\n")
    let validationCount = 0
    assert.throws(
      () => publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: () => {
          validationCount += 1
          return validationCount === 1
        },
      }),
      /produced an incomplete directory/u,
    )
    assert.equal(existsSync(destinationDir), false)

    writeText(path.join(destinationDir, "marker"), "previous\n")
    writeText(path.join(stagingDir, "marker"), "candidate\n")
    validationCount = 0
    assert.throws(
      () => publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: () => {
          validationCount += 1
          return validationCount === 1
        },
      }),
      /produced an incomplete directory/u,
    )
    assert.equal(readFileSync(path.join(destinationDir, "marker"), "utf8"), "previous\n")
    assert.equal(
      readdirSync(root).some((entry) => entry.includes(".backup-")),
      false,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("atomic publication restores the previous cache after interruption", async () => {
  const { publishDirectoryAtomically } = await loadBootstrap()
  const root = makeTempDir()
  const destinationDir = path.join(root, "runtime-cache")
  const stagingDir = path.join(root, "runtime-cache.stage-unit")
  try {
    writeText(path.join(destinationDir, "marker"), "previous\n")
    writeText(path.join(stagingDir, "marker"), "candidate\n")
    assert.throws(
      () => publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: (candidate) => (
          existsSync(path.join(candidate, "marker"))
          && readFileSync(path.join(candidate, "marker"), "utf8") === "candidate\n"
        ),
        rename: (source, destination) => {
          if (source === stagingDir && destination === destinationDir) {
            const error = new Error("injected publish interruption")
            error.code = "EIO"
            throw error
          }
          renameSync(source, destination)
        },
      }),
      /injected publish interruption/u,
    )
    assert.equal(readFileSync(path.join(destinationDir, "marker"), "utf8"), "previous\n")
    assert.equal(existsSync(stagingDir), false)
    assert.equal(
      readdirSync(root).some((entry) => entry.includes(".backup-")),
      false,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const collisionCode of ["EEXIST", "ENOTEMPTY"]) {
  test(`concurrent atomic publication losers reuse the coherent winner after ${collisionCode}`, async () => {
    const { publishDirectoryAtomically } = await loadBootstrap()
    const root = makeTempDir()
    const destinationDir = path.join(root, "runtime-cache")
    const stagingDir = path.join(root, "runtime-cache.stage-loser")
    try {
      writeText(path.join(stagingDir, "marker"), "candidate\n")
      const result = publishDirectoryAtomically({
        destinationDir,
        stagingDir,
        validateDestination: (candidate) => (
          existsSync(path.join(candidate, "marker"))
          && readFileSync(path.join(candidate, "marker"), "utf8") === "candidate\n"
        ),
        rename: (source, destination) => {
          if (source === stagingDir && destination === destinationDir) {
            writeText(path.join(destinationDir, "marker"), "candidate\n")
            const error = new Error("simulated concurrent rename collision")
            error.code = collisionCode
            throw error
          }
          renameSync(source, destination)
        },
      })
      assert.deepEqual(result, {
        destinationDir,
        published: false,
        reused: true,
      })
      assert.equal(readFileSync(path.join(destinationDir, "marker"), "utf8"), "candidate\n")
      assert.equal(existsSync(stagingDir), false)
      assert.deepEqual(readdirSync(root), ["runtime-cache"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("runtime restoration stages a complete tree before replacing a stale cache", async () => {
  const { restoreRuntimeDependencies } = await loadBootstrap()
  const fixture = makeMcpFixture()
  try {
    const pack = await writeRuntimePack({ mcpRoot: fixture.mcpRoot })
    const runtimeCacheDir = path.join(fixture.root, "runtime-cache")
    const target = `${fixturePlatform}-${fixtureArch}-node-${fixtureNodeAbi}`
    writeText(path.join(runtimeCacheDir, "previous-payload"), "preserve me\n")
    writeJson(path.join(runtimeCacheDir, ".desk-runtime-cache.json"), {
      schema_version: 1,
      archive_sha256: "stale",
    })
    assert.throws(
      () => restoreRuntimeDependencies({
        mcpRoot: fixture.mcpRoot,
        packageJson: pack.packageJson,
        packageLockPath: fixture.packageLockPath,
        packPaths: pack.packPaths,
        runtimeCacheDir,
        target,
        platform: fixturePlatform,
        arch: fixtureArch,
        nodeAbi: fixtureNodeAbi,
        publishDirectory: ({ destinationDir, stagingDir }) => {
          assert.equal(destinationDir, runtimeCacheDir)
          assert.equal(
            readFileSync(
              path.join(stagingDir, "node_modules", "fixture-package", "package.json"),
              "utf8",
            ),
            '{"name":"fixture-package"}\n',
          )
          assert.equal(existsSync(path.join(stagingDir, ".complete.json")), true)
          throw new Error("injected runtime publication failure")
        },
      }),
      /injected runtime publication failure/u,
    )
    assert.equal(
      readFileSync(path.join(runtimeCacheDir, "previous-payload"), "utf8"),
      "preserve me\n",
    )
    assert.equal(
      readdirSync(path.dirname(runtimeCacheDir))
        .some((entry) => entry.includes(".stage-") || entry.includes(".backup-")),
      false,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("source mirror stages a complete tree before replacing a stale mirror", async () => {
  const { syncSourceMirror } = await loadBootstrap()
  const fixture = makeMcpFixture()
  try {
    const runtimeCacheDir = path.join(fixture.root, "runtime-cache")
    const sourceMirror = syncSourceMirror({
      mcpRoot: fixture.mcpRoot,
      runtimeCacheDir,
    })
    const markerPath = path.join(sourceMirror, ".complete.json")
    assert.equal(existsSync(markerPath), true)
    rmSync(markerPath)
    writeText(path.join(sourceMirror, "previous-payload"), "preserve me\n")
    assert.throws(
      () => syncSourceMirror({
        mcpRoot: fixture.mcpRoot,
        runtimeCacheDir,
        publishDirectory: ({ destinationDir, stagingDir }) => {
          assert.equal(destinationDir, sourceMirror)
          assert.equal(
            readFileSync(path.join(stagingDir, "package.json"), "utf8"),
            readFileSync(path.join(fixture.mcpRoot, "package.json"), "utf8"),
          )
          assert.equal(existsSync(path.join(stagingDir, ".complete.json")), true)
          throw new Error("injected source publication failure")
        },
      }),
      /injected source publication failure/u,
    )
    assert.equal(
      readFileSync(path.join(sourceMirror, "previous-payload"), "utf8"),
      "preserve me\n",
    )
    assert.equal(
      readdirSync(path.dirname(sourceMirror))
        .some((entry) => entry.includes(".stage-") || entry.includes(".backup-")),
      false,
    )
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
