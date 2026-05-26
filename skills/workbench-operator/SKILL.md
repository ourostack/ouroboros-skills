---
name: workbench-operator
description: Use Ouro Workbench as the native control room for terminal/TUI agents. Invoke when a user asks an Ouro agent what is happening in Workbench, what is waiting on them, how to organize or resume terminal-agent sessions, how Desk mirrors Workbench groups, or how Claude Code, Codex, Copilot CLI, and shell sessions should be treated as first-class citizens.
---

# Ouro Workbench Operator

Ouro Workbench is the local machine sense for terminal and TUI agents. It is not
a replacement for Claude Code, OpenAI Codex, GitHub Copilot CLI, or local shells.
It is the room they run in, the transcript memory around them, and the audited
control surface the selected boss agent can use.

## Core Model

- **Boss agent:** the operator-selected Ouro agent for this machine. The boss can
  answer "what is going on?", inspect Workbench state, and queue native actions.
- **Terminal agent:** any terminal/TUI process in Workbench: Claude Code, Codex,
  Copilot CLI, shell, or another CLI agent. Treat each as first-class.
- **Desk worker:** an agent or harness setup inside a specific terminal session
  that can use the Desk plugin for that session's work. This is independent from
  the boss. Do not conflate boss selection with Desk worker setup.
- **Group:** a Workbench project tab group. By convention it mirrors a Desk
  track when there is a Desk import or onboarding arrangement.
- **Terminal tab:** one Workbench-owned terminal session inside a group. By
  convention it mirrors a Desk task or an active investigation thread.

## Harness Contract

Workbench should appear to Ouro as a named local sense:

```json
{
  "senses": {
    "workbench": { "enabled": true }
  },
  "mcpServers": {
    "ouro_workbench": {
      "command": "/Users/<operator>/Applications/Ouro Workbench.app/Contents/MacOS/OuroWorkbenchMCP",
      "args": []
    }
  }
}
```

If Workbench MCP is registered but `senses.workbench.enabled` is absent, repair
the config. If `senses.workbench.enabled` is true but Workbench MCP is absent,
register Workbench MCP. The native app's registrar should keep both fields in
sync.

## Tool Surface

When Workbench MCP is registered, expect these tools:

- `workbench_status`: current Workbench state, groups, terminals, process
  statuses, recovery plans, transcript paths, action log context.
- `workbench_sense`: the current Workbench sense contract and organization map.
- `workbench_transcript_tail`: bounded tail of a specific terminal transcript.
- `workbench_search_transcripts`: bounded search over saved terminal output.
- `workbench_recovery_drill`: dry-run recovery plan for quit, force-quit,
  reboot, and process-exit cases without mutating state.
- `workbench_request_action`: queue an auditable native action such as send
  input, create group, create terminal, move session, set trust, recover, or
  terminate.

Use read-only tools first. Use `workbench_request_action` only when the next
action is clear and within the operator's standing autonomy grant.

## Conversational Duties

When the operator asks "is anything waiting on me?" or "what is going on?":

1. Call `workbench_status`.
2. If needed, tail or search relevant transcripts.
3. Distinguish human-blocked work, agent-blocked work, crashed/stopped sessions,
   and normal background activity.
4. Move trusted sessions forward with queued Workbench actions when the next
   step is obvious.
5. Explain only meaningful state changes back to the operator.

When onboarding:

1. Check whether a reachable boss exists on this machine.
2. If provider auth or vault unlock is broken, classify the repair actor:
   `agent-runnable`, `human-required`, or `human-choice`.
3. Ask for human action only for raw secret entry, browser login, MFA, provider
   dashboards, destructive deletion, or Apple Developer signing/notarization.
4. Once the boss is reachable, scan recent sessions for Claude Code, Codex,
   Copilot CLI, Workbench, and shells.
5. Propose a small, high-confidence arrangement: Workbench groups mirror Desk
   tracks; terminal tabs mirror active tasks or investigations.
6. Set up Desk worker access inside the terminal harnesses that need it. Do not
   change the boss just to install a Desk worker.

## Desk Mirror

Desk and Workbench should make each other easier to resume:

- Desk track <-> Workbench group.
- Desk task <-> Workbench terminal tab.
- Desk task status should not be silently inferred from a terminal process.
  Use transcripts and explicit task cards as evidence.
- Workbench transcripts are evidence, not source-of-truth task cards.
- Desk task cards are durable work state, not terminal process supervisors.

## Boundaries

- Do not ask the operator to manually resume sessions that Workbench can recover
  or relaunch.
- Do not read arbitrary secrets out of transcripts. If auth is broken, use the
  provider/vault repair flow.
- Do not bulk-import every recent terminal. Prefer the smallest arrangement that
  captures active work.
- Do not treat app quit as session termination. Only explicit terminal exit or a
  trusted terminate action ends a terminal session.
- Apple Developer signing and notarization are distribution concerns, not
  prerequisites for local validation.
