---
name: visual-qa-dogfood
description: Run this whenever work changes UI, rendered documents, CSS/layout/typography, visual assets, native app surfaces, screenshots, or any user-reported visual weirdness. Forces screenshot-backed dogfooding and adversarial visual review so metric-only checks cannot miss obviously broken UX.
---

# visual-qa-dogfood

Use this skill for UI/rendering/layout work before calling a task done. It exists for the failure mode where automated probes all pass but the human eye immediately sees nonsense.

## Trigger

Run this when any of these are true:

- The diff changes UI, rendered document output, layout CSS, typography, visual assets, viewport behavior, native window chrome, or screenshots.
- The user supplied a screenshot or says something "looks wrong", "weird", "ugly", "unreadable", "off", "silly", "not done", or equivalent.
- A validation harness reports dimensions, clipping, overflow, contrast, or scroll metrics for a visual surface.
- You are tempted to say the UI is done because tests/probes passed.

## Core Rule

Metrics are necessary but not sufficient. A visual task is not complete until a human-equivalent viewing pass has inspected representative screenshots or the live app surface and found no obvious absurdity.

## Workflow

1. **Name the surfaces.** List every user-visible surface touched or plausibly affected: routes, windows, panels, document states, themes, viewport sizes, empty/loading/error states, and real dogfood documents.
2. **Use realistic content.** Prefer the user's screenshot/source fixture and at least one dense/ugly real-world example. Do not edit live user docs; copy or fixture them if needed.
3. **Capture visuals.** Use the app's screenshot/probe tools, Playwright/browser screenshots, native screenshot harnesses, or installed-app smoke paths. Cover desktop and narrow viewports when layout can vary.
4. **Inspect like a user, not a meter.** Look for:
   - huge empty regions, tiny content ribbons, bad column balance
   - content clipped, overlapped, hidden behind chrome, or starting off-screen
   - local scroll where page scroll should happen, page scroll where local scroll should happen
   - unreadable line length, crushed words, awkward wraps, illegible contrast
   - controls that do not look clickable, labels that lie, stale/legacy product names
   - state mismatch between what the app says and what it actually shows
5. **Write an absurdity ledger.** For each visual oddity, record: screenshot/probe path, viewport/state, why a user would perceive it as broken, and disposition (`ready`, `fixed`, `intentionally accepted`, `out of scope`, or `needs reviewer gate`). `ready` means the issue is in scope, tractable, and waiting to be fixed. "Probe passed" is not an acceptable disposition.
6. **Fix the highest-signal ready issue.** If an item is in scope and tractable, patch it now. If it is ambiguous, use a reviewer gate; under autopilot, do not ask the user unless it is a true hard exception.
7. **Re-capture after fixes.** The final evidence must be from the fixed build/installed app, not a stale screenshot.
8. **Reviewer gate.** For non-trivial visual changes, spawn a fresh reviewer with the before/after screenshots, the diff, and the ledger. Ask for `PASS` or concrete visual blockers.

## Done Means

- The touched surfaces have screenshot/live visual evidence.
- The absurdity ledger has no `ready` or `needs reviewer gate` items left.
- Automated metrics still pass.
- A reviewer gate passed or the change is trivial enough to justify skipping it.
- The consuming surface is verified: packaged/installed/deployed app when applicable, not only a dev build.

## Anti-Patterns

- Declaring done from DOM metrics without viewing the surface.
- Testing only the bug's first screenshot and not nearby variants.
- Accepting "horizontal scroll exists" without checking whether the table/content is readable.
- Cropping screenshots so the broken relationship to the viewport disappears.
- Treating a user screenshot as illustrative instead of as the primary repro.
