import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")

async function loadActivationContract() {
  const [schema, validator] = await Promise.all([
    import(pathToFileURL(path.join(mcpRoot, "src", "activation", "schema.js"))),
    import(pathToFileURL(path.join(mcpRoot, "src", "activation", "validate.js"))),
  ])
  return { ...schema, ...validator }
}

function validManifest(overrides = {}) {
  return mergeManifest({
    schema_version: 1,
    id: "desk",
    version: "1.7.3",
    dependencies: [
      {
        id: "desk",
        kind: "substrate",
        version: "1.7.3",
        provenance: {
          source: "plugins/desk/plugin.json",
          package: "ourostack/desk",
        },
        lock: {
          version: "1.7.3",
          integrity: "sha256-desk-fixture",
        },
      },
      {
        id: "work-suite",
        kind: "plugin",
        version_range: "^1.4.0",
        provenance: {
          source: "plugins/work-suite/.codex-plugin/plugin.json",
          package: "ourostack/work-suite",
        },
        lock: {
          version: "1.4.9",
          integrity: "sha256-work-suite-fixture",
        },
      },
    ],
    provides: {
      activation_targets: [
        {
          id: "desk:worker",
          kind: "agent",
          default: true,
          depends_on: ["desk", "work-suite"],
          entrypoints: {
            claude: "agents/worker.agent.md",
            codex: "agents/worker.toml",
            copilot: "agents/worker.md",
          },
        },
      ],
      overlay_agents: [
        {
          id: "example:worker",
          kind: "agent-overlay",
          depends_on: ["desk"],
          launch_as: "example:worker",
          inherits: ["desk:worker"],
        },
      ],
    },
    mcp_servers: [
      {
        id: "desk",
        required: true,
        command: "node",
        args: ["mcp/index.js"],
        launch: "host-native",
      },
    ],
    desk_root: {
      policy: "global-default",
      precedence: ["activation", "DESK", "safe-default"],
      opt_out_modes: ["project-local", "manual-only"],
    },
    artifacts: {
      embeddings: {
        shared: true,
        spec_id: "nomic-embed-text-v1-768",
        vector_packs: "read-and-import",
      },
      snapshots: {
        restore: "newest-compatible",
        stale_reconcile: "incremental",
      },
    },
    host_support: [
      {
        host: "codex",
        status: "supported",
        dependency_resolution: "flattened",
        fallback_behavior: "materialize owned global/project activation artifacts",
        capabilities: ["skills", "mcp", "global-default-agent"],
        unsupported_primitives: [],
      },
      {
        host: "claude",
        status: "supported",
        dependency_resolution: "native-or-flattened",
        fallback_behavior: "ship flattened bundle when transitive dependencies are unavailable",
        capabilities: ["skills", "mcp", "agents", "hooks"],
        unsupported_primitives: [],
      },
      {
        host: "generic-stdio",
        status: "degraded",
        dependency_resolution: "manual-host",
        fallback_behavior: "start MCP with explicit root and no worker activation",
        capabilities: ["mcp"],
        unsupported_primitives: ["agent-defaults"],
      },
    ],
    permissions: {
      requested_capabilities: ["Read", "Write", "Interactive"],
      generated_artifacts: ["owned-host-config", "activation-ledger"],
      never_delete: ["desk-root-data"],
    },
  }, overrides)
}

function mergeManifest(base, overrides) {
  if (Array.isArray(base) || Array.isArray(overrides)) return overrides ?? base
  if (!overrides || typeof overrides !== "object") return base
  const out = { ...base }
  for (const [key, value] of Object.entries(overrides)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeManifest(base[key] ?? {}, value)
      : value
  }
  return out
}

function diagnostics(result) {
  return result.errors
    .map((error) => `${error.path}: ${error.code}: ${error.message}: ${error.action ?? ""}`)
    .join("\n")
}

function assertInvalid(result, patterns) {
  assert.equal(result.ok, false)
  const text = diagnostics(result)
  for (const pattern of patterns) assert.match(text, pattern)
}

test("activation schema exports the supported version and required top-level fields", async () => {
  const { ACTIVATION_SCHEMA_VERSION, activationManifestSchema } = await loadActivationContract()

  assert.equal(ACTIVATION_SCHEMA_VERSION, 1)
  assert.deepEqual(
    [...activationManifestSchema.required].sort(),
    [
      "artifacts",
      "dependencies",
      "desk_root",
      "host_support",
      "id",
      "mcp_servers",
      "permissions",
      "provides",
      "schema_version",
      "version",
    ].sort(),
  )
})

test("valid activation manifests distinguish substrate dependencies from agent activations", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const result = validateActivationManifest(validManifest())

  assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("\n"))
  assert.equal(result.value.provides.activation_targets[0].id, "desk:worker")
  assert.deepEqual(result.value.provides.activation_targets[0].depends_on, ["desk", "work-suite"])
  assert.equal(result.value.provides.overlay_agents[0].launch_as, "example:worker")
})

test("activation validation fails closed for unknown schema versions with actionable diagnostics", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const result = validateActivationManifest(validManifest({ schema_version: 999 }))

  assert.equal(result.ok, false)
  assert.match(result.errors.map((error) => error.code).join("\n"), /unknown_schema_version/)
  assert.match(result.errors.map((error) => error.message).join("\n"), /schema/i)
  assert.match(result.errors.map((error) => error.action).join("\n"), /upgrade|regenerate|unsupported/i)
})

test("activation dependencies require version intent, provenance, and lock data", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const result = validateActivationManifest(validManifest({
    dependencies: [
      {
        id: "work-suite",
        kind: "plugin",
      },
    ],
  }))

  assert.equal(result.ok, false)
  const text = diagnostics(result)
  assert.match(text, /dependencies\[0\].*(version|version_range)/)
  assert.match(text, /dependencies\[0\]\.provenance/)
  assert.match(text, /dependencies\[0\]\.lock/)
})

test("activation dependencies reject bad identity, semver, pins, and incompatible locks", async () => {
  const { validateActivationManifest } = await loadActivationContract()

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[0],
          id: "Desk With Spaces",
        },
      ],
    })),
    [/dependencies\[0\]\.id.*invalid_dependency_id/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[1],
          version_range: "latest",
        },
      ],
    })),
    [/dependencies\[0\]\.version_range.*invalid_semver_range/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[0],
          version: "v1",
        },
      ],
    })),
    [/dependencies\[0\]\.version.*invalid_semver/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[0],
          version: "1.7.3",
          lock: {
            version: "1.7.2",
            integrity: "sha256-desk-fixture",
          },
        },
      ],
    })),
    [/dependencies\[0\]\.lock\.version.*lock_version_mismatch/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[1],
          version_range: "^1.4.0",
          lock: {
            version: "2.0.0",
            integrity: "sha256-work-suite-fixture",
          },
        },
      ],
    })),
    [
      /dependencies\[0\]\.lock\.version.*incompatible_dependency_version/i,
      /upgrade|pin|regenerate/i,
    ],
  )
})

test("activation validation requires MCP, root, artifact, host, and permission policy fields", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const cases = [
    {
      name: "required MCP launch fields",
      manifest: validManifest({
        mcp_servers: [{ id: "desk", required: true, command: "node" }],
      }),
      patterns: [/mcp_servers\[0\]\.args/, /mcp_servers\[0\]\.launch/],
    },
    {
      name: "desk root binding policy and precedence",
      manifest: validManifest({
        desk_root: { policy: "global-default", precedence: ["DESK"] },
      }),
      patterns: [/desk_root\.precedence.*activation/i, /desk_root\.opt_out_modes/],
    },
    {
      name: "embedding artifact policy",
      manifest: validManifest({
        artifacts: {
          embeddings: { shared: true, vector_packs: "read-and-import" },
          snapshots: validManifest().artifacts.snapshots,
        },
      }),
      patterns: [/artifacts\.embeddings\.spec_id/],
    },
    {
      name: "snapshot artifact policy",
      manifest: validManifest({
        artifacts: {
          embeddings: validManifest().artifacts.embeddings,
          snapshots: { restore: "whatever" },
        },
      }),
      patterns: [/artifacts\.snapshots\.restore.*newest-compatible/i, /artifacts\.snapshots\.stale_reconcile/],
    },
    {
      name: "host support fallback fields",
      manifest: validManifest({
        host_support: [
          {
            host: "codex",
            status: "supported",
            capabilities: ["skills"],
          },
        ],
      }),
      patterns: [/host_support\[0\]\.dependency_resolution/, /host_support\[0\]\.fallback_behavior/],
    },
    {
      name: "permission boundary",
      manifest: validManifest({
        permissions: {
          requested_capabilities: ["Read"],
          generated_artifacts: ["owned-host-config"],
        },
      }),
      patterns: [/permissions\.never_delete.*desk-root-data/i],
    },
  ]

  for (const entry of cases) {
    assertInvalid(validateActivationManifest(entry.manifest), entry.patterns)
  }
})

test("dependency and activation ordering is deterministic", async () => {
  const { orderActivationDependencies } = await loadActivationContract()
  const target = validManifest().provides.activation_targets[0]
  const overlay = validManifest().provides.overlay_agents[0]
  const ordered = orderActivationDependencies(validManifest({
    dependencies: [
      validManifest().dependencies[1],
      validManifest().dependencies[0],
    ],
    provides: {
      activation_targets: [
        {
          ...target,
          id: "desk:helper",
          default: false,
          depends_on: ["desk"],
        },
        target,
      ],
      overlay_agents: [
        {
          ...overlay,
          id: "zeta:worker",
          launch_as: "zeta:worker",
        },
        {
          ...overlay,
          id: "alpha:worker",
          launch_as: "alpha:worker",
        },
      ],
    },
  }))

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["desk", "work-suite", "desk:helper", "desk:worker", "alpha:worker", "zeta:worker"],
  )
})

test("activation validation enforces desk:worker and overlay relationship integrity", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const target = validManifest().provides.activation_targets[0]
  const overlay = validManifest().provides.overlay_agents[0]

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [
          { ...target, id: "desk:helper", default: false },
        ],
        overlay_agents: [overlay],
      },
    })),
    [/provides\.activation_targets.*desk:worker/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [
          { ...target, default: false },
        ],
        overlay_agents: [overlay],
      },
    })),
    [/desk:worker.*default/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [
          { ...target, id: "desk:worker" },
          { ...target, id: "desk:worker" },
        ],
        overlay_agents: [overlay],
      },
    })),
    [/duplicate.*desk:worker/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [
          { ...target, depends_on: ["missing-substrate"] },
        ],
        overlay_agents: [overlay],
      },
    })),
    [/desk:worker.*depends_on.*missing-substrate/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: ["missing:worker"] },
        ],
      },
    })),
    [/example:worker.*inherits.*missing:worker/i],
  )
})

test("unsupported hosts produce host-native fallback diagnostics", async () => {
  const { diagnoseHostSupport } = await loadActivationContract()
  const diagnostics = diagnoseHostSupport(validManifest(), {
    host: "generic-stdio",
    requested_activation: "desk:worker",
  })

  assert.equal(diagnostics.status, "degraded")
  assert.deepEqual(diagnostics.unsupported_primitives, ["agent-defaults"])
  assert.match(diagnostics.fallback_behavior, /explicit root|no worker activation/i)
})

test("canonical Desk activation manifest exists and validates", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const manifestPath = path.join(repoRoot, "plugins", "desk", "activation", "desk.activation.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const result = validateActivationManifest(manifest)

  assert.equal(result.ok, true, result.errors?.map((error) => error.message).join("\n"))
  assert.equal(result.value.id, "desk")
  assert.equal(
    result.value.provides.activation_targets.some((target) => target.id === "desk:worker"),
    true,
  )
  assert.equal(
    result.value.mcp_servers.some((server) => server.id === "desk" && server.required === true),
    true,
  )
  assert.equal(
    result.value.dependencies.some((dependency) => dependency.id === "work-suite"),
    true,
  )
})
