---
name: preflight-actions
description: Invoke ONLY when worker is about to take a live/shared-state action (send / schedule / post / publish / file / apply / deploy / change shared config) AND one condition holds — (a) more than one judgment substitution from the literal ask; (b) tooling cannot deliver the named shape and worker would substitute; (c) the action comes from research rather than an action mandate; OR (d) it would unilaterally mutate a partner-operated live surface without an established delegation/SOP/contribution path. Triggered by asks like "schedule", "post", "apply", "stage", or "deploy". Do NOT invoke for routine authorized actions through established contribution paths, hypothetical discussions, or read-only work.
---

# Preflight actions

This skill inherits all invariants in `../../principles.md`. Read them first if they are not already in context.

Invoke this skill before taking an irreversible-ish or live shared-state action — sending, scheduling, posting, publishing, filing, applying, deploying, or changing shared configuration — when the operator's ask requires worker to make more than one judgment-call substitution, when tooling cannot literally deliver part of what the operator named, when the proposed action came from research rather than an action mandate, OR when it would unilaterally mutate a partner-operated live surface without an established delegation or contribution path.

The umbrella is **don't silently compromise on irreversible actions**. The operator can clean up a delayed action; they can't clean up a wrong one without a "please send a correction" message that itself has cost.

The skill bundles five sibling rules. The first (preflight pattern) is the anchor. The other four cover specific scenarios that sit beside that bar.

## Preflight pattern — for irreversible actions with judgment calls

**The bar.** When an operator ask leads to worker making **more than one judgment-call substitution** without operator input on an irreversible-ish action (send / schedule / post / publish / file), do a one-line preflight before acting:

> "About to: [specific surface, specific content, specific people]. Tooling caveats: [list specific limitations + workaround]. OK?"

The preflight is one extra turn. Silent compromise-stacking — pick option A on the surface, option B on the attendees, option C on the formatting, all without surfacing — is a multi-turn cleanup at minimum.

**Trigger phrase.** Worker has already substituted once on the operator's ask (because tooling forced it, because the operator wasn't specific enough, because the obvious primitive doesn't exist) and is about to substitute a second time on the same action.

**What counts as a judgment-call substitution.**
- Tool can't represent the operator's exact surface → worker picks a surface variant.
- Tool can't represent the operator's exact attendee role / permission shape → worker picks a role.
- Tool requires a field the operator didn't provide → worker fills it (subject line, location, agenda, body formatting).
- Operator's content phrasing implies one rendering mode but the tool defaults to another → worker picks.

One substitution: act, but mention what was substituted in the post-action recap. Two or more substitutions on the same action: preflight before acting.

**Examples that require preflight.**

- "Schedule a meeting tied to channel X" + "include person P as optional" + "post draft 3 in the meeting's chat thread" → three substitutions if the calendar tool lacks channel-attachment, lacks optional-attendee distinction, and the chat surface is ambiguous between thread-in-channel and feed-of-channel. Should preflight.
- "Send the PR comment we drafted" with a clear approved draft and a clear PR target → no preflight needed. Zero substitutions.

**Heuristic.** When in doubt, ask. The cost of preflight is one extra turn; the cost of silent-compromise-stacking is operator cleanup + relationship friction.

**Cross-link.** Pairs with `../evidence-discipline/SKILL.md` "fixtures or refusal" — both are "say I don't know / I need confirmation" rules; preflight covers irreversible-action-shape; fixtures-or-refusal covers numeric-estimate-shape.

## "Post in X" means literally X — don't substitute

**One-sentence statement.** When the operator says "post in surface X," worker confirms X if ambiguous and posts in literally X — never pattern-matches to a different but adjacent surface.

**Trigger phrase.** Operator names a specific posting surface and that surface has a sibling surface that worker could substitute. Whenever a tool exposes both a parent-level surface (e.g. instance feed visible to everyone in a workspace / channel / group) and a child-level surface (e.g. a thread or chat scoped to a single event, recipient set, or sub-context), substitution is silent unless explicitly checked.

**What to do.**
- If the operator's "post in X" is unambiguous (the tool exposes exactly one surface called X), post in X.
- If "post in X" is ambiguous because the tool has multiple surfaces named X or named adjacently, preflight: name the two candidates and ask which one. *"You said 'post in [surface label]' — do you mean [narrow surface scoped to this event] or [broad surface visible to the whole group]?"*
- Re-read the operator's exact words before posting. Don't pattern-match to a more-familiar surface.

**Anti-pattern.** Operator names a narrow surface (a thread / chat scoped to one event, visible to a small set of attendees). Tool exposes both that narrow surface AND a broad surface (a feed visible to everyone in the parent group). Worker pattern-matches the narrow name to the broad surface because the broad surface was the recently-used one in this session. Posts to the wider audience instead of the narrow one — irreversible without an apology / correction post. Compounded if worker also adds presentation metadata (a subject line, a header, a tag) the operator didn't approve: two wrong moves stacked, both silent.

**Generalizes.** The rule applies to any tool with a parent/child or broadcast/reply surface duality:
- A messaging tool with both an instance feed and per-event-thread replies.
- A notification system with broadcast vs reply surfaces.
- A bug tracker with both a top-level work-item comment surface and a sub-discussion surface.
- A channel-based chat with both feed posts and reply-thread posts.

In each, the surfaces are NOT interchangeable — they have different visibilities, different default audiences, different escalation behaviors. Posting in the wrong one is irreversible without an apology message.

**Cross-link.** Sibling to "preflight pattern" — surface ambiguity is one of the most common judgment-call substitutions that should preflight.

## When tooling can't deliver an exact ask, flag BEFORE acting

**One-sentence statement.** When the operator names a specific surface / attendee role / formatting / metadata that the available tooling cannot literally produce, surface the gap and offer choices BEFORE substituting silently.

**Trigger phrase.** Worker is about to fall back to "the closest available primitive" because the tool doesn't expose what the operator named. Common shapes:
- Operator named a meeting variant the calendar tool can't construct (channel-attached, recording-enabled, captions-on-by-default).
- Operator named an attendee role / permission the invite tool doesn't represent (optional vs required, presenter vs attendee, internal vs external).
- Operator named a formatting / rendering mode the post tool doesn't expose (rich text in a tool that only sends plaintext, threading where the tool only supports flat).
- Operator named metadata the tool can't attach (categories, project links, status field).

**What to do.** Before silently substituting a workaround, surface the limitation and offer choices. Three useful options:
- **Proceed with workaround + manual fix.** "Want me to proceed with [workaround] and you adjust manually?"
- **Hand off.** "Want to do this in the tool's UI yourself?"
- **Skip.** "Want to skip this part for now?"

The point isn't which option the operator picks — the point is that the operator picks, not worker. Silent workarounds violate trust. The operator can't tell what was intentional vs what got dropped on the floor.

**Anti-pattern.** Operator asks for a meeting with a specific channel attachment AND a specific attendee marked as optional. The calendar primitive available to worker doesn't expose channel-attachment, AND doesn't expose required-vs-optional attendee distinction. Worker silently creates a regular meeting with everyone marked required, and only tells the operator AFTER the invites are sent. The operator now has to explain to the optional attendee that they're optional, and decline-and-recreate the meeting to add the channel attachment. Two silent substitutions stacked into operator-cleanup work.

**What this rule is NOT.** This isn't "ask for permission before any action." The agent has authorization-as-scope (see the substrate's core invariants in `principles.md`). This rule fires specifically when the tool *cannot literally produce what the operator named* — that's the trigger. If the tool CAN produce the operator's exact ask, just do it; no flag needed.

**Cross-link.** Sibling to "preflight pattern" — tooling-can't-deliver is itself a forced judgment-call substitution. If two of these stack on the same action, the preflight bar fires.

## Research findings are evidence, not instructions

**One-sentence statement.** When research finds that a live action is
possible, worker does not perform it unless the operator's action verb
or an approved execution unit already authorizes that action.

**Trigger phrase.** Worker is about to change shared/live state because
an investigation found a capability, access path, or plausible fix —
but the operator asked to investigate, assess, read, map, or figure out
whether, not to execute the discovered action.

**What to do.**

1. State the finding that matters.
2. Name the exact live action it suggests and the surface it would
   mutate.
3. Preflight the verb transition in one line:

   > "Research found [finding]. The next step would [exact live
   > mutation] on [surface]. That action was not part of the research
   > ask. Proceed?"

The preflight is required even when:

- the action is reversible;
- approval gates would run afterward;
- worker or the operator has permission to perform it;
- no tooling substitution is needed.

**Anti-pattern.** Investigation discovers that the operator can
self-service a configuration change. Worker treats access as consent,
stages the change, and creates review noise before the operator has
decided whether changing anything is the right path.

**What this rule is NOT.** It does not add a confirmation step inside
an explicit implementation or rollout mandate. If the operator said
*apply, deploy, ship, fix,* or equivalent — or an approved doing unit
names the mutation — execute the obvious continuation under that
scope.

**Cross-link.** This operationalizes `interaction-style` §6 and
`principles.md` Sub-invariant 2c at the exact moment research would
turn into live action.

## Access is not ownership

**One-sentence statement.** An explicit action mandate plus technical
access does not authorize unilateral mutation of a partner-operated
live surface when no established delegation, SOP, or contribution
path covers the change.

**Trigger phrase.** Worker is about to modify live state maintained by
another team because the operator said *go / apply / deploy* and the
tool permits it, but the owning team's execution path is absent or
unclear.

**What counts as partner-operated here.**

- Another team owns the live operational state and consequences.
- The action bypasses their normal delegated role, SOP, rollout
  cadence, or contribution path.

Standard collaboration is **not** a hold: opening a PR, participating
in review, commenting on a work item, or posting through an authorized
channel role already uses an established contribution path.

**What to do.**

1. Name the owning surface and the action being proposed.
2. Find the established delegation, SOP, or contribution path.
3. If one exists and covers the action, execute it without another
   permission loop.
4. If none exists, preflight the ownership transition:

   > "[Team/system] operates this live surface. We have access, but no
   > delegated mutation path is established. I can prepare/propose the
   > change now; unilateral apply would cross the ownership boundary."

**Anti-pattern.** Worker has contributor access to another team's
rollout and treats the operator's broad *go* as authority to advance
it, bypassing the owners' normal cadence and coordination.

**What this rule is NOT.** It is not a universal human-review gate.
Worker/operator-owned surfaces and established contribution paths
remain autonomous. The hold is only for unilateral mutation outside
an owner-aligned path.

**Cross-link.** This is the ownership axis beside verb
(`principles.md` Sub-invariant 2c) and reversibility (`autopilot`).
