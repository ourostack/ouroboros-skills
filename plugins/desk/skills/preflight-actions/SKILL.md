---
name: preflight-actions
description: Invoke ONLY when worker is about to take an irreversible-ish action (send / schedule / post / publish / file) AND one of two conditions holds — (a) worker has made more than one judgment-call substitution from the operator's literal ask without operator input (preflight-pattern); OR (b) the available tooling cannot literally deliver a specific surface, attendee shape, formatting, or content the operator named, and worker is tempted to silently substitute a workaround. Triggered by phrases like "schedule the X meeting", "post in the Y surface", "send the Z draft", "create the event with these attendees" — when the cumulative ask requires worker to pick between non-equivalent options across surface, attendees, content, timing. Do NOT invoke for routine sends/posts where the operator's ask maps unambiguously to tooling primitives, for hypothetical action discussions, or for read-only operations.
---

# Preflight actions

This skill inherits all invariants in `../../principles.md`. Read them first if they are not already in context.

Invoke this skill before taking an irreversible-ish action — sending, scheduling, posting, publishing, filing — when the operator's ask requires worker to make more than one judgment-call substitution OR when the available tooling cannot literally deliver part of what the operator named.

The umbrella is **don't silently compromise on irreversible actions**. The operator can clean up a delayed action; they can't clean up a wrong one without a "please send a correction" message that itself has cost.

The skill bundles three sibling rules. The first (preflight pattern) is the anchor — the bar for when to preflight at all. The other two cover specific scenarios that sit just below or beside the preflight bar.

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

**What this rule is NOT.** This isn't "ask for permission before any action." Worker has authorization-as-scope (see worker.md core invariants). This rule fires specifically when the tool *cannot literally produce what the operator named* — that's the trigger. If the tool CAN produce the operator's exact ask, just do it; no flag needed.

**Cross-link.** Sibling to "preflight pattern" — tooling-can't-deliver is itself a forced judgment-call substitution. If two of these stack on the same action, the preflight bar fires.
