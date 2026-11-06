---
name: first-run-bootstrap
description: Bootstrap the agent's `$DESK/` workspace repo on a machine where it doesn't exist yet. FIRST checks whether the operator already has a remote workspace repo on GitHub and offers to clone it. Only falls through to the fresh-create / operator-provides-path / skip menu if no remote is found. Hard-gates on `gh auth status` — if gh auth is broken, STOPS and waits — does NOT fall through to local-only init, because that forks operator state silently. Use when `session-start` discovers that `$DESK/` is missing.
---

# First-run bootstrap

`$DESK/` doesn't exist on this machine. Most operators already have one — either from a previous machine or an earlier onboarding. So the first thing to try is the quiet happy path: find it on GitHub and clone it.

> **worker users**: see `worker:ms-first-run-templates` for the MS-flavored overlay (rich `_reviews/`, `_landscape/`, AGENTS.md, agency.toml, EMU repo conventions) that supplements this generic skeleton.

## Step 0 — Hard-gate on gh auth

**Do not proceed with ANY local filesystem changes (no `mkdir`, no `git init`) if gh auth is broken.** A local-only init without the remote check forks operator state: the operator may already have a workspace repo on GitHub, and creating a local orphan here risks divergent history, accidental push under the wrong identity, or silent loss of the real source of truth.

```bash
gh auth status
```

If the output shows any of:
- "No accounts found"
- "The github.com token in oauth_token is no longer valid"
- Any other auth failure

Then **stop**. Surface the specific issue and the remediation (usually `gh auth login --hostname github.com`). Wait for the operator to fix it and re-run. Do NOT proceed to "create a fresh one" as a workaround — that's the orphan-producing path.

This applies under auto mode too. Auto-mode autonomy is for execution, not for skipping the gate that prevents state divergence.

> Account-specific checks (e.g. the MS EMU `<alias>_microsoft` identity) live in the consumer overlay — see `worker:emu-github`.

## Step 1 — Check for an existing remote

With gh auth confirmed working, probe for the operator's expected workspace remote:

```bash
gh repo view <owner>/<workspace-repo> --json name,url 2>/dev/null
```

The exact `<owner>/<workspace-repo>` value is consumer-supplied — workers default to `<alias>_microsoft/worker-workspace`; other consumers pick their own convention.

**If the repo exists**, ask ONE yes/no question:

> I found `<owner>/<workspace-repo>` on GitHub. Clone it to `$DESK/`?

If yes:
```bash
git clone https://github.com/<owner>/<workspace-repo>.git "$DESK"
```
Done. Return to `session-start` Step 2 (sync + scan).

**If no remote found, or operator declines**, fall through to Step 2.

## Step 2 — Present the options

```
$DESK/ not found locally and no remote workspace repo discovered.
How do you want to set up task state?
```

Offer (exact labels for menu-rendering):
- "Create a fresh one for me"
- "I have it at a different location (I'll provide the path/URL)"
- "Skip — continue this session without workspace persistence"

## Option A — Create fresh

```bash
mkdir -p "$DESK/_archive" "$DESK/_meta"
cd "$DESK" && git init
touch _archive/.gitkeep

cat > .gitignore <<'EOF'
.DS_Store
*.log
.machine-local.yml
EOF

cat > _meta/friction.md <<'EOF'
# Friction Backlog

Running log of pain points encountered while using this agent. Each
entry is a seed for an improvement to the agent definition, one of
its skills, or surrounding tooling.

Entry format: `## YYYY-MM-DD — <short title>` / **What happened** /
**Why it hurt** / **Proposed fix** / **Status**: `open | in-progress`.

Landed entries are moved to `_meta/_archive/` in the same commit
that ships the fix.

---
EOF

cat > README.md <<'EOF'
# desk workspace

Task state for this agent. Tracks, tasks, planning docs, and doing
docs live here. The agent definition itself lives in a separate
repo — this repo is only state.

See `desk:directory-structure` for the canonical layout.
EOF

git add -A && git commit -m "init: desk workspace scaffold"
```

Then ask:

> Want to add a GitHub remote? (Recommended — keeps state synced across machines.)

If yes, walk the operator through `gh repo create` + `git remote add origin` + `git push -u origin main`. Consumer overlays can preconfigure the owner/visibility defaults.

> **Rich-template overlays** — Consumers that need scaffolded `_reviews/`, `_landscape/`, `AGENTS.md`, or `agency.toml` ship those via their own skill. For worker, see `worker:ms-first-run-templates`.

## Option B — Operator provides URL or path

1. Operator gives a repo URL or local path.
2. If URL: `git clone <url> "$DESK"`.
3. If local path: symlink or use literally — do not copy.
4. Verify the directory has the expected structure (or accept an empty repo with just `_meta/` / `_archive/`).

## Option C — Skip

The session continues without workspace persistence. **Warn the operator**:
- No task cards will be created or read.
- Any skill that requires `$DESK/` (status, session-resumption, start-task, friction-management, etc.) will be unavailable or degraded.
- This is intended for one-shot exploratory sessions only.

## After bootstrap

Return to `session-start` Step 2 (sync + scan) and proceed with the rest of the session.

- See `desk:directory-structure` for the workspace layout.
- See `desk:session-start` Step 4.7 for the `agency.toml` symlink ritual (post-bootstrap, consumer-managed).
- See `desk:start-task` for creating the first task.
