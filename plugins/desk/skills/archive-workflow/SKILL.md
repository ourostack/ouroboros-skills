---
name: archive-workflow
description: Move terminal-state tasks (and fully-terminal tracks) into _archive/ directories to keep the active workspace readable while preserving history. Use when a task transitions to `done` or `cancelled`, or when checking whether a track's tasks are all terminal so the track itself can be archived.
---

# Archive workflow

when a task is done — merged or set aside — i slide it toward the back of the room. the desk in front of me stays uncluttered; the work itself is still mine, still browsable, still searchable. archive isn't exile. it's the past shelves: the things i finished, sorted out of the way so today's work has room to breathe.

## When to invoke

- a task just transitioned to `done` (PR merged) or `cancelled` (operator abandoned).
- after archiving a task, i check whether the parent track is now fully terminal (all tasks `done` or `cancelled` or already archived).
- operator says "archive task X" or "archive track Y" explicitly.

## Archive a task

1. move the entire task directory to the track's `_archive/`:
   ```bash
   mv $DESK/<track>/<task> $DESK/<track>/_archive/<task>
   ```

2. commit the move:
   ```bash
   cd $DESK && git add -A && git commit -m "archive: <task> (done)"
   ```
   for cancelled tasks:
   ```bash
   cd $DESK && git add -A && git commit -m "archive: <task> (cancelled)"
   ```

3. push if remote is configured.

4. then proceed to "Archive a track" check below.

## Archive an iteration

the three archive operations (iteration / task / track) nest cleanly:
archive individual iterations as they terminate; archive the whole
task when its final iteration merges and no further iteration is
planned; archive the track when all tasks are terminal. iteration
archival is a **new operation layered on top** of task/track archival
— it does not replace either.

**when to archive an iteration:**

- the iteration's PR has merged (the iteration's `outcome:` in the
  task card's `iterations.history[]` is `merged` or `shipped-to-pr`
  with a downstream successor iteration), AND
- another iteration has started on the same task+repo (e.g., a
  `review-pass-1` iteration started after an `initial-impl` merged),
  OR the task is about to be archived as a whole.

iteration archival is not tied to PR merge alone — short-lived tasks
where the first iteration merges and the task immediately archives
don't need a separate iteration-archive step (the task archive
captures the iteration directory as part of the task).

**how to archive an iteration:**

1. move the iteration directory into `<repo>/_archive/` as a single
   unit — `planning.md`, `doing.md`, `feedback.md` (if present), and
   `artifacts/` all travel together:
   ```bash
   mv $DESK/<track>/<task>/<repo>/<iteration-slug> \
      $DESK/<track>/<task>/<repo>/_archive/<iteration-slug>
   ```

2. update the task card's `iterations:` block:
   - move the archived iteration's entry from `active:` (if it was
     there) or update it in `history[]` so `path:` points at the
     `_archive/` location.
   - set `outcome:` to the terminal value (`merged`, `shipped-to-pr`,
     `reverted`).

3. commit:
   ```bash
   cd $DESK && git add -A \
     && git commit -m "archive: iteration <iteration-slug> (<outcome>)"
   ```

4. push.

do NOT flatten the iteration contents during archival. the iteration
directory is the atomic unit — a future reader needs `planning.md`,
`doing.md`, `feedback.md`, and `artifacts/` together to reconstruct
what happened. breaking them apart loses the layered-doc cross-refs
(see `skills/pr-feedback-on-own-pr/SKILL.md` three-doc layered design).

## Archive a track

after archiving any task, i check whether the parent track — the whole drawer — is now fully terminal:

1. list remaining (non-archived) task directories in the track:
   ```bash
   ls -d $DESK/<track>/*/  | grep -v _archive
   ```

2. for each remaining task, read its `task.md` and check the `status` field.

3. if every remaining task is `done` or `cancelled` (OR there are no remaining tasks — all already archived):
   - move the entire track directory to the top-level `_archive/`:
     ```bash
     mv $DESK/<track> $DESK/_archive/<track>
     ```
   - commit:
     ```bash
     cd $DESK && git add -A && git commit -m "archive: track <track> (all tasks terminal)"
     ```
   - push.

4. if at least one task is still non-terminal, leave the track active.

## What gets preserved

archived directories travel intact. nothing is flattened, nothing is summarized:

- `track.md` with all metadata
- `task.md` with final status and timestamps (including the full
  `iterations.history[]` block)
- all repo workspace directories, each containing:
  - active iteration directories (if any) — typically none once the
    task is archived
  - `_archive/` sibling under the repo workspace, holding every
    archived iteration as a whole directory (`planning.md`,
    `doing.md`, `feedback.md`, `artifacts/`)
- full git history (always available via `git log`)

## Retrieving archived tasks

to look something up from the back of the room:
```bash
cat $DESK/_archive/<track>/<task>/task.md
```

or if the track is still active but the task is archived:
```bash
cat $DESK/<track>/_archive/<task>/task.md
```

search reaches every surface — the active desk and the back-of-the-room shelves both. nothing falls off the index when it gets archived.

## The archive is read-only

don't modify archived tasks. if a cancelled task needs to be restarted, create a new task instead — don't un-archive. the archive is the historical record; resurrecting a directory in place loses the "this was abandoned then restarted" signal that a fresh task preserves.
