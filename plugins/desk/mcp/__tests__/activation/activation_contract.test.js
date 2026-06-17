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
          entrypoints: {
            codex: "agents/example-worker.toml",
          },
          instructions: {
            identity: "Example Desk worker",
            addendum: "Use the example overlay context on top of the Desk substrate.",
          },
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
        spec_id: "nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768",
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

function pluginDependency(id, version = "1.0.0") {
  return {
    id,
    kind: "plugin",
    version,
    provenance: {
      source: `plugins/${id}/plugin.json`,
      package: `ourostack/${id}`,
    },
    lock: {
      version,
      integrity: `sha256-${id}-fixture`,
    },
  }
}

function overlayAgent({
  id,
  dependsOn,
  inherits,
  identity,
  addendum,
  codex = `agents/${id.replace(/:/gu, "-")}.toml`,
}) {
  return {
    id,
    kind: "agent-overlay",
    depends_on: dependsOn,
    launch_as: id,
    inherits,
    entrypoints: {
      codex,
    },
    instructions: {
      identity,
      addendum,
    },
  }
}

function overlayChainManifest(overrides = {}) {
  const deskManifest = validManifest()
  return validManifest(mergeManifest({
    dependencies: [
      ...deskManifest.dependencies,
      pluginDependency("ms-desk", "2.3.0"),
      pluginDependency("ms-area-desk", "4.5.0"),
    ],
    provides: {
      activation_targets: deskManifest.provides.activation_targets,
      overlay_agents: [
        overlayAgent({
          id: "ms-desk:worker",
          dependsOn: ["desk", "work-suite", "ms-desk"],
          inherits: ["desk:worker"],
          identity: "Microsoft Desk worker",
          addendum: "Use Microsoft employee context without copying Desk setup.",
        }),
        overlayAgent({
          id: "ms-area:worker",
          dependsOn: ["ms-area-desk"],
          inherits: ["ms-desk:worker"],
          identity: "Area Desk worker",
          addendum: "Use area-specific context layered on Microsoft Desk.",
        }),
      ],
    },
  }, overrides))
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

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        validManifest().dependencies[0],
        validManifest().dependencies[1],
        { ...validManifest().dependencies[1] },
      ],
    })),
    [/dependencies\[2\]\.id.*duplicate_dependency_id/i],
  )
})

test("activation validation fails closed for contract type and enum fields", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const target = validManifest().provides.activation_targets[0]
  const overlay = validManifest().provides.overlay_agents[0]

  const result = validateActivationManifest(validManifest({
    id: "Desk With Spaces",
    version: "v1",
    dependencies: [
      {
        ...validManifest().dependencies[0],
        kind: "library",
        provenance: {
          source: 42,
          package: "",
        },
        lock: {
          version: "1.7.3",
          integrity: 7,
        },
      },
      validManifest().dependencies[1],
    ],
    mcp_servers: [
      {
        ...validManifest().mcp_servers[0],
        id: "Desk With Spaces",
        command: 42,
        args: ["mcp/index.js", 7],
        launch: "shell",
      },
    ],
    desk_root: {
      policy: "ambient",
      precedence: ["activation", "ambient"],
      opt_out_modes: ["manual-only", "surprise-me"],
    },
    artifacts: {
      embeddings: {
        ...validManifest().artifacts.embeddings,
        spec_id: 42,
        vector_packs: "write-through",
      },
      snapshots: {
        restore: "newest-compatible",
        stale_reconcile: "overwrite",
      },
    },
    host_support: [
      {
        ...validManifest().host_support[0],
        host: "Codex With Spaces",
        status: "maybe",
        dependency_resolution: "telepathy",
        fallback_behavior: 42,
        capabilities: ["mcp", "root-shell"],
        unsupported_primitives: ["agent-defaults", 42],
      },
    ],
    permissions: {
      requested_capabilities: ["Read", "Root"],
      generated_artifacts: ["owned-host-config", "user-home"],
      never_delete: ["desk-root-data", "temp-cache"],
    },
    provides: {
      activation_targets: [
        {
          ...target,
          id: "Desk Worker",
          kind: "daemon",
          default: "yes",
          entrypoints: {
            ...target.entrypoints,
            unknown: "agents/worker.md",
          },
        },
      ],
      overlay_agents: [
        { ...overlay, id: "Example Worker", kind: "agent", launch_as: 42 },
      ],
    },
  }))

  assertInvalid(result, [
    /^id.*invalid_activation_id/im,
    /^version.*invalid_activation_version/im,
    /dependencies\[0\]\.kind.*invalid_dependency_kind/i,
    /dependencies\[0\]\.provenance\.source.*invalid_dependency_provenance/i,
    /dependencies\[0\]\.provenance\.package.*invalid_dependency_provenance/i,
    /dependencies\[0\]\.lock\.integrity.*invalid_dependency_integrity/i,
    /mcp_servers\[0\]\.id.*invalid_mcp_id/i,
    /mcp_servers\[0\]\.command.*invalid_mcp_command/i,
    /mcp_servers\[0\]\.args.*invalid_mcp_args/i,
    /mcp_servers\[0\]\.launch.*invalid_mcp_launch/i,
    /desk_root\.policy.*invalid_desk_root_policy/i,
    /desk_root\.precedence.*invalid_desk_root_precedence/i,
    /desk_root\.opt_out_modes.*invalid_opt_out_mode/i,
    /artifacts\.embeddings\.vector_packs.*invalid_vector_pack_policy/i,
    /artifacts\.embeddings\.spec_id.*invalid_embedding_spec/i,
    /artifacts\.snapshots\.stale_reconcile.*invalid_snapshot_reconcile/i,
    /host_support\[0\]\.host.*invalid_host_id/i,
    /host_support\[0\]\.status.*invalid_host_status/i,
    /host_support\[0\]\.dependency_resolution.*invalid_dependency_resolution/i,
    /host_support\[0\]\.fallback_behavior.*invalid_fallback_behavior/i,
    /host_support\[0\]\.capabilities.*invalid_host_capability/i,
    /host_support\[0\]\.unsupported_primitives.*invalid_unsupported_primitive/i,
    /permissions\.requested_capabilities.*invalid_requested_capability/i,
    /permissions\.generated_artifacts.*invalid_generated_artifact/i,
    /permissions\.never_delete.*invalid_never_delete_boundary/i,
    /provides\.activation_targets\[0\]\.id.*invalid_activation_target_id/i,
    /provides\.activation_targets\[0\]\.kind.*invalid_activation_target_kind/i,
    /provides\.activation_targets\[0\]\.default.*invalid_activation_default/i,
    /provides\.activation_targets\[0\]\.entrypoints.*invalid_activation_entrypoint/i,
    /provides\.overlay_agents\[0\]\.id.*invalid_overlay_agent_id/i,
    /provides\.overlay_agents\[0\]\.kind.*invalid_overlay_agent_kind/i,
    /provides\.overlay_agents\[0\]\.launch_as.*invalid_overlay_launch_as/i,
  ])

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [{ ...target, entrypoints: undefined }],
        overlay_agents: [overlay],
      },
    })),
    [
      /provides\.activation_targets\[0\]\.entrypoints.*missing_required_field/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [{ ...target, entrypoints: [] }],
        overlay_agents: [overlay],
      },
    })),
    [
      /provides\.activation_targets\[0\]\.entrypoints.*invalid_activation_entrypoint/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [{ ...target, entrypoints: { codex: 42 } }],
        overlay_agents: [overlay],
      },
    })),
    [
      /provides\.activation_targets\[0\]\.entrypoints.*invalid_activation_entrypoint/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [{ ...target, entrypoints: {} }],
        overlay_agents: [overlay],
      },
    })),
    [
      /provides\.activation_targets\[0\]\.entrypoints.*invalid_activation_entrypoint/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: { desk: target },
        overlay_agents: {},
      },
    })),
    [
      /provides\.activation_targets.*invalid_activation_targets/i,
      /provides\.overlay_agents.*invalid_overlay_agents/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: 42 },
        ],
      },
    })),
    [
      /provides\.overlay_agents\[0\]\.inherits.*invalid_overlay_inherits/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: {} },
        ],
      },
    })),
    [
      /provides\.overlay_agents\[0\]\.inherits.*invalid_overlay_inherits/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: [42] },
        ],
      },
    })),
    [
      /provides\.overlay_agents\[0\]\.inherits.*invalid_overlay_inherits/i,
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
        desk_root: { policy: "global-default", precedence: ["DESK"], opt_out_modes: undefined },
      }),
      patterns: [/desk_root\.precedence.*activation/i, /desk_root\.opt_out_modes/],
    },
    {
      name: "embedding artifact policy",
      manifest: validManifest({
        artifacts: {
          embeddings: { shared: true, spec_id: undefined, vector_packs: "read-and-import" },
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
          snapshots: { restore: "whatever", stale_reconcile: undefined },
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
      name: "host capability declarations",
      manifest: validManifest({
        host_support: [
          {
            host: "codex",
            status: "supported",
            dependency_resolution: "flattened",
            fallback_behavior: "materialize owned global/project activation artifacts",
          },
        ],
      }),
      patterns: [/host_support\[0\]\.capabilities/],
    },
    {
      name: "permission boundary never deletes desk data",
      manifest: validManifest({
        permissions: {
          requested_capabilities: ["Read"],
          generated_artifacts: ["owned-host-config"],
          never_delete: undefined,
        },
      }),
      patterns: [/permissions\.never_delete.*desk-root-data/i],
    },
    {
      name: "permission boundary declares requested host capabilities",
      manifest: validManifest({
        permissions: {
          requested_capabilities: undefined,
          generated_artifacts: ["owned-host-config"],
          never_delete: ["desk-root-data"],
        },
      }),
      patterns: [/permissions\.requested_capabilities/],
    },
    {
      name: "permission boundary declares generated artifacts",
      manifest: validManifest({
        permissions: {
          requested_capabilities: ["Read"],
          generated_artifacts: undefined,
          never_delete: ["desk-root-data"],
        },
      }),
      patterns: [/permissions\.generated_artifacts/],
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

  assert.deepEqual(orderActivationDependencies({}), [])
  assert.deepEqual(orderActivationDependencies(null), [])
  assert.deepEqual(
    orderActivationDependencies({
      dependencies: {},
      provides: {
        activation_targets: {},
        overlay_agents: {},
      },
    }),
    [],
  )

  assert.deepEqual(
    orderActivationDependencies({
      dependencies: [
        { id: "zeta-plugin", kind: "plugin" },
        { id: "alpha-plugin", kind: "plugin" },
      ],
    }).map((entry) => entry.id),
    ["alpha-plugin", "zeta-plugin"],
  )
})

test("activation validation accepts multi-level Desk overlay chains", async () => {
  const { orderActivationDependencies, resolveActivationChain, validateActivationManifest } = await loadActivationContract()
  const manifest = overlayChainManifest()
  const result = validateActivationManifest(manifest)

  assert.equal(result.ok, true, diagnostics(result))
  assert.deepEqual(
    result.value.provides.overlay_agents.map((overlay) => overlay.id),
    ["ms-desk:worker", "ms-area:worker"],
  )
  assert.deepEqual(
    orderActivationDependencies(manifest).map((entry) => entry.id),
    [
      "desk",
      "ms-area-desk",
      "ms-desk",
      "work-suite",
      "desk:worker",
      "ms-desk:worker",
      "ms-area:worker",
    ],
  )
  assert.deepEqual(
    resolveActivationChain(manifest, "ms-area:worker").map((entry) => entry.id),
    ["desk:worker", "ms-desk:worker", "ms-area:worker"],
  )
})

test("activation validation enforces desk:worker and overlay relationship integrity", async () => {
  const { orderActivationDependencies, resolveActivationChain, validateActivationManifest } = await loadActivationContract()
  const target = validManifest().provides.activation_targets[0]
  const overlay = validManifest().provides.overlay_agents[0]

  assert.throws(
    () => resolveActivationChain(validManifest(), "missing:worker"),
    /unknown activation target: missing:worker/u,
  )
  assert.throws(
    () => resolveActivationChain(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: ["missing:worker"] },
        ],
      },
    }), "example:worker"),
    /example:worker inherits unknown target missing:worker/u,
  )
  assert.deepEqual(
    resolveActivationChain(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, inherits: ["desk:worker", "desk:worker"] },
        ],
      },
    }), "example:worker").map((entry) => entry.id),
    ["desk:worker", "example:worker"],
  )

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
          target,
          { ...target, id: "desk:helper", default: true },
        ],
        overlay_agents: [overlay],
      },
    })),
    [/only desk:worker may be the substrate default/i],
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

  assertInvalid(
    validateActivationManifest(overlayChainManifest({
      provides: {
        overlay_agents: [
          overlayAgent({
            id: "ms-desk:worker",
            dependsOn: ["desk", "work-suite", "ms-desk"],
            inherits: ["ms-area:worker"],
            identity: "Microsoft Desk worker",
            addendum: "Use Microsoft context.",
          }),
          overlayAgent({
            id: "ms-area:worker",
            dependsOn: ["ms-area-desk"],
            inherits: ["ms-desk:worker"],
            identity: "Area Desk worker",
            addendum: "Use area context.",
          }),
        ],
      },
    })),
    [/overlay inheritance cycle/i],
  )
  assert.deepEqual(
    orderActivationDependencies(overlayChainManifest({
      provides: {
        overlay_agents: [
          overlayAgent({
            id: "ms-desk:worker",
            dependsOn: ["desk", "work-suite", "ms-desk"],
            inherits: ["ms-area:worker"],
            identity: "Microsoft Desk worker",
            addendum: "Use Microsoft context.",
          }),
          overlayAgent({
            id: "ms-area:worker",
            dependsOn: ["ms-area-desk"],
            inherits: ["ms-desk:worker"],
            identity: "Area Desk worker",
            addendum: "Use area context.",
          }),
        ],
      },
    })).map((entry) => entry.id),
    [
      "desk",
      "ms-area-desk",
      "ms-desk",
      "work-suite",
      "desk:worker",
      "ms-desk:worker",
      "ms-area:worker",
    ],
  )
  assert.throws(
    () => resolveActivationChain(overlayChainManifest({
      provides: {
        overlay_agents: [
          overlayAgent({
            id: "ms-desk:worker",
            dependsOn: ["desk", "work-suite", "ms-desk"],
            inherits: ["ms-area:worker"],
            identity: "Microsoft Desk worker",
            addendum: "Use Microsoft context.",
          }),
          overlayAgent({
            id: "ms-area:worker",
            dependsOn: ["ms-area-desk"],
            inherits: ["ms-desk:worker"],
            identity: "Area Desk worker",
            addendum: "Use area context.",
          }),
        ],
      },
    }), "ms-area:worker"),
    /overlay inheritance cycle/u,
  )

  assertInvalid(
    validateActivationManifest(overlayChainManifest({
      provides: {
        overlay_agents: [
          {
            ...overlayAgent({
              id: "ms-desk:worker",
              dependsOn: ["desk", "work-suite", "ms-desk"],
              inherits: ["desk:worker"],
              identity: "Microsoft Desk worker",
              addendum: "Use Microsoft context.",
            }),
            entrypoints: undefined,
          },
        ],
      },
    })),
    [/provides\.overlay_agents\[0\]\.entrypoints.*missing_required_field/i],
  )

  assertInvalid(
    validateActivationManifest(overlayChainManifest({
      provides: {
        overlay_agents: [
          {
            ...overlayAgent({
              id: "ms-desk:worker",
              dependsOn: ["desk", "work-suite", "ms-desk"],
              inherits: ["desk:worker"],
              identity: "Microsoft Desk worker",
              addendum: "Use Microsoft context.",
            }),
            instructions: undefined,
          },
        ],
      },
    })),
    [/provides\.overlay_agents\[0\]\.instructions.*missing_required_field/i],
  )

  assertInvalid(
    validateActivationManifest(overlayChainManifest({
      provides: {
        overlay_agents: [
          {
            ...overlayAgent({
              id: "ms-desk:worker",
              dependsOn: ["desk", "work-suite", "ms-desk"],
              inherits: ["desk:worker"],
              identity: "Microsoft Desk worker",
              addendum: "Use Microsoft context.",
            }),
            instructions: {
              identity: "",
              addendum: "",
            },
          },
        ],
      },
    })),
    [/provides\.overlay_agents\[0\]\.instructions\.identity.*invalid_overlay_instruction/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, default: "yes" },
        ],
      },
    })),
    [/provides\.overlay_agents\[0\]\.default.*invalid_activation_default/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [
          { ...overlay, default: true },
        ],
      },
    })),
    [/overlays must be selected by activation context/i],
  )
})

test("activation validation reports defensive structural errors", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const target = validManifest().provides.activation_targets[0]
  const overlay = validManifest().provides.overlay_agents[0]

  assertInvalid(validateActivationManifest(null), [/\$: invalid_manifest/i])

  assertInvalid(
    validateActivationManifest({}),
    [
      /schema_version.*missing_required_field/i,
      /dependencies.*missing_dependencies/i,
      /mcp_servers.*missing_mcp_servers/i,
      /host_support.*missing_host_support/i,
    ],
  )

  assertInvalid(
    validateActivationManifest(validManifest({ dependencies: [] })),
    [/dependencies.*missing_dependencies/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({ dependencies: ["desk"] })),
    [/dependencies\[0\].*invalid_dependency/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        {
          ...validManifest().dependencies[0],
          kind: undefined,
          lock: {
            version: "not-semver",
            integrity: "sha256-desk-fixture",
          },
        },
      ],
    })),
    [/dependencies\[0\]\.kind.*missing_dependency_kind/i, /dependencies\[0\]\.lock\.version.*invalid_semver/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({ mcp_servers: [] })),
    [/mcp_servers.*missing_mcp_servers/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      mcp_servers: [{ ...validManifest().mcp_servers[0], required: false }],
    })),
    [/mcp_servers\[0\]\.required.*missing_required_mcp/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      artifacts: {
        embeddings: { ...validManifest().artifacts.embeddings, shared: false },
        snapshots: validManifest().artifacts.snapshots,
      },
    })),
    [/artifacts\.embeddings\.shared.*missing_shared_embeddings/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({ host_support: [] })),
    [/host_support.*missing_host_support/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [overlay, { ...overlay }],
      },
    })),
    [/provides\.overlay_agents\[1\]\.id.*duplicate_activation_id/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [{ ...target, depends_on: [] }],
        overlay_agents: [overlay],
      },
    })),
    [/desk:worker\.depends_on.*missing_depends_on/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: null,
        overlay_agents: null,
      },
    })),
    [/provides\.activation_targets/, /provides\.overlay_agents/, /provides\.activation_targets.*desk:worker/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: ["desk:worker"],
        overlay_agents: ["example:worker"],
      },
    })),
    [/provides\.activation_targets\[0\].*missing_required_object/i, /provides\.overlay_agents\[0\].*missing_required_object/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      provides: {
        activation_targets: [target],
        overlay_agents: [{ ...overlay, inherits: undefined }],
      },
    })),
    [/provides\.overlay_agents\[0\]\.inherits/],
  )
})

test("activation dependency ranges support caret, tilde, and exact pins deterministically", async () => {
  const { validateActivationManifest } = await loadActivationContract()
  const desk = validManifest().dependencies[0]
  const workSuite = validManifest().dependencies[1]

  for (const dependency of [
    {
      ...workSuite,
      version_range: "^1.4.0",
      lock: { ...workSuite.lock, version: "1.4.0" },
    },
    {
      ...workSuite,
      version_range: "~1.4.0",
      lock: { ...workSuite.lock, version: "1.4.9" },
    },
    {
      ...workSuite,
      version_range: "1.4.9",
      lock: { ...workSuite.lock, version: "1.4.9" },
    },
    {
      ...workSuite,
      version_range: "^0.2.3",
      lock: { ...workSuite.lock, version: "0.2.9" },
    },
    {
      ...workSuite,
      version_range: "^0.0.3",
      lock: { ...workSuite.lock, version: "0.0.3" },
    },
  ]) {
    const result = validateActivationManifest(validManifest({ dependencies: [desk, dependency] }))
    assert.equal(result.ok, true, diagnostics(result))
  }

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        desk,
        {
          ...workSuite,
          version_range: "1.4.9",
          lock: { ...workSuite.lock, version: "1.4.8" },
        },
      ],
    })),
    [/dependencies\[1\]\.lock\.version.*incompatible_dependency_version/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        desk,
        {
          ...workSuite,
          version_range: "^0.2.3",
          lock: { ...workSuite.lock, version: "0.3.0" },
        },
      ],
    })),
    [/dependencies\[1\]\.lock\.version.*incompatible_dependency_version/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        desk,
        {
          ...workSuite,
          version_range: "^0.2.3",
          lock: { ...workSuite.lock, version: "0.2.2" },
        },
      ],
    })),
    [/dependencies\[1\]\.lock\.version.*incompatible_dependency_version/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        desk,
        {
          ...workSuite,
          version_range: "^0.0.3",
          lock: { ...workSuite.lock, version: "0.0.4" },
        },
      ],
    })),
    [/dependencies\[1\]\.lock\.version.*incompatible_dependency_version/i],
  )

  assertInvalid(
    validateActivationManifest(validManifest({
      dependencies: [
        desk,
        {
          ...workSuite,
          version_range: "^1.4.0",
          lock: { ...workSuite.lock, version: "not-semver" },
        },
      ],
    })),
    [/dependencies\[1\]\.lock\.version.*invalid_semver/i, /dependencies\[1\]\.lock\.version.*incompatible_dependency_version/i],
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

  const unsupported = diagnoseHostSupport(validManifest(), {
    host: "unknown-host",
  })

  assert.equal(unsupported.status, "unsupported")
  assert.deepEqual(unsupported.unsupported_primitives, ["host-activation"])
  assert.match(unsupported.fallback_behavior, /manual host configuration/i)

  const noHostSupport = diagnoseHostSupport({}, {
    host: "unknown-host",
  })

  assert.equal(noHostSupport.status, "unsupported")
  assert.deepEqual(noHostSupport.unsupported_primitives, ["host-activation"])

  const nullManifestHostSupport = diagnoseHostSupport(null, {
    host: "codex",
  })

  assert.equal(nullManifestHostSupport.status, "unsupported")
  assert.deepEqual(nullManifestHostSupport.unsupported_primitives, ["host-activation"])

  const malformedHostSupport = diagnoseHostSupport({
    host_support: {},
  }, {
    host: "codex",
  })

  assert.equal(malformedHostSupport.status, "unsupported")
  assert.deepEqual(malformedHostSupport.unsupported_primitives, ["host-activation"])

  const bareHost = diagnoseHostSupport({
    host_support: [
      {
        host: "bare-host",
        status: "experimental",
        fallback_behavior: "bring your own stdio launch",
      },
    ],
  }, {
    host: "bare-host",
  })

  assert.equal(bareHost.status, "experimental")
  assert.deepEqual(bareHost.unsupported_primitives, [])
  assert.deepEqual(bareHost.capabilities, [])
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
