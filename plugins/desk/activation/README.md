# Desk Activation Contract

`desk.activation.json` is the host-neutral contract for making Desk available as a substrate dependency instead of a manual setup step.

The manifest is intentionally declarative. Host adapters flatten it into native host configuration, while the validator fails closed when a field has an unknown shape, unsupported enum value, duplicate dependency identity, incompatible version lock, or unsupported schema version.

## Fields

- `schema_version`: Activation contract version. Unknown versions are unsupported until the host adapter is upgraded.
- `id` and `version`: The activation package identity and exact plugin version.
- `dependencies`: Ordered substrate/plugin inputs. Each entry declares a stable `id`, `kind`, exact `version` or `version_range`, `provenance`, and resolved `lock` data. Exact versions must match their lock; ranges must be satisfied by their lock.
- `provides.activation_targets`: Launchable activation targets. Desk provides `desk:worker` as the default target and declares the Desk/Work Suite dependencies and host entrypoint files it needs.
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

## Ouroboros Autonomous Agent

Disposition: `supported-flattened`.

Ouroboros/autonomous-agent bundles do not provide host-native-plugin-install for Desk as an independently installed substrate. The supported path is to bundle Desk + Work Suite into the agent bundle and bind `$DESK` to `~/AgentBundles/<agent>.ouro/desk/` in the agent preamble.

The bundle owns the agent, skills, and MCP surfaces together. Desk still reads and writes durable workspace data only through the bound `$DESK` root.

## Generic Stdio

Disposition: `degraded-mcp-only`.

Generic stdio hosts can start the Desk MCP server, but they do not provide agent-defaults or plugin-dependency-resolution. Start the MCP with explicit --root or DESK and no worker activation. A separate host or overlay must provide any agent identity and Work Suite dependency closure.
