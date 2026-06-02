#!/usr/bin/env bash
# desk worker — SessionStart hook.
#
# Fast, non-blocking orientation injected as additionalContext: tells the
# session it is the desk worker, where the desk is, and what work is open,
# then points at the authoritative `session-start` skill. Deliberately does
# NO network / git work (that belongs in the session-start skill, which can be
# interactive and hard-stop). MUST always exit 0 — a nonzero SessionStart hook
# blocks the session from starting.

DESK="${DESK:-$HOME/desk}"

emit() {
  # Emit a SessionStart additionalContext JSON object. Prefer jq for correct
  # escaping; fall back to minimal manual escaping if jq is absent.
  local ctx="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg c "$ctx" \
      '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}' 2>/dev/null && return 0
  fi
  ctx="${ctx//\\/\\\\}"; ctx="${ctx//\"/\\\"}"; ctx="${ctx//$'\n'/\\n}"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$ctx"
}

if [ ! -d "$DESK" ]; then
  emit "desk worker boot — \$DESK ($DESK) does not exist yet. You are the desk worker; invoke the first-run-bootstrap skill to set up the workspace before other work."
  exit 0
fi

open_list=""
count=0
while IFS= read -r card; do
  [ -n "$card" ] || continue
  status=$(grep -m1 -iE '^status:' "$card" 2>/dev/null | sed -E 's/^[Ss]tatus:[[:space:]]*//' | tr -d "'\"" | tr '[:upper:]' '[:lower:]')
  case "$status" in
    done|cancelled|canceled|archived|"") continue ;;
  esac
  rel="${card#"$DESK"/}"; rel="${rel%/task.md}"
  title=$(grep -m1 -iE '^title:' "$card" 2>/dev/null | sed -E 's/^[Tt]itle:[[:space:]]*//' | tr -d "'\"")
  if [ -n "$title" ]; then
    open_list="${open_list}
  - ${rel} [${status}] — ${title}"
  else
    open_list="${open_list}
  - ${rel} [${status}]"
  fi
  count=$((count + 1))
  [ "$count" -ge 12 ] && break
done < <(find "$DESK" -maxdepth 4 -name task.md -not -path '*/_archive/*' 2>/dev/null)

if [ "$count" -gt 0 ]; then
  emit "desk worker boot — your desk is \$DESK ($DESK). Open (non-terminal) tasks:${open_list}

Run the session-start skill now (prereq probe + desk sync + full scan) before other work, then offer to resume one of these or take new work."
else
  emit "desk worker boot — your desk is \$DESK ($DESK). No open tasks found in a quick scan. Run the session-start skill now (prereq probe + desk sync) before other work."
fi
exit 0
