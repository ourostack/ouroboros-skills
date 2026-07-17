---
name: pr-surface-hygiene
description: Authoring rules for long-lived PR surfaces — the PR description body, top-level PR comments, and reply comments that aren't bound to a reviewer thread. Use before drafting any such content, and when auditing a draft handed off from an upstream tool (typically work-doer's `artifacts/pr-description.md`) before work-merger opens the PR. Keeps content from rotting against the pipeline it claims to describe.
---

# PR surface hygiene

Long-lived PR surfaces are read by people who didn't watch them get
written. Anything that rots faster than those surfaces are manually
refreshed ends up either wrong or redundant — either misleads a
reviewer or duplicates a signal the pipeline already enforces. Both
are bad. This skill governs what goes in those surfaces and what
stays out.

**Rule IDs**: `PSH-NNN` (Pr-Surface-Hygiene). Findings from
pr-self-review or other evaluators cite these IDs so the rule
being applied is unambiguous.

## Why this matters

Stale or drift-prone content in a long-lived PR surface:

- **Misleads reviewers** who read inlined counts, timings, and line
  numbers as authoritative — especially once the number has drifted
  from reality.
- **Duplicates pipeline signals.** Every item a required pipeline
  enforces (unit tests, integration, coverage gate, formatter, lint)
  is already communicated by pipeline-green. Restating it means
  reviewers either trust the description (and miss drift) or
  double-check against the pipeline (in which case the description
  was redundant).
- **Creates re-edit churn.** Each re-run changes the numbers; the
  agent either keeps editing to refresh stale values or ships known-
  wrong content. No good option.
- **Rots silently on reformat or extract.** File-colon-line refs
  (`GraphServiceAdapter.cs:2745`) break the moment anyone reformats,
  refactors, or extracts. "Unit N" refs break the moment the doing
  doc archives.

## PSH-001 — Rule 1 — pipeline-enforced signals belong to the pipeline

If a required pipeline (or branch-policy gate) enforces a signal, it
does not belong in the PR description.

**Never post a top-level PR comment solely to announce housekeeping**
such as pipeline green, a branch restack, a target-branch merge, a
new tip SHA, or "still draft / no reviewers." Those facts already
live on the PR and pipeline surfaces, the comments rot on the next
push, and they give reviewers no action. If no human decision or
manual evidence changed, say nothing. Keep machine progress in the
doing log; update the PR description only when durable
reviewer-relevant substance changes.

**Out of `## Test plan`** (move or drop):

- Unit test suite pass / count (`[x] 312/312 green`).
- Integration test suite pass / count.
- Diff-coverage percentages (`[ ] Diff coverage ≥ 85%`).
- Formatter, linter, or style gates (csharpier, eslint, black, etc.).
- Anything else a branch policy or required pipeline blocks merge on.

**In `## Test plan`** (human-validation only):

- Manual validation runbooks (e.g., "INT smoke: hit X then Y, verify
  Z in response").
- Spot-checks against external surfaces (Kusto queries, Grafana
  dashboards, service logs).
- Acceptance items a reviewer should independently verify.
- Cross-cutting items no gate enforces (backward compat, rollout
  plan, ops runbook, dark-launch switch).

Prepend this boilerplate at the top of `## Test plan` so reviewers
understand the section is intentionally narrow:

> _Pipeline-enforced coverage (unit + integration + diff-coverage +
> style) is signaled by required-pipeline green. Items below are
> human-validation only._

## PSH-002 — Rule 2 — long-lived surfaces use stable anchors, not brittle inlines

An **anchor** is an identifier another reader can resolve later from
the codebase or the PR alone. **Brittle** = rots faster than the
containing surface is manually refreshed.

| Brittle (don't) | Stable (do) |
|---|---|
| `(12 tests)` / `(8 tests)` after a unit summary | No count — name the test class or `dotnet test --filter` string |
| `GraphServiceAdapter.cs:2745` line refs | Method / class name: `GraphServiceAdapter.UpdateChannelAsync` |
| Numbered-unit refs (internal doing-doc numbering like "the third unit") | The unit's name or the behavior it landed |
| "p99 ~42 ms on my dev box" | Link the production dashboard that will show p99 after rollout |
| `312/312 green` | Pipeline-green reference (see Rule 1) |
| Undated timing claim from development | Dated + scoped evidence only — or omit |

The general principle: reach for **method names, class names,
thread IDs, test-filter strings, and behavior descriptions**. Those
survive reformatting, refactoring, extraction, and archival.

## PSH-003 — verify tracker citations and require standalone WI bodies

When citing a work-item ID in a PR description, top-level PR
comment, or commit message, two sub-rules apply.

### Rule 1 — verify the ID by reading the WI before citing

Don't cite a work item ID from memory or session context. Fetch the
WI (via the available work-item read tool — engine-specific) and
confirm:

- **Title** matches the role you're citing it for ("admin-bypass
  telemetry follow-up", "atomic-pair predecessor", etc.).
- **State** is what you expect (Open / Active / Closed).
- **Description body** is non-empty (per Rule 2).

The fetch is cheap. The cost of citing the wrong item in a live PR
description is high — the operator catches it, the PR-surface
commit gets a "fix wrong tracker link" follow-up that bloats the
audit trail, and the cited item points reviewers at the wrong
scenario. ID conflation is especially easy when two follow-up tasks
in the same theme share rough wording: one closes, the other stays
open, and "the follow-up task" loses which-is-which.

### Rule 2 — the cited WI must stand on its own

A reviewer who clicks a tracker link expects to land on a work item
that explains itself. The body should carry, at minimum:

- **Scenario** — what triggers the work or when it applies.
- **What we don't know yet** (for follow-up tasks) — the question
  the work item exists to answer.
- **Telemetry / evidence shape** (where applicable) — event names,
  dimensions, query shape.
- **Decision rule** — what action to take in each branch (low usage
  → tighten; high usage → document).
- **Origin** — where the item came from (which PR / iteration /
  discussion).

If the body is empty or just restates the title, the citation is
hollow scaffolding — the reviewer learns nothing from the click.
Populate the body before linking from the PR.

### Conflation guard

When two follow-ups in the same area share rough wording ("Theme F
follow-up" / "Theme J follow-up", or two "telemetry revisit" tasks),
keep a one-line cheat sheet in the iteration's notes mapping ID →
title so the citation grabs the right one. Cheap to write, cheap to
re-read, prevents the most common citation slip.

## PSH-004 — disambiguate the word "agents" in PR copy

The word **agents** in PR-review prose is ambiguous between two
distinct meanings, both coherent in context:

- **Agent as subject** — "agents reading this PR." The agent is the
  reader / actor.
- **Agent as assistant** — "reviewers using their agent." The human
  is the reader / actor; the agent helps them.

A reader has no way to tell which one the author meant without
explicit disambiguation. Bare `Agents: ...` colon-prefix is the
common offender — both interpretations parse, the author had one in
mind, the reader picks the other.

**Use one of these phrasings instead:**

| Intended meaning | Phrasing |
|---|---|
| Assistant (agent helps reviewer) | `Agent-assisted review: ...` |
| Assistant, imperative | `Have your agent ...` |
| Assistant, framed as reviewer advice (clearest) | `**Tip:** have your agent ...` |
| Subject (agent is the reader) | `For agent reviewers: ...` |

The `**Tip:**` framing is especially good when the assistant
interpretation is the goal — readers parse "tip" as "advice for me"
naturally and the ambiguity dissolves.

**Decision aid**: before writing about agents in PR copy, ask "is
the agent the **subject** (reader) or the **assistant** (helper)?"
Then pick from the table.

**Scope**: this rule binds operator-facing PR copy (description,
top-level comments, replies not bound to a reviewer thread). Skill
files and worker-internal docs may use either framing depending on
context; PR copy must be unambiguous.

## PSH-005 — audience-first authoring; drop decorative inlines

Long-lived PR surfaces are read by people who didn't watch them get
written. Write for the **fresh reader's mental model** — orientation
→ substance → action — not for the author's view of the history.
The reviewer opening the PR for the first time has zero baseline:
they don't know about prior versions, iteration drift, or the
relationship between artifacts. They want the chain, not the
preamble.

This is a sharper framing of what looks like a "fewer stale
references" rule. The cure isn't "update references faster" — it's
**write fewer references that need updating, and write nothing that
depends on context the reader doesn't have.**

### Anti-patterns to strip

1. **Self-referential glue.** Prose that explains the relationship
   between this artifact and another. "PR description references
   X." "This comment is the per-step trace of what's claimed
   above." "Verified count of N, despite the description saying
   M." All of these assume the reader has cross-referenced the
   other artifact, which they haven't. Open with the substance, not
   the meta — chain-trace comments lead with "Per-step trace of the
   X chain," not "PR description claims N steps."
2. **Decorative counts / SHAs / timelines that don't navigate.**
   "19 fail-fast steps" only helps if the reader uses the count to
   navigate. They don't — the table they're about to read does its
   own counting. The "19" is decorative and bound to drift. Same
   with "against current HEAD (b390b8a418)" — the SHA is
   decorative; the reader reads the comment in the context of the
   current PR. Method names beat line numbers; pipeline state beats
   a baked-in HEAD SHA. **Counts / SHAs that DO navigate** (a line
   range in a long file, a method anchor) are different — they help
   the reader scroll. Even those drift; prefer method-name-only
   references because method names are stable. (Calendar timelines
   are a common decorative-inline trap; PSH-006 covers them in
   detail.)
3. **"Updated for HEAD X" footers.** Only useful to the author who
   wants to know if their changes landed. The reader is reading the
   latest version regardless; the date / SHA of last update is
   noise.
4. **Defensive prose about choices.** "One PR by design — splitting
   this would lose composition" pre-empts an objection the reader
   hasn't raised. If they don't object, the defense is wasted; if
   they do, the defense in prose was always going to lose to a real
   conversation. **Skip preemptive defense in PR descriptions.**
   (This rule is surface-specific. Chat-share posts override it —
   different audience moment, different rule. See the **Chat-share
   posts** section below.)

### The one-sentence test

A fresh reader should never need to ask "what does the author mean
by referring to X?" If they would, the prose is leaking the
author's context. Rewrite or drop.

### Application

Anchor each precise value (count, SHA, line range, timeline) to
**one source of truth.** If the description and a comment both
claim a count, only one of them gets to claim it; the other links.

## PSH-006 — Fabrication discipline

Calendar timelines are one of the no-fabrication rules; the
canonical rule set (historical specifics, calendar timelines,
code mechanism claims, bot-derived urgency) lives at
[`../operator-voice-comments/SKILL.md#no-fabrication`](../operator-voice-comments/SKILL.md#no-fabrication).
Apply when authoring or auditing any PR-surface content.

## PSH-007 — "out of scope" must be same-repo

The "Out of scope" / "Deferred follow-ups" section in a PR
description surfaces items the reviewer might reasonably wonder
about — work that was **consciously deferred from this PR's
scope**, with a pointer to where the deferred work is tracked.

It is **not** a place to list work in completely different repos.
Cross-repo work is, by definition, not in scope of a PR in this
repo — listing it adds zero signal and reads as filler. The
implicit reviewer reaction is "duh, of course it's not in this PR,
it's not even in this codebase."

**Bar for inclusion** — all three must hold:

1. **Same repo** as the PR.
2. **Scope-eligible** — could plausibly have been added to this
   PR's diff.
3. **Intentionally deferred** — the author chose not to land it
   here, with a tracked reason.

**Decision aid**: before adding an item to "Out of scope," ask
"if this item WERE done, would the changes land in **this PR's
repo**?" If no → don't list it. It's a cross-repo neighbor, not a
deferred-from-this-PR item.

**Cross-repo neighbors that genuinely matter for reviewer context**
belong in the **What** section as track framing, not in the
out-of-scope list:

> Part of [Feature N]; this is the <repo> piece. AdminUX side ships
> separately as <Task M>.

That gives the reviewer the track-level context they need without
miscategorizing it as a deferral. (Cross-repo neighbors are also
where PSH-005's "self-referential glue" anti-pattern is easiest to
slip into — keep the framing tight: feature link, repo split, link
to the sibling tracker. No prose about why the split happened.)

## PSH-008 — use the repo's PR template / established convention, not a custom structure

Before opening ANY PR in ANY repo, do two probes — never invent a
section structure when the repo already has one:

1. **Probe for a PR-template file.** GitHub: `.github/PULL_REQUEST_TEMPLATE.md`
   (single) or `.github/PULL_REQUEST_TEMPLATE/*.md` (multi). Repo-rooted:
   `/PULL_REQUEST_TEMPLATE.md`, `/pull_request_template.md`. In `/docs/`:
   `/docs/pull_request_template.md`. Other git-hosting platforms expose an
   equivalent template path under their own config directory — probe for it.
2. **Pull the last 2–3 merged PRs** (via `gh` or the platform's REST) to
   see the team's ACTUAL filled-in convention — templates drift; recent
   merged PRs are ground truth. If the operator has authored prior PRs in
   the same repo, mirror THEIR structure verbatim (sections, ordering,
   link placement, code-fence conventions).

**NEVER use a custom section structure** (`## Problem` / `## What this PR
does` / `## Background` / `## Validation`, etc.) when the repo has a
discoverable template OR an established convention. Custom sections in a
repo that has conventions read as "wrong template" and get bounced. Only
when neither a template nor a clear recent convention exists is a concise
`## What` / `## Why` a safe default.

## PSH-009 — one canonical body for human + agent readers; no agent-only formatting

This rule generalizes beyond PRs to any artifact read by BOTH humans and
coding agents — bug reports, dashboards, runbooks, status posts, as well as
PR descriptions.

When an artifact will be read by both humans and agents, give it ONE
canonical body — do NOT add agent-specific formatting that humans wouldn't
also benefit from. The body should be scannable by humans (hierarchy +
TL;DR + collapsibles) AND machine-parseable by agents (stable section
headings + embedded data).

**Why.** Modern coding agents have large context windows and tool calls to
fetch the source themselves. A duplicated "agent block" creates a second
source of truth that drifts independently of the body on updates, reads
like robot prose to the humans who'd have parsed the same prose without
help, and spends design effort solving a context-window problem that no
longer exists.

**How to apply:**

- Don't add a `## For your AI agent` / `## Drop-into-your-agent` /
  `## Agent prompt` section duplicating what's already in the body.
- Don't pre-stuff JSON / YAML blobs that mirror prose elsewhere on the
  same page.
- DO use stable, predictable section headings ("Repro", "Acceptance
  criteria", "Suspect code surface") so an agent navigating the doc finds
  the same anchor every time.
- DO embed actionable data inline (queries in fenced blocks, `file:line`
  references in tables, command-lines in code blocks) — useful to humans
  copy-pasting AND agents extracting.
- DO use HTML `<details>` collapsibles for depth sections humans scan past
  but agents read fully — a UX win for humans at no cost to agents.

**Exception.** A structured machine-readable sidecar (e.g. a
`proposed-bug.json`) posted as a SEPARATE attachment, for tooling that
prefers parsing JSON, is fine — that's a parallel surface for a different
consumer, not formatting drift inside the same document.

## Carve-outs — when specific or brittle-looking content IS fine

The rule is narrower than "never use numbers or references." Three
specific exemptions:

- **Per-thread reviewer replies.** A reply posted inside a reviewer-
  created thread is already scoped to that thread's file and line,
  so citing the line (or quoting the surrounding code) is
  legitimate — the thread anchors the location. Applies to replies
  *inside* a reviewer thread only, not to top-level PR comments that
  happen to reference a line.
- **Dated, scoped evidence.** A validation-run screenshot or log
  excerpt that's timestamped and labeled with its environment
  (e.g., "INT, 2026-04-22 14:05, my-dev-tenant") is fine. The dating
  scopes the claim; no reader will assume it reflects production
  next quarter.
- **Behavior descriptions that happen to include a number.**
  ("Retries exponentially up to 5 times," "cache TTL is 30
  seconds.") The number is part of the behavior, not a run-time
  measurement.

## Applying before you write

Before authoring a PR description, top-level PR comment, or a reply
not bound to a reviewer thread, read your draft line by line. For
each line, answer:

1. **Is this a signal a required pipeline already enforces?** If
   yes → drop (cover it with the Rule 1 boilerplate line instead).
2. **Will this rot faster than this PR stays open?** If yes →
   replace with a stable anchor or drop.
3. **If someone reads this in six months, will it still be
   accurate?** If no → drop, or add dating and scoping that makes
   the staleness self-evident.
4. **Is there a stable anchor that says the same thing?** If yes →
   use it instead.

If you can't clear every line against these four questions, rework
the line.

## Applying after something else wrote it (audit mode)

When `work-doer` drafts a PR description to
`artifacts/pr-description.md` before `work-merger` opens the PR,
audit the draft before handing it on — `work-doer` is general-
purpose and doesn't know which pipelines are required in this org.
Worker bridges that gap.

Read the draft top-to-bottom and run the four-question checklist
against every line. Edit the draft in place; this is the cheap
moment to fix. After the PR opens, the stale text is visible to
every reviewer who loads the page.

Common things upstream drafts get wrong:

- `## Test plan` listing unit / integration suites as checkbox items.
- `## Units landed` carrying `(N tests)` parentheticals.
- File:line references in the summary.
- "Unit N" references that archive-rot the moment the doing doc
  moves to `_archive/`.

If the draft is clean, proceed silently. Don't add confirmation
noise to the PR body.

## Chat-share posts (a cousin surface, different conventions)

When asked to draft a "PR ready for review" group-chat post (Teams,
Slack, etc.), the right shape is **not** a tightened PR description.
Chat-share posts are a different surface with a different audience
moment, and the conventions diverge.

| | PR description | Group-chat share post |
|---|---|---|
| Audience moment | Reviewer just clicked into the PR; needs orientation + substance | Teammate just glanced at chat; deciding whether to open the PR at all |
| Length budget | Up to the platform's description cap; reviewer is committed to reading | 2-4 short lines; competing with everything else in the chat |
| Link preview | N/A (the description IS what the reader sees) | Most chat clients auto-render PR title + a snippet — don't restate |
| Defensive scope-framing | Skip (PSH-005; reader hasn't pushed back yet) | Include (chat is conversational; head off the obvious first reaction) |
| Tone | Reference document | Conversational announcement |

**The mistake**: drafting a chat post that reads like a tightened PR
description (technical summary, mini reviewer-focus list, full
sentence structure). It's accurate but reads as wall-of-text in a
chat — and duplicates whatever the link preview is going to render.

### Rules for chat-share posts

1. **Lean on the link preview.** Don't restate what the chat client
   will auto-render. PR titles are usually enough.
2. **Lead with the action sentence.** "X PR ready for review!"
   matches what readers scan for in chat. The CTA is the first
   thing they see.
3. **Include one preemptive scope-framing line.** Anticipate the
   FIRST reaction the reader will have (size, scope, reviewer ask,
   urgency) and address it in one disclaimer line. Point at where
   the longer answer lives ("see the description + 'how to review'
   section").
4. **Target 2-4 short lines.** Reads as an announcement, not a memo.

### Why preemptive scope-framing is OK here (PSH-005 override)

PSH-005 says "skip preemptive defense" for PR descriptions — and
that's right for that surface. Chat-share posts are different: chat
readers will bounce on size, scope, or unclear ask **without**
preemptive framing. The description reader has already committed
past that decision point; the chat reader hasn't. Different
audience moment, different rule.

### Operator customization

Tone (greeting, @-mentions, formality) is the operator's call. The
worker draft should be tone-neutral and let the operator add
character. Don't over-author the social register.

## Surfaces in scope

| Surface | In scope? |
|---|---|
| PR description body | Yes |
| Top-level PR comments (status updates, ready-for-review notes) | Yes |
| Reply comments NOT bound to a reviewer thread | Yes |
| Group-chat "PR ready for review" posts | Cousin surface — see [Chat-share posts](#chat-share-posts-a-cousin-surface-different-conventions) |
| Replies INSIDE a reviewer-created thread | No — carve-out (scoped by thread) |
| Commit messages | No — ephemeral readership, but the spirit applies |
| Doing-doc progress logs | No — archived, not reviewer-facing |
| Task card bodies | No — operator-facing, not reviewer-facing |

## The durability test

When in doubt, ask: **will a reviewer reading this in six months
believe a stale claim?** If yes, rework. If the information is
load-bearing, make sure the dating or scoping makes its staleness
self-evident.
