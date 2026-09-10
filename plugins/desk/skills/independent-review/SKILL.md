---
name: independent-review
description: Coordinate an independent reviewer, frozen review inputs, finding disposition and re-review while leaving all implementation with the selected Superpowers owner.
---

# Independent review

Independent review is a required engineering input, not a second implementation method. The selected Superpowers implementation owner remains responsible for fixes and delivery. The reviewer observes and reports; it does not mutate the implementation tree.

## Freeze the review input

Record the exact source commit, uncommitted diff/content fingerprints, requested outcome, approval and terminal boundaries, prior findings, test selection, dependency/configuration fingerprints and available validation evidence. Give the reviewer enough primary source to evaluate the change, with precise exclusions and known unknowns. Distinguish the current reviewed source from historical runs.

Use an admitted independent reviewer. RoboRev is a first-class reviewer where the host overlay supplies its supported launcher; invoke that overlay's published skill rather than constructing another generic launcher. Verify the actual backend and effective instructions/plugins, not merely a command name or absent `--agent` flag. A failed, timed-out, cancelled, partial, stale or unavailable review is not an approval.

If the host cannot launch the required independent reviewer, return the frozen brief to the authorized parent for review. Do not self-certify and do not invent a fallback reviewer or weaker standard. Reviewer availability does not authorize extra delegation.

## Disposition and re-review

Give each finding a stable identity and a source reference. The implementation owner records whether it is accepted, fixed, rejected with evidence, explicitly deferred under the approved scope, or blocked. A reviewer suggestion is evidence to examine, not permission to broaden the task or change its endpoint.

One implementation owner handles all remediation and re-review findings. Fix accepted in-scope findings through the selected Superpowers method, preserving test-first discipline and the required changed-production coverage. Never run a parallel RoboRev fixer alongside a separate implementation loop.

Request re-review with fresh source/diff fingerprints and the disposition record after changes. Retain prior reports and failed runs; a newer source fingerprint does not rewrite their outcome. Close the review gate only when the required independent review accepts the actual current input and all required findings have valid dispositions. Review approval does not authorize publication, main promotion, profile changes or cleanup beyond the recorded mandate.

## Evidence boundary

Keep detailed reviewer output and operational evidence at the approved private artifact destination. Desk's canonical doing record holds progress/rulings and approved summaries or references, not an uncontrolled copy of private evidence. A reference and a declared hash alone do not prove an artifact exists or was verified. Preserve provenance labels and coverage limits.
