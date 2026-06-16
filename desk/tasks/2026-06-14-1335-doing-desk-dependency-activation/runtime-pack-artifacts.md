# Runtime Pack Artifacts

Status: Unit 6h publication complete for the current host target.

## Current Target

- Plugin version: `1.3.1`
- Runtime target: `darwin-arm64-node-127`
- Production dependency lock hash: `e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be`
- Pack directory: `plugins/desk/mcp/artifacts/runtime-deps/1.3.1/darwin-arm64-node-127/e28611fabac02b7d88a0ad71cd7e282de1ec09e86cefab01e6d4e572136896be/`

## Required Files

- `runtime-deps.tgz`
- `runtime-deps.manifest.json`
- `runtime-deps.sha256`

## Published Manifest

- Manifest `created_at`: `2026-06-15T10:51:16.211Z`
- Package lock SHA-256: `9d427577ed4ebf81b02d100b3e48ea3f39f3392b62ba6e83134344147acce0c0`
- Archive SHA-256: `6978a98096c6f9863ae3aca6ab26b6437a4e83db355e9b2e34a63456ee62b786`
- Production dependencies: `139`
- Root archive entries: `node_modules/`, `package.json`, `package-lock.json`, `runtime-deps.manifest.json`
- Mutable server source: not archived (`archive.contains_server_source: false`)
- Provenance builder: `runtime:deps-pack:build`

## Verification Notes

- Built with `npm --prefix plugins/desk/mcp run runtime:deps-pack:build`; evidence: `unit-6h-runtime-pack-build.log`.
- Verified with `npm --prefix plugins/desk/mcp run runtime:deps-pack:verify`; evidence: `unit-6h-runtime-pack-verify-green.log`.
- Verified committed generated-artifact freshness with `node scripts/test-desk-generated-artifacts.cjs`; evidence: `unit-6h-generated-artifacts-green.log`.
- Verified production runtime pack publication tests with `node --test plugins/desk/mcp/__tests__/runtime/production_runtime_pack.test.js`; evidence: `unit-6h-production-runtime-pack-green.log`.
- Verified no mutable Desk MCP source entries are bundled with a tar entry scan; evidence: `unit-6h-runtime-pack-source-scan.log`.
- Verified broader suite with `npm --prefix plugins/desk/mcp test`; evidence: `unit-6h-npm-test-green.log`.
- Verified coverage with `npm --prefix plugins/desk/mcp run test:coverage`; evidence: `unit-6h-test-coverage.log`.
- Verified repository skill metadata with `node scripts/validate-skills.cjs`; evidence: `unit-6h-validate-skills-green.log`.
- Checked build availability with `npm --prefix plugins/desk/mcp run build`; evidence: `unit-6h-build-unavailable.log` records the expected missing build script.
- No `npm install` command is part of the Unit 6h publication path. The committed pack is dependency-only and is intended for the later runtime-cache source-mirror bootstrap, so current MCP source can be mirrored separately without mutating plugin source or freezing server source into the pack.
