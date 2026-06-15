import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")
const packageJsonPath = path.join(mcpRoot, "package.json")
const packageLockPath = path.join(mcpRoot, "package-lock.json")
const targetPlatform = "darwin"
const targetArch = "arm64"
const targetNodeAbi = "127"

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
  archiveText = "fixture runtime dependency archive\n",
  checksum = sha256(archiveText),
  manifest,
} = {}) {
  const packDir = makeTempDir()
  writeFileSync(path.join(packDir, "runtime-deps.tgz"), archiveText, "utf8")
  writeFileSync(path.join(packDir, "runtime-deps.sha256"), `${checksum}  runtime-deps.tgz\n`, "utf8")
  writeFileSync(
    path.join(packDir, "runtime-deps.manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  )
  return packDir
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
      os: targetPlatform,
      arch: targetArch,
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
    platform: targetPlatform,
    arch: targetArch,
    nodeAbi: targetNodeAbi,
  })

  const expectedDir = path.join(
    mcpRoot,
    "artifacts",
    "runtime-deps",
    packageJson.version,
    `${targetPlatform}-${targetArch}-node-${targetNodeAbi}`,
    prodDependencyLockHash,
  )
  assert.equal(paths.packDir, expectedDir)
  assert.equal(paths.archivePath, path.join(expectedDir, "runtime-deps.tgz"))
  assert.equal(paths.manifestPath, path.join(expectedDir, "runtime-deps.manifest.json"))
  assert.equal(paths.checksumPath, path.join(expectedDir, "runtime-deps.sha256"))
  assert.equal(
    paths.relativeArchivePath,
    `plugins/desk/mcp/artifacts/runtime-deps/${packageJson.version}/${targetPlatform}-${targetArch}-node-${targetNodeAbi}/${prodDependencyLockHash}/runtime-deps.tgz`,
  )

  const changedLock = structuredClone(packageLock)
  changedLock.packages["node_modules/gray-matter"].version = "4.0.4"
  assert.notEqual(
    productionDependencyLockHash({ packageJson, packageLock: changedLock }),
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

  const dependencies = collectProductionDependencyClosure({
    packageJson,
    packageLock,
    platform: targetPlatform,
    arch: targetArch,
  })
  const names = dependencyNames(dependencies)

  assertIncludesAll(names, [
    "@modelcontextprotocol/sdk",
    "better-sqlite3",
    "gray-matter",
    "js-yaml",
    "prebuild-install",
    "section-matter",
    "sqlite-vec",
    "sqlite-vec-darwin-arm64",
  ], "production dependency closure")
  assert.equal(names.includes("sqlite-vec-linux-x64"), false)

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
    platform: targetPlatform,
    arch: targetArch,
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
      platform: targetPlatform,
      arch: targetArch,
      nodeAbi: targetNodeAbi,
    }),
    [],
  )

  const drifted = structuredClone(manifest)
  drifted.package_lock.sha256 = "0".repeat(64)
  drifted.package_lock.prod_dependency_lock_hash = "1".repeat(64)
  drifted.archive.contains_server_source = true
  drifted.archive.root_entries.push("src/server.js")
  drifted.production_dependencies = drifted.production_dependencies
    .filter((dependency) => dependency.name !== "gray-matter")

  assert.deepEqual(
    validateRuntimeDependencyPackManifest({
      manifest: drifted,
      packageJson,
      packageLock,
      platform: targetPlatform,
      arch: targetArch,
      nodeAbi: targetNodeAbi,
    }),
    [
      "runtime dependency pack manifest package_lock.sha256 must match plugins/desk/mcp/package-lock.json",
      "runtime dependency pack manifest package_lock.prod_dependency_lock_hash must match production dependency closure",
      "runtime dependency pack manifest must not mark server source as archived",
      "runtime dependency pack archive root_entries must not include server source path src/server.js",
      "runtime dependency pack manifest must include production dependency gray-matter",
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
    platform: targetPlatform,
    arch: targetArch,
  })

  const validEntries = [
    "node_modules/@modelcontextprotocol/sdk/package.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/gray-matter/package.json",
    "node_modules/js-yaml/package.json",
    "node_modules/prebuild-install/package.json",
    "node_modules/section-matter/package.json",
    "node_modules/sqlite-vec/package.json",
    "node_modules/sqlite-vec-darwin-arm64/package.json",
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
  ]
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
})

test("runtime dependency pack verification checks checksums and unsupported platforms", async () => {
  const {
    collectProductionDependencyClosure,
    productionDependencyLockHash,
    verifyRuntimeDependencyPack,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(packageJsonPath)
  const packageLock = loadJson(packageLockPath)
  const archiveText = "fixture runtime dependency archive\n"
  const archiveSha = sha256(archiveText)
  const manifest = fixtureManifest({
    archiveSha,
    prodDependencyLockHash: productionDependencyLockHash({ packageJson, packageLock }),
    productionDependencies: collectProductionDependencyClosure({
      packageJson,
      packageLock,
      platform: targetPlatform,
      arch: targetArch,
    }),
  })
  const validEntries = [
    "node_modules/@modelcontextprotocol/sdk/package.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    "node_modules/gray-matter/package.json",
    "node_modules/js-yaml/package.json",
    "node_modules/prebuild-install/package.json",
    "node_modules/section-matter/package.json",
    "node_modules/sqlite-vec/package.json",
    "node_modules/sqlite-vec-darwin-arm64/package.json",
    "package.json",
    "package-lock.json",
    "runtime-deps.manifest.json",
  ]
  const packDir = writePackFixture({ archiveText, checksum: archiveSha, manifest })
  const corruptPackDir = writePackFixture({
    archiveText,
    checksum: "0".repeat(64),
    manifest,
  })
  try {
    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir,
        mcpRoot,
        platform: targetPlatform,
        arch: targetArch,
        nodeAbi: targetNodeAbi,
        archiveEntries: validEntries,
      }),
      { ok: true, errors: [], manifest },
    )

    assert.deepEqual(
      verifyRuntimeDependencyPack({
        packDir: corruptPackDir,
        mcpRoot,
        platform: targetPlatform,
        arch: targetArch,
        nodeAbi: targetNodeAbi,
        archiveEntries: validEntries,
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
        arch: targetArch,
        nodeAbi: targetNodeAbi,
        archiveEntries: validEntries,
      }),
      {
        ok: false,
        errors: [`unsupported runtime dependency pack target freebsd-${targetArch}-node-${targetNodeAbi}`],
        manifest,
      },
    )
  } finally {
    rmSync(packDir, { recursive: true, force: true })
    rmSync(corruptPackDir, { recursive: true, force: true })
  }
})

test("package declares CI/release scripts for runtime dependency packs", () => {
  const packageJson = loadJson(packageJsonPath)

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
})
