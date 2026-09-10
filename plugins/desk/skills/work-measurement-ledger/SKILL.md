---
name: work-measurement-ledger
description: How worker keeps an owner-private record of its own work items — what was asked for, what was committed to, what it actually consumed, and what that record can and cannot honestly say. Covers the `desk_work_ledger` tool's intake/commit/size/phase/scope_change/link/complete/close vocabulary, importing usage facts from the host's own local session records, and reading the private report's provenance classes. Use when recording a unit of work as it starts, binding a coding session's usage to it, correcting or deleting a private record, or reading the report and needing to know which numbers are measured and which are merely declared.
---

# The work measurement ledger

there is a drawer in the desk that nobody else opens. inside it is a ledger of the work itself — one line per thing the operator actually asked for, what it turned out to cost, and, written plainly beside every number, where that number came from. the ledger is private by construction: it lives outside git, in an owner-only store, and it exists so the operator can answer "what did this take?" about their own work without anyone building a productivity dashboard on top of them.

the ledger is deliberately small. it is not a second lifecycle, not an evaluation engine, and not a finance system. the task cards in git remain the canonical record of *what the work is*; this drawer holds the operational facts about *how it went*, which don't belong in a repository at all.

## What a work item is

a work item is **one request for one specific independently assessable outcome**. it gets its identity at intake, before any commitment — because an identity handed out after the fact is an identity you can quietly reshape to flatter the result.

these are not work items: a prompt, a session, a pull request, an implementation step. those are things that happen *inside* a work item. if you find yourself opening a second item because the first one took three sessions instead of one, stop — that's the same outcome, and splitting it launders the cost.

```
intake   → the request exists, and now has a name
commit   → outcome, scope, evidence, delivery endpoint, and an explicit operator go
size     → what kind of work this looks like, recorded before it is done
phase    → declared intervals of activity
complete → the agreed endpoint was reached, with evidence
close    → it ended some other way, and the record stays
```

intake is the only step that mints an identity. everything else attaches to one.

## The rule that makes the numbers mean anything

**scope changes are explicit, and rework stays with the original.**

when the shape of the work changes, record a `scope_change` against the item that already exists. when work has to be redone because the first attempt was wrong, that is still the same outcome — it stays on the same item, and the item gets more expensive. that is the honest answer. only a genuinely new outcome earns a new item, and when it does, `link` it to its parent with `follow_on` so the relationship survives.

the ledger refuses `replaces` as a link relation for exactly this reason. there is no vocabulary here for making a costly item disappear behind a fresh one.

`close` keeps cancelled and unfinished work in the drawer. a record of what didn't work is the most expensive record to reconstruct later and the first one a tidy-minded system throws away.

## Sizing before, never after

`size` records the *features* of the work — its type, its scope, the systems it touches, the uncertainty, the risk, the verification burden — and it is recorded **before execution**, once. the ledger refuses a late size once execution evidence exists, and refuses a second size outright.

this is the guard against hindsight. a complexity judgement written after the bill arrives is a description of the bill. what you want is the judgement you actually held going in, so that later you can ask the genuinely useful question: *where was i wrong about how hard this would be?*

sizing carries an explicit `unknown`. use it. an honest unknown is worth more than a confident guess you'll misread in three months.

## Importing what the host already recorded

`import_usage` reads the host's own local session records — the ones the coding tool writes for itself — and copies the minimum: model, initiator, token counters, the host's own usage units, timestamps, and a fingerprint of the source row. no transcripts. the ledger never duplicates the conversation; it records that the conversation happened and what it consumed.

three properties matter more than they look:

- **identity is the source's, not yours.** an observation is keyed by `(source, session id, source event id)`. the work item and machine you attribute it to are columns on that row, not part of its identity. so the same observation cannot be counted twice by claiming it from two items — the second claim comes back as a conflicting allocation, not a silent addition.
- **import is idempotent, and a changed source row does not overwrite what was already observed.** re-import as often as you like. duplicates are reported, not re-added; a source row that changed after import is flagged and the original observation is kept.
- **a missing counter is not a zero.** it stays null, and the report says how many rows were missing it. a malformed row — a negative counter, a surrogate id too large to represent exactly, a timestamp that isn't one — is skipped with its reason named, not coerced into something addable.

if the source is absent or unreadable, the import fails. an unreadable source is not an empty one, and reporting it as no usage would be the single most misleading thing this drawer could do.

session binding is explicit. do not promise that the ledger can discover which session a piece of work happened in — say which session it was.

## Reading the report honestly

every field in the private report carries a provenance class, and the classes are the point:

| class | what it means |
|---|---|
| `measured` | a source outside this ledger recorded it |
| `declared` | somebody said so — usually the operator, sometimes the agent |
| `inferred` | derived from other recorded facts, by a method the field names |
| `estimated` | approximated, with the method named |
| `unavailable` | not known, with a reason — never a zero, never a guess |

a few consequences worth internalising:

- **completion is declared, and so is the canonical task state.** the ledger reads the task card in git read-only and reports both, plus whether they disagree. reading a card is an observation of a recorded declaration, not proof anything shipped, so it carries the `declared` class and cites the card it read in `source_ref`. it never writes to the card. when no card is bound, canonical status is `unavailable` — not "fine".
- **parallel work sums, overlapping time does not.** token and usage counters add up across concurrent sessions. elapsed durations do not: the active span is an interval *union*, so two things happening at once do not become two hours. where the source does not anchor an interval at all, the ledger says `unavailable` with `source_interval_anchor_unknown` rather than inventing a start. an item that declared no intervals gets `unavailable` too, with `no_declared_phase_intervals` — because zero milliseconds is a measurement, and "nothing was declared" is not one.
- **lead time is not activity.** an open item's lead time is censored, and labelled as such, with the as-of moment stated. it is the wall clock from intake, not a claim about effort. a finished item's clock stops at `terminal_claim_recording` — when the claim was *recorded*, which is the only endpoint the ledger actually saw. a cancelled item stops there too, keeps its disposition, and is never counted as delivered.
- **recording gaps are part of the report.** `set_recording` switches capture on and off, and takes a reason. when recording is switched off, the window is recorded, and re-enabling never backfills it — rows stamped inside a closed window are refused at import. while it is off, capture is refused outright, but the owner's own routes — inspect, correct, delete, report — keep answering, because a switch that also blinds the owner would be a worse deal than the one being offered. the report says how many gaps overlap each item, so a suspiciously cheap item is visibly suspicious.
- **the breakdowns split on who observed what.** `by_model` and `by_agent` are `measured`: the source recorded that identity. `by_cycle` and `by_phase` are `declared`: they are operator windows laid over source-timestamped rows, so a row that falls in no window lands in `unattributed` and a row that falls in two lands in `ambiguous`, both counted rather than quietly dropped. `by_agent` calls an identifier `root`, `subagent` or `mixed` from whether the source recorded a parent call, and rows carrying no agent id at all are counted in `missing_agent_id` and attributed to nothing.
- **coverage is never claimed complete.** the source states no completeness guarantee, so the ledger doesn't either. it reports the cutoff it observed and leaves completeness `unavailable`.

## Money, kept deliberately small

three different things get confused constantly, so the ledger keeps them apart:

1. **token counts** — what the source counted.
2. **the host's own usage units** — credits, multipliers, whatever the tool reports. these are the vendor's units, in the vendor's meaning.
3. **actual financial cost** — a number in a currency, and only when someone states one.

there is **no conversion between them**. the ledger does not know what a credit is worth, and any code that pretends to would be inventing a rate. a work item may carry **one** replaceable cost basis, recorded with `cost_basis`: an amount, a currency, the source it was read from, the rate and rate unit, and the effective date. replacing it requires naming the revision you expected, so a stale read cannot silently overwrite a newer figure, and the superseded count stays visible.

where no basis has been stated, financial cost is `unavailable` and stays null. totals are held **per currency** and report how many items were priced and how many weren't. rates differ by context and change over time; a single hardcoded conversion would be wrong for most readers and quietly wrong for the rest.

## What the drawer will not do

- **no participant study, no team ranking, no cross-person comparison.** the store resolves to one owner at server scope; there is no caller-supplied person, root, or schema. an item recorded under one binding is simply not found under another.
- **no silent export.** nothing leaves the drawer unless the owner asks for it, and the report is owner-private.
- **no raw transcript duplication.** references only.
- **no quality cuts to make a number look better.** the ledger measures work; it is not a reason to do less of it.
- **no evaluation engine.** an offline evaluation receipt can be *referenced* with `link_evaluation_receipt` — a link, a hash, a run id, a declared status — and the ledger records it as declared, never as something it verified. feedback capture and package diagnostics are not online evaluation either, and this drawer does not pretend otherwise.

## Inspection, correction, deletion

these are rights, not features.

`inspect` shows everything held for one item. `correct` replaces a declared field — the request, who asked, the outcome, scope, evidence, delivery endpoint — keeping the previous value and the reason in a correction history. it requires `expected_revision` — the revision you read before deciding to correct — because a concurrency check a caller can decline is not a check. measured observations are not correctable: an observation records what a source said, and editing it would make the word "measured" a lie. a correction cannot clear a defining field either; if the item should not exist, delete it.

`delete` requires explicit confirmation, removes every dependent row — including imports, session bindings and usage events — reports what it removed, and leaves a content-free tombstone so the report can say a deletion happened without resurrecting what was deleted. asking for a deleted item afterwards is told it was deleted here and when — which is all the tombstone knows — and stays distinguishable from the plain absence you get for an identifier that was never in this partition at all. the store uses journalling and secure deletion so the removed content does not linger in a sidecar file.

## When to reach for it

record intake when the operator asks for something specific enough to assess. commit when the go is real. size before starting. import usage when a session that belongs to the item ends. complete or close when it's over. read the report when the operator asks what something took — and when you read it aloud, carry the provenance classes with you. the honest sentence is "about four hours of wall clock, sixty thousand tokens measured, and no cost figure because nobody stated a rate" — never a single confident number with its uncertainty filed off.

if you are unsure what this drawer will answer to, ask it: `capabilities` lists every route it will accept and flags which of them capture, derived from the same dispatch table the tool routes on, so it cannot advertise something it will not do.
