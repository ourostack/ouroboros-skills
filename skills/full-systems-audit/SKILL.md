---
name: full-systems-audit
description: Perform a comprehensive codebase audit covering architecture, code quality, and modularization. Produces an audit report plus a routed backlog for work-planner, inch-worm, and companion skills.
---

Audit a codebase end-to-end and produce durable execution artifacts for the rest of the skill ecosystem. You are the mapper and router, not the one giant executor. Large structural items should flow into `work-planner` / `work-doer` / `work-merger`; only after those land should the surviving small items be re-evaluated and handed to `inch-worm`.

## When to use

- Before a major refactoring effort
- When onboarding to an unfamiliar codebase
- When code quality or architecture concerns have accumulated
- Periodically, to catch boundary drift and god-module growth

## Primary contract

Your default output is NOT a giant doing doc. Your default output is:

1. `audit-report.md` — the human-readable map of the system, findings, evidence, and recommendations
2. `audit-backlog.md` — a routed backlog that other skills can act on directly

Only generate a doing doc when the user explicitly wants coordinated execution work and at least one routed item clearly requires it.

## Audit phases

Run these sequentially. Take notes throughout — they feed the audit artifacts.

### Phase 1: Manifest

Build a complete picture of what exists.

1. List all source files (exclude node_modules, dist, .git, worktrees, coverage).
2. Count files and lines per directory/subsystem.
3. Extract imports from every source file to map the dependency graph.
4. Identify the most-imported modules (centrality).
5. Find the largest files (>500 lines are candidates for splitting).
6. Count cross-subsystem imports in both directions to detect layering violations.

### Phase 2: Documentation

Read every piece of in-codebase documentation.

1. README, ARCHITECTURE, CONTRIBUTING, AGENTS (or equivalents).
2. All files in docs/.
3. All skill files.
4. Any psyche/identity/soul files if this is an agent harness.
5. Package.json, tsconfig, eslint config, vitest/jest config.
6. Note what the docs claim the architecture is — you'll compare against reality.

### Phase 3: Flow tracing

Map the major runtime flows end-to-end.

1. Identify the critical path (e.g., request → processing → response).
2. Trace it through every file, noting each handoff.
3. Identify where state is assembled and how many sources contribute.
4. Look for competing code paths (two modules doing similar things).
5. Look for "invisible machinery" — things that affect behavior but aren't visible to the user/agent.

### Phase 4: Control deck assessment

Evaluate the clarity of the system's configuration surface.

1. List every config file, env var, and external state directory.
2. Map which configs affect which behaviors.
3. Assess whether an operator/agent can predict system behavior from the config alone.
4. Note any configs that are scattered, duplicated, or confusingly named.

### Phase 5: Findings synthesis

Categorize everything into severity levels.

**CRITICAL** — Architectural violations, competing implementations, broken layering.
**HIGH** — God modules, overloaded directories, misleading coverage.
**MEDIUM** — Duplication, naming issues, inline complexity, tight coupling.
**LOW** — Vestigial code, missing lint rules, cosmetic issues.

Every finding needs:
- **What**: The specific issue
- **Why it matters**: Impact on maintainability, navigability, correctness
- **Evidence**: File/path/flow proof that grounds the claim
- **What to do**: Concrete fix

### Phase 6: Routing and sequencing

Route each finding into the correct execution lane.

Execution lanes:

1. **planner-required**
   Use when the fix is architectural, cross-cutting, dependency-shaped, risky, or too large for a single clean PR.
   Default downstream flow: `work-planner` -> `work-doer` -> `work-merger`

2. **inch-worm-ready-after-reeval**
   Use when the fix is self-contained and should become a one-PR seed after the large items have landed.
   Default downstream flow: `inch-worm`

3. **defer**
   Use when the issue is intentional, ambiguous, product-dependent, low-value, or not yet worth the churn.

For each finding, also recommend supporting skills when helpful:
- `frontend-design` for UX/front-end issues
- `skill-creator` for skill-authoring issues
- `openai-docs` for OpenAI-build questions needing current docs
- other domain-specific skills as appropriate

Do NOT try to become those skills. Route into them.

### Phase 7: Review gate

Stop after the audit artifacts are written and present them for review.

Do NOT automatically start execution. Do NOT automatically convert the backlog into a doing doc. Wait for explicit approval on what should happen next.

### Phase 8: Post-large-work re-evaluation

When the user chooses to execute the large tranche first, re-audit the affected areas after those items merge. Reclassify surviving backlog items before handing them to `inch-worm`. Many "small" items disappear, merge together, or change priority after the structural work lands.

## Output format

The audit produces two markdown artifacts by default:

1. **`audit-report.md`**
   Contains:
   - repo/system summary
   - architecture notes
   - control-deck assessment
   - findings grouped by severity or subsystem
   - evidence and rationale
   - what appears healthy and should be preserved

2. **`audit-backlog.md`**
   Contains routed findings in a durable format that other skills can consume directly.
   The format is intentionally compatible with `inch-worm` so the small-item lane can pick it up without translation.

Backlog item format:

```markdown
## A-001 — short finding title

**Source**: audit
**What**: One-sentence description of the issue.
**Why it matters**: Maintainability/correctness/AX impact.
**Evidence**: `path/to/file.ts:line`, flow notes, or import/dependency evidence.
**Severity**: critical | high | medium | low
**Blast radius**: self-contained | affects one module | affects multiple modules | crosses trust boundaries
**Dependencies**: (optional) item ids that should land first
**Recommended lane**: planner-required | inch-worm-ready-after-reeval | defer
**Suggested supporting skills**: (optional) comma-separated skill names
**Verification**: How a future agent should revalidate this at current HEAD before changing code.
**Status**: open | in-progress | fixed | superseded | deferred
**Notes**: (optional) context that will matter later

---
```

If the repo has project-specific task doc conventions, place the artifacts where those conventions say they belong. Otherwise place them in the working directory or present them inline, but keep them durable.

## Execution choreography

The default chained flow is:

1. Audit the whole terrain.
2. Route findings into `planner-required`, `inch-worm-ready-after-reeval`, and `defer`.
3. Execute the `planner-required` tranche first through `work-planner` / `work-doer` / `work-merger`.
4. Re-evaluate the backlog after those large items land.
5. Hand the surviving small items to `inch-worm`.

Do not skip the re-evaluation step. Small fixes picked too early create churn.

## Principles

- Approach with care — if this is an agent's home, treat it like one
- Every finding needs a "why it matters" and a "what to do"
- Severity reflects impact on inhabitants, not just engineering aesthetics
- The audit artifacts must be executable by the rest of the skill ecosystem
- Prefer structural fixes over workarounds
- Respect what's working well — acknowledge good architecture
- For agent harnesses, prioritize AX and TTFA over aesthetic tidiness; prefer truth-bearing state, clean seams, and moves the inhabitant will actually enjoy living with
- Use parallel exploration agents only when the runtime and permissions allow it
- Inventory every file, but do not try to dump every file into context; use tooling for exhaustive scans and read deeply where the evidence points
- Stop when another pass is unlikely to change prioritization or the remaining issues are intentional/ambiguous/product-dependent rather than actionable

## Learned pitfalls (from real audit execution)

These are things that went wrong and how to avoid them:

### Persist findings immediately
Never keep audit findings only in conversation context. Context compresses. Write findings to `audit-report.md` and `audit-backlog.md` as each phase completes.

### CI workflow files reference dist/ paths
When moving source files, check `.github/workflows/*.yml` for hardcoded `require('./dist/...')` paths. These break silently after file moves.

### v8 coverage differs between CI and local
New files change the aggregate coverage computation. Always verify coverage on CI, not just locally. Individual files may round to 100% but drag the aggregate below threshold.

### File-completeness rule for split files
Splitting a large file creates new modules that need either `emitNervesEvent` calls or entries in the dispatch-exempt list. Plan for this upfront when designing splits.

### Module-level side effects break test mocks
Never add module-level `emitNervesEvent()` calls to fix file-completeness. They fire during test imports before `vi.mock()` setup and break unrelated tests. Use dispatch-exempt entries or add events inside handler functions instead.

### Version sync across packages
Every version bump needs BOTH `package.json` and `packages/ouro.bot/package.json`. CI has a publish-sync guard that fails if they disagree.

### MCP live testing requires daemon
After routing MCP through the daemon (if applicable), `send_message` requires the daemon to be running. Use `ouro dev` to reload, and ask the resident agent to verify after each behavioral PR.

### Ask the inhabitant
If an agent lives in the codebase, ask them what feels uncomfortable before finalizing the audit plan. Their perspective on "seams over size" is more valuable than file-length metrics.
