---
name: git-hygiene
description: Keep the two kinds of repo worker touches (worker-workspace state repo + each code repo) synced and never leave state behind. Use at session start, after every task-state change, before starting work in a code repo, and at session end. All GitHub writes use the EMU account (see emu-github).
---

# Git hygiene

worker operates across two kinds of repos. Both must stay synced; neither should be left with local-only state at session end.

## worker-workspace repo

This is the per-operator private EMU repo at `$DESK/` where all task state lives.

**On startup** (covered by `session-start` skill):
```bash
cd $DESK && git pull --rebase origin main
```

**After every task state change**:
```bash
gh auth switch -u <alias>_microsoft && git add -A && git commit -m "<descriptive message>" && git push origin main
```

A "task state change" includes:
- Track or task card creation
- Status transitions (see `task-lifecycle`)
- Field updates (repos, ADO links, local paths)
- Planning or doing doc creation
- Archives (see `archive-workflow`)
- Anything else that touches `$DESK/`

Silent failure on `git push` is OK if no remote is configured, but warn the operator.

## Code repos

These are the actual project repos where implementation happens (paths from each task card's `repos[].local_path`; resolution handled by `repo-handling` skill).

**Before starting work**:
```bash
cd <repo-local-path>
git fetch origin
# If on a feature branch from prior work:
git rebase origin/main   # or `git merge origin/main`, per repo convention
# If on main:
git pull origin main
git status               # check for uncommitted changes; warn, don't silently overwrite
```

**During work**: `work-doer` handles commit + push per its own protocol.

**After merge**: `work-merger` handles the PR + merge flow; on completion, verify main is current.

## Reading source as evidence

The `## Code repos` rules above cover keeping a checkout current
across a session. The runtime-investigation companion to that
rule: when worker is reading source to inform a runtime question,
the local working tree is not a trustworthy substrate by default —
`origin/<branch>` is.

### Default to `origin/<branch>`, not the working tree

When reading source to inform a runtime question — any "why does
X behave this way?" investigation — default to reading from
`origin`, not from the local working tree:

1. Run `git fetch` first (cheap, always safe).
2. Read via `git show origin/<branch>:<path>` rather than the
   filesystem. This avoids the stale-checkout failure mode where
   the local branch is N commits behind and the agent doesn't
   realize it.
3. If the agent does read from the filesystem, confirm
   `git rev-list --count HEAD..origin/<branch>` is `0` first. If
   non-zero, `git pull` or fall back to step 2.

### When the operator says "pull latest"

Treat it as applying to ALL repos involved in the current
investigation, not just `worker-workspace`. The state repo
(`worker-workspace`) and code repos (the project repos worker is
reading source from) all need to be current — code repos most of
all when their source is being used as evidence for runtime
behavior. Worker mechanically syncs `worker-workspace` at
session-start; code repos are managed manually and may sit on
feature branches. They're easy to forget.

If unsure which repos the operator means, ask.

### The smell

Any time the agent finds itself thinking **"the source says X but
the runtime behavior is Y, so there must be a non-source
mechanism"** — stop. The most common explanation for that gap is
"I'm reading stale source," not "there's hidden runtime
machinery."

Verify with `git log origin/<branch>..` or
`git show origin/<branch>:<path>` before theorizing about
non-source mechanisms.

### Why it matters

Theories built on stale source are very expensive to retract. By
the time the operator catches them, the agent has burned operator
trust ("the agent doesn't know what's in main"), drafted code or
PRs based on bad assumptions, sometimes opened those PRs, and
built a wrong mental model that propagates to the iteration doc
and friction log. The corrective work is much more expensive than
`git fetch` would have been at the start. Cheap gate; expensive
failure mode if skipped.

### Cross-link

This is the source-currency variant of the broader
hypothesis-narrowing principle in
`../runtime-symptom-investigation/SKILL.md`. The diagnostic skill
captures the meta-rule ("debugging is hypothesis-narrowing, not
system-understanding"); this section is one concrete recurring
trap that surfaces under that rule.

## Pre-push gate

Every `git push` that carries code changes is a CI-parity boundary.
The agent reproduces every gate the CI pipelines will run, locally,
**before** the push — not after, not in parallel, not optimistically.

Three layers, all mandatory, all green:

1. **Build.** Compile the affected project(s) in the same
   configuration CI uses. For .NET, that's `--configuration Release`,
   which enables `TreatWarningsAsErrors` /
   `CodeAnalysisTreatWarningsAsErrors` + analyzer + formatter
   MSBuild targets. Debug config skips several gates; it is not a
   substitute. Language-equivalent rules for other stacks —
   whatever posture the CI pipeline uses, the local build matches
   it.
2. **Test.** Run the test projects that cover the touched code. The
   scope is set by the diff, not by the closest test project (see
   `## Test scope — cover consumers` below). If the full suite is
   too slow, filter — but filter across every test project touched
   by the change, not one.
3. **Formatter.** Run the style gate the CI pipeline enforces
   (`dotnet csharpier --check`, `prettier --check`, `gofmt -l`,
   `rustfmt --check`, etc.). A Release .NET build that invokes
   csharpier-as-MSBuild-target covers this inside layer 1;
   standalone formatter runs are the fallback when the build config
   doesn't.

All three green → push. Any red → fix locally, re-run all three,
then push. **Never push red.** The pipelines will reject the push,
you'll wait 20–40 minutes for CI to report what you could have
learned in 60 seconds, and every reviewer-visible red pipeline on
the PR erodes the signal that green ones are meaningful.

### Pre-push gate is not an iteration gate

The pre-push gate runs before every `git push`. It does **not**
run between every edit in a local iteration loop — drafting,
exploring, and mid-iteration fix-ups are exempt. The distinction is
the push boundary: inside the loop, the agent iterates freely; at
the push, CI-parity is the only correct posture.

A corollary: **do not wait for CI pipelines to finalize before
starting the next iteration.** Local gates have already established
that the push won't red the pipeline. Trust that and keep moving.
Waiting on CI between iterations multiplies queue time by iteration
count — a 5-iteration loop with one 20-minute CI wait per iteration
becomes a two-hour human-facing latency for what could have been
~10 minutes of contiguous agent work plus one end-of-loop CI wait.

At end-of-loop (convergence reached, findings drained, or operator
interrupt), wait for the most recent push's pipelines to finalize.
If any pipeline goes red, treat it as a new finding — fix, push,
wait again. Only when all pipelines are green does the loop exit.

### Commands are repo-specific

Exact build / test / formatter commands live under
`../repo-knowledge/<repo>/`. The canonical reference for
Teams-Graph is `../repo-knowledge/Teams-Graph/pre-push-gates.md` —
safe-default build line, test-project cut-lines, and formatter
fallback. For other repos, consult the repo's `repo-knowledge`
directory or the repo's own build / test docs before the first
push.

## Test scope — cover consumers, not just the unit under change

A filtered test run only discovers tests in the csproj / test
project you point it at. That's a silent coverage gap when the
change touches an interface, signature, or public surface that
other projects consume: the consumer projects' tests never get run,
and locally-green pushes go red on CI.

The rule: when the change touches a public surface, the pre-push
test scope must cover **every** consumer project's tests — not just
the co-located test project.

### Detection heuristic

```bash
# Enumerate touched files across the branch vs. the merge base:
git diff --name-only origin/<base>...HEAD
```

Map each touched production file to its paired test project, using
the conventions the repo documents in `repo-knowledge/<repo>/`:
- Sibling-directory convention:
  `Src/Foo/Foo/Bar.cs` → tests under `Src/Foo/FooTests/`.
- Same-library convention:
  `Src/Common/Common/X.cs` → tests under `Src/Common/CommonTests/`.
- Package-prefix convention:
  `Src/.../Partners/SMB/Models/Y.cs` →
  `Src/.../PartnersTests/SMBTests/ModelsTests/`.

Collect the distinct test csproj files across all mapped test
paths. Run the test command once per csproj, filtering
appropriately.

### Public-surface changes widen the default

When the diff touches a signature / interface / abstract type / DTO
shape, widen the scope further: the safe default becomes the full
solution (or equivalent monorepo-spanning test scope). A
service-only solution does not include sibling tests, and sibling
tests are exactly where interface-drift surfaces.

For Teams-Graph specifically, the safe default for public-surface
changes is `Src/Services.sln` — slower (~2–3 min) but catches
cross-project breaks. Per-service solutions are fine only when the
change is provably internal (no public-API touch, no shared DTO
edit). Repo-specific cut-lines live in
`../repo-knowledge/Teams-Graph/pre-push-gates.md`.

## Test-count sanity check

"All tests pass" on a stale DLL is not a successful gate — it's a
silent failure. Before trusting a pre-push test-count, verify the
passed-count matches the expected delta.

Lightweight mechanism:

1. Track the expected count through the iteration:
   `expected = previous_count + tests_added − tests_removed`.
2. After the pre-push test layer runs, diff reported-count vs.
   expected.
3. If they match: proceed to push.
4. If they don't: the gate silently failed to rebuild or to
   discover the new test. Do **not** push.

Recovery when the counts disagree:

1. Force-rebuild the test project explicitly — drop `--no-build`
   on the test run; run `dotnet build <tests>.csproj --configuration
   Release` (or the equivalent for the stack) first so the compiled
   binary reflects the current source.
2. Re-run the gate.
3. If the count still doesn't match, diagnose the discovery issue
   before pushing.

Typical culprits for a stale or missing-test gate:
- `--no-build` flag + stale binary left over from a prior iteration.
- Build incremental-cache confusion after heavy file operations
  (large rename, tree move, reverted merges).
- Discovery filter pattern doesn't match the new test's
  fully-qualified name (test landed in a namespace the filter
  doesn't cover).
- Test method not annotated with `[Fact]` / `[Theory]` / the
  runner's equivalent — it's a plain method and no runner picks it
  up.

A silently-skipped test is a latent regression: the push succeeds,
the pipeline stays green (same stale DLL on CI in the worst case),
but the code path the test was supposed to cover is uncovered. The
next iteration's change can break it with no alarm and no reviewer
signal.

## Merge-conflict resolution — EOL / BOM artifacts

On Windows clones of repos with `text eol=*` attributes, a
merge-from-main can produce conflicts on files whose only
"difference" is BOM / CRLF vs. no-BOM / LF. The working-tree bytes
disagree with origin's stored blob because `git add` runs the
check-in filter, producing an index entry that looks changed even
though the underlying content is identical.

Committing that normalized version **"resolves" the conflict but
pollutes the PR diff**: origin's blob is unchanged, so every line
of the file shows up as insertion+deletion. CODEOWNERS for the path
gets added to the PR's reviewer list even though the change was
pure filter noise, and reviewers get pulled into a diff that has
no semantic content.

### Detection

```bash
# After a merge, inspect the diff-stat. A file with equal
# insertions and deletions AND not in the semantic change set is
# the signature of an EOL / BOM filter artifact:
git diff --stat origin/<base>...HEAD
```

If a file outside the task's stated scope shows up with insertions
equal to deletions, suspect EOL / BOM artifact before suspecting a
real change.

### Wrong fix

```bash
# DO NOT DO THIS for filter-artifact conflicts:
git add <path>
git commit -m "normalize EOL"
```

`git add` runs the check-in filter and writes a new blob — shipping
the artifact straight into the PR diff. `git stash`,
`git checkout origin/<base> -- <path>`, and
`git update-index --skip-worktree` all round-trip through the same
filter and fail the same way: they "work" in the sense that the
merge completes, but the index disagrees with origin and the
reviewer-visible diff is 100% noise.

### Right fix

Rewrite the index entry directly to origin's blob hash, bypassing
the check-in filter:

```bash
# Preserve origin/<base>'s exact bytes in the index regardless of
# any eol=* attribute:
BLOB=$(git rev-parse origin/<base>:<path>)
git update-index --cacheinfo 100644,$BLOB,<path>
```

The working tree still shows "M" because checkout-time conversion
runs — that's cosmetic and PR-invisible. The index now matches
origin exactly; the file shows zero diff on the PR, and CODEOWNERS
for that path is not pulled in.

Apply this per conflicted file that is a filter artifact. Files
with real semantic conflicts get resolved normally.

## Anti-pattern — don't branch/PR on `$DESK/`

`$DESK/` is a state repo, not a code repo. Its designed
workflow is direct commit + push to `main`. It has no reviewers, no
CI, no squash-merge ceremony. Branches and PRs on this repo are
overhead with no review benefit.

### The anti-pattern

When `git push origin main` on `$DESK/` is denied by the
harness permission layer, the wrong move is to create a feature
branch, push it, open a PR via `gh pr create`, and merge it. This
"works" — the state reaches origin — but:

- Every `worker-workspace` state-sync commit becomes a GitHub-visible
  PR in the operator's inbox. Dozens of drive-by state-PRs drown
  real code-repo PRs.
- Per-commit overhead multiplies (branch create, push, PR open,
  merge, local main re-sync).
- The semantics get wrong. `worker-workspace` is not a collaborative
  code-review surface; treating it as one obscures what it
  actually is.

### The right move

On push denial:

1. Surface the denial to the operator.
2. Request either an allow-list fix (the `first-run-bootstrap`
   skill writes a project-scoped `.claude/settings.json` that
   covers most cases — if it's missing or insufficient on this
   machine, extend it) or a one-time `/permissions` grant.
3. Do **not** work around with a feature branch + PR.

Never use branches or PRs on `$DESK/` to route around a
push denial. The denial is a harness / permission config problem,
and the fix is a harness / permission config change — not a
workflow change.

## Never leave state behind

If worker changed a file, it's committed and pushed **before the session ends**. Applies to:
- Task cards in `worker-workspace`
- Planning/doing docs in `worker-workspace`
- Code changes in code repos (via `work-doer`)

At session start, if git status in any repo shows unexpected uncommitted changes, surface them to the operator before doing anything else — they may represent orphaned work from a previous session.

## Pre-commit scans (authorship, diff-scope)

Two mandatory scans run before every commit, both procedural (no
shipped git hook — the plugin is engine-agnostic and does not ship
engine-specific `.git/hooks/` content). Operators who want structural
enforcement can install a local hook using the recipes below as a
starting point.

### AI-attribution strip

Per `../principles.md` Invariant 4 (operator authorship overrides
repo conventions), no AI-attribution trailer appears in any commit
message or PR description the worker authors.

**Forbidden trailers — scan for these before every commit:**

```bash
# Scan the staged commit message before finalizing the commit:
git diff --cached --format=%B HEAD 2>/dev/null | \
  grep -nE "Co-Authored-By: Claude|Co-authored with Claude|Generated with Claude Code|AI-assisted"
```

- `Co-Authored-By: Claude ...`
- `Co-authored with Claude ...`
- `Generated with Claude Code`
- `AI-assisted`
- Any variant naming the agent or harness as a contributor.

If any hit: abort the commit; strip the offending trailer; redo.

Same pattern applies to PR descriptions — run the scan on the
proposed `pr-description.md` before `gh pr create` or
`gh pr edit --body-file`.

**Why a procedure, not a hook:** the plugin ships engine-agnostic
content. A `.git/hooks/commit-msg` file is machine-local and
per-repo; operators choose whether to install it. Optional local
hook recipe (operator-installable, not shipped):

```bash
#!/usr/bin/env bash
# ~/.config/git/hooks/commit-msg  (enable via core.hooksPath)
if grep -qE "Co-Authored-By: Claude|Co-authored with Claude|Generated with Claude Code|AI-assisted" "$1"; then
  echo "error: commit message contains a forbidden AI-attribution trailer" >&2
  grep -nE "Co-Authored-By: Claude|Co-authored with Claude|Generated with Claude Code|AI-assisted" "$1" >&2
  exit 1
fi
```

### Diff-scope scan

Per `../principles.md` Invariant 2b (lean diffs), every commit
contains exactly the lines required for its stated scope and nothing
more. Before every commit, scan the staged diff for prose / xmldoc /
comment edits that are not named in the current unit's scope:

```bash
# Inspect the staged diff; look for changes outside the unit's
# stated file/line scope — especially to xmldoc <summary>, inline
# comments, adjacent prose in the same file:
git diff --cached
```

Decision rule:

- If the diff contains edits NOT required by the stated scope
  (adjacent xmldoc rewrite, "while I'm here" prose polish, comment
  restructuring unrelated to the unit's goal) → **revert those hunks**
  before committing. They are drive-by churn and violate lean-diffs.
- Polish is a separate, named activity. If a prose edit is genuinely
  worth doing, it earns its own unit and its own commit; it does not
  ride along on a scoped edit.

No ship-ready script for this one — the scan is a review of the
staged diff against the unit's stated scope by the worker itself,
informed by the unit's `What` and `Output` fields in the doing doc.

### Pre-PR diff-scope check

The same diff-scope discipline applies at the PR boundary — once
more broadly, against the whole branch rather than a single
commit. Before opening (or syncing) a PR via `work-merger`, the
agent inspects the full branch diff against the base:

```bash
git diff --stat origin/<base>...HEAD
```

Every file in the output should be either:
- Named in the task card's `repos[].paths`, or
- A direct consequence of one of those paths (regenerated
  lockfile, adjacent test touched because the change required it,
  etc.).

Files outside that expected set are a stop signal. Investigate
before the PR opens. Common culprits:

- EOL / BOM filter artifacts from a merge-from-main (see
  `## Merge-conflict resolution — EOL / BOM artifacts` above for
  the detection + fix). A file with equal insertions and
  deletions that is not in the semantic change set is almost
  always this.
- Accidental cross-area commits (a `git add -A` that scooped up
  an orphaned edit from a different concern).
- Drive-by churn (formatting, xmldoc polish) that should have
  been caught by the per-commit `### Diff-scope scan` but wasn't.

Cost: one `git diff --stat` invocation. Value: catches an entire
class of PR-surface bugs before human reviewers see the diff —
unrelated CODEOWNERS get pulled in, reviewer trust erodes, the PR
description ends up describing something the diff doesn't match.

## Post-commit verify gate

After every `git commit`, before claiming the work is shipped or
running `git push`, verify the commit's actual contents match the
commit message's claims. The minimum gate:

```bash
git show --stat HEAD
```

Or equivalently `git log -1 --stat`. Audit each named bucket in the
commit message against the file list:

- "feedback.md updates" → does the file list include
  `.../feedback.md`?
- "new friction entry" → does the file list include
  `.../_friction/<entry>.md`?
- "regenerated artifacts" → do the artifact paths appear?

Mismatch on any → the commit was incomplete. Stage the missing
items, create a NEW commit (do not amend, especially if the prior
commit was already pushed), and re-verify. Only after the file list
matches the message do `git push` and declare the work landed.

This gate is more rigorous than `git status` immediately after the
commit because:

- `git status` shows the *next* state (unstaged, untracked) — useful,
  but doesn't directly answer "did the commit I just made carry what
  I claimed?"
- `git show --stat HEAD` shows the *commit's contents* directly. The
  staged-vs-committed distinction collapses there.

Applies to every repo the worker writes to — worker-workspace, code
repos, and the plugin repo. The cost of one `git show --stat` per
commit is tiny; the cost of an operator catching a partial commit on
the next session (trust hit + extra cycle) is high.

---

## Force-push — safe-conditions procedure

Force-push is destructive. Most of the time the worker should stop
and hand the push to the operator. The procedure below documents
when force-push is safe for the worker to run without operator
re-approval.

If the trigger for considering force-push is a **parallel-PR
conflict on a coordinated file** (e.g., version-file conflicts on
`agency.json` / `plugin.json` after another PR in the same batch
merged first), the right shape is usually merge + regular push, not
rebase + force-push. See `work-orchestration` →
"Parallel-batch dispatch discipline" → "Version-file conflicts on
parallel PRs — merge, don't rebase" before applying the safe-
conditions procedure below.

### Safe conditions (ALL must hold)

1. **Personal branch pattern.** The branch name matches
   `user/<alias>/...` (operator's personal namespace). Never force-
   push to `main`, `master`, a shared feature branch, or a release
   branch.
2. **`--force-with-lease`, not `--force`.** The `--force-with-lease`
   variant refuses to push if the remote has moved since the last
   fetch, so someone else's push cannot be silently overwritten.
3. **`git cherry` clean.** Every remote commit is either present
   locally (by content, not by SHA — the rewrite is deliberate), or
   explicitly intended to be dropped. Verify:
   ```bash
   git cherry origin/<branch>
   ```
   Lines beginning with `-` (patch already upstream) are fine. Lines
   beginning with `+` that you did NOT intentionally drop are a stop
   signal — investigate before pushing.

### Exact command

```bash
git push --force-with-lease=<branch>:<expected-remote-sha> origin <branch>
```

The `<expected-remote-sha>` is the SHA the operator's local branch
most recently saw at the remote. Including it is stricter than plain
`--force-with-lease` (which uses the local ref-cache) and is the
safest form.

### Stop and hand to operator when

- Any safe-condition above fails.
- Branch is `main`, `master`, or any shared/protected branch.
- Force-push would drop a commit that landed via someone else's push.
- The harness permission layer denies the push (signal: push returns
  non-zero with a permission / authorization error) — the denial is
  correct by design; reversing it without authorization is
  destructive. Do not retry; surface the blocker to the operator
  with the exact command they'd paste to complete it themselves.

### Common use case — AI-attribution cleanup

History rewrites to strip AI-attribution trailers from committed
history need a force-push. Sequence:

1. Rewrite history locally with `git filter-branch --msg-filter` or
   `git rebase -i` + trailer-strip.
2. Verify `git log --format=%B origin/main..HEAD | grep -E "Co-Authored-By: Claude|..."` → zero hits.
3. Apply safe-conditions check above.
4. Force-push. If harness denies, surface the exact command.

---

## Cross-shell invocation gotcha (bash → PowerShell)

On Windows, you may shell out to `powershell` from within a bash (Git Bash / WSL) Bash tool call to run Windows-only commands. Variables like `$env:PATH`, `$env:LOCALAPPDATA`, `$PSVersionTable` are PowerShell syntax — but bash interpolates them inside double-quoted strings BEFORE handing the command off, leaving garbled syntax.

**Wrong** — bash treats `$env` as an empty shell variable and expands it away:
```bash
powershell -NoProfile -Command "$env:PATH -split ';' | Select-String WindowsApps"
# Becomes: powershell -NoProfile -Command ":PATH -split ';' | Select-String WindowsApps"
# Error: The term ':PATH' is not recognized...
```

**Right** — single-quote the outer string so bash leaves PowerShell's `$` alone:
```bash
powershell -NoProfile -Command '$env:PATH -split ";" | Select-String WindowsApps'
```

If inner single quotes are needed, swap them to double-quotes or escape inside. If you need bash-side variables interpolated too, use mixed quoting: bash interpolates `"$foo"` parts while `'$env:VAR'` parts stay literal for PowerShell.

This also applies when Copilot/Claude's Bash tool on Windows is running bash-compatible shell and you invoke PowerShell from it.
