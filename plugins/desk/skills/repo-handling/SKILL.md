---
name: repo-handling
description: Find or set up local clones for code repos referenced by a task card. Handles the multi-computer workflow where operators create task cards on one machine and resume on another with different directory layouts. Probes the current working directory, its parent, and common conventions before falling back to a three-option clone/provide/ADO-MCP flow. Also manages machine-local overrides, cross-org MCP routing, large-repo fallbacks, and mcp→local promotion when a previously-remote-only repo turns up locally.
---

# Repo handling

When a task references a code repo, worker needs to know where the code lives locally. Operators routinely move between machines with different layouts (`~/code/` on Mac, `Q:\src\` on Windows, `/repos/` on a Linux dev box) — task cards committed on one machine shouldn't block resume on another. This skill handles the cross-machine reality gracefully.

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
4. **Operator-provided path** (three-option flow)

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
4. **Three-option flow** (see section 4) — operator provides path, clones, or falls back to MCP.

### Absolute path in `local_path` is ALWAYS a bug

If the committed task card's `local_path` is an absolute path (`C:\src\...`, `Q:\src\...`, `/Users/<alias>/...`) — that's a bug. It means a previous session baked one machine's layout into the shared task card, breaking every other machine.

**When you encounter one during a session**:
1. Surface it to the operator: "`task.md` has `local_path: <absolute-path>` — that's specific to one machine and breaks cross-machine portability. Want me to move it to `.machine-local.yml` on this machine and revert `task.md` to tilde form?"
2. On yes: write the absolute path to `.machine-local.yml` for this repo, update `task.md` back to `~/code/<repo-name>` tilde form, commit both changes in worker-workspace with a message like `fix(portability): revert task.md local_path to tilde form; absolute path kept in .machine-local.yml for this machine`.
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

For each candidate, verify it's a git repo whose origin matches the expected ADO repo (same remote check as section 2).

### On success

1. Update the task card's `repos[].local_path` **only if the discovered path matches a portable form** (`~/code/<repo-name>` or similar). If the discovered path is operator-specific (`/Users/<alias>/work/<repo-name>`, `Q:\src\<repo-name>`), prefer writing it to `.machine-local.yml` instead and leave `local_path` as the portable default.
2. Set `mode: local` on the task card if it wasn't already.
3. Commit the task card change.

### mcp→local promotion

If the task card previously had `mode: mcp` for this repo (i.e., the operator on a different machine couldn't clone it), but on this machine the clone is right there — flag it to the operator:

> Heads up: `<repo-name>` is set `mode: mcp` on the task card (probably because it was uncloneable elsewhere). I found a local clone at `<path>`. Want me to promote it to `mode: local` here? If so, the doing docs for this repo may still describe ADO-MCP-only operations; I'll flag them for review.

On yes: update `mode: local`, write the discovered path to `.machine-local.yml` (not the task card — other machines may still need mcp), and mark the doing doc for this repo with a "⚠ local clone available on this machine; consider local git ops where the doc says ADO MCP" note at the top.

---

## 4. Three-option flow (discovery failed)

If nothing resolves, present three options:

```
I can't find a local clone of <repo-name> (<org>/<project>).

Three options:
1. "I have it cloned at <path>" — tell me where it is
2. "Clone it for me" — I'll run git clone (may take a while for large repos)
3. "Just use ADO MCP" — I'll work through the ADO API only (read code, create PRs,
   but no local tests/builds)

Which one?
```

### Option 1: User provides path

1. User gives a local path.
2. Verify it's a git repo with the expected remote.
3. Update task card: `local_path: "<user-provided-path>"`, `mode: local`.
4. Offer to add to `.machine-local.yml` if the path doesn't match the `~/code/` convention (so other machines aren't affected).

### Option 2: Clone for me

1. Get the clone URL via ADO MCP:
   ```
   Use ado_<org> repo tools to get the repo by name; extract the clone URL.
   ```
2. Clone to the machine's preferred root (default `~/code/`, or `defaults.clone_root` from `.machine-local.yml` if set):
   ```bash
   git clone <clone-url> ~/code/<repo-name>
   ```
3. Update task card: `local_path: "~/code/<repo-name>"`, `mode: local`.
4. Warn the operator: this can take a long time for large repos.

### Option 3: ADO MCP only

1. Update task card: `local_path: ""`, `mode: mcp`.
2. All code reading happens through ADO MCP tools (file browsing, search).
3. PR creation happens through ADO MCP tools.
4. Limitations:
   - Cannot run tests locally
   - Cannot run builds locally
   - Cannot use git commands directly
   - Code review and browsing still work

---

## Large repo handling

Some repos are too large to clone practically (for example, repos in the 10s of GB).

For repos you know are large (or when `git clone` takes more than a few minutes):
- **Recommend Option 3 (ADO MCP) as the default.**
- Warn the operator before cloning:
  ```
  <repo-name> is a very large repo (~NNGB). Cloning will take a long time and significant disk space.
  Recommend: use ADO MCP for code reading and PRs. You can always clone later if needed.
  ```
- If the operator insists on cloning, proceed with Option 2 but set a longer timeout.

### Tracking known-large repos

Keep a list in `$DESK/_meta/large-repos.md` per operator, so worker can warn on first encounter without re-discovering the size. Format:

```markdown
| Repo | Approx size | Recommendation |
|------|-------------|----------------|
| <repo-name> | <size> | ADO MCP |
```

---

## Cross-org MCP routing

Each repo in the task card has an `org` field that determines which MCP server handles its operations:

| `repos[].org` | MCP server | Tools prefix |
|----------------|------------|--------------|
| `domoreexp` | `ado_domoreexp` | `mcp__ado_domoreexp__*` |
| `office` | `ado_office` | `mcp__ado_office__*` |

(Default orgs. Keys correspond to whatever MCP-server names are configured in `.github/agents/worker.md`'s `mcp-servers:` block — add more as needed.)

When performing ADO operations on a repo (fetching files, creating PRs, querying builds), always use the MCP server matching the repo's `org` field. This is how a single task can span repos in different ADO organizations without special routing logic.

---

## Fan PR lookups across `repos[]`

Every non-terminal task card declares a `repos[]` array. Session
probes (`session-start`) and status queries (`status`) need to
surface PR state across **every** repo the task touches — not just
the entry whose PR ID is already cached.

For each active task card, iterate every entry in `repos[]` and:

- **ADO repos** (entries whose `org` maps to a configured ADO
  organization): call the PR list REST endpoint
  `GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests?searchCriteria.creatorId={userId}&searchCriteria.status=active&api-version=7.1`
  for each repo, scoped to the current user.
- **GitHub repos** (entries whose `org` is a GitHub organization,
  e.g., `shared-internal-tools`): run
  `gh pr list --repo <org>/<repo-name> --author @me --state open --json number,title,url,isDraft`
  after the `emu-github` account switch has been done.

Cache the returned PR metadata on the task-scan output for downstream
consumers (status skill, session-start skill-routing prompts). Do NOT
update task-card frontmatter on every fan-out — the cached list is
ephemeral per session; only persist to the card when the operator
confirms a new PR is the task's PR.

Fan-out skips silently when a repo is `mode: mcp` without a reachable
REST endpoint (rare); otherwise it's a non-blocking read.

## Repo-knowledge auto-loader

`plugins/worker/repo-knowledge/<repo-name>/*.md` holds repo-specific
guidance that worker loads automatically when an active task
references a repo of that name.

**Loader contract** (prose, not a separate script — this is worker's
file-read behavior during session-start):

1. For each active task's `repos[].name`, check whether the directory
   `plugins/worker/repo-knowledge/<repo-name>/` exists under the
   installed worker plugin.
2. If it exists: load every `.md` file in that directory into
   context. Common filenames: `code-standards.md`, `pipeline-notes.md`,
   `conventions.md`, etc. No fixed schema — each repo's knowledge
   directory is owned by whoever encoded it.
3. If it doesn't exist: **silently no-op.** Do not warn, do not log
   an error, do not prompt the operator. An unknown repo is the
   default state; worker has guidance for a small number of repos
   and general instincts for the rest.

### Namespace is repo-name only

The knowledge directory is keyed by repo `name` (e.g.,
`repo-knowledge/Teams-Graph/`), not `<org>/<repo>`. Collisions across
orgs with identically-named repos are not pre-designed around;
handle at first collision by prepending the org to the directory
name (e.g., `repo-knowledge/domoreexp-Teams-Graph/`) when the
collision actually surfaces. Don't over-engineer ahead of first
collision.

### What goes in repo-knowledge

Only content that is truly specific to that repo and that the worker
would otherwise re-learn on every session — build gotchas, pipeline
IDs, code-review rules specific to the repo's coding style, engineer-
specific conventions. Cross-cutting principles go in
`../principles.md` or the applicable skill; they do NOT belong in
repo-knowledge.

Content must be engine-agnostic (REST API names, not harness MCP
tool names) — repo-knowledge is loaded into every worker session
regardless of the active harness.

## Pre-work hygiene (before work-doer runs)

Before invoking work-doer on a repo, ensure the local state is clean:

1. `cd <repo-local-path>`
2. `git fetch origin`
3. If on a feature branch from prior work: `git rebase origin/main` (or merge, depending on repo convention)
4. If on main: `git pull origin main`
5. Check for uncommitted changes — warn the operator if found, do not silently overwrite.

Skip this if `mode: mcp` (no local clone to manage).
