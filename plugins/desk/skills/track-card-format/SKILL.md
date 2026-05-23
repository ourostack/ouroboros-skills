---
name: track-card-format
description: Schema + body template for `track.md` — the per-track dashboard at the root of each track directory. Use when creating a new track, reading an existing track, or updating a track card's frontmatter or tasks table.
---

# Track card format

`track.md` is the label on the drawer. it sits at the root of a track directory and **is a working dashboard, not just metadata** — the first thing a resuming operator reads. make it useful.

## Frontmatter schema

```yaml
---
schema_version: 1
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

consumer agents extending this with their own work-tracker schema
(e.g. enterprise overlays with Feature / Epic hierarchies) add their
own frontmatter block — typically the overlay ships a
`<overlay>:card-fields` skill defining the tracker-specific shape
(e.g. `tracker:` and `tracker_defaults:` keys).

## Schema versioning

`schema_version: 1` declares the current track-card schema. same semantics as task.md: files missing the field are treated as `schema_version: 0` and continue to parse cleanly (v1 is a strict superset of v0); new tracks always write `schema_version: 1`; bump only on genuinely breaking changes.

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

consumer agents may add a "Work-tracker structure" body section
(e.g. an enterprise Feature/Requirement/Task hierarchy) — that
belongs in the consumer's extension skill, not here.

keep the body concise. when a resuming operator slides the drawer open, they should know what's in flight and what's next in under 30 seconds.
