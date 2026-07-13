---
name: linkedin-profile
description: >-
  Author and publish a complete LinkedIn profile that reads like the operator,
  not like a model. Covers the full arc: pick the one conversion goal, build
  the audience model, capture the operator's real voice verbatim, draft
  fold-first, lock sections in order (About → Headline → Experience → Featured
  → Skills → small fields), publish via browser automation with
  character-level verification, then audit to a rubric until nothing improves.
  Invoke when the user asks to refresh, rewrite, audit, or "fix" their
  LinkedIn profile, or any section of it (About, headline, experience
  entries, skills, featured). Encodes hard-won failure modes: model-judged
  bake-offs produce polished-wrong drafts; the operator is the only valid
  evaluator; synthetic typing silently drops characters. Do NOT invoke for
  writing LinkedIn posts/content strategy, or for resumes (different
  artifact, different rules).
---

# linkedin-profile

Author a LinkedIn profile end to end — strategy, copy, publishing, audit — with the operator's
voice as the load-bearing material and the agent as editor, publisher, and verifier.

## Stance

- **The operator's voice is the material. You are the editor.** Every failed draft in this
  skill's history failed the same way: a model guessed at voice and performed a persona.
  Capture real voice first (interview, chat transcripts, things they've actually written),
  then compose from it. Their verbatim words are privileged input — but *compose*, don't
  string-replace their phrases into slots.
- **The evaluator is the bottleneck, not the generator.** Model judges will score
  polished-wrong drafts 9+/10. Audience simulations and reviewer agents are *detectors* —
  prompt them to falsify, never to approve. The only gate that counts is the operator.
- **Iterate one section at a time, one decision per exchange.** Never dump the whole
  profile for review. Lock the section, then move.

## Workflow

1. **Goal first.** One primary conversion: active job search, passive optionality, thought
   leadership, founder/fundraising, sales, hiring, or consulting. Everything downstream
   serves it. Passive optionality means: no Open-to-Work frame, no CTA, zero job-hunt scent,
   and **Notify network OFF on every single save**.
2. **Audience model.** Rank the real readers: (a) post-contact lookups ("who is this
   person?"), (b) the goal audience (the people the positioning is *for* — they read
   everything and smell slop), (c) skimming scanners (recruiters/sourcers — headline, title,
   tenure, first two About lines), (d) amplifiers (press, organizers). Plus a **constraint
   audience**: current colleagues and leadership read this too — nothing that over-claims
   or reads cynical from inside.
3. **Voice capture.** Interview conversationally (no forms). Get the origin story AND the
   present in their own words. Save the transcript verbatim; it outranks every draft.
4. **Fold first.** The first ~200 characters of the About (mobile fold; desktop shows
   ~275+) are the highest-leverage copy on the profile. Iterate the fold as a standalone
   artifact in chat — cheap, fast, and it constrains everything downstream.
5. **Section order:** About (anchor) → Headline (falls out of it) → Experience (current
   role first) → Featured → Skills → small fields. Visuals (photo/banner) are the
   operator's design call; offer specs and candidates, never push.
6. **Redline loop.** Draft whole sections; let the operator edit in a real editor (or
   paste-and-markup). Respond with **whole-piece passes, never line patches** — patching
   the pointed-at line while the same disease lives elsewhere is the #1 trust-burner.
   Keep a running kill list of every word, phrase, and move the operator rejects; treat
   it as binding law for all future drafts, and store it durably.
7. **Publish** (browser automation) with the verification discipline below.
8. **Audit** the live profile against the rubric until a pass finds nothing real. Batch
   anything needing operator judgment into ONE group at the end.

## Craft laws

- **The razor: no word that isn't necessary.** Applies to every artifact and to your own
  chat messages.
- **So-what first.** Every bullet leads with the change, not the activity. Story is carried
  by the *sequence* of outcomes, not by narration.
- **Bare facts; nothing argues for its own significance.** Kill on sight: justification
  clauses ("X is a deliverable too:"), journey narration ("from an ambiguous ask…"),
  manufactured outcome frames, scale announcements ("at the scale of"), meta-narration
  ("The road here:"), validation ticks ("actually", "always").
- **Show, never label.** No self-labels (visionary, builder, thought leader). Only facts:
  shipped X, founded Y, maintain Z. If a line sounds quotable, cut it.
- **No context-dependent jokes.** A joke that needs backstory reads as noise (or worse) to
  a cold reader. The test: every line must work for someone who knows nothing.
- **Verb truth and proportion truth.** Never inflate ("worked on" ≠ "built and ran");
  never let a footnote project read as the era's main work. Junior eras stay junior.
- **No keyword stuffing in prose.** Searchable terms live structurally: headline segments,
  skills, title fields. An About that says "agentic workflows" reads as written by a bot.
- **Mentorship/culture claims need concrete scope or outcome** (who, how many, what
  changed) or they fold into another bullet as a plain noun. Unquantified virtue lines are
  definitionally slop.
- **Layers retell one story at different resolutions.** A deliberate one-sentence echo
  across headline/About/entry is coherence; same-resolution duplication is a defect.
- **Humanize:** no em-dashes, no semicolons in profile prose; straight quotes; varied
  sentence length (all-short reads noir, all-long reads unparseable); no "not X, it's Y"
  scaffolding; no aphorism closers. If closes keep failing, the strongest close is none.

## Section mechanics (live-verified 2026-07; re-verify limits before load-bearing use)

- **Headline:** ~220 chars; first ~60 must stand alone in search cards. Separator-segment
  form scans well: role + company · category · thesis-compression · named projects.
- **About:** ~2,600 max, 1,100–1,800 sweet spot. First-person. Paragraph breaks survive.
- **Experience:** ~2,000/entry. Current role carries the weight (bullet-hybrid or
  bare-facts prose); older roles are 1–3 line period pieces; delete "Technologies used:"
  cruft. Title changes at one company = separate position entries; the company header
  renders total tenure automatically — never write it into copy. Multiple *current*
  positions sort newest-start-first: use the reorder tool to put the anchor first (same
  for Featured — newest-added lands first).
- **Skills:** cap 100; pin top 5 to mirror the headline story; associate skills to
  positions when adding; keep old off-goal skills unpinned if they hold endorsements.
- **Featured:** 3–5 items, strongest first, must *prove* the headline. Link cards pull
  og:image from the target — **a site with no og:image renders a permanent gray
  placeholder**; fix the site, then delete/re-add the card.
- **Small fields:** custom URL, Location, Industry are search filters — set deliberately.
  Honors/Projects sections beat Experience entries for awards and bounded artifacts.

## Publishing verification (non-negotiable)

- **Synthetic typing drops characters randomly** in some form fields. After EVERY typed
  field: zoom-verify at character level; repair via word-select-and-retype (full-field
  retypes reproduce drops). After publishing: extract rendered text and machine-diff
  against locked copy. Never claim "published" from command echo — verify state.
- Expect save interstitials (upsells, connect-suggestions) — dismiss, never engage.
- Media/file uploads usually require a native file picker: operator territory. Say so.

## Audit rubric (score 0–2 each; lowest sections = highest leverage)

Category clarity in 5 seconds · one story across headline/About/Featured/Experience ·
fold hooks · accomplishment-driven entries with real numbers · pinned skills match the
story · Featured proves the headline with live thumbnails · fields set intentionally ·
no stale/contradicting content · verification badges present where eligible.

## Failure modes (all observed, all fatal)

The angsty-movie-voiceover About (brooding, comparison-to-"most people", aphorisms).
The bake-off trap (N models × M drafts, judged by models, all wrong the same way).
The string-replacement trap (pasting operator phrases instead of composing).
The spray-and-pray publish (type, save, never look). The wall-of-text reply that buries
the one question the operator asked.
