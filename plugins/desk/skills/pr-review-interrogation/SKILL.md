---
name: pr-review-interrogation
description: Invoke ONLY when reviewing a PR (self or external) that adds a new abstraction / helper / pattern, OR when answering a provenance question about code in a diff ("where did X come from", "is X new", "what does this PR change about Y"). Triggered by phrases like "why did we add this helper", "is this new in the PR", "where did this field come from", "why does this PR need this". Also auto-invoked by `pr-self-review` Phase 2 / Phase 4 when a finding concerns a new abstraction or a provenance claim. Do NOT invoke for generic code review that does not involve challenging a design premise or tracing where something came from, for routine nit / style findings, or for architectural conversations that have no PR in scope.
---

# pr-review-interrogation

This skill inherits all invariants in `../../principles.md`. Read them
first if they are not already in context.

Single-purpose skill for one reviewer discipline: **do NOT accept the
PR's own framing as the answer.** When a PR adds something or when a
question about the PR's diff is raised, the PR's doc-comment, commit
messages, and consumer-code narrative are SUBJECTS of the review, not
authoritative answers to it.

Two rules, one set of red flags. Both rules trace to the same failure
mode: reviewer (human or agent) reads the PR's own explanation of a
thing and mistakes that explanation for evidence.

## When to invoke

- **Operator triggers.** Any of:
  - "where did `<field/type>` come from?"
  - "is `<thing>` new in this PR?"
  - "what does this PR change about `<file/subsystem>`?"
  - "why does this PR need `<helper/abstraction>`?"
  - "are you sure we need to add this?"
- **`pr-self-review` auto-triggers.** During Phase 2 evaluation or
  Phase 4 classification:
  - A finding touches a newly-introduced helper, abstraction, or
    shared-surface change → Rule 2 applies.
  - A finding or clarifying question concerns where something came
    from or what the PR changed → Rule 1 applies.

Rule 1 and Rule 2 are independent; a single review pass may invoke
only one, both, or neither.

## Rule 1 — Diff-first for provenance questions

Every provenance claim about a PR starts with a `git diff` against
the merge base. Not with consumer code, not with commit messages, not
with doc-comments, not with the PR description.

### The command

```
git diff <merge-base>..<branch> -- <path>
```

`<merge-base>` is typically `origin/main` (or whatever the task's
base branch is — check the task card's `base_branch` if unsure).
`<path>` scopes the diff to the file, directory, or glob the question
is about. Without the path argument, the diff is too noisy to read
for provenance.

The diff is the definitive source. Everything else is narrative that
must be reconciled against the diff, not trusted in its place.

### Why consumer code is not a substitute

Reading a consumer that uses type `X` and inferring what fields `X`
has is backward derivation. Consumers can use a subset of `X`'s
fields, can pre-date the PR's changes, can use a same-named but
different type in a partner-specific namespace. The set of fields a
consumer reads tells you NOTHING about what the PR changed on `X` —
it only tells you what that consumer happens to need.

Commit messages describe the author's intent for a commit. They
describe ONE commit, not the full branch-vs-main delta. A field
renamed in commit A and reverted in commit C shows up in neither
commit message as "unchanged," but the branch's diff against main
correctly shows no net change.

### Scope-check when multiple types share a name

Same type names across namespaces are common: a shared-library type
at `<Common>/Models/X.cs` and a partner-local narrow-reader at
`<Partners>/<P>/Models/X.cs` may both exist. Before answering "what
does the PR change about `X`":

1. Grep the repo for all types named `X`. Treat each hit as a
   candidate.
2. Read each candidate: its namespace, its field set, its declared
   usage scope.
3. Name which candidate is the storage/shared shape and which is a
   narrow projection.
4. Only then pick the one in scope for the question.

Picking by path-convenience ("the one at `.../Partners/<P>/Models/`
looks right") without this check produces wrong answers confidently.

### What a diff-first answer looks like

Good:

> `git diff origin/main..user/alice/feature -- <file>` shows one net
> new field (`TicketsListWebUrl`), two dropped
> (`LiveChatAgentSiteId`, `LiveChatAgentSiteUrl`), and the
> `[Required]` attribute removed on every existing field. Commit `abc123`
> adds the new field; commit `def456` removes the two and relaxes
> `[Required]`.

Bad:

> Based on the consumer code in `<partner>/Models/X.cs`, the PR adds
> two new fields and drops three. [reasoned backward; wrong on both
> counts.]

The good answer leads with the diff and cites commits as supporting
narrative. The bad answer leads with narrative and never runs the
diff.

## Rule 2 — Prove novelty for new abstractions

When a PR adds a helper, abstraction, or shared-surface pattern
(especially on a shared file or under a shared subsystem), the
reviewer's job is to prove the new thing earns its keep. The PR's
own rationale is not proof.

### The questions to ask

For every new helper/abstraction:

1. **Novelty.** What about this PR's needs is genuinely different
   from the existing callers of the same underlying system? If the
   answer cannot be articulated in one sentence, the new helper is
   suspect.

2. **Existing patterns.** How do existing callers handle the same
   category of problem (error mapping, retry, telemetry, batching,
   etc.)? If there is an established pattern, the new code should
   use it, not introduce a sibling.

3. **Premise-challenge.** Do NOT accept the PR's own rationale —
   doc-comment, commit message, PR description — as the answer to "does
   this need to exist." The author thought they needed it, or they
   would not have added it. The reviewer's job is to challenge that
   premise, not to relay it.

4. **Xmldoc-after-novelty.** If the helper passes the first three
   questions, the doc-comment should explain **what** it does, not
   justify its existence by contrast with other callers. "We kept
   this separate because other callers rely on X" is a smell — a
   self-contained helper does not need to reference the rest of the
   file.

### The "N existing callers" frame

Most shared-surface additions are on files that already have many
callers doing approximately the category of work the new helper is
doing. Before accepting the new helper:

- Count the existing callers of the shared surface (grep for
  call-sites of the surrounding class/method). The answer is
  typically a double-digit count.
- For 3–5 representative existing callers, read how they handle the
  same category of problem the new helper addresses.
- If any one of them solves it with a pattern that would also work
  for this PR's needs, the reviewer's default should be "align with
  the existing pattern" rather than "accept the new helper."

The burden of proof is on the new helper, not on the existing
callers. A PR adding a sibling pattern to an established one needs
to show why alignment is insufficient.

### What a novelty-proved answer looks like

Good:

> `GraphServiceAdapter` has ~20 existing callers. Five of them
> (`ChannelsService`, `MembersService`, `TeamsService`,
> `MessagesService`, `FilesService`) handle fine-grained HTTP-status
> → domain-error mapping via `try { ... } catch
> (InternalServiceException ex) { switch (ex.InnerHttpStatus) ... }`.
> This PR's SMB caller needs the same category of mapping. The new
> `CallGraphAPIReturningPayload<T>` helper duplicates that surface
> with a non-throwing return shape — no novelty proven. Recommend
> aligning with the `catch InternalServiceException` pattern instead.

Bad:

> The helper's doc-comment explains it returns a payload non-throwingly
> so callers can inspect HTTP status without a catch block. That
> matches this PR's needs.

The good answer names the existing callers, reads how they handle
the category, names the new helper as a sibling-pattern, and
recommends alignment. The bad answer restates the doc-comment and calls
that a review.

## Red flags

Specific shapes that indicate Rule 1 or Rule 2 is being violated,
usually by the reviewer trusting the PR's framing:

- **"We kept this separate because other callers rely on X."** A
  self-contained helper does not need to reference the rest of the
  file. If the doc-comment defines the helper against other callers
  rather than describing what the helper itself does, the helper is
  likely a parallel pattern that should have been an alignment.

- **Xmldoc that justifies by contrast.** Phrases like "unlike the
  existing `Foo`, this new `Bar` does Y differently" or "we
  deliberately chose a different approach from sibling X." These are
  the PR explaining its own design; they are not a review. A
  reviewer seeing this should go read `Foo` / sibling X and
  evaluate whether the divergence is load-bearing.

- **"This is why this code is here" in response to "why did this
  PR need this."** Reading the code and restating its behavior is
  not answering the premise-challenge question. "This code does
  non-throwing HTTP status mapping" is a description; "this PR
  needs non-throwing HTTP status mapping because the existing
  throwing pattern does X which is incompatible with Y" is an
  answer.

- **Consumer-code reasoning for provenance questions.** Any answer
  that starts with "looking at how `<consumer>` uses `<type>`..."
  and never runs the diff against the merge base is wrong by
  construction. The consumer tells you what it uses; the diff tells
  you what the PR changed.

- **Same-named types picked without scope-check.** If the reviewer
  picked one of several same-named types without naming the others
  and saying why the chosen one is the storage/shared shape, they
  may have answered against the wrong type.

When a red flag fires, the right move is not to re-ask the
question — it is to go run the correct evidence-gathering (Rule 1's
diff for provenance, Rule 2's existing-callers-walk for novelty) and
answer from that evidence.
