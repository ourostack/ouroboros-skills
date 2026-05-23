---
id: 01-workspace-to-ms-desk
description: Renames the operator's workspace dir from ~/worker-workspace/ or ~/desk/ to ~/ms-desk/ and repoints ~/agency.toml. Lands as part of the desk/ms-desk plugin split on 2026-05-22.
safety: safe
needs_restart: true
---

## Detect

```bash
# Migration is needed iff the new path doesn't exist AND at least one of the old paths does.
[ ! -d "$HOME/ms-desk" ] && { [ -d "$HOME/worker-workspace" ] || [ -d "$HOME/desk" ]; }
```

## Safety check

```bash
# Identify which old path is present (worker-workspace takes priority — predates the W7 cutover).
OLD=""
if [ -d "$HOME/worker-workspace" ]; then OLD="$HOME/worker-workspace"
elif [ -d "$HOME/desk" ]; then OLD="$HOME/desk"
fi

if [ -z "$OLD" ]; then
  echo "Safety check: neither ~/worker-workspace nor ~/desk exists on this machine — Detect lied. Aborting."
  exit 1
fi

# Never sweep-stage. If there's uncommitted work in the old dir, refuse and let the operator commit/stash first.
if [ -n "$(git -C "$OLD" status --porcelain 2>/dev/null)" ]; then
  echo "Uncommitted work in $OLD; commit or stash, then start a new session and I'll retry the migration."
  exit 1
fi

# Refuse if ~/ms-desk somehow exists as a non-dir entity (file, symlink to nowhere, etc.) — would clobber on mv.
if [ -e "$HOME/ms-desk" ] && [ ! -d "$HOME/ms-desk" ]; then
  echo "~/ms-desk exists but isn't a directory; manual inspection needed before I can mv."
  exit 1
fi

exit 0
```

## Migrate

```bash
# Re-identify the old path (Safety check confirmed at least one exists).
OLD=""
if [ -d "$HOME/worker-workspace" ]; then OLD="$HOME/worker-workspace"
elif [ -d "$HOME/desk" ]; then OLD="$HOME/desk"
fi

# Update the remote URL to canonical name. GitHub auto-redirects the old name,
# but pointing at the canonical avoids future puzzlement.
EMU_ALIAS=$(git -C "$OLD" config user.email 2>/dev/null | sed -n 's/@microsoft.com$//p')
if [ -n "$EMU_ALIAS" ]; then
  git -C "$OLD" remote set-url origin "https://github.com/${EMU_ALIAS}_microsoft/desk.git" || true
fi

# The actual rename. mv is atomic on same-filesystem renames + fully reversible.
mv "$OLD" "$HOME/ms-desk"

# Repoint ~/agency.toml symlink if it's a symlink pointing into the old path.
if [ -L "$HOME/agency.toml" ]; then
  TARGET=$(readlink "$HOME/agency.toml" || true)
  case "$TARGET" in
    "$HOME/worker-workspace/"*|"$HOME/desk/"*)
      rm "$HOME/agency.toml"
      ln -s "$HOME/ms-desk/agency.toml" "$HOME/agency.toml"
      ;;
  esac
fi
```

## Announce

I detected this machine still had `~/worker-workspace/` or `~/desk/` from before the 2026-05-22 plugin split (desk substrate + ms-desk overlay). I ran the cutover:

- Renamed the old workspace dir → `~/ms-desk/`
- Updated the git remote URL to the canonical name (`<alias>_microsoft/desk` — GitHub already auto-redirected, but explicit is cleaner)
- Repointed `~/agency.toml` symlink at `~/ms-desk/agency.toml`

Workspace contents are byte-identical; only the path changed. Existing commits, branches, and any uncommitted work that you committed before this fired are all where you left them under the new path.

**Please start a new session** so my preamble loads against `~/ms-desk/`. If you launch me via `agency claude -a ms-desk:worker` (once the plugin rename lands), that's the canonical invocation going forward.
