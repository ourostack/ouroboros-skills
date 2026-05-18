---
name: friction-management
description: How worker maintains the operator's friction log — appending new entries during real use, updating `Status:` lines when fixes land, and archiving landed/partial entries so the live log stays signal-dense. Use when capturing a new pain point, when a friction item's fix ships in worker, or when the friction log grows past ~150 lines and open items start getting buried.
---

# Friction management

The friction log at `$DESK/_meta/friction.md` (and per-track `<track>/_friction/friction.md` for track-local pain) is worker's primary improvement pipeline. Operators capture real-use pain; future sessions turn pain into skill/agent/plumbing fixes. The log is only useful if it's readable — if it grows into a wall of mostly-landed entries, operators can't find the open ones and the signal dies.

This skill governs three operations: append, mark landed, archive.

## 1. Append (new friction)

When the operator hits friction, or when worker notices a recurring rough edge:

1. Decide the scope: is this operator-specific (`_meta/friction.md`), or track-specific (`<track>/_friction/friction.md`)? Default to operator-level; use track-local only when the issue is tightly coupled to one track's work.
2. Append a new entry at the END of the file using this format:

   ```markdown
   ## YYYY-MM-DD — <short title>

   **Context** (optional, use when background matters): <one paragraph>.

   **What happened**: <what went wrong — concrete, specific>.

   **Why it hurt**: <impact — what broke, how much time, what's at risk>.

   **Proposed fix**: <specific, actionable. Prefer a numbered list when multiple paths exist>.

   **Status**: open.
   ```

3. Commit + push to worker-workspace. No separate review step; the log is live evidence.

### Capture during the activity, not after

**Capture friction during the activity that surfaced it, not after.**
Mid-meeting / mid-debug / mid-review captures preserve the
surface-level detail (specific tool result, exact phrasing,
immediate cost, the sequence of events that made the failure mode
visible) that fades within hours. Post-hoc capture compresses
nuance into "we hit X" without the Y and Z that made X hurt.

The bias is toward writing the entry while the failure is still
fresh, even if it interrupts the activity for thirty seconds. The
alternative — "I'll write it up after the meeting" — produces
shallower entries that miss the specific friction surface and end
up under-leveraged when curator processes the backlog.

A short live-capture entry is more useful than a long after-the-fact
one. Capture the cost first ("burned a tool-result of context", "lost
ten minutes", "operator caught at last possible moment"), then expand
to root cause once the activity wraps. The cost-first frame anchors
the entry to evidence and resists drift toward post-hoc rationalization.

## 2. Mark landed

When a fix ships in the worker plugin (or other owning repo) that resolves a friction entry:

1. Update the entry's `**Status**:` line. Format:

   ```markdown
   **Status**: landed in <repo> commit `<sha>` (PR #N) — <one-line summary of how the fix addresses the friction>.
   ```

   If the fix is only partial, use `partial` and spell out what remains open.

2. **In the SAME commit**, move the entry out of the live log. See section 3.

**Why same commit:** an entry marked `landed` but still in the live log is easy to miss — readers scan down the file and all they see is friction, landed or not. The canonical state of the friction log is "live = open." Mixing landed in with open degrades the whole log.

## 3. Archive — same motion as mark-landed

Move landed/partial entries to `_meta/_archive/friction-YYYY-MM-DD.md` (or `<track>/_friction/_archive/friction-YYYY-MM-DD.md` for track-local).

### Archive file naming

- **Per-date**: `friction-YYYY-MM-DD.md` — groups entries archived on the same date.
- **Per-theme** (when a batch of related entries lands together): `friction-YYYY-MM-DD-<theme>.md` — e.g., `friction-2026-04-17-windows-prereqs.md`.

Use per-theme when 3+ entries land in one sweep with a shared story (e.g., "all the first-Windows-run friction"). Use per-date otherwise.

### Archive file structure

```markdown
# Friction archive — <YYYY-MM-DD>[<theme>]

Entries archived from `_meta/friction.md` on <YYYY-MM-DD>. Each is landed or partial — see the Status line at the bottom of each entry.

---

<entry 1 — full body including the Status line>

---

<entry 2 — full body including the Status line>

---
```

Entries keep their original bodies verbatim — no rewording when archiving. The archive is evidence, not a summary.

### The single-motion rule

Archiving must happen in the SAME git commit as the `Status: landed` update. Commit message pattern:

```
friction: archive landed — <comma-separated short titles> (<sha>s)

Entries moved from _meta/friction.md to _meta/_archive/friction-<date>[-<theme>].md.
Status lines updated in the archived copy with the shipping commit sha.
```

Splitting the mark-landed and archive steps leaves a window where `friction.md` has inconsistent state (some landed entries inline, others already archived). Always atomic.

## 4. When the live log grows past ~150 lines

Even with open-only-in-live, an operator can accumulate open items faster than they fix them. If `_meta/friction.md` grows past ~150 lines, consider:

- **Group by theme** in the archive when you eventually land a batch.
- **Add a brief summary at the top of `friction.md`** — e.g. "N open entries across [themes]" — so the shape is visible at a glance.

Do NOT aggressively close entries just to shrink the log. Open means unresolved; the log is evidence, not a todo list.

## 5. Never delete, never rewrite

- Don't delete entries, even landed ones. Archive them.
- Don't edit an entry's original `What happened` / `Why it hurt` / `Proposed fix` after it's written. Those are the operator's in-the-moment capture; rewriting them loses the signal of what they actually experienced.
- Only the `Status:` line changes after initial write. Everything else is append-only evidence.
