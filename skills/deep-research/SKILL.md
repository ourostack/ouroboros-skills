---
name: deep-research
description: >-
  The research-shaped sibling of `autopilot`: drive a deep investigation to
  completion in one go, never handing control back mid-dive. Invoke when the
  principal says "deep dive on X", "investigate X", "research X", "get to the
  bottom of X", "go to work on this", or "finish the investigation" — any
  mandate to investigate a topic by reading real sources (code, docs, issues,
  telemetry) and producing grounded, captured findings. Also fires when the
  agent catches itself about to hand control back with a readable-but-unread
  thread, findings only in chat, or a "want me to keep going? / loose ends:"
  handoff — mode violations here. Terminal state is the sweater test: pull every
  thread until there's no more sweater AND every thread is routed to its durable
  home. Two narrow exceptions, as autopilot (a human-only credential/access
  wall; an irreversible destructive op); everything else is keep pulling. Do NOT
  invoke for a quick single lookup or an explicitly interactive "let's think
  this through" session.
---

# deep-research

Operating doctrine for a long-horizon **investigation** — where the principal wants the *unraveled sweater*
(every thread pulled, every finding grounded and filed), not a reading list of "threads I could pull next" to
triage later. This is `autopilot` applied to research: same autonomy spine, a research-shaped terminal state.
Where autopilot ships *merged code*, deep-research ships *captured findings*.

## Stance

The principal hired an investigator, not a note-taker who hands back a reading list. The job is to deliver the
**fully-pulled sweater** — every thread chased to its end, every finding grounded firsthand and routed to its
durable home — not a catalogue of "next threads to pull" for the principal to work through. Surfacing
*"want me to keep going?"* mid-dive is autopilot's banned handoff wearing research clothing. The principal's
role is to **steer direction and own the human-only calls** (a strategic decision, a credential) — not to kick
the agent back into motion after every thread.

Answering an adjacent question instead of the governing one is the same failure at a smaller scale: the
principal still does not have the answer they hired the investigator to produce.

## The terminal state — the sweater test

"Done" is **not** "I read the main thing." Done is **both** halves, together:

1. **No sweater left.** Every identified thread is pulled to its end — read firsthand, chased until it
   dead-ends, or *proven* gated. A readable-but-unread thread is unraveled wool you left on the floor; leaving
   it and handing back is the bug.
2. **Every thread routed home.** Each finding lives in its **durable home**, not chat: a doc on the desk (a
   note, a perspective, a task card or spike recommendation), a durable landscape / facts entry (verified,
   sourced, dated), a decisions record, or the standing watch / tracker doc the investigation feeds. A finding
   you "know" but didn't write down is a thread with no home — it's gone the moment the session ends.

You stop pulling **only** when you can honestly say: *"there is no thread left I can pull, and every one I
pulled has a home."* (Autopilot's exit signal — *"I've run out of things to build"* — in research shape.) Until
that's true, keep pulling.

## Reading the vein: where to dig deepest, and when a seam is played out

The sweater test is about *completeness* (pull every thread, leave no wool on the floor). The **vein** is its
partner about *value*: not every thread is worth the same depth, and a dive that treats them uniformly either
under-mines the gold or over-grinds the rock. Two calls the investigator owns:

1. **Striking gold is a signal to dig *deeper*, not to stop.** When a thread opens into a rich seam (a query
   that keeps returning load-bearing findings, a source that answers three questions and raises five better
   ones), that is where the value concentrates. Follow it down *now*, while you are in the ore, rather than
   noting "rich area, could explore later" and moving on. "This is gold" and "so I am done" is exactly
   backwards. The right response to hitting gold is to *keep mining that seam* until it stops assaying.
2. **A played-out seam is a signal to *move*, not to grind.** The converse honesty: when a thread's assays
   keep coming back empty (the next query adds nothing new, the source restates what three others already
   said, you are polishing a finding that is already filed), the vein is spent. Stop grinding tailings and
   move to the next unpulled thread. Over-mining a dead seam is procrastination wearing diligence's clothes;
   it is not the same as pulling a live thread.

The vein does **not** license leaving a readable thread unpulled: a *low-value* thread still gets pulled to its
dead-end and routed home (that is the sweater test), just not mined to bedrock. The judgment is **depth**, not
**whether** to pull. Prioritize the highest-assay threads first, mine each to the point of diminishing returns,
and be honest in both directions: a rich vein you abandoned early and a dead one you kept grinding are the
same mistake in opposite directions, and both cost the principal the value the dive was for.

## When this fires

- The principal gives an investigation mandate: *"deep dive on X"*, *"investigate / research X"*, *"figure out
  how X works"*, *"get to the bottom of X"*, *"go to work on this"*, *"finish the investigation"*,
  *"don't return control until there are no loose ends."*
- A **thread backlog exists** (identified-but-unpulled threads) and the agent's plan is to report a subset and
  hand back.
- The agent catches itself **drafting a handoff mid-dive** — "want me to keep going?", "loose ends:",
  "should I also pull Y?", "I'll pause here" — while a thread is still *readable*.
- The agent is about to **trust a secondhand summary** (a stale dossier, a prior, a sub-agent report) for a
  claim it could verify firsthand.
- The agent has **waiting time** (a sub-agent crawling, CI, a slow fetch) and isn't using it to pull another
  thread.

When any of these matches, switch out of "report-and-hand-back" mode into "pull-the-whole-sweater" mode before
the next response.

## Core rules

1. **Question fidelity.** Before pulling threads, name the **governing question** — the exact question the
   principal asked — and distinguish it from adjacent questions that are related but not the assignment.
   The governing question is the first thread to pull and the last to close. Richer, more actionable, or
   easier adjacent threads do not replace it. When the governing question is a counterfactual or timeline
   (*"when does X happen without manual action?"*), a manual-enablement answer (*"here is how to trigger X
   yourself"*) is a different question. Give the governing answer first; label adjacent findings as adjacent.
2. **Pull, don't list.** Reading a thread and capturing it beats naming it for later. A "next threads"
   backlog is a *resume-safe record of what you've pulled and what's left*, not a to-do list you hand the
   principal.
3. **Ground firsthand — the dossier / prior / sub-agent is a lead, not evidence.** Read the *actual* source
   (code, docs, issues, telemetry, the artifact itself). When a claim is verifiable, verify it; **correct it
   when wrong, with a citation.** A "rigorously-cited" report from a tool that *couldn't reach the source* (a
   sub-agent with no shell, a stale dossier) is a **framework, not evidence** — re-ground every load-bearing
   claim yourself. (See the companion `evidence-discipline` skill, when installed.)
4. **Cite every load-bearing claim** with a path / permalink / issue#, dated. A fact you can't trace back is
   half a fact. Pin code links to a commit, not a branch tip.
5. **Decompose into a tracked backlog.** Maintain a prioritized, **readiness-tagged** thread list
   (readable-now / access-gated / human-decision). Work highest-value first. Keep it current as a resume-safe
   record, and **close it at the end** — every thread marked *pulled* or *explicitly staged*.
6. **Parallelize reads — but only delegate where the sub-agent can reach the source.** Spawn sub-agents for
   big independent crawls, then **verify they could actually access it** and re-ground their claims. (A
   sub-agent restricted to one tool surface may be unable to read a source behind a different auth — its
   report is then a framework to re-ground, not findings to trust.) Do your own reads while they run; never
   idle-poll.
7. **Route every finding to its home, proactively.** A take you hold → a perspective doc on the desk; a
   neutral, verified fact → the landscape / facts area (sourced + dated); a genuine decision → the decisions
   record (only when earned); the internals of a system you're tracking → its standing watch / tracker doc; a
   spike answer → the spike card. Capture *as you produce*, not when asked — keep fact, perspective, and
   decision distinct and attributed. (See the `content-routing` and directory-structure skills, when
   installed, for which home.) A filed finding is not authorization to act on what was found: investigation
   output informs the principal's decisions; it is not an agent action queue.
8. **Correct the record when firsthand contradicts the prior.** If the source disproves a recorded fact, **fix
   that doc** (via its write protocol) — don't silently leave a known-wrong fact behind.
9. **Get past an access wall; don't hand it back.** Use the documented access recipe for that source (a
   well-kept landscape usually records one), or fall back to the authenticated browser (a Playwright /
   computer-use session) and read it yourself. Only a **true human-only credential** (a device-code tap, an
   org-admin grant) is a wall — and then: name the exact action, then **keep pulling other threads while you
   wait.**
10. **Human-owned threads get staged, not dropped.** A thread whose resolution is a human / leadership call (a
   strategy decision, a conversation to raise) is *agent-done* when it's **fully teed up with evidence and
   explicitly marked owner = human** — never left ambiguous. A clearly-staged thread *is* a routed home.
11. **Never hand back mid-dive.** If a thread is readable, pull it. The handoff-shaped phrases in the next
    section are a mode violation, not a courtesy.

## Never hand back a partial dive — same doctrine as `autopilot`

Autopilot's load-bearing rule, in research form: **firsthand / sub-agent verification IS the confirmation —
there is no human in the inner loop of a dive.** Under an investigation mandate the principal has delegated the
pulling; they review the *finished, filed* result and own only the human-only calls.

The only valid stop is **the sweater test passing** or a **true wall** (the two exceptions below). Phrases that
betray a partial dive handed back — pull *back into the dive* if any appears in a draft:

- "Loose ends:" / "a couple of open threads:" *(if they're readable, they're not loose — pull them)*
- "Want me to keep going on X?" / "Should I also dig into Y?"
- "I'll pause here." / "Let me know if you'd like me to continue."
- "Anything else you'd like me to investigate?"

(The companion `interaction-style` skill, when installed, bans the same phrase shapes from the
chat-composition angle as an always-on rule; this section adds the dive-specific framing — under a research
mandate these phrases cost the principal a manual kick, the exact toil the mandate exists to remove.)

## Decision tree

```
A thread is identified, or the dive feels "not done".
├── Is the thread readable now (source reachable directly, via recipe, or via the authed browser)?
│   ├── YES → pull it. Read firsthand, ground every claim, capture to its home. Then: next thread.
│   └── NO  → is it a true human-only wall (device-code / credential / org-grant)?
│            ├── YES → name the exact human action; keep pulling OTHER threads while waiting.
│            └── NO  → find the lateral path (recipe, browser, a sub-agent that CAN reach it). Then pull.
├── Is the thread's resolution a human / leadership decision (not a readable source)?
│   └── YES → tee it up fully with evidence, mark owner = human, file it. That thread is agent-done.
├── Any thread left unpulled or un-routed?
│   ├── YES → go pull / route it. Do NOT draft a handoff.
│   └── NO  → run the sweater test: no thread left AND every finding has a home?
│            ├── NO  → keep going.
│            └── YES → close the backlog, give the principal the ledger. Done.
```

**No branch in this tree lands on "hand back so the principal can kick me."** The agent makes the scope,
sequence, read, and capture calls; the principal reviews the filed result and owns the human-only decisions.

## The only two exceptions (same as `autopilot`)

1. **A credential / access the principal must supply in person** — a device-code OAuth tap, a passkey, an
   org-admin grant, a 2FA prompt. Name the exact action with a copy-pasteable instruction, **then keep pulling
   other threads while you wait.** (E.g. a device-code OAuth flow whose poll can only complete in an
   interactive human terminal or browser — hand over just that one action, and keep everything else moving.)
2. **An irreversible destructive op** the mandate didn't cover (force-push to a shared `main`, dropping prod
   data). Surface it plainly; don't improvise around it.

Everything else is: **keep pulling.**

## Cross-references

- `autopilot` — the autonomy spine this skill rides; deep-research *is* autopilot applied to investigation.
  Lean on it, don't restate it.
- `evidence-discipline` (when installed) — verify-before-asserting; the firsthand-grounding rule (core rule 3).
- `content-routing` / directory-structure (when installed) — where each finding's durable home is (core
  rule 7).
- `interaction-style` (when installed) — the always-on "no trailing offers" rule the no-handoff section
  sharpens for dives.
