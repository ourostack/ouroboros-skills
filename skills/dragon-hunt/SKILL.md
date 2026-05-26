---
name: dragon-hunt
description: Run an adversarial end-to-end bug hunt across product, backend, auth, data, integrations, MCP/agent surfaces, and deployment assumptions. Use when the user wants Codex to find, prove, fix, test, and log every reachable defect before declaring a system ready.
---

# Dragon Hunt

Adversarial product audit for moments when "the happy path works" is not good enough. Your job is to behave like a curious, chaotic user plus a skeptical security reviewer: find real bugs, prove them, fix them, and leave durable evidence.

## Operating Posture

- Assume bugs exist. Look for the first thing that feels too trusting, too implicit, too environment-dependent, too visually fragile, or too untouched by tests.
- Prefer proof over suspicion. A bug is real when you can reproduce it with a browser, test, request, MCP call, database state, or source-level invariant.
- Fix what you can reach in the current turn. Do not stop at a report unless the user asked for audit-only mode.
- Do not batch vague refactors. Each fix needs a concrete failure mode and verification.
- Keep a discovery backlog for anything observed but not fixed immediately. Close or defer every item before claiming the hunt is complete.

## Hunt Map

Work through these surfaces. Adapt to the app, but do not skip a surface merely because it is inconvenient.

1. **Auth and sessions**
   - Try forged, stale, cross-environment, missing-secret, default-secret, logout, callback, and redirect flows.
   - Check open redirects, protocol-relative URLs, backslash normalization, control characters, and callback state cookies.

2. **Authorization and data ownership**
   - Try editing, deleting, viewing, adding, importing, saving, or notifying across user boundaries.
   - Include soft-deleted records, orphaned records, duplicate rows, and stale relationship rows.

3. **Input and upload boundaries**
   - Try empty, huge, malformed, duplicate, special-character, HTML/script, SVG, MIME-confused, and same-timestamp inputs.
   - Verify server-side checks, not only client affordances.

4. **Critical product journeys**
   - Use the real UI in desktop and mobile viewports.
   - Exercise create, edit, delete, search, add/remove, undo/redo, notification, import, export, and settings flows.
   - Test both mouse and keyboard where the interaction should be accessible.

5. **API, MCP, and agent surfaces**
   - Exercise the same product actions through public APIs, internal APIs, and MCP tools.
   - Verify tool names, parameters, error messages, idempotency, and cleanup.
   - If an Ouro agent is part of the product contract, ask it to perform representative actions and report exact tool results.

6. **Persistence and deployment assumptions**
   - Compare local/test/prod adapters and secrets. Look for code that silently falls back in production.
   - Check migrations, remote schema assumptions, storage keys, queues, rate limits, and third-party credentials.

7. **Visual and interaction integrity**
   - Inspect every changed surface at realistic viewport sizes.
   - Look for overlapping text, accidental borders, mixed component generations, broken animation, unclear click targets, inaccessible contrast, and desktop/mobile layouts that tell different stories.

## Proof Loop

For each suspected bug:

1. Reproduce it with the smallest reliable path.
2. Add or update a failing test when practical.
3. Patch the smallest product surface that owns the bug.
4. Re-run the focused test.
5. Re-run the wider suite needed for the blast radius.
6. Re-test the original reproduction path.
7. Record the finding and the verification in the final summary or the active backlog.

## Completion Bar

You are done only when:

- Every fixed bug has a test or an explicit manual verification note.
- Every discovered-but-unfixed item is marked deferred, superseded, or handed off with a real path.
- Browser/API/MCP surfaces relevant to the request have been exercised.
- The full required verification suite for the repo has passed, or failures are clearly unrelated and documented with evidence.
- Any long-running local servers or sessions you started are stopped unless the user asked to keep them running.

