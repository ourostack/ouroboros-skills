---
name: stay-in-turn
description: Stay-in-turn for long-running work — the right way to wait on CI, batched merges, multi-PR refactors, audits, and any operation that takes longer than a couple of minutes. Resolves the "Claude keeps stopping mid-task" failure mode by replacing background+wakeup yields with a Monitor stream that produces events back into the same turn.
---

This skill is short. Read it once. Reach for it whenever a task involves waiting on something external (CI, deploys, production smoke, network, long script, multi-step chain) — especially when the operator says "do not return control until X is done."

## The failure mode

The recurring shape:
1. You start a long-running operation (a CI run, a chain of N PR merges, a build, a sleep).
2. You use `Bash run_in_background: true` to launch it.
3. You call `ScheduleWakeup` to "come back later."
4. You write a summary and end your turn.
5. From the operator's perspective, **Claude stopped**. They have to read the summary and decide whether to nudge.

Even if the wakeup eventually fires, the conversation visibly pauses. The operator becomes the orchestrator, poking the system every cycle. They didn't ask to be that. They asked for the task to finish.

## The fix

Use **`Monitor`** to stream events from the long-running operation back into the same turn.

The Monitor tool's contract: events arrive on their own schedule. They are NOT user replies — they're notifications. Your turn continues across them. You react in-turn, take an action if the event signals a problem, and wait for the next event.

The shape:

```
1. Write a driver script that does the whole long task and emits one event line per logical milestone (per PR, per file, per check, per deploy, per smoke).
2. Launch the driver via Bash run_in_background: true.
3. Start a Monitor that tails the driver's stdout, filtered to event lines.
4. React to each event in-turn. Continue the same turn until the driver emits its end-marker (e.g. "DRIVER_END") or all expected events arrive.
5. Only then either run the autopilot durable continuation scan, or, outside autopilot, summarize and yield.
```

This is the standard for any task >2 minutes of expected wall-clock work.

## When to use what

| Scenario | Tool |
| --- | --- |
| Foreground command <2 min, you need the output now | `Bash` (no background) |
| One-shot wait for a specific completion ("tell me when build finishes") | `Bash run_in_background: true` with an `until <condition>; do sleep 30; done` body — completion = single notification |
| Recurring events, eventual end (per-PR result, per-test pass/fail, per-deploy result, per-smoke result, per-file processed) | `Monitor` with a driver script that emits one line per event |
| Indefinite watch (every error in a log, "tell me whenever an event happens") | `Monitor persistent: true` |
| **Genuine "come back days from now"** (cron-like, not in-turn waiting) | `ScheduleWakeup` — and only this case |

`ScheduleWakeup` is for "come back tomorrow when conditions outside this conversation might have changed." It is NOT a yield-mechanism for in-turn work. Using it that way is the failure mode this skill exists to fix.

## Driver script shape

```bash
#!/bin/bash
# driver.sh — process a list of items, emit one event per result.
set -u
ITEMS=(...)
echo "DRIVER_START total=${#ITEMS[@]}"
for item in "${ITEMS[@]}"; do
  echo "BEGIN item=$item"
  if process_item "$item"; then
    echo "OK item=$item"
  else
    echo "FAIL item=$item reason=$(why "$item")"
    # Optionally break on first failure so you can intervene
    break
  fi
done
echo "DRIVER_END"
```

The event vocabulary (`BEGIN`, `OK`, `FAIL`, `DRIVER_START`, `DRIVER_END`) is yours to choose, but include enough information in the event that a single line tells you what to do next without needing to grep the log.

## Monitor invocation shape

```
Monitor(
  description: "merge chain events",
  command: "tail -F /tmp/driver.log 2>&1 | grep --line-buffered -E '^(DRIVER_START|DRIVER_END|BEGIN|OK|FAIL)'",
  timeout_ms: 3600000,         // up to one hour for typical chains
  persistent: false,           // false ends when the tail ends; true requires explicit TaskStop
)
```

Critical details:
- Always use `grep --line-buffered` in pipes. Without it, pipe buffering delays events by minutes.
- Always include both success and failure markers in the grep alternation. A monitor that only emits `OK` lines stays silent on a crash. Silence ≠ success.
- Set `timeout_ms` generously but finitely. The chain should self-terminate via `DRIVER_END`; the timeout is just a backstop.

## Reacting to events in-turn

When a `FAIL` event lands:
1. **Inspect** — read the per-item log to understand the cause.
2. **Decide** — is this auto-fixable (e.g. add an exempt-list entry, widen a v8-ignore block, retry after a flake) or substantive? Under autopilot/no-human-gates, route substantive failures through reviewer/fixer support and the hard-exception test before considering operator input.
3. **Act in-turn** — apply the fix, re-launch the driver from the failed item if applicable.
4. **Or surface** — only when the failure is a true human-only credential/capability blocker or an unrecoverable destructive shared-state action with no safe staged path. Summarize the failure with enough context that the operator can decide, and ask. Do NOT yield silently.

When an `OK` event lands: nothing to do — the chain continues. You can still react to it (e.g. update progress in a task list) but don't write to the operator unless the user asked for milestone announcements.

When `DRIVER_END` lands: treat it as the driver finishing its current queue, not proof that the overall mandate is done. Under autopilot/no-human-gates, run the autopilot durable continuation scan before summarizing; if it finds a ready next item, start that item instead of yielding. Outside autopilot, summarize and yield naturally.

## When the operator says "do not return control until X is done"

This phrase is your cue to use this pattern. The operator is asking for an autonomous chain. The Monitor pattern lets you deliver it. ScheduleWakeup-then-yield does NOT — the operator's experience is that you stopped.

The chain ends at the terminal state, not at the first green checkpoint. For fully-agentic repos, keep the driver or foreground loop alive through PR merge, deploy/publish/install verification, consuming-surface smoke, cleanup, and the autopilot durable continuation scan. A driver that emits `OK pr=123 merged` and then exits before deploy/smoke is encoding the same premature handoff this skill exists to prevent.

If the chain genuinely cannot run autonomously, first apply the autopilot hard-exception test: spawn reviewer/fixer support for ambiguity, try safe staged paths, and run the durable continuation scan for other ready work. Surface operator input only for a true human-only credential/capability or an unrecoverable destructive shared-state action with no safe staged path; after that input is resolved, run autonomously the rest of the way.

## Anti-patterns

- **Wakeup chaining**: ScheduleWakeup → process one item → ScheduleWakeup → process one item. Each wakeup is a return-of-control. Use Monitor instead.
- **Background + sleep + check loop in the foreground**: a poll loop in the foreground works but burns Bash calls. A driver + Monitor is cleaner.
- **Monitor with too-narrow grep**: filter that only matches success markers means failures are silent. Always include failure markers.
- **No `--line-buffered`**: events buffer until the pipe closes. Looks like the chain hung.
- **Driver script with no end-marker**: Monitor never knows when to stop emitting. Always emit `DRIVER_END` (or whatever sentinel you chose) at the bottom of the driver.

## Cross-references

- **work-merger** — when merging multiple PRs serially, this is the pattern.
- **full-systems-audit** — when running multiple parallel exploration agents and triaging their results, you can use Monitor to stream "agent done" events.
- **inch-worm** — when running a backlog campaign, the same shape applies.

If a downstream skill says "wait for CI" or "process N items," the implementation should default to the driver-plus-Monitor shape. Document the event vocabulary and end-marker in that skill so future invocations are consistent.

## Final principle

A turn that ends with "I started a background task, will check later" is a turn where you stopped. The operator does not want you to stop. They want the task done. The Monitor pattern is how you do the task done without stopping.
