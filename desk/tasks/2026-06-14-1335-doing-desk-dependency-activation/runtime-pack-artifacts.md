# Runtime Pack Artifacts

Status: Unit 6g red contract. The production runtime dependency pack is expected to be committed in Unit 6h.

## Current Target

- Plugin version: `1.3.1`
- Runtime target: `darwin-arm64-node-127`
- Production dependency lock hash: `e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be`
- Pack directory: `plugins/desk/mcp/artifacts/runtime-deps/1.3.1/darwin-arm64-node-127/e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be/`

## Required Files

- `runtime-deps.tgz`
- `runtime-deps.manifest.json`
- `runtime-deps.sha256`

## Verification Notes

- `node --test plugins/desk/mcp/__tests__/runtime/production_runtime_pack.test.js` is red until the current target files are present, tracked by git, and verified.
- `node scripts/test-desk-generated-artifacts.cjs` is red until the same production target is present and tracked.
- The committed pack must derive from `plugins/desk/mcp/package-lock.json`, include package-lock hash and production dependency lock hash metadata, expand to dependency-only runtime files, and avoid mutable MCP server source.
