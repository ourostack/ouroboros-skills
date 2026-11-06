#!/usr/bin/env bash
# desk worker — SessionStart hook.
#
# Fast, non-blocking foundation injected as additionalContext, followed by a pointer to the authoritative `desk:session-start` scan. Deliberately does no workspace, network, or Git work. MUST always exit 0 because a nonzero SessionStart hook blocks the session from starting.

DESK="${DESK:-$HOME/desk}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FOUNDATION_SKILL="${1:-$PLUGIN_ROOT/skills/using-desk/SKILL.md}"

emit() {
  # Emit a SessionStart additionalContext JSON object. Prefer jq for correct escaping; fall back to minimal manual escaping if jq is absent.
  local ctx="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg c "$ctx" \
      '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}' 2>/dev/null && return 0
  fi
  ctx="${ctx//\\/\\\\}"; ctx="${ctx//\"/\\\"}"; ctx="${ctx//$'\n'/\\n}"
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}' "$ctx"
}

if [ ! -r "$FOUNDATION_SKILL" ]; then
  emit "desk worker boot — the Desk foundation could not be read from $FOUNDATION_SKILL. Invoke desk:session-start before other work; it remains the authoritative workspace scan."
  exit 0
fi

foundation=$(cat "$FOUNDATION_SKILL" 2>/dev/null) || {
  emit "desk worker boot — the Desk foundation could not be read from $FOUNDATION_SKILL. Invoke desk:session-start before other work; it remains the authoritative workspace scan."
  exit 0
}

if [ -d "$DESK" ]; then
  direction="Desk startup: \$DESK is $DESK. Invoke desk:session-start now for the authoritative workspace scan before other work."
else
  direction="Desk startup: \$DESK ($DESK) does not exist yet. Invoke desk:session-start now for the authoritative workspace scan; it will route to first-run-bootstrap."
fi

emit "${foundation}

${direction}"
exit 0
