---
name: session-start
description: Worker's session-start checklist. Invoke as the FIRST thing in every worker session — probes prerequisites (gh binary + version floor + auth state, jq, Windows PATH gotchas), syncs the worker-workspace repo, scans for active tasks, and emits a one-screen status block. Hard-stops on prereq failures; does NOT silently fall through to local-only operation. If `$DESK/` doesn't exist, hands off to `first-run-bootstrap`. If the operator picks a task to resume, hands off to `session-resumption`.
---

# Session start

Run this as the first thing in every worker session. It establishes trust that prereqs are met, task state is synced, and the operator knows what's in flight. The prereq probe has teeth — a failure is a hard stop, not a hint to route around.

## Step 1 — Prerequisite probe

Seven checks. Any failure surfaces the specific remediation to the operator and **waits** — don't proceed to step 2, and don't fall back to a local-only mode. A session with broken auth is not "offline mode"; it's "not-yet-ready."

### 1a. `gh` binary present

```bash
gh --version
```

Missing → install command per OS:
- macOS: `brew install gh`
- Windows: `winget install --id GitHub.cli` (or see 1d below if winget is also missing)
- Linux: [cli.github.com](https://cli.github.com/) for distro packages

### 1b. `gh` version floor — 2.40 or newer

`gh auth switch -u <user>` (which the `emu-github` skill chains before every GitHub write) was added in gh 2.40 (Dec 2023). Older gh errors with `unknown shorthand flag: 'u' in -u` and the rest of the chained command **never runs** — which is dangerous: if the operator has both accounts cached and the default is the personal one, a push could leak under the personal identity because the switch silently failed.

```bash
gh --version | head -1 | awk '{print $3}'
# Parse: major.minor.patch. Require major > 2 OR (major == 2 AND minor >= 40).
```

Below 2.40 → surface the version and recommend `winget upgrade GitHub.cli` / `brew upgrade gh` / `sudo apt update && sudo apt upgrade gh`. Hard-stop; do not proceed.

### 1c. `jq` present

```bash
jq --version
```

Missing → `brew install jq`, `winget install jqlang.jq`, `sudo apt install jq`. Hard-stop — several skills use `jq` for JSON parsing.

### 1d. Windows winget diagnostic (only if `winget` itself is missing)

Fresh Microsoft VM images built from a `vmadmin`-templated base often leave the current user's `WindowsApps` off their PATH, so `winget.exe` is installed but not reachable by name. Don't recommend "reinstall winget" — that's a dead end. Diagnose instead:

```powershell
Get-AppxPackage Microsoft.DesktopAppInstaller
Test-Path "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
$env:Path -split ';' | Select-String WindowsApps
```

If the `Test-Path` returns `True` but PATH doesn't contain `$env:LOCALAPPDATA\Microsoft\WindowsApps`, the fix is:
1. Short-term: invoke winget by absolute path — `& "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" install jqlang.jq`
2. Durable: append `%LOCALAPPDATA%\Microsoft\WindowsApps` to the user PATH via `setx PATH "$env:Path;$env:LOCALAPPDATA\Microsoft\WindowsApps"` or the System Properties GUI.

Surface both and let the operator pick.

### 1e. `gh auth status` — auth is actually working

```bash
gh auth status
```

Not just "the EMU account appears" — also check the output for `The github.com token in oauth_token is no longer valid` or similar staleness signals. A cached-but-expired token fails every subsequent gh call with a confusing 401/403 that masquerades as a permissions problem. **Hard-stop on stale token**. Walk the operator through `gh auth login --hostname github.com` (Microsoft SSO flow) before proceeding.

### 1f. EMU identity resolves

```bash
gh auth switch -u <alias>_microsoft && gh api user -q .login
```

Output must equal `<alias>_microsoft`. `<alias>` is derived from `git config --global user.email` (strip `@microsoft.com`). See the `emu-github` skill for the full EMU ruleset.

If 1b failed (old gh without `auth switch`), skip to the fallback pattern in `emu-github` (GH_TOKEN env var) — but flag to the operator that this is a workaround and gh should be upgraded.

### 1g. ADO REST staleness probe

When ADO REST endpoints (or `Invoke-RestMethod` / equivalent) return
all-empty objects with no exception, suspect token staleness. The
ADO surface responds to an expired or rotated bearer token with an
HTTP 302 redirect to the sign-in page; redirect-following clients
(notably PowerShell `Invoke-RestMethod`) parse the resulting HTML as
empty JSON and return a shape with every field blank — no thrown
exception, no obvious error.

The trap: trusting the empty result. "The PR has no description" —
no, the auth is broken; the PR is fine.

Verify with raw curl + `head -c`:

```bash
curl -s -H "Authorization: Bearer $(az account get-access-token --resource '499b84ac-1321-427f-aa17-267ca6975798' --query accessToken -o tsv)" "https://dev.azure.com/<org>/_apis/projects?api-version=7.1" | head -c 50
```

The GUID `499b84ac-1321-427f-aa17-267ca6975798` is the ADO resource
ID and is generic across orgs.

- Output starts with `{"count"` → token is fine.
- Output starts with `<html` / `<!DOCTYPE` or contains
  `Object moved to` → the token is being rejected and the call is
  being silently redirected to the sign-in page.

Fix: the operator runs `az login` (or
`az login --tenant <tenantId>`); worker re-fetches the token via
`az account get-access-token`; retry the call. If conditional
access blocks an interactive flow, escalate to the operator.

Fallback diagnostic: `az repos pr show <id>` returns a clear error
in this state (`Before you can run Azure DevOps commands, you need
to run the login command`) — useful when the calling client is one
that masks the redirect, since the CLI surfaces the auth issue
explicitly.

This probe is also a session-resumption signal — when any ADO REST
call mid-session returns all-empty objects, run the curl check
before retrying or diagnosing further.

## Step 2 — worker-workspace sync

If `$DESK/` doesn't exist → hand off to the `first-run-bootstrap` skill (which has its own gh-auth hard-gate; never proceed to bootstrap if step 1 is still red).

If it exists:
```bash
cd $DESK && git pull --rebase origin main
```
If the pull fails (conflict, no remote), warn the operator but proceed — don't block.

## Step 3 — Scan for active tasks

Glob `$DESK/**/task.md` excluding `_archive/`. Parse each card's YAML frontmatter. Filter to non-terminal status (NOT `done`, NOT `cancelled`). Group by track, sort by `updated` descending.

## Step 4 — Scan code repos

For each active task card's `mode: local` repo, run `git fetch origin` and note current branch + dirty state. Don't block on this — it just informs the status output.

## Step 4.5 — Fan PR lookups across every `repos[]` on every non-terminal task

For every non-terminal task card, iterate every entry in `repos[]` —
not just the entry whose PR ID is already cached in the task's
frontmatter. A task that declares `OrderService` + `OrderUI` in
`repos[]` may have an active PR on either; session-start must surface
both.

Fan-out is engine-agnostic. Use the ADO REST API for each repo's PRs
and `gh` for GitHub repos:

- **ADO repos** (repo entries with `org` matching a configured ADO
  organization): `GET /{org}/{project}/_apis/git/repositories/{repoId}/pullRequests?searchCriteria.creatorId={userId}&searchCriteria.status=active&api-version=7.1`
  — returns the current user's active PRs on that repo.
- **GitHub repos**: `gh pr list --repo <org>/<repo> --author @me --state open --json number,title,url,isDraft`
  — with the `emu-github`-switched account active so the listing
  reflects the operator's EMU identity.

For each PR surfaced:
- If the PR has unresolved (Active) review threads from humans or the
  PR-Assistant AI reviewer → flag for the pr-feedback-on-own-pr routing prompt
  in step 5.
- Cache PR metadata in the task-scan output so step 5 can render it
  without a re-fetch.

Skip the fan-out silently for `mode: mcp` repos without a local
clone — the lookup still succeeds via ADO REST; just note the repo in
the fan-out log so the operator sees the coverage.

## Step 4.6 — Friction-backlog scan

While scanning active tracks, count the open `_friction/*.md` entries
(exclude `_friction/_archive/`). If the count is non-zero on any
active track, flag for the curator routing prompt in step 5.

## Step 4.7 — Workspace MCP link check (auto-create, platform-aware)

Workspace-level MCPs live in `$DESK/agency.toml`.
Agency's config layering walks UP the directory tree from CWD and
follows symlinks (and reads hardlinks transparently); a link at
`$HOME/agency.toml` → `$DESK/agency.toml` lets every
`agency claude -a worker:worker` launch (from anywhere under `$HOME`)
auto-load workspace MCPs without the operator passing `--mcp-config`.
See the README's "Workspace MCPs" section for the full convention.

This step **creates the link for the operator** if conditions are
right — using the platform's strongest-available link primitive — and
announces what it did. Operator effort: zero on macOS/Linux, zero on
Windows post-Developer-Mode-or-NTFS, zero in 99% of practical cases.

### Link-type strategy by platform

POSIX (macOS, Linux, WSL): **symlink** via `ln -sf`. Same-volume
constraint doesn't apply; symlinks just work.

Windows native (MINGW / MSYS / CYGWIN-style shells against NTFS): try
in order, taking the first that succeeds:

  1. **Symbolic link** via `New-Item -ItemType SymbolicLink`. Works
     when the operator has Developer Mode enabled (Settings → For
     developers → Developer Mode) OR is running elevated. Silently
     fails otherwise — the next attempt picks up.
  2. **Hard link** via `New-Item -ItemType HardLink`. Works
     unconditionally on NTFS for files on the same volume (which is
     the typical $HOME case on Windows). No elevation needed. Hard
     links share an inode — edits to either path show on the other.
     Only catches: cross-volume placements break it (rare for
     `$HOME` ↔ `$DESK`), and a non-in-place atomic
     replace on the workspace file (unusual — `add-workspace-mcp`
     edits in place) would break the link.
  3. **Plain copy** via `cp -f`. Fallback when neither link primitive
     succeeds. The two files become decoupled — surface a friction
     entry so operator knows their next workspace edit needs a
     manual re-sync.

The decision tree below uses `link` as a generic verb covering all
three platform-strongest primitives.

### Decision tree (run in order; first match wins)

1. **`$DESK/agency.toml` does NOT exist** → no-op
   silently. Either it's a first-run case (handled by
   `first-run-bootstrap`) or the operator hasn't created the file
   yet. No link to make.

2. **`$HOME/agency.toml` does NOT exist** → attempt to create the
   link using platform-strongest primitive:

   ```bash
   if uname -s 2>/dev/null | grep -qiE '^(MINGW|MSYS|CYGWIN)' ; then
     # Windows: symlink → hardlink → copy
     powershell.exe -NoProfile -Command \
       "New-Item -ItemType SymbolicLink -Path '$HOME\agency.toml' -Target '$HOME\worker-workspace\agency.toml' -ErrorAction Stop" \
       2>/dev/null \
     || powershell.exe -NoProfile -Command \
          "New-Item -ItemType HardLink -Path '$HOME\agency.toml' -Target '$HOME\worker-workspace\agency.toml' -ErrorAction Stop" \
          2>/dev/null \
     || cp -f "$DESK/agency.toml" "$HOME/agency.toml"
   else
     # POSIX
     ln -sf "$DESK/agency.toml" "$HOME/agency.toml"
   fi
   ```

   Then **verify** by content + linkage check:
   ```bash
   # Same content (sanity)
   diff "$HOME/agency.toml" "$DESK/agency.toml" >/dev/null \
     && link_kind=$(detect_link_kind "$HOME/agency.toml")
   # detect_link_kind emits "symlink" | "hardlink" | "copy" | "missing"
   ```

   On verified link/hardlink, announce in the Step 5 status block
   (mentioning the link kind so the operator knows whether edits
   propagate):
   > `🔗 Created ~/agency.toml as <symlink|hardlink> → $DESK/agency.toml. Workspace MCPs will auto-load on your next agency claude launch (when launched from a CWD under $HOME).`

   On verified-content-but-copy, file a friction entry and surface a
   single warning (don't retry):
   > `⚠ ~/agency.toml created as a copy (no symlink/hardlink available). Edits to $DESK/agency.toml won't propagate until next session-start. To enable proper linking on Windows: enable Developer Mode (Settings → For developers) — then re-run worker; symlink will land automatically.`
   The friction entry's slug: `windows-agency-toml-copy-fallback-<YYYY-MM-DD>`.

3. **`$HOME/agency.toml` exists AND is correctly linked to the
   workspace file** (symlink target match OR hardlink inode match) →
   silent no-op. Already configured.

4. **`$HOME/agency.toml` exists AND is a regular file**:
   - **If content equals the workspace file** (operator imported on a
     prior session that fell back to copy): UPGRADE to the
     platform's strongest link primitive automatically. Delete the
     copy + recreate as link via the Step 2 logic. Announce:
     > `🔗 Upgraded ~/agency.toml from regular-file copy to <symlink|hardlink>. Future workspace edits will propagate.`
   - **If content differs from the workspace file**: do NOT
     overwrite. Operator may have hand-edited; preserve their
     state. Surface to operator:
     > `⚠ ~/agency.toml is a regular file with different content from $DESK/agency.toml. Leaving alone. If you intended to use the workspace version, back up your local edits and replace.`

5. **`$HOME/agency.toml` is a symlink but points somewhere else** →
   repair (same Step 2 link-creation logic; replace existing symlink
   target). Announce:
   > `🔗 Updated ~/agency.toml → $DESK/agency.toml (was pointing at <previous-target>).`

### Verify discovery (NEW — Layer 2 of whole-moon Windows fix)

After link creation/verification, confirm agency CLI's walk-up
actually finds the toml from `$HOME`:

```bash
( cd "$HOME" && agency config list 2>&1 ) | grep -q "agency.toml"
```

If discovery fails, surface a friction entry: agency CLI walk-up gap.
The link is in place but agency isn't finding it from `$HOME`.
Operator should report this as a bug to whoever owns the agency CLI
(it should walk up from `$HOME` as the fallback search root).

If discovery succeeds from `$HOME` but the operator typically launches
from a CWD outside `$HOME` (e.g. `C:\Windows\system32` on Windows
when launched via Task Scheduler / system shortcut), surface a
one-line note:

> `ℹ Workspace MCPs will load when 'agency claude' is launched from a CWD under $HOME. If your shortcut launches from C:\Windows\system32 or similar, consider setting its "Start in" property to %USERPROFILE%.`

### Why this lives in session-start, not first-run-bootstrap

first-run-bootstrap only runs when the workspace itself is missing.
Operators on a new machine who clone an existing workspace skip
bootstrap entirely — but they still need the link. session-start
runs every session, catches the gap on the next launch, fixes it
once, and is silent thereafter.

### Why a link (vs auto-creating `~/.agency/agency.toml`)

The link keeps the source of truth in the workspace's git history
(every machine's MCP set follows the workspace clone). Editing
`~/.agency/agency.toml` per-machine forks state silently; the link
doesn't. Hardlink falls back to the same property: edits to either
path are visible on the other (because they share an inode), so a
hardlink at `$HOME/agency.toml` is functionally indistinguishable
from a symlink for the operator's purposes — except it survives
shell tools that don't follow symlinks (rare, but Windows-friendly).

## Step 5 — Emit status + ask

Concise status block, then an open prompt:

```
N active tasks across M tracks. Uncommitted changes in K repos.

<track-name>/
  <task-slug>    <status>    updated <X ago>
  ...

resume one, or start new?
```

If the operator picks a task to resume → hand off to the `session-resumption` skill.
If the operator says "start new" → follow the `dual-input` skill.
If the operator wants the fuller dashboard → invoke the `status` skill.

### Skill-routing prompts

After the status block, offer skill routing if the signals from steps
4.5 and 4.6 fire. Both prompts are engine-agnostic prose the worker
presents; the operator picks. The prompts exist because `curator`
and `pr-feedback-on-own-pr` are gated by explicit operator phrasing in their
`description:` frontmatter — they won't auto-fire from ambient
conversation, so worker surfaces them when signals warrant.

- **Curator routing** (from step 4.6): if open `_friction/` entries
  exist on any active track, surface:
  > "I see N open friction entries across tracks [A, B, C]. Want to
  > process the backlog? (invokes the `curator` skill)"

- **pr-feedback-on-own-pr routing** (from step 4.5): if any non-merged PR on
  any active track has unresolved review threads, surface:
  > "I see M PRs with unresolved review threads (PR <id> on <repo>
  > has K threads; PR <id> on <repo> has L threads). Want to iterate
  > on feedback? (invokes the `pr-feedback-on-own-pr` skill)"

These prompts are one decision group each, per `interaction-style`.
If both fire, offer both in a single message; operator picks one or
neither.

## Never skip, never route around

All five steps run every session. The prereq probe in particular is load-bearing — most mid-session failures trace back to a missing tool, an old `gh`, or stale auth that worker didn't catch at start.

**Auto-mode is license for action, not for skipping safety checks.** A prereq-probe failure is like a compile error: fix it, don't proceed. If the operator insists on proceeding with broken prereqs, surface the specific risk (e.g., "no gh = can't push to worker-workspace = state won't sync across machines") and require an explicit override.
