# Desk Activation Contract

`desk.activation.json` is the host-neutral contract for making Desk available as a substrate dependency instead of a manual setup step.

The manifest declares:

- Desk and Work Suite dependency identity, version intent, provenance, and lock data.
- The default `desk:worker` activation target.
- The required Desk MCP server.
- Desk-root precedence and opt-out modes.
- Shared embedding and snapshot artifact policy.
- Host support dispositions and permission boundaries.

Host adapters may flatten this manifest into their native plugin/config surfaces, but generated artifacts must remain owned and removable without deleting desk-root data.
