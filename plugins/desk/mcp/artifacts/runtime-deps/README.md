# Runtime Dependency Packs

Production runtime dependency packs live under:

```text
plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/
```

Each pack directory contains `runtime-deps.tgz`, `runtime-deps.manifest.json`,
and `runtime-deps.sha256`. Archives are dependency-only runtime packs for the
Desk MCP server; they must not contain mutable MCP server source.
