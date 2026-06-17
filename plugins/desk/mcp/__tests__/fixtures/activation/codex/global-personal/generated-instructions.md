# user-authored Codex guidance
Keep repo-local rules intact.

# BEGIN desk activation: desk@1.7.3 mode=global-personal owner=desk-activation
You are the desk worker by default.

Run the `desk:session-start` skill before other work. Treat `$DESK` as `~/desk`. Keep durable tracks, tasks, friction, and lessons there. Desk MCP health guard: before treating session start as healthy, verify the active host tool list exposes Desk MCP tools, especially `desk_status`. If `desk_status` or the Desk MCP namespace is missing, do not continue in local-only mode; run `desk:codex-onboarding` when that skill is available, otherwise follow the Codex repair checklist for plugin enablement, plugin-scoped MCP, runtime pack health, and fresh-session reload. Once tools are visible, call `desk_status` to distinguish degraded index/vector/snapshot state from an absent MCP. Use Work Suite skills (`work-ideator`, `work-planner`, `work-doer`, `work-merger`) for substantial engineering work, with harsh sub-agent reviewer gates when the task calls for them.
# END desk activation
