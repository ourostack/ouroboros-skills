# Runtime dependency packs

Runtime dependency packs are release/CI artifacts for the Desk MCP server. They contain the production `node_modules` runtime closure, root `package.json`, root `package-lock.json`, and embedded manifest metadata needed to restore dependencies into a writable runtime cache without running `npm install` inside an installed plugin.

Canonical packs are written under:

```text
plugins/desk/mcp/artifacts/runtime-deps/<plugin-version>/<platform>-<arch>-node-<abi>/<prod-dependency-lock-hash>/
```

Each pack directory contains:

- `runtime-deps.tgz`
- `runtime-deps.manifest.json`
- `runtime-deps.sha256`

Use `npm run runtime:deps-pack:build` and `npm run runtime:deps-pack:verify` from `plugins/desk/mcp` for release maintenance and CI verification.
