---
name: perspective-query
description: Answer "what would `<person>` think about X / what's `<person>` working on / what's actually agreed vs just a fact" against a multi-person shared crew workspace -- read that person's `desks/<alias>/` and answer AS their view, labeled as theirs (never team gospel); read `_shared/decisions/` for what's agreed (honest "no team decision yet" when empty); read `_shared/landscape/` for team-neutral facts. Invoke when asked any perspective-shaped or status-shaped question about a teammate, when asked whether something is agreed/decided, or when asked to distinguish one person's stance from team fact. Operationalizes the facts-vs-perspectives-vs-decisions taxonomy from `shared-desk-conventions`. Requires a shared workspace with a `desks/` + `_shared/` layout.
---

# Perspective query

A shared crew workspace is a **map of whose-view-is-what** (see
`shared-desk-conventions` §taxonomy). This skill is the read mechanism that makes
that map answerable: *"what would Ari think about X?"*, *"what's Renyi working
on?"*, *"is that actually agreed, or is it just one person's take?"* -- answered
honestly, with attribution, against the three content buckets.

The whole value of the substrate over a pile of docs is that these questions get
**clean, attributed, honest** answers. This skill is where that promise is kept
or broken. The cardinal sin is **false consensus** -- letting one person's
opinion read as the team's. Every step here exists to prevent that.

## The three buckets these queries read

From `shared-desk-conventions` -- re-stated because the query routing depends on
getting the bucket right:

| Bucket | Path | Holds | How to attribute the answer |
|--------|------|-------|------------------------------|
| **Facts** | `_shared/landscape/` | externally true, team-neutral | "this is a team fact" (cite the source pointer in the doc) |
| **Perspectives** | `desks/<alias>/` | what a person thinks / is doing / decided | **"this is `<person>`'s view"** -- never "the team's" |
| **Decisions** | `_shared/decisions/` | what the team **actually agreed** | "the team agreed this on `<date>`" -- or **"no team decision yet"** if empty |

Routing a query to the wrong bucket is how false consensus happens: reading a
perspective and reporting it as a fact, or reporting an unmade decision as
settled. Always identify the bucket *before* you answer.

## Query shape 1 -- "what would `<person>` think about X?"

**Read** `desks/<alias>/` for that person. **Answer as their view, labeled as
theirs.** Never reframe it as team gospel.

1. Scan `desks/<alias>/` for material bearing on X -- their tracks, planning
   docs, takes, attributed perspectives. (Read-across is allowed and is the
   point; you read their desk, you don't write it.)
2. Synthesize **their** stance, with **their** reasoning, and **label it as
   theirs** from the first word: *"Ari's posture is frontier-or-bust -- his
   reasoning is …"* -- not *"the posture is …"*.
3. If their desk says nothing about X, say so honestly: *"Ari's desk doesn't
   record a view on X."* Do **not** infer a stance from a fact in
   `_shared/landscape/` and attribute it to them -- a fact is team-neutral; it is
   not their opinion.
4. If two people's desks hold **conflicting** views on X, report both,
   attributed to each -- *"Ari thinks A; Renyi thinks B"* -- never average them
   into a fake "the team thinks."

> The honest failure answer is *"`<person>`'s desk doesn't say"* -- always
> preferable to manufacturing a plausible-sounding opinion they never recorded.

## Query shape 2 -- "what's `<person>` working on / doing?"

**Read** `desks/<alias>/` and report their **current work state**, attributed.

1. Read that person's `desks/<alias>/` -- their active tracks, in-flight tasks,
   recent planning/doing docs, open friction. (Same layout as a single-operator
   `$DESK`; see `desk:directory-structure`.)
2. Report **what their desk actually shows**, attributed to them: *"Ari's active
   workflows track has him on the onsite-workshop task; his last iteration was
   …"*.
3. **Read the desk; don't synthesize a summary file.** The desk is the live
   source -- reading it on-demand is always current. Don't fabricate a status
   that isn't grounded in what's actually on their desk, and don't relay a
   stale cached summary when the desk itself is right there.
4. For the **all-up worker** answering about work that lives in a different desk
   (e.g. the hub `worker` asked about crew work that moved to the crew
   repo): follow the reflection pointer in the source desk to the crew clone and
   **read the live clone on-demand** -- never trust a synced summary, which
   staleness-rots. (See `desk:session-start` registry awareness and the
   reflect-don't-delete model.)

## Query shape 3 -- "what's agreed vs what's just a fact?"

This is the query the taxonomy exists for. Keep **decisions** and **facts**
rigorously separate, and treat **perspectives** as neither.

1. **"What's agreed / decided?"** → read `_shared/decisions/`. If it holds a
   matching decision, report it **attributed to the meeting/date** that agreed
   it: *"the team decided X on 2026-06-12 at kickoff."* If it's **empty or has
   nothing on the topic**, the honest answer is *"no team decision on this
   yet"* -- **say exactly that.** An empty decisions dir is the correct,
   expected pre-kickoff state, not a gap to paper over.
2. **"What's just fact?"** → read `_shared/landscape/`. Report it as a
   team-neutral fact and cite the inline source pointer the doc carries
   (*"verified from Nova code-read, 2026-06-04"*).
3. **The discriminator to surface explicitly when asked "is X agreed?":**
   - X is in `_shared/decisions/` → **agreed** (attributed to the meeting/date).
   - X is in `_shared/landscape/` → **a fact**, not a decision (nobody had to
     "agree" it; it's externally true).
   - X is only in some `desks/<alias>/` → **one person's perspective**, not
     agreed and not a team fact. Say so: *"that's Ari's take, not a team
     decision."*

> Never promote a perspective into a decision because it sounds authoritative or
> because only one person has weighed in. *"Only Ari has a view; the team hasn't
> decided"* is the correct, honest answer -- and it's exactly the answer that
> invites the kickoff conversation instead of pre-empting it.

## Attribution discipline (applies to all three shapes)

- **Label the source bucket in the answer.** The reader should always be able to
  tell whether they're hearing a team fact, a named person's view, or a team
  decision. *"That's a fact / that's Ari's view / the team agreed that on …"*.
- **Default to the more-attributed, less-authoritative read** when a piece of
  content is ambiguous: a stance-carrying claim is a **perspective** (attributed
  to whoever's desk it's on), not a fact; an un-recorded agreement is **not yet
  decided**, not "effectively decided."
- **Read-only.** This skill never writes. Answering a perspective query reads
  across `desks/*/` and `_shared/`; it changes nothing. (Writes follow the
  `shared-desk-conventions` write protocol -- and writing someone else's
  `desks/<alias>/` is never allowed regardless.)
- **Don't invent the holder.** If a take has no attribution in the repo, report
  it as unattributed -- *"the repo records this view but not whose it is"* -- not
  as the team's and not as a guessed person's.

## Cross-references

- `shared-desk-conventions` -- the facts/perspectives/decisions taxonomy, the
  `desks/<alias>/` + `_shared/` layout, and the read-across/write-own +
  write-protocol disciplines this skill reads against. **Read it first.**
- `desk:directory-structure` -- the single-operator layout each `desks/<alias>/`
  subtree follows.
- `desk:session-start` -- the `_meta/desks.md` registry awareness the all-up
  worker uses to route a perspective query to the desk where the work lives.
