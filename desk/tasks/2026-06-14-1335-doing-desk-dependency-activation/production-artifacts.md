# Production Shared Artifacts

Status: published in Unit 22e.

This note records the expected verification shape for the first committed Desk production vector pack and snapshot. The artifacts must live under the active embedding-spec directories:

- `plugins/desk/artifacts/vector-packs/<embedding-spec-id>/`
- `plugins/desk/artifacts/snapshots/<embedding-spec-id>/`

Required release-maintenance commands:

- `npm --prefix plugins/desk/mcp run artifact:vector-pack:build -- --desk-root <desk-root> --pack-id <pack-id> --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:snapshot:build -- --desk-root <desk-root> --snapshot-id <snapshot-id> --included-pack-id <pack-id> --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <desk-root>`
- `node scripts/test-desk-generated-artifacts.cjs`

Commands run:

- `node plugins/desk/mcp/scripts/rebuild-index.js --root <repo>/desk`
- `npm --prefix plugins/desk/mcp run artifact:vector-pack:build -- --desk-root <repo>/desk --pack-id repo-public-bootstrap-2026-06-15 --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:snapshot:build -- --desk-root <repo>/desk --snapshot-id repo-public-bootstrap-2026-06-15 --included-pack-id repo-public-bootstrap-2026-06-15 --from-local-db`
- `npm --prefix plugins/desk/mcp run artifact:validate -- --desk-root <repo>/desk`
- `npm --prefix plugins/desk/mcp run artifact:snapshot:verify -- --snapshot-id repo-public-bootstrap-2026-06-15`
- `node scripts/test-desk-generated-artifacts.cjs`

Current freshness anchors:

- current_artifact_source_scope_hash: sha256:8b978e8566c015bee3d46c924286bc309582117057cc533d6d0ce05d255beb4d
- current_document_tree_hash: sha256:b8268841c4877dfe293de7c463eadf38339c741daa6416ffd5b1ec652087fba8

Published vector pack:

- Path: `plugins/desk/artifacts/vector-packs/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.jsonl`
- Manifest: `plugins/desk/artifacts/vector-packs/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.manifest.json`
- Checksum: `plugins/desk/artifacts/vector-packs/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.sha256`
- `pack_id`: `repo-public-bootstrap-2026-06-15`
- `row_count`: 2
- `rows_sha256`: `974644991aa23dbb7348d3b92ce39cef404298462e09a9b3410f92ca38279b4c`
- `artifact_source_scope_hash`: `sha256:8b978e8566c015bee3d46c924286bc309582117057cc533d6d0ce05d255beb4d`
- `document_tree_hash`: `sha256:b8268841c4877dfe293de7c463eadf38339c741daa6416ffd5b1ec652087fba8`
- `represented_document_count`: 1
- Represented document: `tasks/dependency-activation/task.md` at `sha256:3886140d5ca53b11e39d670572bce11535d9f980e4d168dbdcbbd72bc10edf59`
- Provenance commit: `afc202300c6ad40df150adb7876a88a64c06df8d`

Published snapshot:

- Path: `plugins/desk/artifacts/snapshots/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.sqlite.zst`
- Manifest: `plugins/desk/artifacts/snapshots/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.manifest.json`
- Checksum: `plugins/desk/artifacts/snapshots/nomic-embed-text-v1_5-desk-md-h2-paragraph-v1-unicode-whitespace-v1-768/repo-public-bootstrap-2026-06-15.sha256`
- `snapshot_id`: `repo-public-bootstrap-2026-06-15`
- `artifact_source_scope_hash`: `sha256:8b978e8566c015bee3d46c924286bc309582117057cc533d6d0ce05d255beb4d`
- `document_tree_hash`: `sha256:b8268841c4877dfe293de7c463eadf38339c741daa6416ffd5b1ec652087fba8`
- `included_pack_ids`: `repo-public-bootstrap-2026-06-15`
- `represented_document_count`: 1
- Represented document: `tasks/dependency-activation/task.md` at `sha256:3886140d5ca53b11e39d670572bce11535d9f980e4d168dbdcbbd72bc10edf59`
- Artifact sha256: `sha256:8a16b98403babe5e8dd2d40bc72957283b361a157f3d5aa100a3bfcb881e77a9`
- Runtime: `portable-portable-portable`
- Provenance commit: `afc202300c6ad40df150adb7876a88a64c06df8d`

Approval state:

- `plugins/desk/artifacts/publication-policy.json` keeps `default_publication: deny`, `repo_visibility: public`, `sensitive_repo: true`, and `approval_required: true`.
- `vector-pack` and `snapshot` publication are explicitly approved by `human-directed-codex` at `2026-06-16T06:09:03.000Z` for repo-local public Desk documents only.

Privacy and redaction checks:

- Exclusion checks ran through the vector-pack and snapshot artifact writers before bytes were written.
- Tombstone/redaction checks ran through the artifact writers and `artifact:validate`.
- Active artifacts represent only `tasks/dependency-activation/task.md`; no gitignored, sensitive-path, deleted, redacted, personal global desk, or absolute-path content is represented.
