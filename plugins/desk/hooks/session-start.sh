#!/usr/bin/env bash
# desk worker — SessionStart hook.
#
# Fast, non-blocking foundation injected as additionalContext, followed by a pointer to the authoritative `desk:session-start` scan. Deliberately does no workspace, network, or Git work. MUST always exit 0 because a nonzero SessionStart hook blocks the session from starting.

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FOUNDATION_SKILL="${1:-$PLUGIN_ROOT/skills/using-desk/SKILL.md}"

# This is the final Desk release on the ouroboros-skills channel, so every startup opens with the move.
MOVE_NOTICE="Desk has moved to ourostack/desk. Run the move-to-ourostack-desk migration now (desk:session-start-migrations): $PLUGIN_ROOT/migrations/01-move-to-ourostack-desk.md"

emit() {
  # Emit a SessionStart additionalContext JSON object. Prefer jq for correct escaping; fall back to minimal manual escaping if jq is absent.
  local ctx="${MOVE_NOTICE}
$1"
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

# Ask the MCP server's own resolver which desk this session binds, so the hook
# and the server can never disagree. It honours the Claude project, the saved
# binding, $DESK and the home fallbacks, and always exits 0.
root=""
if command -v node >/dev/null 2>&1; then
  root=$(node "$PLUGIN_ROOT/mcp/scripts/resolve-desk-root.js" --root-only 2>/dev/null)
elif [ -n "${DESK:-}" ] && [ -d "$DESK" ]; then
  root="$DESK"
fi

if [ -n "$root" ]; then
  direction="Desk startup: \$DESK is $root. Invoke desk:session-start now for the authoritative workspace scan before other work; if an overlay launches Desk with its own root, desk_status reports the root Desk actually bound."
else
  direction="Desk startup: no desk is bound yet, so Desk is in setup mode. Run the onboarding path desk_status names now — desk:first-run-bootstrap by default, which looks for an existing local desk, then the operator's desk repository on GitHub, and otherwise offers to create one; an overlay that owns its workspace names its own, such as crew:join-crew. Do not offer to continue without Desk. After setup, desk:session-start remains the authoritative workspace scan."
fi

emit "${foundation}

${direction}"
exit 0
