# Runtime dependency packs

Runtime dependency packs are release/CI artifacts for the Desk MCP server. They contain the production `node_modules` runtime closure, root `package.json`, root `package-lock.json`, and embedded manifest metadata needed to restore dependencies into a writable runtime cache without running `npm install` inside an installed plugin.

For `better-sqlite3`, the explicitly required `build/Release/better_sqlite3.node` addon is packaged, but other files under `build/` are not inferred as runtime dependencies. Optional compiler outputs and test extensions differ between source-built and prebuilt installations and must not change the required archive shape. JavaScript runtime files remain discovered and required.

Canonical packs are written under:

```text
plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/
```

Each pack directory contains:

- `runtime-deps.tgz`
- `runtime-deps.manifest.json`
- `runtime-deps.sha256`

Use `npm run runtime:deps-pack:build` and `npm run runtime:deps-pack:verify` from `plugins/desk/mcp` for release maintenance and CI verification.

The build CLI uses generic provenance. For a curated release pack, call `buildRuntimeDependencyPack` from `src/runtime/runtime-deps.js` with an explicit `provenanceSource` describing the actual build host and installed production closure. Preserve the resulting archive, sidecar, checksum and support-matrix identities together; do not carry a prior native-byte provenance claim onto replacement bytes.
