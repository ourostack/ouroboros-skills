---
name: shared-desk-conventions
description: The multi-person shared-workspace layout variant -- one git repo, N operators, `desks/<alias>/` = one person's full desk, `_shared/{landscape,decisions}/` = team-neutral facts + agreed decisions; read-across / write-own; the facts-vs-perspectives-vs-decisions content taxonomy (every opinion attributed to its holder); and the invisible conflict-safe write protocol (`desks/<you>/` = direct push; a shared path = auto pull-`main` → branch → write → PR → merge-now, NO human review). Invoke when working in a shared crew repo that has a `desks/` + `_shared/` layout, when deciding where a piece of content belongs (a fact vs an opinion vs an agreed decision), or when about to write to a path outside your own `desks/<alias>/` subtree. The multi-person overlay for `desk:directory-structure`.
---

# Shared-desk conventions

`desk:directory-structure` is the floor plan of one operator's room -- one
operator, one `$DESK/`, synced across that operator's machines, private, the
operator owns every write. This skill is the **multi-person overlay** on that
floor plan: the same room, but now N operators share one git repo, each with
their own desk in it, plus a common area for team-neutral facts and agreed
decisions.

Read `desk:directory-structure` first for the single-operator layout (tracks,
tasks, iterations, reserved `_` directories, where planning/doing docs go); come
here for what changes when the room is shared.

## The shift -- single-operator → shared workspace

A shared workspace generalizes the single-`$DESK` model along five axes at once:

| Axis | Single-operator desk | Shared workspace |
|------|----------------------|------------------|
| **Tenancy** | 1 operator | N operators in one repo |
| **Visibility** | private | team-visible by default |
| **Desks per operator** | 1 (`$DESK`) | personal + one-or-more shared |
| **Content** | all "the operator's" | facts vs perspectives vs decisions, attributed |
| **Worker** | one worker | a generalist (all-up) + specialists (scoped) |

The most important non-obvious consequence: per-person scoping is **concurrency
safety, not tidiness.** A shared repo where N agents all write one tree is a
collision machine -- concurrent agents `git add`-sweep each other's uncommitted
edits into the wrong commit. Git merges non-overlapping paths cleanly, so if
each agent writes only its own `desks/<alias>/`, conflicts go to ~zero **without
any locking.** Scoping *is* the mechanism (see "the write protocol" below).

## The floor plan

The shared repo is one git repository. It holds everyone's desks side by side,
plus a shared common area, plus (when the crew bundles its own tooling) a
`plugins/` source tree.

```
<crew-repo>/                            # one git repo, N operators
  README.md                             # plain-markdown front page (graceful degradation)
  AGENTS.md                             # crew conventions, auto-imported by the crew worker
  _meta/
    desks.md                            # the desk registry (one row per desk) -- see desk:session-start
  _shared/                              # the common area -- team-neutral, the contention hotspot
    landscape/                          # FACTS: externally true, team-neutral (read by everyone)
      <topic>.md
    decisions/                          # DECISIONS: what the team ACTUALLY agreed, attributed
      README.md                         # the discipline note; near-empty until kickoff
      <decision>.md
    tracks/                             # (optional) shared-track coordination cards -- see below
      <track>/
  desks/                                # one subtree per person -- the unit of ownership AND safety
    _template/                          # clean clonable skeleton a new teammate copies in (read desk:first-run-bootstrap shape)
    <alias>/                            # ONE PERSON'S FULL DESK -- identical shape to a single-operator $DESK
      _meta/
        friction.md
        tips/
        featured.md                     # this person's pins (per-person, not repo-wide)
      <track-name>/                     # exactly desk:directory-structure layout, rooted here
        track.md
        _planning/
        <task-name>/
          task.md
          <repo-name>/
            <YYYY-MM-DD>-<slug>/
    <other-alias>/                      # someone else's desk -- you READ it, you don't WRITE it
  plugins/                              # (optional) the crew's bundled tooling source -- a shared path
```

The key identity: **`desks/<alias>/` is one person's full desk** -- everything
`desk:directory-structure` describes (tracks, tasks, iterations, `_planning/`,
`_friction/`, `_meta/`, `_archive/`) lives *under* that prefix, unchanged. The
`desks/<alias>/` prefix just re-roots the same floor plan one person at a time.
A person's agent treats `desks/<alias>/` as its effective `$DESK`.

## Read-across / write-own

The single discipline that makes a shared workspace both powerful and safe:

- **Read across everything.** Every agent READS all of `desks/*/` and all of
  `_shared/`. This is the superpower -- the shared brain that every agent reads,
  so the team gets smarter automatically and a new desk orients in minutes.
- **Write only your own.** An agent WRITES only its owner's `desks/<alias>/`.
  This is the safety -- the concurrency mechanism above.

Reads span the whole repo; writes scope to one subtree. (The desk MCP's
`--person <alias>` write-prefix enforces the write side mechanically -- reads and
search stay repo-wide because the indexer walks the tree recursively by
filename; see `desk:session-start` for the registry-awareness side.)

## The content taxonomy -- facts vs perspectives vs decisions

The core failure mode of a team knowledge base is conflating "one person's
opinion" with "team fact." The shared workspace keeps three things distinct and
**attributes relentlessly**:

| Kind | Lives in | What it is | Who can rely on it |
|------|----------|------------|--------------------|
| **Facts** | `_shared/landscape/` | Externally true, team-neutral. *"Service X's control flow is a model-driven loop"* (verified from code). | Anyone. |
| **Perspectives** | `desks/<alias>/` | What a person thinks / is doing / decided, **attributed to them**. *"Alex's posture is frontier-or-bust; here's the reasoning."* | Only as **that person's view**, labeled as theirs. |
| **Decisions** | `_shared/decisions/` | What the team **actually agreed**, attributed to the meeting/date. | Anyone -- but only once genuinely agreed. |

Three rules fall out of this:

1. **A fact is not an opinion.** Before a claim goes into `_shared/landscape/`,
   it must be externally true and team-neutral -- verifiable independent of who
   holds it. If it carries a stance ("we should…", "the right move is…", "I
   think…"), it is a **perspective** and belongs in that person's
   `desks/<alias>/`, attributed. Apply the same provenance discipline
   `desk:directory-structure` requires for promoted facts: inline source pointer
   + date at write time (*"verified from Service X code-read, 2026-06-04"*).

2. **Every perspective is attributed.** A perspective in `desks/alex/` is *Alex's*
   -- never reframe it as team gospel. This is what makes "what would Alex think
   about X" a clean, honest query (see `perspective-query`): the agent reads
   `desks/alex/` and answers **as Alex's view, labeled as his**, not as the
   team's position.

3. **A decision is only a decision once it's agreed.** `_shared/decisions/` is
   **near-empty until kickoff** -- and that is correct. Recording a thing there
   means the team genuinely agreed it, attributed to the meeting/date that
   agreed it. Saying *"no team decision yet"* **is the honest answer** and is
   always preferable to promoting one person's preference into a fake consensus.

The substrate is a **map of whose-view-is-what** -- more useful AND more honest
than a false monolith. It also propagates a founder's thinking *better* than
baking it in, because it travels as reasoning-with-attribution that invites the
kickoff conversation rather than pre-empting it.

> **False-consensus is the cardinal sin here.** The taxonomy exists precisely so
> "Alex's opinion" never reads as "the team's." When in doubt about whether
> something is a fact, a perspective, or a decision, the safe default is the
> **more attributed, less authoritative** bucket: perspective over fact,
> "not-yet-agreed" over decision.

## The write protocol -- invisible conflict-safety, NOT human review

This is the load-bearing behavior. The "gate" on shared paths exists purely to
**serialize concurrent writes** so agents don't clobber each other -- it is
**invisible to humans, and there is no review step, ever.** Path determines
behavior:

### Your own desk → direct push

When an agent writes its own `desks/<you>/`, it is the **sole writer** of that
subtree. There is no one to conflict with. The agent just **commits and pushes
directly** -- no branch, no PR, no ceremony. This is the common case (notes,
planning, doing docs, friction, per-person tracks/tasks).

### A shared path → auto pull-`main` → branch → write → PR → merge-now

A **shared path** is anything outside your own desk that multiple agents may
write: `_shared/` (facts + decisions), `plugins/` (the bundled tooling source),
`_shared/tracks/` (shared-track coordination cards), `_meta/desks.md` (the
registry). When an agent recognizes "this isn't my desk," it **automatically**:

1. **pulls latest `main`** (so it's writing on top of everyone else's work),
2. **branches** off that latest `main`,
3. **writes** its change,
4. **opens a PR**, and
5. **merges it onto latest `main` right now** -- **retrying** the whole cycle if
   `main` moved under it (pull again, rebase, re-merge).

There is **NO human review step.** The PR is a serialization primitive, not an
approval gate. The human never sees it. This is the mechanism that prevents the
commingle/clobber bug (concurrent agents sweeping each other's writes). A
decision's *legitimacy* is not a review step -- it's the **attribution
discipline** above (the agent records only genuinely-agreed decisions,
attributed to the meeting/date). Conflict-safety ≠ correctness-review.

| Path | Writer model | Write behavior |
|------|--------------|----------------|
| `desks/<you>/...` | sole writer | **direct commit + push** |
| `_shared/...` | multiple writers | auto pull-`main` → branch → write → PR → merge-now (retry if main moved) |
| `plugins/...` | multiple writers | same conflict-safe protocol |
| `_shared/tracks/<track>/` | multiple writers | same conflict-safe protocol |
| `desks/<someone-else>/...` | **not yours** | **don't write** -- read-only |

> **The test before any write:** *"is this path inside my own `desks/<alias>/`?"*
> Yes → direct push. No → the conflict-safe protocol (and if it's
> `desks/<someone-else>/`, you shouldn't be writing it at all). The agent runs
> this test silently; the human never thinks about it.

## Shared tracks (when several people work one effort)

Shared tracks recur, so handle them lightly: the shared track's coordination
card/index lives in `_shared/tracks/<track>/` (a shared path → conflict-safe
writes), while **each person's actual work on it stays in their own
`desks/<alias>/` subtree and links to the shared card.** Shared card =
coordination; the work itself = scoped. The default stays read-across /
write-own; only the small coordination surface is shared.

## Graceful degradation -- plain markdown first

The shared repo must be useful as **plain markdown** to a teammate who never
runs an agent, and superpowered for those who do -- never gate participation on
agent fluency. `desks/<alias>/` and `_shared/` are just folders of markdown;
the README is a plain front page. Author every file so a human reading it cold,
with no agent, can navigate and understand it. The agent layer is additive.

## Cross-references

- `desk:directory-structure` -- the single-operator floor plan this skill
  overlays. The `desks/<alias>/` subtree is exactly that layout, re-rooted.
- `perspective-query` -- operationalizes this taxonomy: "what would `<person>`
  think / what's `<person>` doing / what's agreed vs just fact," with the
  attribution discipline this skill defines.
- `desk:session-start` -- reads `_meta/desks.md` and surfaces the desk-set +
  "which desk am I."
- `desk:git-hygiene` -- the underlying push / branch / merge mechanics the write
  protocol drives.
- Your overlay's identity skill -- the identity your writes push under. The generic crew layer is identity-neutral; a corporate overlay supplies the concrete account model.
