# Desk Activation Contract

`desk.activation.json` is the host-neutral contract for making Desk available as a substrate dependency instead of a manual setup step.

The manifest is intentionally declarative. Host adapters flatten it into native host configuration, while the validator fails closed when a field has an unknown shape, unsupported enum value, duplicate dependency identity, incompatible version lock, or unsupported schema version.

## Fields

- `schema_version`: Activation contract version. Unknown versions are unsupported until the host adapter is upgraded.
- `id` and `version`: The activation package identity and exact plugin version.
- `dependencies`: Ordered substrate/plugin inputs. Each entry declares a stable `id`, `kind`, exact `version` or `version_range`, `provenance`, and resolved `lock` data. Exact versions must match their lock; ranges must be satisfied by their lock.
- `provides.activation_targets`: Launchable targets. The opt-in alpha selects `desk:worker` with Desk, Superpowers, Plain Language and Ponytail plus its host entrypoints.
- `provides.overlay_agents`: Optional agent overlays that inherit Desk behavior without launching as `desk:worker`.
- `mcp_servers`: Required MCP servers. Desk declares its MCP launch as host-native rather than as a manual `mcp add` step.
- `desk_root`: Root binding policy, precedence, and opt-out modes. The default policy is global activation first, then `DESK`, then safe defaults, with project-local and manual-only opt-outs.
- `artifacts.embeddings`: Shared embedding policy and active embedding spec for vector packs.
- `artifacts.snapshots`: Snapshot restore and stale-reconcile policy.
- `host_support`: Host dispositions, dependency-resolution strategy, unsupported primitives, fallback behavior, and capabilities.
- `permissions`: Requested host capabilities, generated artifact classes, and never-delete boundaries.

## Ownership

Host adapters may flatten this manifest into their native plugin/config surfaces, but generated artifacts must remain owned and removable without deleting desk-root data.

The manifest is not a user-facing CLI contract. Healthy activation should be host-native: no manual MCP registration, copied worker files, or hand-edited JSON/TOML on the happy path.

Host adapters use the actual marketplace namespace, for example `desk@ourostack-local`, `superpowers@ourostack-local`, `plain-language@ourostack-local` and `ponytail-upstream@ourostack-local`, plus selected overlays.

## Overlay Ladder

Desk has three separable layers:

1. `desk` is the substrate dependency: skills, MCP, workspace layout, artifact bootstrap, and `desk_status`.
2. `desk:worker` is the generic base worker that makes Desk useful as a standalone plugin.
3. Consumer plugins provide overlays, for example `ms-desk:worker` inheriting `desk:worker`, and an area overlay inheriting `ms-desk:worker`.

An overlay is selected by activation context rather than by changing Desk's substrate default. Standalone Desk still selects `desk:worker`; a global or project profile can select `ms-desk:worker` or an area overlay as the effective worker. Host adapters must enable the selected chain's plugin dependencies while keeping Desk MCP singular. The active activation chain is visible through generated instructions and through `desk_status`.

Synthetic shape:

```json
{
  "provides": {
    "activation_targets": [
      {
        "id": "desk:worker",
        "kind": "agent",
        "default": true,
        "depends_on": ["desk", "superpowers", "plain-language", "ponytail-upstream"]
      }
    ],
    "overlay_agents": [
      {
        "id": "ms-desk:worker",
        "kind": "agent-overlay",
        "depends_on": ["desk", "superpowers", "plain-language", "ponytail-upstream", "ms-desk"],
        "inherits": ["desk:worker"],
        "launch_as": "ms-desk:worker"
      },
      {
        "id": "ms-area:worker",
        "kind": "agent-overlay",
        "depends_on": ["ms-area-desk"],
        "inherits": ["ms-desk:worker"],
        "launch_as": "ms-area:worker"
      }
    ]
  }
}
```

Use this ladder when deciding plugin dependencies: depend on `desk` when you only need the substrate, depend on an org overlay when you need a vendor-flavored worker layer, and depend on the relevant area overlay when the work needs that narrower context.

## Evidence States

Zero-setup support has three different evidence states:

- `repo-source-current`: manifests and the source catalog point at the expected Desk, Superpowers, Plain Language and Ponytail files; this is not active-session proof.
- `installed-cache-current`: the Codex plugin cache contains manifests matching the repository source.
- `active-session-visible`: the currently running host session has reloaded those manifests and exposes the expected skills, MCP tools, selected activation, and `desk_status`.

The read-only `scripts/audit-codex-plugin-cache.cjs` checks the first two states. It reports `active-session-visible` as not checked until the caller supplies active host MCP tool evidence with `--active-tools` or `--active-tools-file`; `--strict-active` fails when no active snapshot is supplied or required Desk tools are missing. This keeps file/cache freshness, MCP launchability, and active-session visibility separate.

Desk workers also carry a startup health guard: if `desk_status` or the Desk MCP namespace is missing from the active tool surface, the agent treats Desk MCP as absent, explains what MCP-backed desk access provides, and asks whether to fix/reload now or continue without generic reminders. Choosing repair routes to `desk:codex-onboarding` or the host repair checklist; choosing no reminders is an explicit operator preference, not silent local-only fallback. Once `desk_status` is callable, degraded index/vector/snapshot states are runtime repair problems rather than activation absence.

## Artifact Privacy

Embeddings and snapshots are derivative data and may carry privacy risk. Activation manifests declare the shared embedding and snapshot policies so host adapters can keep publication explicit, approval-gated, and separate from ordinary startup.

## Ouroboros Autonomous Agent

Disposition: `supported-flattened`.

Ouroboros/autonomous-agent bundles do not provide host-native-plugin-install for an independent Desk substrate. The alpha packaging path bundles Desk + Superpowers + Plain Language + Ponytail and binds `$DESK` to `~/AgentBundles/<agent>.ouro/desk/`. This source contract is not native alpha runtime admission.

The bundle owns the agent, skills, and MCP surfaces together. Desk still reads and writes durable workspace data only through the bound `$DESK` root.

## Generic Stdio

Disposition: `degraded-mcp-only`.

Generic stdio hosts start Desk MCP but provide neither agent-defaults nor plugin-dependency-resolution. Use explicit --root or DESK and no worker activation. A separate host owns any agent identity and selected engineering provider closure.
