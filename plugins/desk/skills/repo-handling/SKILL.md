---
name: repo-handling
description: Find or set up local clones for code repos referenced by a task card. Handles the multi-computer workflow where operators create task cards on one machine and resume on another with different directory layouts. Probes the current working directory, its parent, and common conventions before falling back to a two-option clone/provide flow. Also manages machine-local overrides, large-repo fallbacks, and a repo-knowledge auto-loader.
---

# Repo handling

When a task references a code repo, the agent needs to know where the code lives locally. Operators routinely move between machines with different layouts (`~/code/` on Mac, `Q:\src\` on Windows, `/repos/` on a Linux dev box) — task cards committed on one machine shouldn't block resume on another. This skill handles the cross-machine reality gracefully.

> **overlay users**: consumer overlays often ship a richer repo-discovery skill — non-GitHub MCP fallback for the org's work-item tracker, cross-org MCP routing, and per-tracker REST PR fan-out. This skill stays generic.

## When to invoke

- A task card has a `repos[].local_path` of `""` and `mode: local` — clone needs to be located.
- A task card's `local_path` exists in YAML but the directory doesn't resolve on this machine (machine-portability case).
- Operator asks "where's repo X" or "do I have repo Y cloned."
- Setting up a fresh machine that doesn't have any of the operator's usual clones.

## Resolution order

For each repo entry that needs resolving, try in order — stop at the first success:

1. **Machine-local override** (per-machine YAML; see below)
2. **The literal `local_path` in the task card** (tilde-expanded)
3. **Auto-discovery** across PWD, PWD's parent, and common conventions (see below)
4. **Operator-provided path** (two-option flow)

When steps 1–3 all fail, that's a genuine "I don't know where this is" — fall through to step 4. When steps 2 or 3 succeed with a path different from what's on the task card, propose adding it to `.machine-local.yml` so future sessions on this machine skip the discovery.

---

## 1. Machine-local override

**This is THE workaround for per-machine drive/layout differences.** Operators routinely have different preferred drives across machines: `~/code/` on personal Mac, `~/src/` on Linux, `Q:\src\` or `C:\src\` on Windows. The committed task card's `local_path` is the portable default (tilde form) — `.machine-local.yml` is the per-machine escape hatch.

**Convention**: A git-ignored file at `$DESK/.machine-local.yml` lets a given machine override `local_path` per repo without touching the committed task card. Each machine maintains its own copy (file is gitignored precisely because it's machine-specific).

### Schema

```yaml
# $DESK/.machine-local.yml — per-machine, gitignored
repos:
  OrderService: /Users/<alias>/work/OrderService
  OrderUI: ~/dev/OrderUI
  OrderAdminPortal-Fork: ~/projects/OrderAdminPortal-Fork  # alias for OrderAdminPortal repo
defaults:
  clone_root: ~/code   # where new clones go on this machine (default: ~/code)
```

### Resolution

When resolving a repo entry, the effective path is determined IN THIS ORDER — stop at the first hit:

1. **`.machine-local.yml`** → use that path (after tilde expansion). Hostname-scoped only if the file has a hostname section; otherwise the file applies to the current machine.
2. **Task card `local_path`** → tilde-expand and check if it resolves to a git repo with the expected remote.
3. **Auto-discovery** (see section 3 below) — PWD first, then common conventions.
4. **Two-option flow** (see section 4) — operator provides path or worker clones.

### Absolute path in `local_path` is ALWAYS a bug

If the committed task card's `local_path` is an absolute path (`C:\src\...`, `Q:\src\...`, `/Users/<alias>/...`) — that's a bug. It means a previous session baked one machine's layout into the shared task card, breaking every other machine.

**When you encounter one during a session**:
1. Surface it to the operator: "`task.md` has `local_path: <absolute-path>` — that's specific to one machine and breaks cross-machine portability. Want me to move it to `.machine-local.yml` on this machine and revert `task.md` to tilde form?"
2. On yes: write the absolute path to `.machine-local.yml` for this repo, update `task.md` back to `~/code/<repo-name>` tilde form, commit both changes in the desk workspace with a message like `fix(portability): revert task.md local_path to tilde form; absolute path kept in .machine-local.yml for this machine`.
3. Push.

The rule: **committed `local_path` is always tilde form. Absolute paths go in `.machine-local.yml`.** No exceptions.

### Setup

If the file doesn't exist, do nothing — the convention is opt-in. If the operator hits the "different path on different machines" problem, propose creating the file:

```
I notice your task card says ~/code/<repo-name>, but the path doesn't exist on this machine.
On this machine you have it at /Users/<alias>/work/<repo-name>. Want me to add a machine-local
override at $DESK/.machine-local.yml so I'll find it here without changing the
committed task card? (y/n)
```

### Why git-ignored

The override is per-machine. Committing it would defeat the purpose. Add `.machine-local.yml` to `$DESK/.gitignore` if it doesn't already include it.

---

## 2. Task card local_path

Use the value as-is, expanding `~` to `$HOME`. If the path resolves to a git repo with the expected remote, you're done. If not, fall through to auto-discovery.

**Verify the remote matches** before trusting the path:
```bash
git -C <path> remote get-url origin 2>/dev/null | grep -qiE "<org>.*<repo-name>|<repo-name>.*<org>"
```

A path that exists but points at a different repo is a fail — don't use it.

---

## 3. Auto-discovery

Probe candidates in this order, stopping at the first match:

1. **Current working directory** (`$PWD/<repo-name>`). Operators often run worker from the directory that contains their clones — don't miss the obvious.
2. **PWD's parent and grandparent** (`$PWD/../<repo-name>`, `$PWD/../../<repo-name>`). Covers the case where worker is invoked from inside one repo and needs to find its sibling (e.g., running from `~/code/service-a` and needing `~/code/service-b`).
3. **Common home-directory conventions**:
   - `~/code/<repo-name>`
   - `~/repos/<repo-name>`
   - `~/src/<repo-name>`
   - `~/dev/<repo-name>`
   - `~/<repo-name>`
4. **Common Windows dev-machine roots** (when running on Windows): `C:\src\<repo-name>`, `Q:\src\<repo-name>`. Windows dev machines often prefer a drive-rooted `src` dir over a home-directory root, so a clone present on the box won't be found by the POSIX conventions above.

For each candidate, verify it's a git repo whose origin matches the expected upstream repo (same remote check as section 2).

### Match on the remote, not the directory name

The candidates above all assume the local directory is named `<repo-name>`. That assumption breaks when an operator keeps a clone under a different name — most commonly **two clones of one upstream** under distinct names (e.g. one per long-lived branch) so parallel work doesn't thrash a single working tree. A card authored against one clone's name then can't find the sibling even though it's sitting in a conventional root.

So before falling back to asking the operator: for each conventional root above, scan its immediate children for **any** directory whose `git -C <dir> remote get-url origin` matches the target's upstream (by org + repo, the same remote check as section 2), not just the one named `<repo-name>`. A rename or a parallel-clone layout still resolves. Only after the remote-match scan comes up empty is the clone genuinely absent — then offer the two-option flow below.

### On success

1. Update the task card's `repos[].local_path` **only if the discovered path matches a portable form** (`~/code/<repo-name>` or similar). If the discovered path is operator-specific (`/Users/<alias>/work/<repo-name>`, `Q:\src\<repo-name>`), prefer writing it to `.machine-local.yml` instead and leave `local_path` as the portable default.
2. Set `mode: local` on the task card if it wasn't already.
3. Commit the task card change.

---

## 4. Two-option flow (discovery failed)

If nothing resolves, present two options:

```
I can't find a local clone of <repo-name> (<org>/<repo>).

Two options:
1. "I have it cloned at <path>" — tell me where it is
2. "Clone it for me" — I'll run git clone (may take a while for large repos)

Which one?
```

(overlay users may have a third option — work via the org's tracker MCP only — when the consumer overlay provides remote-tracker fallback.)

### Option 1: User provides path

1. User gives a local path.
2. Verify it's a git repo with the expected remote.
3. Update task card: `local_path: "<user-provided-path>"`, `mode: local`.
4. Offer to add to `.machine-local.yml` if the path doesn't match the `~/code/` convention (so other machines aren't affected).

### Option 2: Clone for me

1. Obtain the clone URL (from the task card, the hosting platform UI, or operator input).
2. Clone to the machine's preferred root (default `~/code/`, or `defaults.clone_root` from `.machine-local.yml` if set):
   ```bash
   git clone <clone-url> ~/code/<repo-name>
   ```
3. Update task card: `local_path: "~/code/<repo-name>"`, `mode: local`.
4. Warn the operator: this can take a long time for large repos.

---

## Large repo handling

Some repos are too large to clone practically (for example, repos in the 10s of GB).

For repos you know are large (or when `git clone` takes more than a few minutes):
- **Warn the operator before cloning** and consider whether a remote-only workflow is viable (overlay users may have a remote-tracker MCP fallback via their consumer overlay).
  ```
  <repo-name> is a very large repo (~NNGB). Cloning will take a long time and significant disk space.
  ```
- If the operator confirms, proceed with Option 2 but set a longer timeout.

### Tracking known-large repos

Keep a list in `$DESK/_meta/large-repos.md` per operator, so worker can warn on first encounter without re-discovering the size. Format:

```markdown
| Repo | Approx size | Recommendation |
|------|-------------|----------------|
| <repo-name> | <size> | remote-only / skip-clone |
```

---

## Fan PR lookups across `repos[]`

Every non-terminal task card declares a `repos[]` array. Session
probes (`session-start`) and status queries (`status`) need to
surface PR state across **every** repo the task touches — not just
the entry whose PR ID is already cached.

For each active task card, iterate every entry in `repos[]` and run
the appropriate hosting-platform PR list call scoped to the current
user. For GitHub repos:

```bash
gh pr list --repo <org>/<repo-name> --author @me --state open --json number,title,url,isDraft
```

(overlay users: non-GitHub work-item trackers use their own REST
endpoints instead — consumer overlays extend this fan-out.)

Cache the returned PR metadata on the task-scan output for downstream
consumers (status skill, session-start skill-routing prompts). Do NOT
update task-card frontmatter on every fan-out — the cached list is
ephemeral per session; only persist to the card when the operator
confirms a new PR is the task's PR.

## Repo-knowledge auto-loader

`<plugin>/repo-knowledge/<repo-name>/*.md` holds repo-specific
guidance that the agent loads automatically when an active task
references a repo of that name.

**Loader contract** (prose, not a separate script — this is the
agent's file-read behavior during session-start):

1. For each active task's `repos[].name`, check whether the directory
   `<plugin>/repo-knowledge/<repo-name>/` exists.
2. If it exists: load every `.md` file in that directory into
   context. Common filenames: `code-standards.md`, `pipeline-notes.md`,
   `conventions.md`, etc. No fixed schema — each repo's knowledge
   directory is owned by whoever encoded it.
3. If it doesn't exist: **silently no-op.** Do not warn, do not log
   an error, do not prompt the operator. An unknown repo is the
   default state; the agent has guidance for a small number of repos
   and general instincts for the rest.

### Namespace is repo-name only

The knowledge directory is keyed by repo `name` (e.g.,
`repo-knowledge/OrderService/`), not `<org>/<repo>`. Collisions across
orgs with identically-named repos are not pre-designed around;
handle at first collision by prepending the org to the directory
name (e.g., `repo-knowledge/acme-OrderService/`) when the
collision actually surfaces. Don't over-engineer ahead of first
collision.

### What goes in repo-knowledge

Only content that is truly specific to that repo and that the agent
would otherwise re-learn on every session — build gotchas, pipeline
IDs, code-review rules specific to the repo's coding style, engineer-
specific conventions. Cross-cutting principles go in
`../principles.md` or the applicable skill; they do NOT belong in
repo-knowledge.

Content must be engine-agnostic (REST API names, not harness MCP
tool names) — repo-knowledge is loaded into every session
regardless of the active harness.

## Pre-work hygiene (before work-doer runs)

Before invoking work-doer on a repo, ensure the local state is clean:

1. `cd <repo-local-path>`
2. `git fetch origin`
3. If on a feature branch from prior work: `git rebase origin/main` (or merge, depending on repo convention)
4. If on main: `git pull origin main`
5. Check for uncommitted changes — warn the operator if found, do not silently overwrite.

Skip this if the repo has no local clone to manage.
