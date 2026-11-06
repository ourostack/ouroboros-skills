---
name: full-systems-audit
description: Perform a comprehensive codebase audit covering architecture, code quality, and modularization. Produces a doing doc with chained, PR-scoped fixes.
---

Audit a codebase end-to-end and produce a doing doc that chains every finding into well-scoped, independently mergeable units of work.

## When to use

- Before a major refactoring effort
- When onboarding to an unfamiliar codebase
- When code quality or architecture concerns have accumulated
- Periodically, to catch boundary drift and god-module growth

## Audit phases

Run these sequentially. Take notes throughout — the notes feed the doing doc.

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
- **What to do**: Concrete fix

### Phase 6: Doing doc generation

Convert findings into a doing doc with chained units.

Each unit must be:
- **PR-scoped**: One logical change, independently reviewable and mergeable
- **Sequenced**: Dependencies respected (e.g., boundary fixes before restructuring)
- **Testable**: Clear verification criteria (tests pass, imports updated, no regressions)
- **Described**: What changes, why, which files

Group units into phases:
1. **Boundary fixes** — Eliminate circular dependencies and layering violations (no functional changes)
2. **God module splits** — Break oversized files into focused modules (no functional changes)
3. **Directory restructuring** — Move misplaced code to correct locations
4. **Semantic fixes** — Unify competing implementations, fix naming
5. **Logic sharing** — Extract duplicated patterns into shared utilities
6. **Quality** — Coverage improvements, lint rules, cleanup
7. **Documentation** — Update docs to reflect all changes

## Output format

The audit produces a **doing doc** (markdown) following the project's task doc conventions. The doing doc should be placed in the owning agent's task directory if applicable, or presented inline if no agent bundle context exists.

The doing doc contains:
- A summary of findings (for human review)
- Sequenced units of work (for autonomous execution)
- Each unit specifies: files to change, what to do, verification steps

## Principles

- Approach with care — if this is an agent's home, treat it like one
- Every finding needs a "why it matters" and a "what to do"
- Severity reflects impact on inhabitants, not just engineering aesthetics
- The doing doc must be executable by an autonomous agent
- Prefer structural fixes over workarounds
- Respect what's working well — acknowledge good architecture
- Use parallel exploration agents for large codebases (heart, mind, senses, etc. simultaneously)
- Read every file, not just the ones that look suspicious

## Learned pitfalls (from real audit execution)

These are things that went wrong and how to avoid them:

### Persist findings immediately
Never keep audit findings only in conversation context. Context compresses. Write findings to a durable planning doc as each phase completes.

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
