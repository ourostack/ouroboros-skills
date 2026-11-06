---
name: operator-voice-comments
description: Invoke ONLY when worker is drafting content for posting in the operator's voice — PR comments (top-level or thread reply), PR description prose, ADO work-item comments, chat messages worker drafts for the operator to send. Triggered by other skills (pr-feedback-on-own-pr, pr-surface-hygiene, pr-self-review, peer-pr-review) at their drafting steps. Do NOT invoke for skill-internal docs, doing-doc / planning-doc prose, commit messages, or worker's own chat replies to the operator (different surfaces with different conventions).
---

# operator-voice-comments

This skill inherits all invariants in `../../principles.md`. Read
them first if they are not already in context.

This is a **leaf skill** consumed by the PR-lifecycle skills
(`pr-feedback-on-own-pr`, `pr-surface-hygiene`, `pr-self-review`, and the
forthcoming `peer-pr-review`) at every draft-time touchpoint where
worker is producing content the operator will post in their own
name. The rules below govern that content; the consuming skill
governs everything else (workflow, dispatch, surface choice).

The operator's name and reputation ride on every word that lands
under their account. Worker's default writing posture is the
opposite of the operator's actual voice — softer, longer,
hedged, padded with anticipated retreats and inferred
mechanism-claims. The four sections below are the cumulative fix
for that drift.

## Surfaces in scope

In scope (worker is drafting; operator posts):
- Reply comments inside an existing reviewer thread.
- Top-level PR comments (status updates, ready-for-review notes,
  ad-hoc observations).
- PR description prose worker produces or audits.
- ADO work-item comments / descriptions.
- Group-chat messages the operator will send.

Out of scope (different surfaces, different rules):
- SKILL.md / repo-knowledge / planning / doing prose.
- Commit messages (ephemeral readership; the spirit applies but
  the audience is different).
- Worker's own chat replies to the operator.
- Friction entries / task cards / track cards.

## Surface mechanics

For most in-scope surfaces — PR comments, ADO comments, PR
descriptions — worker drafts prose and the operator (or worker via
the GitHub / ADO API on the operator's behalf) posts it. The
rendering is whatever the destination does with markdown, and
worker doesn't have to think about it.

The exception is Teams chat. When worker posts via
`mcp__teams__SendMessageToChat` or
`mcp__teams__UpdateChatMessage`, set `contentType: "html"` for any
multi-line content. The default `text` contentType collapses
newlines and bullets into a wall of text on Teams render —
paragraphs lose their breaks, lists lose their bullets, the
message becomes unreadable.

The Teams renderer's quirks are narrower than HTML's full surface,
and the default-to-`<p>` instinct backfires:

- **Inter-section separator: `<br><br>`** — force a visible blank
  line between every distinct section. `<p>...</p>` does NOT give
  visible paragraph spacing in Teams; the renderer collapses the
  inter-`<p>` margin to a single line break and your bold section
  header sits flush under the previous section's body.
- **Intra-section line break: `<br>`** — for header→body within a
  single section (`<b>Section</b><br>body...`).
- **No `<p>...</p>` wrappers.** They imply spacing they don't
  deliver, and bloat the source for no visible gain.
- **`<a href>`, `<b>`, `<i>` render fine inline.**
- **Avoid `<table>`, `<h1>`–`<h6>`, `<div>`, `<code>`, `<ul><li>`** —
  the rich-message-format reference lists some as supported but
  rendering is unreliable in practice. Inline code-ish strings
  (paths, identifiers, flags) work fine as plain text; engineers
  recognize `/path/to/something` and `EnableSomeFlag` without
  backtick formatting.

Single-line text sends are fine with the default `text` contentType.

**Counter-example (don't do this)**:
```html
<p>opener</p>
<p><b>Section A</b><br>body A</p>
<p><b>Section B</b><br>body B</p>
```
Renders as one continuous block with no visible breaks between sections.

**Correct shape**:
```html
opener<br><br>
<b>Section A</b><br>body A<br><br>
<b>Section B</b><br>body B<br><br>
closer line
```
Renders with a visible blank line between each section.

## Anchor placement

Before drafting a comment, decide where it lands.

**When authoring a PR comment in the operator's voice, default to a
file-thread anchored to the most specific applicable file/method.
Only escalate to a top-level PR comment if there is genuinely no
anchor in the diff — and that case is rare.**

The instinct to reach for top-level comments tends to fire when:

- a finding feels "about the PR overall" rather than about one
  piece (architectural, scoping, contract-shape)
- multiple files are touched by the same concern and worker
  hasn't picked the most central one
- the rationale is long and worker thinks "this needs framing
  room rather than a code anchor"

None of those reasons survive scrutiny. There is almost always a
specific file/method/property where the finding lands hardest, and
anchoring there makes the comment more actionable.

### Why anchored beats top-level

- **Recipient-acting cost.** Anchored comments sit next to the
  code they're about. The recipient sees the comment when they
  re-read that hunk during follow-up. Top-level comments require
  the recipient to hold the comment context separately and
  re-correlate to code.
- **PR-iteration durability.** File-thread anchors survive
  re-pushes (ADO tracks the line via diff-aware anchoring).
  Top-level comments float free of the diff state.
- **Reader-scanning cost.** A reviewer skimming the PR for
  unresolved threads sees anchored comments inline with the code
  they care about; top-level comments have to be opened
  separately from the Conversation tab.

### When top-level is genuinely the right call

- A meta-status post: "Ready for re-review", "Pinging on this
  one", "Test plan was updated".
- A finding whose subject is the PR's existence or framing
  itself: "This should probably be split into two PRs because X."
- A response to a top-level question someone else opened.

Architectural / scoping / contract-shape concerns are NOT in this
list. They almost always have a specific file or method as the
hardest-landing anchor — pick one and file-thread there. If the
concern truly spans many files equally, pick the most central
file and acknowledge the cross-cutting nature in the comment body
itself, not by floating the comment up.

## Chat-share register vs. ADO-comment register

The skill's tone rules below (No fabrication, No sycophantic
padding, Match operator's voice, Verify before posting) are
written predominantly in their **PR-comment register**: rationale-
first, formal, no double punctuation, no informal contractions.
That register is right for surfaces a third party reads cold,
possibly months later — PR descriptions, ADO thread replies,
work-item comments. The reader is approaching the surface
without context; rationale-first prose does the work.

**Teams chat surfaces are a different register.** Group chats,
DMs, replies in channel threads — these read live, in-context,
between peers who are already collaborating. The right register
is warm/loose, with a few specific positive shapes that
distinguish operator-voice from worker-default flat-by-rules
prose.

The negative rules (No fabrication, No sycophantic padding) apply
to BOTH registers. The positive shapes below are what make the
chat register land as the operator's actual voice rather than as
a polished PR comment that wandered into the wrong surface.

### Lead with gratitude

Open chat-share nudges to reviewers with **`hi <name(s)>!! thanks
for <X>`** before any ask. The acknowledgment isn't optional
padding — it establishes that the recipient is doing the operator
a favor, and the ask flows from that framing. Without it, the
message reads as treating their time as a debt being collected.

Compare the same situation in two registers:

- ADO thread reply (PR register): *"replies are up on the 3
  remaining active threads — happy to walk through any sync"*
- Teams group-chat ping (chat register): *"hi both!! thanks for
  reviewing the TCA PR — have 3 comments still open awaiting
  y'all's resolution. lmk if you have more thoughts there or if
  we can resolve"*

Same substance, different opening. The PR-register version is
correct for ADO; it would read flat-by-rules in chat.

### Dual ask

Pair "more thoughts there *or* if we can resolve" — invites both
substantive engagement AND thread-closure. Avoid single-track
framings like "lmk when you've got cycles," which signal only
the move-forward half without the value-your-input half. The
dual ask says "I value your input AND I want to move forward
when you're ready" in one phrase.

### Invite more at close

End with "also let me know if you have additional feedback" or
equivalent — keeps the channel open beyond the current set of
threads. Don't close the door with "otherwise just whenever
you've got cycles" or "no rush" — those read as worker pre-
empting a follow-up the operator might actually want.

### Surface markers

Teams chat tolerates and benefits from:

- Double punctuation: `!!`
- Informal contractions: `y'all's`, `lmk`, `wdyt`
- Lowercase openers: `hi <name>!!`
- Single-word energy markers: `sweet`, `cool`, `thanks!!`

PR / ADO surfaces don't. The contractions and double punctuation
that make a Teams ping land warm read as unprofessional in a PR
description.

### Concrete shape pairs

| Bad (transactional / cycles-as-tax) | Good (gratitude-first / collaborative) |
|---|---|
| `"Hi both — replies are up on the last 3 active threads. lmk when you've got cycles 🙏"` | `"hi both!! thanks for reviewing — have 3 comments still open awaiting y'all's resolution. lmk if you have more thoughts or if we can resolve"` |
| `"Pinging on the 4 outstanding threads — let me know what's blocking"` | `"hi <name>!! thanks for the review pass. 4 threads still open — happy to walk through any sync, or feel free to push back / resolve as you see fit"` |
| `"Reminder: PR <id> has X open threads from you"` | (Just don't write a reminder. Write the gratitude-first variant above.) |

### Voice test for chat-share

Read the draft as the recipient. If it reads transactional —
"operator collecting status," "cycles owed" — the register is
wrong for chat. The replacement reads as a collaborator asking
for help, with the gratitude-first opener doing the framing
work. A reviewer reading a transactional ping rolls their eyes;
that's the symptom the chat-register rules exist to prevent.

### When the surface is ambiguous

Some surfaces are hybrid (a Teams channel post that serves as a
quasi-status-update and gets read later by people who weren't
online). When in doubt, lean to the surface's primary read mode:
live-and-peer → chat register; cold-and-formal → PR register.
If genuinely uncertain, ask the operator which one the post is
for.

## No fabrication

Seven kinds of fabrication recur in operator-voice drafts. They
share one root failure mode — worker introducing fact-shaped
content the operator did not supply and cannot verify on the
spot — and they read identically to the recipient: a confident
claim attached to the operator's name, with no underlying
evidence.

### Historical specifics

When a draft references operator history — "the recent X
cleanup," "we hit this trap before with Y," "based on our prior
incident with Z" — the specifics get verified before the comment
goes out. "Directionally plausible" doesn't pass the bar; the
operator is on the hook for every named claim, and a recipient
who can't verify the framing may take it at face value.

The risk is highest when worker is **building a case for a
recommendation**. The recommendation might be sound; supporting
it with invented prior incidents undermines trust regardless.

**Verify before naming.** Before writing a comment that
references a specific past event, check workspace files
(planning docs, design docs, `_friction/`, `_landscape/`,
`_meta/`), prior chat history, SharePoint / OneDrive for
operator-authored docs, or ADO (wiki pages, work item history,
prior PR threads).

**If you can't verify but the reference is still useful, gesture
without specifics.**

- Bad: "the recent `TeamId` vs `TeamsId` cleanup."
- Good: "the recent cleanup of overlapping ID names in this
  codebase" (no specific names that could be wrong).
- Best: verify the actual specifics, then cite verbatim with
  confidence.

**If the recommendation is the substance and the historical
reference is supporting context, drop the supporting context if
you can't verify it.** The recommendation either stands on its
own merits or doesn't.

The bar is higher for operator-facing PR comments than for
internal walkthroughs. Internal walkthroughs can hedge ("I think
there was a recent confusion around X, worth checking") because
the operator can correct on the spot. PR comments go to a third
party who has no way to verify and may take the framing at face
value.

**The one-sentence test.** If a third-party reviewer asked
"where's the documented history for that claim?" — could worker
point to a specific source? If no, don't make the claim.

### Calendar timelines

Worker-suggested timelines that get baked into long-lived
artifacts (PR descriptions, ADO task titles, commit messages)
are hard to remove later. Once "60-day follow-up" sits in an
ADO task title, every downstream surface that references that
task carries the implicit claim that the team agreed to a 60-day
timeline — which isn't what happened.

**Rule**: bake calendar timelines ("60-day follow-up," "in 30
days," "Q3 revisit") into operator-facing surfaces only if the
operator explicitly named the number.

**Default framing for follow-up criteria is data-driven, not
calendar-driven:**

| Bad (worker-fabricated calendar) | Good (data-driven) |
|---|---|
| "60-day follow-up" | "once usage telemetry lands" |
| "Revisit in Q3" | "after the next rollout-monitor cycle" |
| "30-day grace period" | "after 100 events accumulate" |
| "Re-evaluate in a month" | "once X% of GET volume measured" |

**Application:**

1. When proposing a follow-up review cadence, frame it on the
   underlying data signal — "once telemetry lands" / "after
   usage data accumulates" / "at the next rollout review" —
   never "in N days/weeks/months" unless the operator named the
   number.
2. If the operator DOES name a calendar ("let's revisit before
   EOM Q3"), it's fine to bake into surfaces — that's an
   operator-authored timeline, not worker-fabricated.
3. **Pre-existing surfaces that have inherited a worker-
   fabricated timeline**: surface to operator before reusing the
   framing. "ADO task X title says '60-day follow-up' — was that
   your call or worker's? Worth retitling?"

**Cost asymmetry**: data-driven framings are slightly less crisp
("once telemetry lands" is vaguer than "in 60 days") but always
defensible. Calendar framings sound crisper but bind the team to
a number nobody actually committed to. Crispness on a fiction is
not worth the cleanup cost.

### Numeric duration / cost / scope estimates

A draft that includes "~N min", "~N hr", "should take roughly
X", "ETA Y", "this'll cost Z", "~N PRs" carries a numeric claim.
The recipient reads it as data — same way they'd read a
benchmark figure or a documented build time. If worker can't
cite the fixture that generated the number, the number is
fabrication.

**Distinct from Calendar timelines** (above) — that rule covers
WHEN ("60-day follow-up"); this one covers HOW LONG / HOW MUCH /
HOW BIG ("~2 hr total", "~$50 spend", "~5 PRs"). Both rest on
the same principle: numeric claims need fixtures.

**The relay failure mode.** The most common path numeric
estimates reach operator-voice content is inheritance — worker
is composing a plan based on another agent's output, an upstream
tool's hint, or a prior conversation turn, and the estimates
ride along untouched. "It came from upstream" does not make it a
fixture. If the upstream source had no measurement behind the
number, it's fabrication regardless of how many hops it
traveled.

**What to do.**

1. Before quoting a number in operator-voice content, identify
   the fixture: a measured prior run, a documented spec, a
   build-time log, a benchmark. Cite the source inline.
2. If no fixture exists, strip the number from the draft. The
   plan stands on its substantive content; numbers without
   anchors are noise.
3. When auditing inherited content (relay case), apply the same
   test to every number — do not waive the rule for content
   that arrived pre-formed.

**Cross-link.** Canonical home is
`../evidence-discipline/SKILL.md` → "Fixtures or refusal." This
sub-section is the operator-voice-content reinforcement of the
same rule. The `interaction-style` §7 sub-section "Strip
fabricated estimates from response prose" reinforces at the
response-prose surface.

### Code mechanism

A factual claim about code mechanism — "X happens because Y → Z
→ W gets discarded / preserved / lost" — must be verified by
reading the exact lines, not inferred from surrounding context.
The first three steps of a chain may be verified from the diff;
the fourth ("token gets discarded") is often where worker
substitutes "the typical pattern is..." for an actual read.
That's the failure mode.

Identify load-bearing claims in the draft. Anything of the form
"because the [function/handler] [does X]" is a claim — every
step in a chain is a claim.

**Inferred-mechanism flag phrases.** When any of these surfaces
in the draft (or in the reasoning that produced the draft),
treat it as a signal that the claim is inferred, not verified:

- "probably returns null"
- "the typical pattern is..."
- "based on similar code elsewhere..."
- "it's reasonable to assume..."
- "it likely [does X]"
- "the catch presumably [does Y]"

Either verify, or soften the claim to match the actual evidence.
Hedging language pasted onto an inferred claim ("I think,"
"probably," "if I'm reading this right") makes it worse — now
the draft hedges a claim worker should have verified, which
signals to the recipient that the work wasn't done.

**Cheap verification techniques.** Re-read the function body at
the cited line. Trace each `try` / `catch` / `return` / `throw`
explicitly through the source. Two minutes of reading clears
most inferred-mechanism risk.

**Acceptable shapes when verification isn't possible.**

- Drop the specific mechanism claim entirely. "If a non-ETag
  exception fires here, the cascade affects the lookup outcome.
  broaden the catch?" is weaker but accurate.
- Reframe as a question. "what does the outer catch do with X
  on a non-ETag failure?" — invites the reviewer to check;
  doesn't claim.
- Cut the comment if you can't make the case without unverified
  claims.

> **Consumer agents adding MS-internal trust-boundary discipline use `worker:ms-infra-trust-boundaries`.**

### Bot-derived urgency

Review-bot SLA-breach badges, queue-wait age, "PR has been
Active for N days," "review-bot has nudged" — these are **bot
state, not human state**. The bot has its own clock; the author
and operator have theirs. Treat bot signals as informational
only:

- "PR has been Active for N days" → fact about platform state.
- "Review-bot has nudged" → fact about the bot's behavior.
- "SLA-breach badge fired" → fact about the bot's clock, NOT a
  fact about author urgency.

**Don't translate bot signals into urgency framings unless the
operator independently confirms timing pressure.** Phrases like
"author is waiting," "we should move quickly," "they need
feedback fast" require operator-confirmed context, not
bot-derived inference. If the operator says "they just put it
out for review," "they're in no rush," or "no time pressure" —
that overrides any bot-signal urgency. Listen for those
overrides and update the working framing; don't keep reaching
for the prior framing after correction.

**Default posture: "as much care as needed."** When proposing a
course of action, take pressure framing OUT unless the pressure
is real and operator-confirmed. The cost of moving slowly with
care is almost always less than the cost of moving quickly with
bot-manufactured urgency.

**Symptom phrases to watch for.** "Has been waiting," "sitting
for N days," "SLA-breached," "in the queue for X" — each carries
implicit pressure. When a draft is about to use one as an
argument for speed, verify the operator has confirmed the
pressure first.

**Self-check.** If the operator hadn't said anything about
urgency, where did "we should move faster" come from? If the
answer is "the bot," that's not enough.

### Business-model coherence

When a draft critiques a charging, pricing, quota, or budget-flow
decision, the no-fabrication rule extends to **business-model
coherence**. The failure mode: worker reasons about charging in
isolation ("if X charges, the spam attack succeeds at Y's
expense") without asking the business-model question ("who
*should* pay when the system incurs cost on a real-traffic-shaped
attack?"). The owner of the abuse vector usually owns the cost;
the spam-protection layer (rate limits, budget caps, ADAP) is the
lever that bounds drain — not the unit-cost setting on a per-
intent line item.

Three checks before posting:

1. **If the proposed change lands, who covers the underlying
   cost instead?** Compute happened; someone covers it.
   "Customer shouldn't pay" is a position, but it implies
   "the provider eats the cost" or "the request never gets
   served." If the draft doesn't acknowledge that trade, it's
   reasoning about charging in a vacuum.
2. **What layer is the actual lever for the concern?** Drain
   from spam is a *spam-protection* problem, bounded by rate
   limits and budget caps. Saying "don't charge for it" is
   solving the wrong layer's problem.
3. **What's the customer's mental model under the contract?** A
   PAYG customer has a contract: pay per interaction, control
   via rate limits and budget. A "free carve-out" breaks that
   contract's coherence — invites edge-case questions about why
   one variant is free and not another.

If any check fails, reframe to operate on the actual lever
("is the spam-protection adequate to bound drain at the
customer's expense?") or drop the draft.

## No sycophantic padding

Operator-voice prose is direct, fact-shaped, and lean. Worker's
default is the opposite — soften every ask, pre-empt every
objection, leave every scope-clarification, add an out-clause
"in case they push back." That kind of padding does three
things, all bad:

1. **Puts words in the operator's mouth.** "Happy to file
   separately if it feels out of scope" claims the operator's
   emotional posture (happy, accommodating) before they've
   decided how they feel. Same with "would you be open to" —
   that's worker presuming the operator wants to defer.
2. **Pre-empts a conversation that hasn't started.** A comment
   is a conversation opener; the recipient gets to respond.
   Worker including the anticipated response inside the question
   turns it from an open question into a leading question with
   built-in retreat. The recipient can't respond freely because
   the answer is partly pre-written.
3. **Reads as not-operator's-voice.** Operator's actual style is
   direct: "Is there a reason we don't try all channel team
   members?" not "Would you potentially be open to considering
   whether all channel team members might possibly be tried?"
   The peers operator works with are also direct. A padded
   comment from the operator's account reads as off-tone.

### Strip preemptive accommodation

Search the draft for these phrases — each is a candidate for
deletion. Sometimes one survives, but the bar is high.

- "happy to"
- "would you be open to"
- "would it be possible to"
- "if you have time"
- "if it's not too much trouble"
- "no pressure"
- "if it feels"
- "if you'd like"
- "feel free to"
- "totally fine to"

### Strip preemptive scope-defense

"Strictly scoped to X," "I'm not asking for Y," "no need to do
Z" — only include if there's evidence the recipient has
previously pushed back on scope. Otherwise it's worker
explaining why the ask is reasonable, which is content the
recipient can derive themselves.

### Strip preemptive concession

"Happy to file separately," "totally fine to defer," "no need to
address now" — these say "I'm already retreating" before the
recipient has objected. Let them ask if they want to defer.

### Don't follow-on without value-add

When queuing a comment that follows on from an existing thread,
the bar is **does this add substance the natural conversation
won't produce?** If the comment is the obvious next question
someone in the room will ask within a turn or two, drop it.
Operator-voice piling-on dilutes the operator's signal on the
comments where they DO add unique substance. Trust the existing
thread.

Three checks before queuing a follow-on:

1. **What new substance does this comment introduce?** A specific
   claim, a quantification, a cross-team angle, a concrete
   counter-proposal. If the answer is "the next obvious question
   that someone else will ask within a turn or two," drop the
   draft.
2. **Would the conversation already cover this?** If the existing
   thread's natural arc lands on the same point, worker piling on
   adds noise, not signal.
3. **Is worker the right voice for it?** If the operator has no
   privileged context relative to the thread (they're not the
   named owner, they don't have data the thread needs), the
   operator's voice on a piling-on comment dilutes their signal
   for the comments where they DO add unique substance.

If all three checks fail, drop the draft. This is the same logic
behind "drop the comment if you can't make the case without
unverified claims" (under No fabrication / Code mechanism) — a
comment that doesn't add value isn't worth posting under the
operator's name.

### Don't explain the recipient's own code back to them

The author wrote the code; they know what it does. Padding a
question with "context" that just restates what's already
obvious to the author looks like worker is showing its homework
rather than respecting the author's expertise. Skip the
preamble; ask the question.

### Don't anchor feedback comments by referencing test names

A recipient acting on a comment cares about the production code
change, not which test does or doesn't cover it. Test-name
anchoring also tends to slide back into test-file analysis
worker shouldn't be doing. The substance of the comment carries
on its own.

### No trailing periods on PR comments

Apply to the LAST punctuation of every PR comment — not just
short chat-style ones. The original framing carved out
"short chat-style" but the actual usage rule is broader: PR
comments at every length read overly formal with a trailing
period in this voice register. Evidence: a peer review of six
file-thread comments (PR 1548324, 2026-04-28) had every single
trailing period removed by the operator on edit. 6/6 isn't a
short-comment quirk; it's the rule.

Internal periods between sentences in a multi-sentence comment
are fine. Trailing `?` and `!` stay. Only the FINAL punctuation
of the comment, when it's a period, is the over-formal signal.

Examples:
- `"loop only exits via the early-return paths above"` (no
  trailing dot)
- `"want to avoid confusion similar to the recent ID-name
  cleanup"` (no trailing dot)
- `"why do we drop the cancellation token here?"` (trailing `?`
  stays)
- A multi-sentence comment: internal `.` between clauses fine;
  final clause's terminal `.` still strips.

### Soften declarative recommendations

Recommendations need to land as suggestions, not directives. Two
softeners — pick at least one for any "you should X" / "worth
X-ing" shape:

- **Prefix with `consider` / `suggest` / `wdyt`** — turns the
  declarative into an explicit invitation:
  - Instead of `"worth adding the same gate here"` → write
    `"consider adding the same gate here"` or `"suggest adding
    the same gate here"`.
  - Instead of `"switching the verb to PATCH"` → write
    `"suggest switching the verb to PATCH"`.

- **End with `?` instead of a period** — turns a declarative
  into an open question. Often combined with the prefix:
  - `"consider adding the same gate here so the rollout has the
    same control surface?"`
  - `"worth mirroring on /smbconversations endpoints since
    they'll need the same operational visibility once they're
    handling real traffic?"` (note: `worth X-ing` shape needs
    the `?` to land as a question, not a directive)

The `worth X-ing` / `worth doing Y` shape isn't softer than it
looks — bare, it reads as "you really should." Without one of
the two softeners (prefix or trailing `?`), `worth` patterns
land as directives.

The directive-vs-suggestion line is the single most common edit
the operator makes on PR-comment drafts. Apply at draft time;
don't wait for the dial test to surface it.

### No worker-internal jargon

Worker-internal vocabulary has no place in operator-facing PR
comments. The recipient doesn't share worker's terminology and
shouldn't have to translate. Specifically watch for:

- **Abbreviations the recipient doesn't use**: `impl-PR`,
  `impl pr`, `the impl` (for "implementation PR" / "the
  implementation"). Operator-edit on PR 1548324: dropped
  `impl-PR` entirely; the recipient knows what's coming
  without that scoping.
- **Worker-pipeline phase names**: `Phase 7`, `the convergence
  loop`, `the bake-in pass`, `Tier-2`, etc. Internal
  workflow vocabulary; meaningless to a reviewer who doesn't
  use worker.
- **Worker skill names**: `operator-voice-comments`,
  `pr-self-review`, `pr-feedback-on-own-pr`, etc. Even if the
  reviewer also uses worker, naming the skill in a PR comment
  is over-internal — it's the equivalent of citing your IDE's
  refactoring tool by name when reviewing someone else's code.

If you find yourself wanting to write `"<X> PR"` (where `<X>`
is a worker-internal scope marker like `impl` / `next` /
`follow-up`), pause. Either drop the scoping (recipient
typically already knows what's coming next) or replace with
plain English (`"the next PR"`, `"when you implement"`,
`"the follow-up"`).

The check: would a reviewer who doesn't use worker plugin
understand this comment without translation? If no, replace or
drop the worker-isms.

### The voice test

Read the draft aloud as if the operator is saying it. If any
phrase makes the operator sound apologetic, deferential beyond
the actual posture, or like they're already backing down before
being challenged — cut that phrase. Trust the recipient to push
back if needed; they don't need worker to write their pushback
for them in the original comment.

### Don't add formatting / subject lines beyond the approved draft

When the operator approves draft text for a chat / channel / PR /
ADO surface, **stick to literal approved content**. No subject
lines, no extra emoji, no paragraph reorganization, no bold-header
metadata, no body-style overrides — unless the operator wrote them
into the approved draft.

The failure mode: the operator approves a casual chat-style message
("hi all!! quick heads up..."). Worker passes it to a posting tool
that exposes a separate `subject` / `title` / `header` field, and
worker fills that field with a worker-generated header
("Project X kickoff — Tue 9am PT"). The result renders as a
formal-looking announcement (bold subject sitting above the casual
body) — turning a friendly note into something that reads like an
official broadcast. Off-tone, and the operator can't even see what
went wrong from the draft they approved.

**Rule.** Mechanics that change visual presentation are part of the
voice. Subject lines, header fields, formatting metadata, content-
type overrides (when they affect rendering) — all live under the
same approval bar as body prose. If the operator's approved draft
doesn't include a subject, the post doesn't get a subject. If the
operator wrote `hi all!!`, the post sends `hi all!!` — not
`Hi All!!`, not `# Project X` above it, not bullet-formatted "for
clarity."

**Surface-mechanic exception.** Engine-level rendering choices that
don't change presented content — e.g., setting `contentType: "html"`
to make multi-line content render with visible line breaks (per
"Surface mechanics" above) — are still worker's call, because the
alternative is a wall of unreadable text. The line is between
*rendering choices that preserve approved content* (worker's call)
and *added content / metadata that changes how it reads* (operator's
call only).

## Match operator's voice

The shapes that read as operator-voice rather than as worker-
drafted:

### Direct question + supporting reason in one sentence

Use an em-dash or a colon to join the ask and its reason. The
ask comes first; the reason supports.

- Good: `"Naming question: rename X → Y? Reads as A rather than
  B — want to avoid the recent C confusion"`
- Good: `"why drop the cancellation token here — pattern
  elsewhere in this layer threads it through"`
- Bad: `"Quick naming question (totally optional!): would you
  potentially be open to renaming X → Y, given that it could be
  confusable with B? Happy to file separately if scoped wrong."`

### Lowercase nit prefix where the operator's style uses it

If the operator's own comments use a lowercase prefix
(`"nit: ..."`, `"naming: ..."`, `"q: ..."`), match that style.
Sentence-case-everything reads as worker overriding the
operator's voice. The lowercase prefix is a deliberate signal —
short, low-stakes, conversational.

- Good: `"nit: rename X → Y reads cleaner than the current
  shape"`
- Bad: `"Nit. Rename X to Y reads cleaner than the current
  shape."`

### Question shape where actually a question

If the comment is asking, write it as a question — with a `?`,
ending where the question ends. Don't dress questions as
declarations ("I wonder if X would be cleaner"); don't dress
declarations as fake questions ("could we maybe consider X?"
when the operator has already decided).

- Good (real question): `"is there a reason we don't try all
  channel team members?"`
- Good (real declaration): `"swap to the all-members path —
  current shape misses the SMB case"`
- Bad: `"I wonder if we might consider trying all channel team
  members"`

### One ask per comment

If a thread has two distinct concerns, that's two threads (or
two comments in the thread). Mashing them together loses the
recipient — they answer one and the other gets lost. The
operator's actual style is one ask per comment with high signal
density.

### Concrete shape pairs

| GOOD shape (operator-voice) | BAD shape (padded / worker-default) |
|---|---|
| `"naming: X → Y? reads as A rather than B"` | `"Quick naming nit (no pressure!): would you be open to renaming X to Y? It could be slightly clearer."` |
| `"why use bool here when the PATCH side is bool? — feels asymmetric"` | `"I noticed that this property is `bool` on the GET side and `bool?` on the PATCH side. Would you potentially be open to making them match? Totally fine to defer if out of scope."` |
| `"is there a reason we drop the cancellation token here"` | `"I see that CancellationToken.None is being passed here. Could you help me understand why we don't propagate the token from HttpContext like in similar code elsewhere in this layer?"` |

The GOOD shapes are shorter, sharper, and assume the recipient
will engage on the substance. The BAD shapes are longer, hedged,
and assume the recipient will be irritated by the question
unless worker pre-empts that irritation. The operator's actual
peers do not need to be pre-empted.

## Verify before posting

The dial test is the single check that ties the four
no-fabrication rules and the voice rules together. Run it on
every operator-voice draft before the comment goes out.

### The dial test

Read the comment as the recipient will read it — in their inbox,
on the PR, with no session context, no insight into what worker
considered before settling on this shape. For each factual claim
in the draft, ask:

> "If they push back saying this isn't quite how the code works
> (or this isn't quite the history they remember, or this
> timeline isn't real), do I have evidence?"

If the answer is no — the claim is unverified. The comment as
drafted will lose to a real conversation. Two acceptable fixes:

1. **Soften the claim** to match the actual evidence available.
   "If the outer catch returns null then..." is weaker but
   accurate; "the outer catch returns null" claims a fact worker
   didn't read.
2. **Cut the claim**. The comment may still stand on its
   surviving substance; if it doesn't, drop the comment.

### Hedging language doesn't rescue an unverified claim

"I think," "probably," "if I'm reading this right," "based on a
quick look" — pasting these onto an inferred claim makes the
draft worse, not better. Now the comment hedges a claim worker
should have verified, and the hedge itself signals to the
recipient that the work wasn't done. The recipient reads:
"worker didn't bother to check, and is trying to get away with
the claim anyway." That's worse for operator trust than just
omitting the claim.

The correct moves are: **verify**, or **soften to match
evidence**, or **cut**. Hedge-and-keep is not a fourth option.

### Where the dial test bites

The four no-fabrication rules each surface a specific symptom.
The dial test is the moment to catch them:

| Section | What the dial test catches |
|---|---|
| Historical specifics | "the recent X cleanup" — can worker name the source? |
| Calendar timelines | "60-day follow-up" — did the operator name 60? |
| Code mechanism | "X handler returns null on Y" — did worker read the line? |
| Bot-derived urgency | "the author needs feedback fast" — did the operator confirm? |

Treat each match as a hard stop on the draft until the claim is
verified, softened, or cut. Operator-trust regressions from a
single posted unverified claim cost more than any number of
silenced drafts.

### Tool-verify static-analysis claims

The dial test handles "did worker actually read the line." A
sibling failure mode shows up specifically when a draft makes a
**static-analysis claim** — dead code, unreachable, impossible-to-
throw, can't-be-null, this-can-never-fire. For those, reading the
lines isn't enough. Compilers see reachability subtleties human
control-flow tracing misses; defer to the analyzer.

**Why the C# case is sneaky.** `catch (Exception ex) when (...)`
filter clauses make static reachability genuinely hard to prove —
the compiler can't always determine that the `when` filter MUST
match (or fail) for given exception types, so paths after the
catch can be reachable even when traced control flow says they
aren't. Async state machines, generated methods, and method tails
satisfying return-type contracts all add similar non-obvious
reachability. Sibling cases exist in TypeScript / Go / Rust, but
C# is where this trap most often fires.

**How to verify:**

1. **Mentally simulate the analyzer first.** Would the C# compiler
   emit `CS0162: Unreachable code detected` (or the language's
   equivalent)? If yes, the claim is grounded. If no — or you
   can't tell — the claim is unverified.
2. **For real verification, run the build.** `dotnet build` on the
   project, with `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`
   if the repo configures it. If removing the line locally and
   rebuilding produces no new warning/error, the line is genuinely
   dead. If it produces one, the analyzer disagrees and the claim
   is wrong.

**Reachability red flags that argue against confident "dead code"
claims:**

- Path passes through an exception filter (`catch ... when (...)`).
- Path is in an `async` method (state-machine quirks).
- The unreachable path is a method tail satisfying a return-type
  contract.
- Control flow involves cancellation tokens, awaits, or
  Polly-style retry wrappers.

**When in doubt, soften to a question, not a directive.** "Is
this reachable?" / "Does the analyzer flag this?" beats "this is
dead code, remove it." Question-shaped framing lets the author
answer with tool-verified fact rather than feel pressured to
remove a line the analyzer wants kept. A directive that turns out
to be wrong costs the author cycles trying and reverting; a
question costs them only one analyzer run.

**Sibling rule.** This is the static-analysis corollary to
`## No fabrication → Code mechanism`. Mechanism rule: read the
lines before claiming. Tool-verify rule: for static-reachability
claims, read-the-lines isn't enough — defer to the analyzer.

### Voice and verification compose

A draft that passes the no-fabrication rules but reads as
sycophantic-padded still fails — and vice versa. The four
sections of this skill are cumulative, not alternatives. The
voice test (Section 2) and the dial test (this section) are the
two final reads before posting:

- **Voice test**: read aloud as the operator. Anything that
  sounds apologetic, deferential beyond posture, or pre-
  retreating gets cut.
- **Dial test**: read as the recipient. Anything claiming a
  fact worker can't back gets verified, softened, or cut.

If both passes are clean, the comment is ready. If either fails,
the comment is not ready — go back to the relevant section and
fix the specific failure rather than tweaking around it.

### Validator-first gate (default for all operator-voice artifacts)

Worker's previous default was "ask operator at draft time" for
any operator-voice public-surface artifact (PR replies, ADO
comments, chat-share drafts, status updates). That default is
overcautious — most of these can be auto-validated by a zero-
context sub-agent and only need human attention when something
residual remains.

**The sequence — author, validate, residual-check, gate-or-
waive:**

1. **Author** the artifact. Worker drafts the prose with all
   prior subsections (No fabrication, No sycophantic padding,
   Match operator's voice, Verify before posting) applied.
2. **Run a zero-context sub-agent review** with the same rigor
   used for doing-doc validation. The sub-agent reads only the
   draft + this skill's rules + the operator's relevant memory
   files, with no session context. Audit prompts:
   - Does this read evergreen and audience-first per the
     pr-surface-hygiene rules?
   - Are there any internal-handle leaks (scenario IDs, harness
     names, workspace paths, session metadata, worker-internal
     jargon)?
   - Does the message accurately describe what the code commit
     does, if it claims one?
   - Is the framing voice-aligned (first-person possessive when
     the team owns the thing; reader-aware explanation depth)?
   - Do the no-fabrication rules hold for every named claim?
3. **Residual-judgement check.** After the validator passes,
   worker asks itself: *is there anything genuinely requiring
   human input?* Examples of legitimate residuals:
   - Decisions the validator can't make (cross-team
     coordination implications, embargo timing, surprise risk
     for the recipient).
   - New information the operator may have that the validator
     can't infer (someone is on PTO; a prior offline decision
     contradicts what's drafted).
   - The artifact references something the operator hasn't
     seen yet (a new code design choice, a non-obvious
     tradeoff worth flagging).
4. **Gate-or-waive.** Empty residual → waive the human gate,
   proceed to post. Non-empty residual → surface ONLY the
   residual + the proposed artifact, not the whole package.
   The operator decides on the residual; everything else is
   already validated.

**Why this beats default-to-ask.** The operator's time is the
cost. Surfacing a clean artifact for "approval" when nothing
about it requires the operator's judgement is a sub-optimal use
of their attention. Human gates also create coordination
friction — they should land at the latest possible point on
the critical path, never as an artifact-by-artifact pre-post
checkpoint.

**When the validator's verdict is too thin to waive on alone.**
For first-time-touched surfaces (a new chat venue, a new
reviewer's first PR, an unfamiliar work-item type), waive only
after the validator returns clean AND worker has high
confidence the surface mechanics match prior shipped artifacts.
"Validator passed" plus "I've never posted to this surface
before" is not yet a waive condition — surface to operator the
first time.

**Compose with `peer-pr-review` / `pr-feedback-on-own-pr` /
`pr-self-review` / `pr-surface-hygiene`.** Those skills already
cite this one at every draft-time touchpoint. The validator-
first gate is the agent's default behavior at those
touchpoints — not an opt-in extension. Skills that previously
said "surface to operator before posting" should be read as
"surface only when the residual-check returns non-empty."
