---
name: track-card-format
description: Schema + body template for `track.md` — the per-track dashboard at the root of each track directory. Use when creating a new track, reading an existing track, or updating a track card's frontmatter or tasks table.
---

# Track card format

`track.md` sits at the root of a track directory. **It's a working dashboard, not just metadata** — it's the first thing a resuming operator reads, so make it useful.

## Frontmatter schema

```yaml
---
title: "<track title>"
status: active | closed

# Link to predecessor track (if this track succeeds a closed one)
predecessor:
  slug: <predecessor-track-slug>
  title: "..."
  status: closed

# Provenance (if track was adopted from an existing planning bundle)
adopted_from:
  source_path: /path/to/source
  source_sha: <commit if applicable>
  adopted_at: 2026-01-15T14:30:00Z
  adopted_by: <operator alias>

# Pointer to the canonical cross-repo plan
planning: ./_planning/planning.md
---
```

Consumer agents extending this with their own work-tracker schema
(e.g., worker users with ADO Features) add their own frontmatter
block — see `worker:ms-card-fields` for the MS-specific `ado:` +
`ado_defaults:` shape.

## Body sections (recommended template)

```markdown
## Scope

One paragraph describing what this track covers.

## Tasks

| Slug | State | Repos | Tracker link | Doing doc |
|------|-------|-------|--------------|-----------|
| `api-validation-layer` | drafting | OrderService (local), OrderUI (local) | <link to work-tracker item, if any> | `api-validation-layer/OrderService/...-doing-validation.md` |

## Ordering

1. `api-validation-layer` Phase 1 must ship before UI can adopt the new contract.

## Adoption summary (if adopted)

- **Source**: planning bundle at `<path>` (see frontmatter `adopted_from`)
- **Inherited from predecessor track**: <summary of what was preserved vs reparented>
- **New work items under this track**: <summary>
- **Planning docs preserved**: see `_planning/` (current) and `_planning/_history/` (superseded)
```

Consumer agents may add a "Work-tracker structure" body section
(e.g., the MS ADO Feature/Requirement/Task hierarchy) — that
belongs in the consumer's extension skill, not here. worker users:
see `worker:ms-card-fields`.

Keep the body concise. When a resuming operator reads `track.md`, they should know what's in flight and what's next in under 30 seconds.
