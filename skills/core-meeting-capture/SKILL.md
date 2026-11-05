---
name: core-meeting-capture
description: >-
  Use when capturing, refreshing or publishing a meeting, transcript, chat,
  recording or meeting recap; when a capture README is only a receipt; or when
  slides, diagrams, whiteboards or demos mentioned in a meeting need visual
  evidence. Not for recording an ongoing livestream or generating illustrations.
---

# Core meeting capture

A meeting capture is usable understanding backed by preserved evidence, not a
list of files. Read [the capture contract](references/capture-contract.md) before
producing a package.

## Provider boundary

This is the generic engine. A thin adapter owns source discovery, identity,
authorization, native retrieval, recording-part/time correspondence and the
destination's publication rules. Use its maintained access route; do not build a
provider API, bypass access controls or infer authority from source availability.
Context-specific adapters add their own routing, not a second recap engine.

## Evidence ledger first

Before drafting, separate **known source statements**, **unknown fields** and
**planned operations**. Only a successful tool/adapter receipt establishes
retrieval, inspection, publication or readback. In a simulation, provided
observations are attributed to the fixture; planned operations stay pending.
Unknown check times, hashes, durations, anchors and model prices remain unknown.
Use supplied anchors unchanged. Label future commands/captions as plans, not results.
When only a part/time is supplied, cite that as plain text; a URL fragment remains
unknown until the adapter supplies it. Source hash means recording bytes, not the
availability of the original deck.

## Required package shape

1. **Purpose and outcome:** what this meeting was for and what changed.
2. **Meaningful discussion:** main ideas, reasoning, disagreements and evidence,
   with inline links to speaker/time-qualified transcript or chat anchors.
3. **Decisions and proposals:** distinguish actual agreements from suggestions.
4. **Commitments and our actions:** actual owner, action, timing, observed status
   and source. Mark unknowns, unassigned work and no-commitment gaps explicitly.
5. **Unresolved questions:** what remains unsettled, without assigning new work.
6. **Visual evidence:** assessed status for each video; relevant verified artifacts
   or stills with captions that explain what to notice.
7. **Coverage and navigation:** concise capture date, source/part coverage, limits,
   eligible transcript/chat/artifact links and freshness.

Every factual interpretation has a local or native source anchor beside it.
Retain full eligible transcripts (speakers/timestamps), chat and artifacts.
An approved review subset or exclusion constrains **every** derivative and model
input; unapproved originals stay only in authorized private staging.

## Video gate — every existing recording

Video existence makes a transcript-guided visual-evidence assessment **required**,
even without a separate request. Assess presentation, diagram, whiteboard and demo
moments. Fetch the native original first. Where the recording adds evidence or
the original is absent, select a few useful real frames through the authorized
adapter; inspect them, do not invent replacements.

Before seeking, verify recording part and transcript-to-video mapping, especially
reset clocks. Adapter-provided video times are already mapped: do not offset
them twice. Unknown mapping blocks extraction. Screen exclusions before model
requests. Use the **cheapest available capable visual model**, small readable
contact sheets, and bounded candidate windows; never an expensive whole-video
pass. Prefer authorized cloud decode for large/remote recordings.

Save only legible, relevant, nonduplicate inspected frames; record provenance
and transformations. Delayed, unavailable, mapping-unverified, no-relevant-moment
and video-does-not-show-target are explicit states, not completed visual capture.
Attach the exact blocker, checked coverage and a bounded authorized retry.

## Delivery gate

| Check | Required evidence |
|---|---|
| Understanding | Purpose, reasoning, actual agreements, actions, unknowns, inline anchors |
| Scope | Full eligible evidence; approved subset/exclusions across all outputs |
| Visuals | Per-video assessment, actual inspection or honest unresolved state |
| Persistence | Destination-authorized publication and readback of package and links |

“Receipt exists”, “deadline”, “frames are obtainable” and “redact later” do not
meet these gates. Never report unseen pixels, OCR, progress, confidence, approval
or successful retrieval. A useful partial recap may be published under its
destination rules, but unresolved visual work remains open with a recovery step.
