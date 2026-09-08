# Private qualitative feedback (`desk_feedback`)

`desk_feedback` holds a participant's own words about the preview build they are running. It exists so someone trying a preview can say what they think, keep it, correct it, and delete it, without that opinion becoming a measurement of them or a commit in a shared repository.

## What it is not

- **Not telemetry.** The storage tool has no background collector or network operation and records no flow, effort, duration, cost, or performance figure. An entry exists because the participant asked for it in an explicit `capture` call. Feedback typed into or read back through the agent remains part of the host/model conversation and follows that system's retention rules.
- **Not Git-durable friction.** Friction notes (`friction_add`) are written into the desk workspace, which is a Git checkout that syncs to a remote. Private feedback deliberately never lands there.
- **Not part of the search index.** The desk index (`.state/desk-index.sqlite`) is a rebuildable derivative that gets dropped and rebuilt, and it feeds `desk_search`, `desk_recall`, and embeddings. Private feedback is a separate store and is never indexed, embedded, or snapshotted.

## Storage and permission contract

| Property | Value |
| --- | --- |
| Location | `$XDG_STATE_HOME/ouroboros-skills/desk/feedback/<partition>/feedback.sqlite`, defaulting to `~/.local/state/...` when `XDG_STATE_HOME` is unset or blank |
| Partition | First 32 hex characters of SHA-256 over the JSON object containing resolved `desk_root` and `person`, derived from the session binding |
| POSIX directory modes | `0700` on every directory the store owns; a loosened directory is tightened on the next open |
| POSIX file mode | `0600` on the SQLite file |
| macOS extended ACLs | Removed from the store-owned directories and DB, with native read-back before SQLite opens; the enclosing state home is not reconfigured |
| Windows DACLs | Protected from inherited rules, with exactly one Allow FullControl rule for the current user SID; directory rules inherit to children; native ownership and rules are read back |
| Engine | `better-sqlite3` (the dependency the package already carries), with `journal_mode = DELETE` and `secure_delete = ON` |

The partition is derived, never supplied. Tool input cannot name another participant, another namespace, or another storage file: there is no path, alias, database, or namespace field in the schema, and unknown fields are rejected. A session reads and writes exactly one partition — its own — so there is no cross-desk or cross-person browsing.

The store refuses to open, rather than degrading quietly, when:

- the resolved store path would fall inside the desk workspace;
- the state home or any directory above it contains a `.git` entry (point `XDG_STATE_HOME` at a directory that is not under version control);
- any directory in the store path is a symlink or is not a directory;
- the SQLite file is a symlink, is not a database, or cannot be opened;
- a path cannot be inspected because of permissions.

### Platform boundary

Linux uses owner-only POSIX modes. On macOS, extended ACL grants can survive `chmod 0700/0600`, so the tool also clears ACLs on its own paths with the system `chmod -N` and verifies the result through the native ACL listing. It leaves the enclosing state home unchanged.

Windows uses the built-in Windows PowerShell/.NET ACL provider under `%SystemRoot%`, not a PATH-selected replacement or a POSIX-mode claim. The fixed program receives paths as UTF-8 JSON data. It rejects reparse points and existing objects owned by another identity; a newly created object with default Administrators-group ownership may be assigned to its actual creator SID. It applies and reads back the protected owner-only DACL before SQLite opens.

An unavailable provider is rejected before state creation. Any failed or incomplete protection stops the tool without writing feedback or falling back to an unprotected store. There is no policy bypass, elevation, dependency installation, or host-permission configuration change. Failures are scoped to `desk_feedback`; the other Desk tools remain routable.

Adapter tests and repacked Windows binaries do not qualify NTFS behavior. The native Windows CI job exercises real directory/file DACLs, Unicode paths, junction rejection, foreign-owner rejection and new-object owner reassignment, feedback CRUD, and the actual offline source mirror. Native macOS tests separately cover inherited and later-added ACL grants.

## API

One tool, one `action` per call. Unknown actions and unknown fields are errors, never ignored.

```jsonc
{ "action": "capture", "text": "…", "task_ref": "optional/pointer" }
{ "action": "list",    "limit": 20, "offset": 0 }
{ "action": "correct", "entry_id": "…", "expected_revision": 2, "text": "…" }
{ "action": "delete",  "entry_id": "…" }
```

Returns:

- `capture` → `{ status: "captured", entry }`
- `list` → `{ status: "ok", entries, count, total, limit, offset, next_offset }`
- `correct` → `{ status: "corrected", entry }`
- `delete` → `{ status: "deleted", entry_id }`

An entry is `{ entry_id, preview_version, text, task_ref, revision, captured_at, updated_at }`. `preview_version` is the installed Desk plugin version, not the independently versioned MCP component. It identifies the declared preview release; it is not an independently measured fingerprint of every active plugin.

Bounds: `text` is trimmed and capped at 4000 JavaScript string units, `task_ref` at 200, `limit` is an integer from 1 to 100 (default 20), and `offset` is a non-negative safe integer (default 0). Follow `next_offset` until it is null to inspect older entries. Each page and its `total` are read in one SQLite transaction; separate pages are live reads, not a frozen export.

### Corrections are conditional

`correct` requires `expected_revision` — the revision the caller last read. A correction written against a stale read fails with the current revision rather than overwriting an edit it never saw, so two concurrent corrections cannot silently lose one of them. A `correct` or `delete` against an unknown `entry_id` is an error, not a quiet success.

## What deletion does and does not mean

`delete` removes the row. There is no soft-delete column, no tombstone, and no retained copy of the text: with `secure_delete = ON` SQLite overwrites the freed pages, and `journal_mode = DELETE` keeps the words out of a write-ahead sidecar. After a delete, reopening the store does not return the text.

That boundary ends at this file. Deletion here does **not** reach:

- backups, snapshots, or disk images taken by the operating system or any backup tool;
- copies the participant already shared — a message, a pasted quotation, or a summary already written to a desk;
- the conversation transcript the feedback was typed into.

The store is not encrypted and does not sync across devices. It uses operating-system access controls on one machine. It does not isolate agents running as the same operating-system user or prevent privileged administrators from accessing the file. Those limits must not be described as anonymity or regulatory compliance.

## Sharing is not a hidden action

There is no share, export, publish, or sync action, and no branch of any action writes outside the private store. Reads return to the caller that asked.

Handing feedback to a desk is therefore a separate, visible step owned by the participant's agent: it shows the exact content and the exact destination, the participant confirms, and only then is an attributed summary written to that participant's own desk. Because a desk is a Git checkout, withdrawal after that point is a tombstone, not an erasure — history keeps what was pushed. Say that plainly when offering to share.
