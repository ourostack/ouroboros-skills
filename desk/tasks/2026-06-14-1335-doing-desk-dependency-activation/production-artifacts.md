# Production Shared Artifacts

Status: pending Unit 22e publication.

This note records the expected verification shape for the first committed Desk production vector pack and snapshot. The artifacts must live under the active embedding-spec directories:

- `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/`
- `plugins/desk/artifacts/snapshots/<embedding-spec-id>/`

Required release-maintenance commands:

- `npm --prefix plugins/desk/mcp run artifact:vector-pack:build -- --desk-root <desk-root> --pack-id <pack-id> --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:snapshot:build -- --desk-root <desk-root> --snapshot-id <snapshot-id> --included-pack-id <pack-id> --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <desk-root>`
- `node scripts/test-desk-generated-artifacts.cjs`

Current freshness anchors to fill in Unit 22e:

- `current_artifact_source_scope_hash: pending Unit 22e`
- `current_document_tree_hash: pending Unit 22e`

The final Unit 22e publication record must include:

- Vector pack manifest path, checksum path, manifest freshness hashes matching the current anchors above, row count, represented document count, and git commit.
- Snapshot manifest path, checksum path, manifest freshness hashes matching the current anchors above, included vector pack IDs, represented document count, and git commit.
- `plugins/desk/artifacts/publication-policy.json` approval details for both `vector-pack` and `snapshot` publication.
- Confirmation that exclusion checks and tombstone/redaction checks ran before artifact writes.
- Confirmation that active artifacts do not represent gitignored, sensitive-path, deleted, or redacted documents.
