# Desk Dependency Activation Final Verification

Date: 2026-06-16
Branch: `desk/dependency-activation-plan`

## Summary

Unit 24 integration coverage now exercises the production shared-artifact paths for:

- cold production snapshot restore and repeated snapshot startup idempotence;
- cold rebuild from committed production vector packs without live embeddings;
- missing-vector live generation with asserted outbound embedding request shape;
- active/archived search scope and refs graph preservation after vector-pack rebuild;
- degraded lexical startup when snapshots, vector packs, and live embeddings are unavailable.

No production vector-pack or snapshot artifact regeneration was required by Units 24a2-24b5 because those units changed integration tests and task evidence only, not artifact source-scope files or indexed production document inputs.

## Final Gate Evidence

All final-gate logs live beside this file.

| Gate | Command | Evidence | Result |
| --- | --- | --- | --- |
| Desk MCP tests | `npm --prefix plugins/desk/mcp test` | `unit-24c-npm-test-green.log` | 638/638 pass |
| Desk MCP coverage | `npm --prefix plugins/desk/mcp run test:coverage` | `unit-24c-test-coverage-green.log` | 100% line/branch/function; coverage gate passed |
| Root validation | `node scripts/validate-skills.cjs` | `unit-24c-validate-skills-green.log` | Pass |
| Host manifest freshness | `node scripts/test-desk-host-manifests.cjs` | `unit-24c-host-manifests-green.log` | Pass |
| Generated artifact freshness | `node scripts/test-desk-generated-artifacts.cjs` | `unit-24c-generated-artifacts-green.log` | Pass |
| Runtime dependency pack | `npm --prefix plugins/desk/mcp run runtime:deps-pack:verify` | `unit-24c-runtime-deps-pack-verify-green.log` | Pass |
| Production vector/snapshot artifacts | `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <repo>/desk --plugin-root <repo>/plugins/desk` | `unit-24c-artifact-validate-green.log` | Pass |
| Production snapshot | `npm --prefix plugins/desk/mcp run artifact:snapshot:verify -- --plugin-root <repo>/plugins/desk --snapshot-id repo-public-bootstrap-2026-06-15` | `unit-24c-snapshot-verify-green.log` | Pass |
| Build | `npm --prefix plugins/desk/mcp run build` | `unit-24c-build-unavailable.log` | Expected unavailable: package has no `build` script |
| Whitespace | `git diff --check` | `unit-24c-diff-check-green.log` | Pass |

## Notes

- The first final-gate attempt ran the full test suite and coverage concurrently. That overloaded the large SQLite-limit test and produced a timeout, so the final evidence was rerun sequentially and passed cleanly.
- The degraded lexical integration test intentionally emits one `semantic_unavailable` diagnostic while proving lexical fallback. No unexpected warnings remain in the final evidence.
