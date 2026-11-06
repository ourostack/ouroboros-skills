---
name: archive-workflow
description: Move terminal-state tasks (and fully-terminal tracks) into _archive/ directories to keep the active workspace readable while preserving history. Use when a task transitions to `done` or `cancelled`, or when checking whether a track's tasks are all terminal so the track itself can be archived.
---

# Archive workflow

When a task reaches a terminal state (`done` or `cancelled`), archive it to keep the active workspace clean while preserving full history.

## When to invoke

- A task just transitioned to `done` (PR merged) or `cancelled` (operator abandoned).
- After archiving a task, check whether the parent track is now fully terminal (all tasks `done` or `cancelled` or already archived).
- Operator says "archive task X" or "archive track Y" explicitly.

## Archive a task

1. Move the entire task directory to the track's `_archive/`:
   ```bash
   mv $DESK/<track>/<task> $DESK/<track>/_archive/<task>
   ```

2. Commit the move:
   ```bash
   cd $DESK && git add -A && git commit -m "archive: <task> (done)"
   ```
   For cancelled tasks:
   ```bash
   cd $DESK && git add -A && git commit -m "archive: <task> (cancelled)"
   ```

3. Push if remote is configured.

4. Then proceed to "Archive a track" check below.

## Archive an iteration

The three archive operations (iteration / task / track) nest cleanly:
archive individual iterations as they terminate; archive the whole
task when its final iteration merges and no further iteration is
planned; archive the track when all tasks are terminal. Iteration
archival is a **new operation layered on top** of task/track archival
— it does not replace either.

**When to archive an iteration:**

- The iteration's PR has merged (the iteration's `outcome:` in the
  task card's `iterations.history[]` is `merged` or `shipped-to-pr`
  with a downstream successor iteration), AND
- Another iteration has started on the same task+repo (e.g., a
  `review-pass-1` iteration started after an `initial-impl` merged),
  OR the task is about to be archived as a whole.

Iteration archival is not tied to PR merge alone — short-lived tasks
where the first iteration merges and the task immediately archives
don't need a separate iteration-archive step (the task archive
captures the iteration directory as part of the task).

**How to archive an iteration:**

1. Move the iteration directory into `<repo>/_archive/` as a single
   unit — `planning.md`, `doing.md`, `feedback.md` (if present), and
   `artifacts/` all travel together:
   ```bash
   mv $DESK/<track>/<task>/<repo>/<iteration-slug> \
      $DESK/<track>/<task>/<repo>/_archive/<iteration-slug>
   ```

2. Update the task card's `iterations:` block:
   - Move the archived iteration's entry from `active:` (if it was
     there) or update it in `history[]` so `path:` points at the
     `_archive/` location.
   - Set `outcome:` to the terminal value (`merged`, `shipped-to-pr`,
     `reverted`).

3. Commit:
   ```bash
   cd $DESK && git add -A \
     && git commit -m "archive: iteration <iteration-slug> (<outcome>)"
   ```

4. Push.

Do NOT flatten the iteration contents during archival. The iteration
directory is the atomic unit — a future reader needs `planning.md`,
`doing.md`, `feedback.md`, and `artifacts/` together to reconstruct
what happened. Breaking them apart loses the layered-doc cross-refs
(see `skills/pr-feedback-on-own-pr/SKILL.md` three-doc layered design).

## Archive a track

After archiving any task, check whether the parent track is now fully terminal:

1. List remaining (non-archived) task directories in the track:
   ```bash
   ls -d $DESK/<track>/*/  | grep -v _archive
   ```

2. For each remaining task, read its `task.md` and check the `status` field.

3. If every remaining task is `done` or `cancelled` (OR there are no remaining tasks — all already archived):
   - Move the entire track directory to the top-level `_archive/`:
     ```bash
     mv $DESK/<track> $DESK/_archive/<track>
     ```
   - Commit:
     ```bash
     cd $DESK && git add -A && git commit -m "archive: track <track> (all tasks terminal)"
     ```
   - Push.

4. If at least one task is still non-terminal, leave the track active.

## What gets preserved

The archived directories retain their full structure:
- `track.md` with all metadata
- `task.md` with final status and timestamps (including the full
  `iterations.history[]` block)
- All repo workspace directories, each containing:
  - Active iteration directories (if any) — typically none once the
    task is archived
  - `_archive/` sibling under the repo workspace, holding every
    archived iteration as a whole directory (`planning.md`,
    `doing.md`, `feedback.md`, `artifacts/`)
- Full git history (always available via `git log`)

## Retrieving archived tasks

To review a past task:
```bash
cat $DESK/_archive/<track>/<task>/task.md
```

Or if the track is still active but the task is archived:
```bash
cat $DESK/<track>/_archive/<task>/task.md
```

## The archive is read-only

Do not modify archived tasks. If a cancelled task needs to be restarted, create a new task instead — don't un-archive. The archive is the historical record; resurrecting a directory in place loses the "this was abandoned then restarted" signal that a fresh task preserves.
