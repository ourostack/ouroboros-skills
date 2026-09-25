---
id: 01-move-to-ourostack-desk
description: Move a V2 Desk install from the ouroboros-skills v2-alpha channel to ourostack/desk (2026-09-24)
safety: safe
needs_restart: true
---

## Detect

```bash
T="${AGENCY_TOML:-$HOME/.local/agency/agency.toml}"
grep -Eqs 'github:ourostack/ouroboros-skills:plugins/(desk|superpowers|plain-language|crew)@v2-alpha([^A-Za-z0-9._/-]|$)' "$T" && exit 0
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
command -v claude >/dev/null && command -v jq >/dev/null || exit 1
ref="$({ jq -r '."ouroboros-skills".source.ref // empty' "$CFG/plugins/known_marketplaces.json"; jq -r '.extraKnownMarketplaces."ouroboros-skills".source.ref // empty' "$CFG/settings.json"; } 2>/dev/null | head -n 1)"
[ "$ref" = "v2-alpha" ] || exit 1
claude plugin list --json 2>/dev/null | jq -e 'any(.[]; .id == "desk@ouroboros-skills")' >/dev/null
```

## Safety check

```bash
command -v git >/dev/null && command -v gh >/dev/null || { echo "git and gh are required"; exit 1; }
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
if command -v claude >/dev/null && ! command -v jq >/dev/null && grep -Eqs '"ref": *"v2-alpha"' "$CFG/plugins/known_marketplaces.json" && claude plugin list 2>/dev/null | grep -q "desk@ouroboros-skills"; then
  echo "jq is required to move the Claude Code plugins; install jq, then restart the session"
  exit 1
fi
exit 0
```

## Migrate

```bash
set -eu
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
T="${AGENCY_TOML:-$HOME/.local/agency/agency.toml}"
V2_COORD='github:ourostack/ouroboros-skills:plugins/(desk|superpowers|plain-language|crew)@v2-alpha([^A-Za-z0-9._/-]|$)'
US=$'\x1f'
report=""
say() { report="$report$1"$'\n'; }
failed=""

# Agency: move only V2 channel coordinates (@v2-alpha). V1 entries (@main or no ref) stay as they are.
if [ -f "$T" ] && grep -Eq "$V2_COORD" "$T"; then
  names="$(grep -Eo "$V2_COORD" "$T" | sed -E 's#^.*:plugins/([a-z-]+)@.*$#\1#' | sort -u | paste -sd ' ' -)"
  [ -e "$T.pre-ourostack-desk" ] || cp "$T" "$T.pre-ourostack-desk"
  tmp="$(mktemp)"
  sed -E "s#$V2_COORD#github:ourostack/desk:plugins/\\1@main\\2#g" "$T" > "$tmp"
  # Write back into the existing file so a symlinked agency.toml stays a symlink.
  cat "$tmp" > "$T"
  rm -f "$tmp"
  say "Agency: $T now tracks github:ourostack/desk:plugins/<name>@main for ${names}. The original file is kept as $T.pre-ourostack-desk."
  if grep -q "ourostack/ouroboros-skills:plugins/" "$T"; then
    say "Its other ourostack/ouroboros-skills entries stay as they are."
  fi
fi

# Claude Code: move only a V2 install, meaning desk@ouroboros-skills from a marketplace that tracks v2-alpha.
old_ref() {
  { jq -r '."ouroboros-skills".source.ref // empty' "$CFG/plugins/known_marketplaces.json"; jq -r '.extraKnownMarketplaces."ouroboros-skills".source.ref // empty' "$CFG/settings.json"; } 2>/dev/null | head -n 1
}
ids() { claude plugin list --json 2>/dev/null | jq -r '.[] | "\(.id) \(.scope // "user")"'; }
has() { ids | grep -q "^$1 "; }
if command -v claude >/dev/null && [ "$(old_ref)" = "v2-alpha" ] && has desk@ouroboros-skills; then
  # Every plugin installed from ouroboros-skills: name, scope, project path, install path.
  before="$(claude plugin list --json 2>/dev/null | jq -r '.[] | select(.id | endswith("@ouroboros-skills")) | [(.id | sub("@ouroboros-skills$"; "")), (.scope // "user"), (.projectPath // ""), (.installPath // "")] | join("\u001f")')"
  field() { printf '%s\n' "$before" | awk -F "$US" -v n="$1" -v f="$2" '$1 == n { print $f; exit }'; }
  old() { [ -n "$(field "$1" 1)" ]; }
  # Run a command from the plugin's project directory when it was installed at project or local scope.
  in_project() { local dir="$1"; shift; if [ -n "$dir" ]; then (cd "$dir" && "$@"); else "$@"; fi; }
  # The removal command for a plugin, run from its project directory when it was installed at project or local scope.
  remove_cmd() {
    local s dir
    s="$(field "$1" 2)"; dir="$(field "$1" 3)"
    if [ "$s" = user ]; then printf 'claude plugin uninstall %s@ouroboros-skills' "$1"; return; fi
    [ -z "$dir" ] || printf 'cd %q && ' "$dir"
    printf 'claude plugin uninstall --scope %s %s@ouroboros-skills' "$s" "$1"
  }

  claude plugin marketplace add ourostack/desk >&2
  claude plugin marketplace update ourostack >&2
  # Keep automatic updates on for the new marketplace, as SETUP.md sets them. Every other setting is preserved.
  S="$CFG/settings.json"
  [ -s "$S" ] || echo '{}' > "$S"
  tmp="$(mktemp)"
  jq '.extraKnownMarketplaces.ourostack = ((.extraKnownMarketplaces.ourostack // {"source": {"source": "github", "repo": "ourostack/desk"}}) + {"autoUpdate": true})' "$S" > "$tmp"
  cat "$tmp" > "$S"
  rm -f "$tmp"
  # Carry the saved desk binding over; never overwrite one the new install already has.
  OLD="$CFG/plugins/data/desk-ouroboros-skills/desk.activation.json"
  NEW="$CFG/plugins/data/desk-ourostack/desk.activation.json"
  binding=""
  if [ -f "$OLD" ] && [ ! -f "$NEW" ]; then mkdir -p "$(dirname "$NEW")" && cp "$OLD" "$NEW" && binding="copied"; fi

  # Never remove an old companion that a plugin staying in ouroboros-skills depends on. Dependencies come from each
  # staying plugin's installed manifest; if a manifest cannot be read, every moved companion is kept (fail safe).
  # The old Desk is never a V1 dependency, so it is always removed once the new Desk is installed.
  MOVED="desk crew superpowers plain-language"
  COMPANIONS="crew superpowers plain-language"
  DEPS='.dependencies[]? | (if type == "string" then . else (.name // empty) end) | if test("@") then (select(endswith("@ouroboros-skills")) | sub("@ouroboros-skills$"; "")) else . end'
  keep=""
  why=""
  needed=""
  grow=1
  while [ "$grow" = 1 ]; do
    grow=0
    while IFS="$US" read -r name scope project path; do
      [ -n "$name" ] || continue
      case " $MOVED " in *" $name "*) case " $keep " in *" $name "*) ;; *) continue ;; esac ;; esac
      if [ -n "$path" ] && deps="$(jq -r "$DEPS" "$path/.claude-plugin/plugin.json" 2>/dev/null)"; then
        reason="$name@ouroboros-skills depends on it"
      else
        deps="$COMPANIONS"
        reason="the dependencies of $name@ouroboros-skills could not be read"
      fi
      for dep in $deps; do
        needed="$needed $dep"
        case " $COMPANIONS " in *" $dep "*) ;; *) continue ;; esac
        case " $keep " in *" $dep "*) continue ;; esac
        old "$dep" || continue
        keep="$keep $dep"
        why="$why$dep@ouroboros-skills stays because $reason."$'\n'
        grow=1
      done
    done <<< "$before"
  done

  # Reinstall every moved plugin from ourostack in its original scope, skipping any already installed there; Desk goes last.
  moved=""
  for p in crew superpowers plain-language desk; do
    old "$p" || continue
    moved="$moved, $p@ourostack"
    has "$p@ourostack" && continue
    in_project "$(field "$p" 3)" claude plugin install --scope "$(field "$p" 2)" "$p@ourostack" >&2
  done
  # Remove the old copies, dependents first, keeping their data.
  for p in crew desk superpowers plain-language; do
    old "$p" || continue
    case " $keep " in *" $p "*) continue ;; esac
    in_project "$(field "$p" 3)" claude plugin uninstall --scope "$(field "$p" 2)" --keep-data "$p@ouroboros-skills" >&2 || failed="$failed $p@ouroboros-skills"
  done

  say "Claude Code: ${moved#, } now run from the ourostack marketplace (ourostack/desk), with automatic updates on."
  [ -z "$binding" ] || say "Your desk binding carried over to the new install."
  staying="$(ids | awk '$1 ~ /@ouroboros-skills$/ { print $1 }' | sort)"
  for f in $failed; do staying="$(printf '%s\n' "$staying" | grep -vx "$f" || true)"; done
  if [ -z "$staying" ] && [ -z "$failed" ]; then
    claude plugin marketplace remove ouroboros-skills >&2
    say "The old ouroboros-skills marketplace is removed."
  elif [ -n "$staying" ]; then
    say "These V1 plugins stay installed from the old ouroboros-skills marketplace: $(printf '%s\n' "$staying" | paste -sd ' ' - | sed 's/ /, /g')."
    [ -z "$why" ] || say "${why%$'\n'}"
    say "V2 in ourostack/desk replaces V1. When you no longer need them, remove them with:"
    # Dependents first, then the plugins they depend on, then the plugins kept for them, then the marketplace.
    order=""
    for pass in dependents dependencies; do
      for id in $staying; do
        case " $keep " in *" ${id%@*} "*) continue ;; esac
        case " $needed " in *" ${id%@*} "*) [ "$pass" = dependencies ] || continue ;; *) [ "$pass" = dependents ] || continue ;; esac
        order="$order $id"
      done
    done
    for k in $keep; do order="$order $k@ouroboros-skills"; done
    for id in $order; do
      say "  $(remove_cmd "${id%@*}")"
    done
    say "  claude plugin marketplace remove ouroboros-skills"
  fi
fi

printf '%s' "$report"
if [ -n "$failed" ]; then
  echo "Desk is now installed from ourostack/desk, but Claude Code could not uninstall:$failed. Uninstall each with 'claude plugin uninstall <plugin>' (add --scope project or --scope local if it was installed there), then restart the session." >&2
  exit 1
fi
```

## Announce

Desk moved to ourostack/desk. The migration's report above says what changed on this machine and anything left for you to do. Restart this session so Desk loads from its new home.
