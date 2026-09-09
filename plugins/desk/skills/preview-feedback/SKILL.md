---
name: preview-feedback
description: Capture, inspect, correct, delete, or explicitly share a participant's qualitative feedback about an installed engineering preview. Use only for preview feedback, not ordinary task discussion, code review, telemetry, or automatic friction logging. Requires Desk MCP.
---

# Preview feedback

Use the existing `desk_feedback` MCP operation. The participant owns the words and the sharing decision. This is explicit capture, not a background assessment of the person or their work.

## Keep it private by default

Capture only when the participant explicitly asks to save preview feedback. A complaint, a reviewer comment, or an observation during normal work is not consent to store it. If they are only discussing the preview, respond to the substance without creating a record.

Keep their meaning and distinguish their own words from an agent-proposed summary. If a summary is needed, show it for confirmation before capture. Never add inferred effort, productivity, competence, or performance measurements. Do not attach logs, task contents, credentials, or unrelated conversation context.

Never fall back to `friction_add`, a lesson, a task card, a file in the desk, or another storage mechanism if protected feedback is unavailable. Report the actual failure; an unprotected or Git-synced substitute is not private feedback.

## Use the existing API

| Intent | Call |
| --- | --- |
| Save explicit feedback | `{"action":"capture","text":"the participant's feedback"}` |
| Inspect a page | `{"action":"list","limit":20,"offset":0}` |
| Correct a record | `{"action":"correct","entry_id":"id","expected_revision":1,"text":"confirmed replacement"}` |
| Delete a record | `{"action":"delete","entry_id":"id"}` |

`task_ref` is an optional short pointer on capture, not an invitation to copy the task. Text is limited to 4,000 characters. Capture records the installed Desk preview version; do not supply or invent a version.

Use `next_offset` to inspect additional pages when requested. Pages are live views, not a frozen export; do not describe a partial page as the complete store. Identify the intended entry before correcting or deleting it. Use the revision just read for a correction; if it changed, reread and reconcile instead of blindly retrying. Successful calls return an entry or deletion ID; errors do not mean the requested change happened.

The store is bound to the current resolved desk and person. No argument selects another participant or location. Do not bypass that binding by opening the database directly.

## Sharing is a separate decision

Before any identifiable sharing, show the exact excerpt and exact destination, explain who can read it and whether it enters Git history, and obtain visible confirmation for that pair. A request to keep a note private, an earlier general work mandate, or "we should share this later" does not authorize publication.

If Git publication is requested, use only the participant's own desk and its established contribution path. Keep the publication attributed to that participant. Do not write to another person's desk, a shared decisions directory, an issue, a channel, or a collector merely because the tool can reach it.

Withdrawal from Git is a participant-authored tombstone, not history rewriting or an erasure promise. Explain that history, search artifacts, and copies may retain the original. Changing or deleting the private record does not silently update a previously shared copy.

## Explain the real boundary

The local store is separate from desk search, embeddings, snapshots, and Git. It makes no network requests and is not encrypted or cross-device synced. The conversation and its provider retention are separate; "private store" does not mean the conversation never left the machine.

Deletion removes the stored row and its text from the current SQLite file, not OS backups, snapshots, conversation history, or copies already shared. Do not claim anonymity, physical erasure, or regulatory compliance.

For a requested minimal runtime diagnostic, use `desk_doctor` with `{"format":"preview"}`. That separate allowlisted package/process snapshot reads no feedback or task records and has no collector. Do not attach even that snapshot to a share without the participant's confirmation.
