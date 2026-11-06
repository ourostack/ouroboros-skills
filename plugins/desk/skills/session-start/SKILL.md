---
name: session-start
description: Session-start checklist. Invoke as the FIRST thing in every agent session — probes prerequisites (gh binary + version floor + auth state, jq, Windows PATH gotchas), syncs the workspace repo, scans for active tasks, and emits a one-screen status block. Hard-stops on prereq failures; does NOT silently fall through to local-only operation. If `$DESK/` doesn't exist, hands off to `first-run-bootstrap`. If the operator picks a task to resume, hands off to `session-resumption`.
---

# Session start

sitting down at the desk. the first thing every session — turn on the lamp, check the tools are where they were left, see what's still open across the drawers, surface it for the operator. the prereq probe has teeth: a real miss is a hard stop, not a hint to route around.

> **worker users**: see `worker:ms-session-extensions` for the EMU identity resolve (Step 1f), ADO REST staleness probe (Step 1g), and ADO PR fan-out in Step 4.5. this skill stays generic.

## Step 0 — Host identity probe

before touching anything — before prereq checks, before sync, before scanning the drawers — figure out where this desk is sitting. the substrate is increasingly spread across multiple hosts (local mac, headless VM, remote fleet members), and an agent that doesn't know which room it's in will commit to the wrong workspace, reach for tooling that isn't on this host, propose actions appropriate for some other machine, or miss the host-specific recovery the operator actually needs.

run a minimal identity probe in the first tool call of the session. use the variant matching the host shell:

**POSIX shells (macOS, Linux, WSL, Git Bash):**

```bash
hostname && pwd && whoami && uname -s
```

**Windows PowerShell:**

```powershell
hostname; (Get-Location).Path; whoami; [System.Environment]::OSVersion.Platform
```

both shells: just run it. four commands, idempotent — re-running is cheap. don't try to short-circuit by "checking if probe already ran" before any tool call; the check is harder than the probe itself.

then write the result to durable state. persistence precedence:

- **if a task card exists**, the task-card preamble is **mandatory**. add a "Host context" line: ``Host: `<hostname>` / user: `<user>` / cwd: `<pwd>` / OS: `<os>` / probed: <timestamp>``. chat scrollback is ephemeral from the perspective of a future session resuming this task; the task card is what survives, so that's where the host context belongs.
- **if no task card exists** (fresh session, nothing picked yet), open the first chat message with a one-line "Running on `<hostname>` as `<user>` in `<pwd>`, OS `<os>`." visible to the operator from turn one; cheap to add.
- **both** is fine — chat lead + task-card preamble together — but the task card is what carries across sessions.

applies to ANY agent using this skill — worker, ccatester, investigator, triage, future fleet agents. single-host setups still benefit (the probe is fast and silent on the happy path), but the cost-of-omission climbs as host count grows.

## Step 0.5 — Auto-heal migrations

before any path-dependent work — before the prereq probe, before sync, before scans — hand off to the `session-start-migrations` skill. it walks every enabled plugin's `migrations/` dir, runs each migration's Detect predicate, and (for the ones that fire) runs Safety/Migrate/Announce. if any migration with `needs_restart: true` runs successfully, the skill hard-stops the session with a "please restart" message; the operator restarts and the next session opens against canonical paths.

why here, not later: most later steps assume `$DESK/` already points at the right place. if the machine is still on a pre-migration name (an old workspace dir that's since been renamed), running Step 1's prereq probe or Step 2's `cd $DESK && git pull` first would either fail confusingly or — worse — quietly operate against stale state. migrations run first, restart, everything downstream resolves cleanly.

on a machine with no pending migrations (the common case) this step is a few cheap Detect bash exits and returns immediately.

## Step 1 — Prerequisite probe

five checks. any failure surfaces the specific remediation to the operator and **waits** — don't proceed to step 2, and don't fall back to a local-only mode. a session with broken auth isn't "offline mode"; it's "not-yet-ready."

### 1a. `gh` binary present

```bash
gh --version
```

missing → install command per OS:
- macOS: `brew install gh`
- Windows: `winget install --id GitHub.cli` (or see 1d below if winget is also missing)
- Linux: [cli.github.com](https://cli.github.com/) for distro packages

### 1b. `gh` version floor — 2.40 or newer

`gh auth switch -u <user>` (used by any workflow that disambiguates between multiple cached GitHub accounts) landed in gh 2.40 (Dec 2023). older gh errors with `unknown shorthand flag: 'u' in -u` and the rest of the chained command **never runs** — which is dangerous when multiple identities are cached: a push can leak under the wrong account because the switch silently failed.

```bash
gh --version | head -1 | awk '{print $3}'
# Parse: major.minor.patch. Require major > 2 OR (major == 2 AND minor >= 40).
```

below 2.40 → surface the version and recommend `winget upgrade GitHub.cli` / `brew upgrade gh` / `sudo apt update && sudo apt upgrade gh`. hard-stop; do not proceed.

### 1c. `jq` present

```bash
jq --version
```

missing → `brew install jq`, `winget install jqlang.jq`, `sudo apt install jq`. hard-stop — several skills lean on `jq` for JSON parsing.

### 1d. Windows winget diagnostic (only if `winget` itself is missing)

fresh Windows VM images built from a templated admin-user base often leave the current user's `WindowsApps` off their PATH, so `winget.exe` is installed but not reachable by name. don't recommend "reinstall winget" — that's a dead end. diagnose instead:

```powershell
Get-AppxPackage Microsoft.DesktopAppInstaller
Test-Path "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
$env:Path -split ';' | Select-String WindowsApps
```

if `Test-Path` returns `True` but PATH doesn't contain `$env:LOCALAPPDATA\Microsoft\WindowsApps`, the fix is:
1. short-term: invoke winget by absolute path — `& "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe" install jqlang.jq`
2. durable: append `%LOCALAPPDATA%\Microsoft\WindowsApps` to the user PATH via `setx PATH "$env:Path;$env:LOCALAPPDATA\Microsoft\WindowsApps"` or the System Properties GUI.

surface both and let the operator pick.

### 1e. `gh auth status` — auth is actually working

```bash
gh auth status
```

look in the output for `The github.com token in oauth_token is no longer valid` or similar staleness signals. a cached-but-expired token fails every subsequent gh call with a confusing 401/403 that masquerades as a permissions problem. **hard-stop on stale token**. walk the operator through `gh auth login --hostname github.com` before going further.

## Step 2 — Workspace sync

if `$DESK/` doesn't exist → hand off to the `first-run-bootstrap` skill (it has its own gh-auth hard-gate; never proceed to bootstrap if step 1 is still red).

if it exists, pull the latest:
```bash
cd $DESK && git pull --rebase origin main
```
if the pull fails (conflict, no remote), warn the operator but proceed — don't block.

## Step 3 — Scan for active tasks

glob `$DESK/**/task.md` excluding `_archive/`. parse each card's YAML frontmatter. filter to non-terminal status (NOT `done`, NOT `cancelled`). group by track, sort by `updated` descending. this is the look across the drawers to see what's still open.

## Step 4 — Scan code repos

for each active task card's locally-cloned repo, run `git fetch origin` and note current branch + dirty state. don't block on this — it just informs the status output.

## Step 4.5 — Fan PR lookups across every `repos[]` on every non-terminal task

for every non-terminal task card, iterate every entry in `repos[]` —
not just the entry whose PR ID is already cached in the task's
frontmatter. a task that lists `OrderService` + `OrderUI` in
`repos[]` may have an active PR on either; session-start needs to
surface both.

for each GitHub repo entry:

```bash
gh pr list --repo <org>/<repo> --author @me --state open --json number,title,url,isDraft
```

(worker users: ADO repos use a REST endpoint instead — see
`worker:ms-session-extensions`.)

for each PR surfaced:
- if the PR has unresolved (Active) review threads from humans or an
  AI reviewer → flag for the pr-feedback-on-own-pr routing prompt
  in step 5.
- cache PR metadata in the task-scan output so step 5 can render it
  without a re-fetch.

## Step 4.6 — Friction-backlog scan

while scanning active tracks, count the open `_friction/*.md` entries
(exclude `_friction/_archive/`) — the cards pinned to the corkboard,
still asking for attention. if the count is non-zero on any active
track, flag for the curator routing prompt in step 5.

## Step 4.7 — Workspace MCP link check (auto-create, platform-aware)

workspace-level MCPs live in `$DESK/agency.toml`. agency's config
layering walks UP the directory tree from CWD and follows symlinks
(and reads hardlinks transparently); a link at `$HOME/agency.toml` →
`$DESK/agency.toml` lets every `agency claude -a worker:worker` launch
(from anywhere under `$HOME`) auto-load workspace MCPs without the
operator passing `--mcp-config`. see the README's "Workspace MCPs"
section for the full convention.

this step **creates the link for the operator** if conditions are
right — using the platform's strongest-available link primitive — and
announces what it did. operator effort: zero on macOS/Linux, zero on
Windows post-Developer-Mode-or-NTFS, zero in 99% of practical cases.

### Link-type strategy by platform

POSIX (macOS, Linux, WSL): **symlink** via `ln -sf`. same-volume
constraint doesn't apply; symlinks just work.

Windows native (MINGW / MSYS / CYGWIN-style shells against NTFS): try
in order, taking the first that succeeds:

  1. **Symbolic link** via `New-Item -ItemType SymbolicLink`. works
     when the operator has Developer Mode enabled (Settings → For
     developers → Developer Mode) OR is running elevated. silently
     fails otherwise — the next attempt picks up.
  2. **Hard link** via `New-Item -ItemType HardLink`. works
     unconditionally on NTFS for files on the same volume (the
     typical $HOME case on Windows). no elevation needed. hard links
     share an inode — edits to either path show on the other. only
     catches: cross-volume placements break it (rare for `$HOME` ↔
     `$DESK`), and a non-in-place atomic replace on the workspace
     file (unusual — `add-workspace-mcp` edits in place) would break
     the link.
  3. **Plain copy** via `cp -f`. fallback when neither link primitive
     succeeds. the two files become decoupled — surface a friction
     card so the operator knows their next workspace edit needs a
     manual re-sync.

the decision tree below uses `link` as a generic verb covering all
three platform-strongest primitives.

### Decision tree (run in order; first match wins)

1. **`$DESK/agency.toml` does NOT exist** → no-op
   silently. either it's a first-run case (handled by
   `first-run-bootstrap`) or the operator hasn't created the file
   yet. no link to make.

2. **`$HOME/agency.toml` does NOT exist** → attempt to create the
   link using the platform's strongest primitive:

   ```bash
   if uname -s 2>/dev/null | grep -qiE '^(MINGW|MSYS|CYGWIN)' ; then
     # Windows: symlink → hardlink → copy
     powershell.exe -NoProfile -Command \
       "New-Item -ItemType SymbolicLink -Path '$HOME\agency.toml' -Target '$DESK\agency.toml' -ErrorAction Stop" \
       2>/dev/null \
     || powershell.exe -NoProfile -Command \
          "New-Item -ItemType HardLink -Path '$HOME\agency.toml' -Target '$DESK\agency.toml' -ErrorAction Stop" \
          2>/dev/null \
     || cp -f "$DESK/agency.toml" "$HOME/agency.toml"
   else
     # POSIX
     ln -sf "$DESK/agency.toml" "$HOME/agency.toml"
   fi
   ```

   then **verify** by content + linkage check:
   ```bash
   # Same content (sanity)
   diff "$HOME/agency.toml" "$DESK/agency.toml" >/dev/null \
     && link_kind=$(detect_link_kind "$HOME/agency.toml")
   # detect_link_kind emits "symlink" | "hardlink" | "copy" | "missing"
   ```

   on verified link/hardlink, announce in the Step 5 status block
   (mention the link kind so the operator knows whether edits
   propagate):
   > `🔗 Created ~/agency.toml as <symlink|hardlink> → $DESK/agency.toml. Workspace MCPs will auto-load on your next agency claude launch (when launched from a CWD under $HOME).`

   on verified-content-but-copy, file a friction card and surface a
   single warning (don't retry):
   > `⚠ ~/agency.toml created as a copy (no symlink/hardlink available). Edits to $DESK/agency.toml won't propagate until next session-start. To enable proper linking on Windows: enable Developer Mode (Settings → For developers) — then re-run worker; symlink will land automatically.`
   the friction card's slug: `windows-agency-toml-copy-fallback-<YYYY-MM-DD>`.

3. **`$HOME/agency.toml` exists AND is correctly linked to the
   workspace file** (symlink target match OR hardlink inode match) →
   silent no-op. already configured.

4. **`$HOME/agency.toml` exists AND is a regular file**:
   - **if content equals the workspace file** (operator imported on a
     prior session that fell back to copy): UPGRADE to the
     platform's strongest link primitive automatically. delete the
     copy + recreate as link via the Step 2 logic. announce:
     > `🔗 Upgraded ~/agency.toml from regular-file copy to <symlink|hardlink>. Future workspace edits will propagate.`
   - **if content differs from the workspace file**: do NOT
     overwrite. operator may have hand-edited; preserve their
     state. surface to operator:
     > `⚠ ~/agency.toml is a regular file with different content from $DESK/agency.toml. Leaving alone. If you intended to use the workspace version, back up your local edits and replace.`

5. **`$HOME/agency.toml` is a symlink but points somewhere else** →
   repair (same Step 2 link-creation logic; replace existing symlink
   target). announce:
   > `🔗 Updated ~/agency.toml → $DESK/agency.toml (was pointing at <previous-target>).`

### Verify discovery (NEW — Layer 2 of whole-moon Windows fix)

after link creation/verification, confirm agency CLI's walk-up
actually finds the toml from `$HOME`:

```bash
( cd "$HOME" && agency config list 2>&1 ) | grep -q "agency.toml"
```

if discovery fails, surface a friction card: agency CLI walk-up gap.
the link is in place but agency isn't finding it from `$HOME`. the
operator should report this as a bug to whoever owns the agency CLI
(it should walk up from `$HOME` as the fallback search root).

if discovery succeeds from `$HOME` but the operator typically launches
from a CWD outside `$HOME` (e.g. `C:\Windows\system32` on Windows
when launched via Task Scheduler / system shortcut), surface a
one-line note:

> `ℹ Workspace MCPs will load when 'agency claude' is launched from a CWD under $HOME. If your shortcut launches from C:\Windows\system32 or similar, consider setting its "Start in" property to %USERPROFILE%.`

### Why this lives in session-start, not first-run-bootstrap

first-run-bootstrap only runs when the workspace itself is missing.
operators on a new machine who clone an existing workspace skip
bootstrap entirely — but they still need the link. session-start
runs every session, catches the gap on the next launch, fixes it
once, and is silent thereafter.

### Why a link (vs auto-creating `~/.agency/agency.toml`)

the link keeps the source of truth in the workspace's git history
(every machine's MCP set follows the workspace clone). editing
`~/.agency/agency.toml` per-machine forks state silently; the link
doesn't. hardlink falls back to the same property: edits to either
path are visible on the other (because they share an inode), so a
hardlink at `$HOME/agency.toml` is functionally indistinguishable
from a symlink for the operator's purposes — except it survives
shell tools that don't follow symlinks (rare, but Windows-friendly).

## Step 5 — Emit status + ask

concise status block, then an open prompt:

```
N active tasks across M tracks. Uncommitted changes in K repos.

<track-name>/
  <task-slug>    <status>    updated <X ago>
  ...

resume one, or start new?
```

if the operator picks a task to resume → hand off to the `session-resumption` skill.
if the operator says "start new" → follow the `dual-input` skill.
if the operator wants the fuller dashboard → invoke the `status` skill.

### Skill-routing prompts

after the status block, offer skill routing if the signals from steps
4.5 and 4.6 fire. both prompts are engine-agnostic prose the agent
presents; the operator picks. the prompts exist because `curator`
and `pr-feedback-on-own-pr` are gated by explicit operator phrasing in
their `description:` frontmatter — they won't auto-fire from ambient
conversation, so this skill surfaces them when signals warrant.

- **Curator routing** (from step 4.6): if open `_friction/` cards
  exist on any active track, surface:
  > "I see N open friction cards across tracks [A, B, C]. Want to
  > process the backlog? (invokes the `curator` skill)"

- **pr-feedback-on-own-pr routing** (from step 4.5): if any non-merged PR on
  any active track has unresolved review threads, surface:
  > "I see M PRs with unresolved review threads (PR <id> on <repo>
  > has K threads; PR <id> on <repo> has L threads). Want to iterate
  > on feedback? (invokes the `pr-feedback-on-own-pr` skill)"

these prompts are one decision group each, per `interaction-style`.
if both fire, offer both in a single message; operator picks one or
neither.

## Never skip, never route around

every step in this skill — Step 0 plus the Step 1 through Step 5 chain (including the `.x` sub-steps for 2.5, 4.5, 4.6, 4.7) — runs every session. the host-identity probe (Step 0) is cheap and silent on the single-host happy path; the prereq probe (Step 1) is load-bearing — most mid-session failures trace back to a missing tool, an old `gh`, or stale auth that wasn't caught at start.

**auto-mode is license for action, not for skipping safety checks.** a prereq-probe failure is like a compile error: fix it, don't proceed. if the operator insists on proceeding with broken prereqs, surface the specific risk (e.g., "no gh = can't push to the workspace state repo = state won't sync across machines") and require an explicit override.
