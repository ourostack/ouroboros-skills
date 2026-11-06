---
name: curator
description: Invoke ONLY when the operator explicitly asks to process the open friction backlog — walk each open `_friction/*.md` entry and decide encode / no-op dispositions. Triggered by phrases like "let's go through friction", "process the backlog", "curate the friction", "let's curate". Do NOT invoke for appending a new friction entry (that's `friction-management`), answering questions about what's in the backlog, or discussing friction abstractly.
---

# Curator

This skill inherits all invariants in `../../principles.md`. Read
them first if they are not already in context.

Invoke this skill when the operator asks to process the friction
backlog — typically phrased as "let's go through friction," "process
the friction backlog," or "curate `_friction/`." Worker remains the
agent; curator is a set of instructions worker follows for the
friction-processing task.

## What this skill does

For each open friction entry in `$DESK/<track>/_friction/` (or
`$DESK/_meta/friction.md` for cross-track entries), produce
one of three dispositions:

1. **encode-in-skill** — content belongs in an existing or new
   `plugins/worker/skills/<name>/SKILL.md`. This covers both narrow
   single-purpose skills and longer multi-phase skills (like curator
   itself, or `pr-feedback-on-own-pr`) that worker internalizes for specific
   operator-triggered workflows.
2. **encode-in-repo-knowledge** — content is repo-specific (build
   gotchas, pipeline IDs, code-review rules for a particular repo);
   goes under `plugins/worker/repo-knowledge/<repo>/*.md` where the
   `repo-handling` auto-loader picks it up.
3. **no-op** — content cannot be encoded in the plugin. Carries a
   one-line rationale on the entry's `Status:` line and stays open on
   the originating friction doc. See the canonical example below.

No deferrals. Per `principles.md` Invariant 5, every entry gets a
disposition in the same pass. "Wait and see if it keeps happening" is
a deferral dressed up as a no-op; reject.

## Process

1. **List open entries.** `ls $DESK/<track>/_friction/` plus
   `$DESK/_meta/friction.md` for cross-track entries. Skip
   archived entries under `_archive/`.
2. **Read each entry end-to-end** before picking a disposition. Do not
   skim. Per `../../principles.md` Invariant 2, reactive edits without
   reading the full entry produce churn.
3. **Decide disposition.** Name the target file or rationale.
4. **Batch decisions.** Present dispositions to operator in one
   message with a clear table (entry → disposition → target). Wait
   for signoff. Per `../../principles.md` Invariant 1, do not walk the
   operator through one entry at a time.
5. **Encode in a single PR** against the plugin repo, one unit per
   entry, with per-unit acceptance checks (grep-presence + engine-
   agnostic audit). Worker uses the `work-planner` → `work-doer`
   skills for the planning/doing/execution pipeline.
6. **Archive** each landed entry: update its `Status:` line to name
   the PR and merge SHA, move it to `_friction/_archive/` in the
   same motion. See the `friction-management` skill.

## Engine-agnostic constraint

The plugin must not name a specific agent harness. Do not ship:

- Harness MCP tool names (use the underlying REST API instead — e.g.,
  `GET /_apis/git/repositories/.../pullRequests/{id}/threads`, not
  the MCP wrapper name).
- Subagent-spawn primitives (worker is the agent; skills are
  instruction sets worker internalizes, not separate agents to
  spawn).
- Harness-specific file paths like `.claude/settings.json` — see the
  canonical no-op below for the one exception.

The `AGENTS.md` hard constraint at the root of the worker repo
encodes this. Per-unit acceptance checks grep for harness-tool
identifiers (double-underscore-prefixed tool names, subagent-type
keys, spawn-paren forms) and expect zero hits.

## What a valid no-op looks like: engine-specific protection

The canonical example of the no-op disposition: a piece of friction
whose only viable resolution is a harness-level configuration file
(pre-execution hook, command interceptor, settings flag) that is
engine-specific and cannot ship in the plugin without breaking on
other harnesses.

**Shape of the ask:** Make it structurally impossible for the agent
to perform some unsafe operation (push to the wrong account, write
to a protected path, run an irreversible command without
confirmation) by intercepting at the harness level.

**What can land in the plugin (acceptable):** a skill-level degrade
path that runs the safety check before the unsafe operation and
fails loud if the check doesn't pass. Engine-agnostic, ships as a
skill, covered.

**What stays out of the plugin (the no-op):** the harness-level
interceptor configured in the operator's personal engine-specific
config file (e.g., a pre-execution hook in the operator's Claude
Code `settings.json`, an equivalent config in another harness).
This is a structural guardrail, layered under the skill-level
check.

**Why it is a no-op for the plugin:**

- The hook is configured via an engine-specific file. The plugin
  is engine-agnostic: `AGENTS.md` hard constraint #1 forbids
  shipping harness-specific configuration in plugin content.
- Shipping the hook in the plugin would break on any other harness
  that doesn't read that config file.
- The skill-level degrade path already handles the 99% case; the
  hook is belt-and-suspenders, not primary protection.

**Disposition:** plugin-side no-op. Entry stays open on
`_meta/friction.md` with `Status:` updated to name the
operator-personal config file the hook belongs in
(harness-specific). Operator handles the hook personally in their
own settings.

## When no-op is not the right call

Do not reach for no-op because encoding feels hard. Patterns that look
like they should be no-ops but aren't:

- "This is just a style preference" — style preferences encode into
  the applicable skill; not a no-op.
- "I don't know what skill to put it in" — that's a routing question,
  not a no-op signal. Ask the operator.
- "It might change" — encode the current version. If it changes
  later, update the encoding. Plugin content evolves; that's what
  PRs are for.

No-op is appropriate when: the content is structurally incompatible
with the plugin's engine-agnostic constraint (the engine-specific
protection case above), when the ask duplicates already-landed
content, or when operator explicitly decides against encoding after
seeing the proposal.

## Handoff back to worker

After all dispositions are decided and operator has signed off:

- Encoded entries become units of a single PR against the plugin
  repo. Worker uses `work-planner` → `work-doer` for planning and
  execution.
- No-op entries get their `Status:` line updated in-place. They do
  not move to `_archive/` — they stay open because the ask is not
  resolved, just redirected out of plugin scope.
- Curator is done when the backlog has zero undecided open entries.
