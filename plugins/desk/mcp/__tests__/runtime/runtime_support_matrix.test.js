import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")

async function loadRuntimeDeps() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "runtime", "runtime-deps.js")))
}

function loadJson(file) {
  return JSON.parse(readFileSync(file, "utf8"))
}

function clone(value) {
  return structuredClone(value)
}

test("committed runtime support matrix equals the physically shipped runtime packs", async () => {
  const {
    buildRuntimeSupportMatrix,
    deriveRuntimeSupportMatrixPath,
    validateRuntimeSupportMatrix,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(path.join(mcpRoot, "package.json"))
  const matrixPath = deriveRuntimeSupportMatrixPath({
    mcpRoot,
    packageJson,
  })
  const committed = loadJson(matrixPath)
  const generated = buildRuntimeSupportMatrix({
    mcpRoot,
    packageJson,
  })

  assert.deepEqual(committed, generated)
  assert.deepEqual(
    validateRuntimeSupportMatrix({
      matrix: committed,
      mcpRoot,
      packageJson,
    }),
    [],
  )
  assert.deepEqual(committed, {
    schema_version: 1,
    plugin: {
      name: "@ourostack/desk-mcp",
      version: "1.3.2",
    },
    targets: [
      {
        id: "darwin-arm64-node-127",
        platform: "darwin",
        arch: "arm64",
        node_abi: "127",
        prod_dependency_lock_hash: "e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be",
        archive_sha256: "7d76c97caa6e8de06af283c77ad6cedb4ac213c713830e9963ec52fc908c9f0f",
        artifact_path: "darwin-arm64-node-127/e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be",
      },
    ],
  })
})

test("runtime support matrix validation catches omitted, phantom, and metadata-drifted targets", async () => {
  const {
    buildRuntimeSupportMatrix,
    validateRuntimeSupportMatrix,
  } = await loadRuntimeDeps()
  const packageJson = loadJson(path.join(mcpRoot, "package.json"))
  const generated = buildRuntimeSupportMatrix({
    mcpRoot,
    packageJson,
  })
  const cases = [
    {
      name: "omitted target",
      mutate: (matrix) => {
        matrix.targets = []
      },
      pattern: /must exactly match physically shipped runtime packs/u,
    },
    {
      name: "phantom target",
      mutate: (matrix) => {
        matrix.targets.push({
          ...matrix.targets[0],
          id: "linux-x64-node-127",
          platform: "linux",
          arch: "x64",
          artifact_path: "linux-x64-node-127/not-shipped",
        })
      },
      pattern: /must exactly match physically shipped runtime packs/u,
    },
    {
      name: "plugin version drift",
      mutate: (matrix) => {
        matrix.plugin.version = "0.0.0"
      },
      pattern: /plugin\.version/u,
    },
    {
      name: "platform drift",
      mutate: (matrix) => {
        matrix.targets[0].platform = "linux"
      },
      pattern: /platform/u,
    },
    {
      name: "architecture drift",
      mutate: (matrix) => {
        matrix.targets[0].arch = "x64"
      },
      pattern: /arch/u,
    },
    {
      name: "ABI drift",
      mutate: (matrix) => {
        matrix.targets[0].node_abi = "115"
      },
      pattern: /node_abi/u,
    },
    {
      name: "production lock hash drift",
      mutate: (matrix) => {
        matrix.targets[0].prod_dependency_lock_hash = "0".repeat(64)
      },
      pattern: /prod_dependency_lock_hash/u,
    },
    {
      name: "archive checksum drift",
      mutate: (matrix) => {
        matrix.targets[0].archive_sha256 = "0".repeat(64)
      },
      pattern: /archive_sha256/u,
    },
    {
      name: "artifact path drift",
      mutate: (matrix) => {
        matrix.targets[0].artifact_path = "darwin-arm64-node-127/not-the-pack"
      },
      pattern: /artifact_path/u,
    },
  ]

  for (const item of cases) {
    const matrix = clone(generated)
    item.mutate(matrix)
    const errors = validateRuntimeSupportMatrix({
      matrix,
      mcpRoot,
      packageJson,
    })
    assert.ok(errors.length > 0, item.name)
    assert.match(errors.join("\n"), item.pattern, item.name)
  }
})

test("runtime support matrix generation and verification are wired into artifact validation", () => {
  const packageJson = loadJson(path.join(mcpRoot, "package.json"))
  assert.equal(
    packageJson.scripts["runtime:support-matrix:generate"],
    "node scripts/generate-runtime-support-matrix.js",
  )
  assert.equal(
    packageJson.scripts["runtime:support-matrix:verify"],
    "node scripts/verify-runtime-support-matrix.js",
  )
  const validator = readFileSync(
    path.join(mcpRoot, "scripts", "validate-artifacts.js"),
    "utf8",
  )
  assert.match(validator, /verifyRuntimeSupportMatrix/u)
})
