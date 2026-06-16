---
schema_version: 1
status: in_progress
created: 2026-06-15
updated: 2026-06-15
---

# Desk Dependency Activation

This public task card is the repo-local Desk context used for production shared artifact publication. It represents only public, repository-owned setup work for making Desk resolve as a dependency of plugins and worker agents.

The implementation plan lives in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation.md`. The companion artifact notes live in `desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/production-artifacts.md`.

Current scope:

- Host-native activation for Codex, Claude, Copilot/root, Ouroboros autonomous-agent bundles, and generic stdio hosts.
- Default global Desk plus worker behavior for the operator, with opt-out paths for project-local or manual-only setups.
- Repo-shared runtime dependency packs, vector packs, and snapshots that avoid each machine needing to recalculate everything from scratch.
- Publication controls covering explicit approval, gitignore and sensitive-path exclusion, tombstones, redaction cleanup, and freshness anchors.

Privacy boundary:

- Production artifacts for this public repo must represent only repo-local public Desk documents.
- Personal global desk content, local absolute paths, credentials, secrets, redacted documents, and gitignored material must not be represented.
