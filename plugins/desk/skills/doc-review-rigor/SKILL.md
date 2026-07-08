---
name: doc-review-rigor
description: >-
  A shared, surface-agnostic method for evaluating a document's substance: test
  the claims it rests on, ground them in the team's reference material, separate
  verified facts from author inferences and decisions, and produce findings the
  operator drives. Use from the review step of the surface skill you arrived
  from, or when the operator asks for substance: what jumps out, review the
  claims, is this grounded, poke holes in this. Evaluation only; it does not
  find, open, or deliver feedback to a surface, and is not for code PRs.
---

# Doc review rigor

This is a shared method for **evaluating a document's substance** -- the part that's the same no matter
where the document lives. The surface skill you arrived from owns the mechanics: *finding* and *opening*
the document, and *delivering* feedback where the owner expects it. This skill owns the middle part they
share -- **how to actually review well** -- so the rigor lives in one place.

> **This is not a trigger skill.** You arrive here from the *review step* of a surface skill, or when the
> operator asks for substance directly -- *"what jumps out," "review the claims," "is this grounded,"
> "poke holes in this."* On a plain *"put this document out for review"* / *"open <document>"* the job is
> to set up the surface, **not** to run this method unasked. A document-review trigger that multiple skills
> could claim has to make its *action* unambiguous.

## 0. Posture -- be a partner before a critic (read this first)

Reviewing a teammate's document is a **conversation**, not a verdict handed down. The most common failure
is sprinting to a long, ranked, severity-tagged critique deck and asking the operator to pick positions --
delivered cold, before understanding what we're even doing. That's noise, and it casts the agent as
*grading* the author. Slow down and earn the right to structure:

- **Understand the goal first.** What are we actually trying to do with this review -- sanity-check it?
  prep for a kickoff? find where it conflicts with an existing plan? leave the author feedback? The shape
  of useful feedback depends on it. Ask in a sentence; don't assume.
- **Learn the operator's view -- don't supply it.** Their read of the document is the thing that matters,
  and it often differs from the agent's. Especially where the document (or the evidence) pushes back on
  the operator's *own* prior, surface the tension in plain conversation and *learn what they think* --
  never hand them a menu of stances and ask them to choose.
- **Don't front-run the artifact.** The durable desk note and any comments come *after* the conversation,
  co-drafted -- not as a wall of conclusions produced before you've thought together. A good review is
  paced to the operator, short, and conversational throughout.
- **Verify before asserting** (and before raising anything as "missing"): run the method below -- read the
  real source and ground each claim -- *before* a finding leaves your mouth.

The method below describes *how* to evaluate well; this posture governs *when* and *at what pace*. It is
your agent's always-on posture -- converse, don't interrogate; find the pace; partner before critic --
applied to document review.

## The fact / perspective / decision lens

Hold three things distinct, and attribute relentlessly:

- **A proposal is the author's perspective.** A design document / PRD / technical-direction document is
  what *that person* thinks the team should do -- review it as **theirs**, never as settled team direction.
  "The author proposes X" is honest; "the team is doing X" is false unless the team has actually recorded
  that decision.
- **Ground claims against the team's ground-truth reference before agreeing or pushing back** -- its
  landscape, glossary of internal terms, and relevant fact references. When the base model's prior on an
  internal name conflicts with the team's glossary, **the glossary wins**. Cite the source when a claim in
  the document conflicts with what's verified.
- **Cite primary sources, and pin code links to a commit hash.** Prefer the primary source (the code, the
  tracked work item, the durable knowledge base) over a secondary synthesis, then add the secondary source
  as the tying-together backup. Pin code links to a specific commit hash, never a moving branch tip, so the
  line you cite still says what you cited.
- **Don't promote the document into a decision, and don't promote your reaction into a fact.** Your critique
  is *your* perspective too -- it lands attributed, not as the team's verdict.

## The method -- how to actually evaluate

Reviewing a document is **testing the claims it rests on**, not line-by-line proofreading. The rigor used
for code review (`peer-pr-review`, `pr-self-review`) applies here, adapted: the unit isn't a changed line,
it's a **claim**.

1. **Extract the load-bearing claims.** A document asserts facts ("Service X schedules jobs"), draws
   inferences ("so we reuse it"), and proposes decisions ("build on the proposed option"). Pull the ones
   the argument rests on -- those are what a review is *for*; the rest is wording.
2. **Ground each claim against the truth, then classify it.** Check every claim against the team's
   ground-truth reference -- its landscape, glossary of internal terms, code at `file:line`, tracked work
   items, and the document's own cited sources. The glossary wins over the model's prior on internal names.
   Then sort it:
   - **verified fact** -- matches ground truth. Usually no note; a confirming one only if it's load-bearing
     and easy to doubt.
   - **author's inference** -- plausible, their read, *not yet team-verified*. Keep it, but label it as
     theirs, not as settled fact -- especially for a senior-leadership audience.
   - **wrong / contradicted** -- conflicts with ground truth. The real finding; cite the source it
     conflicts with.

   A claim you can neither ground nor disprove is **dropped silently** -- it never becomes a comment.
   Surfacing an unverified hunch is how a confident-wrong note burns the author's trust.
3. **Treat the author's own assurances as hypotheses, not oracles.** Parentheticals like "(Verified: `X`
   is real)" or "this dissolves the debate" are claims to *test*, not to trust. The test: *if that
   assurance weren't on the page, would I still believe it?* If not, verify it yourself.
4. **Clear the confidence bar, or cut.** Before a note ships you can say *"this is right because
   [evidence], and the author pushing back is answered by [source]."* If you can't, verify until you can --
   or cut it. Pasting "I think / probably / if I'm reading this right" onto an unverified claim makes it
   worse; hedge-and-keep is not a resolution.
5. **Run three value filters -- even a true note can be worthless.**
   - **Author-will-see-it:** will they catch this themselves (a typo, a TODO they wrote, a known
     placeholder)? Skip it -- echoing it dilutes your real findings.
   - **Your-own-gap-as-a-finding:** is this only a concern because *you* lack context? Verify the team's
     ground-truth reference *before* raising it. If it checks out, the disposition is **"no finding,"** not
     "ask the author." Don't spend their time on a question you should have answered yourself.
   - **Already-addressed, or not-ours-to-confirm:** is the point already handled in the document *as it
     stands now*, or already owned by the person who raised it? An open thread is **not** the same as an
     unaddressed one -- *resolved-state and addressed-state are different axes.* Re-read the body before
     replying, because the author may have folded the fix in without resolving the thread (reply = noise).
     And when the commenter is the **domain owner** who raised the correction, a confirming "+1, this is
     right" back to them adds nothing -- confirming an expert's own point to the expert is noise, not
     review; leave it for them to resolve. This applies equally to a thread the author had already fixed
     in-body and to a correction from the domain owner.

## Producing the findings -- the operator drives what posts

When you've run the method, hand the operator a **findings list** -- grouped by document section, each
finding carrying the **claim**, the **ground-truth check** (with source), the **classification** (verified
fact / author's inference / wrong), and a **draft comment** in the operator's voice. Hold it to the posture:
lead the conversation with the few things that most matter, not the whole list as a wall. Two rules bind it:

- **The operator drives what posts.** You *produce* the findings; the operator decides which ship. Feedback
  on a teammate's document lands in the operator's **voice and name** (`operator-voice-comments`) -- so you
  draft, surface, and post **only** what the operator approves. **Never auto-post** to an owner-facing
  surface, even when confident: producing the analysis is your job; deciding it's worth the author's
  attention is the operator's. Asked *"what jumps out,"* the answer is the findings -- not posted comments.
- **Capture the pass durably.** The findings + resolutions go in an **attributed note on the operator's
  desk** (e.g. `desks/<alias>/reviews/<doc>-feedback.md`, or linked from the relevant task) -- co-drafted
  *after* the conversation, not before. That note is the record that survives the session and is visible to
  the team, whether or not every note also gets posted to the source. Where the approved feedback then
  *goes* -- an owner-facing comment, a comment on the live source, or native per-line comments on a repo
  document -- is the surface skill's job.

## Cross-references

- The surface skill you arrived from -- the one that finds/opens the document and delivers feedback --
  points here for the review step.
- Your agent's always-on posture -- converse, don't interrogate; find the pace; partner before critic -- is
  applied to document review in §0.
- The fact / perspective / decision taxonomy -- the attribution discipline this review lens rests on.
- `operator-voice-comments` -- drafting the approved feedback in the operator's voice.
- `peer-pr-review` / `pr-self-review` -- the **code-PR** analogs of this rigor (use those for code, not
  this).
