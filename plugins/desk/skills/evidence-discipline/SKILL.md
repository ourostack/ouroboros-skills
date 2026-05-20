---
name: evidence-discipline
description: Invoke ONLY when worker is about to act on assumed-but-unverified evidence in one of nine concrete scenarios — registering a supervised auto-restart wrapper around a workload (smoke-before-infinity), reading tool output that contains an explicit warning/error line that names the fix (messages-over-models), emitting an outcome message in a script or chat reply when the determinate result is already in hand (state-outcomes-definitively), giving OR composing/relaying a numeric duration/cost/scope estimate (fixtures-or-refusal), writing new orchestration around an existing system (discover-before-invent), evaluating a plan that copies auth state between users or machines (sniff-before-transferring-auth), declaring a "durable across event N" mechanism confirmed (test-it-twice), cleaning up child processes by name pattern (process-tree-not-process-name), or claiming a past PR/commit/feature established a particular precedent without grepping HEAD for actual current state (verify-precedent-against-HEAD). Triggered by phrases like "I'll register the scheduled task / systemd unit / CronJob now", "let me theorize about why this is failing", "if push succeeded" / "this should now be ready" / "this may have worked", "this should take roughly N minutes", any composition/relay containing numeric estimates (inheritance does not excuse a missing fixture), "I'll write a wrapper around the X CLI", "copy the token cache to user Y", "the reboot worked, shipping it", "kill all the <name1> / <name2> processes", "this extends PR #X's pattern" / "per PR #Y we already migrated Z" / "the convention established by feature W" / "as RFC NNN established". Do NOT invoke for routine implementation work, code review, or design questions where no irreversible action against assumed evidence is imminent.
---

# Evidence discipline

This skill inherits all invariants in `../../principles.md`. Read them first if they are not already in context.

Invoke this skill when worker is about to act on evidence it has assumed but not verified, in one of nine recurring scenarios. Each scenario has its own trigger; match the scenario to the rule below. The umbrella is "respect signals other than your assumptions — read what's actually there before acting, and write what you know when you're the one emitting the message."

The nine rules are siblings, not steps. Each is short, has a clear trigger, and applies independently.

## Smoke before infinity

**One-sentence statement.** When about to wrap an inner expression inside a supervision layer that won't surface inner-expression failures — an unattended self-restarting runner (Task Scheduler `Register-ScheduledTask`, systemd `Restart=always`, k8s CronJob, etc.) OR a polling-wait loop (`until <expr>; do sleep N; done`, `while <expr>; do …`, `Bash` with `run_in_background: true` gating on a CLI-tool output) — worker first runs the inner expression ONCE as a one-shot under the same auth/principal/env/comparison-shape config, verifies the expected output, and only THEN wraps it in supervision.

**Trigger phrase.** "I'm about to register a supervised auto-restart wrapper around a workload." Or: "I'm about to call `Register-ScheduledTask`, set up a systemd unit, or apply a CronJob manifest." Or: "I'm about to background an `until <expr>` / `while <expr>` polling loop that gates on a CLI-tool output expression."

**What to do.**

For supervised runners: run the loop body's first iteration as a one-shot via a *temporary* Task Scheduler entry with `Once` trigger + same principal config (or the equivalent for the supervisor in question). Verify three things: clean exit code, expected artifact created (e.g. `setup.log` + first iter log), no orphan processes left running. The smoke must exercise the cold-start / bootstrap path — including `cache_ttl=0` for any plugin-install step — so cached short-circuits don't hide first-iter failures.

For polling-wait loops: run the inner comparison expression ONCE foreground before wrapping it in `until` / `while` / background. Concretely, if the loop is `until [ "$(gh pr checks 70 --json conclusion --jq '.[0].conclusion')" = "SUCCESS" ]; do sleep 10; done`, smoke `gh pr checks 70 --json conclusion --jq '.[0].conclusion'` directly first. Verify three things: the CLI returns 0 (no schema error like `Unknown JSON field: "conclusion"`), the `--jq` path resolves to a non-empty value, and that value's *type and shape* match the comparison RHS (string vs bool, single value vs list, expected token vs literal "SUCCESS"). If any check fails, the loop comparison can't possibly match — fix at smoke-time.

If any check fails, debug at the one-shot level before going infinite.

**Anti-pattern.** Two shapes — same disease:

- **Supervised-runner shape.** Registering the supervisor first, then watching the "task is running" surface and assuming green, while every iteration silently exits 1 because of a per-iter setup bug (token name wrong, encoding crash, principal denied, em-dash in prompt). The supervisor wrapper hides per-iteration failures behind the lie "the service is running."
- **Polling-loop shape.** Backgrounding `until [ "$(<expr>)" = "<value>" ]; do sleep N; done` where `<expr>` references a CLI-tool field that doesn't exist (`gh pr checks --json conclusion` instead of `--json bucket` / `--json statusCheckRollup`). The comparison silently returns false forever; the operator's only signal is "this seems stuck" several minutes later. CI may have completed in seconds, but the broken comparison can't see it. The runaway is invisible from the outside — `Bash run_in_background: true` makes the failure mode worse, not better, because there's no visible output until the operator notices the stuck state.

## Messages over models

**One-sentence statement.** When a tool emits an explicit warning or error that names the fix, that message IS the fix — worker reads the message and applies the named action before theorizing about anything else.

**Trigger phrase.** "There's a warning/error line in the output that names a different variable, a different flag, a different command, or a specific HRESULT."

**What to do.** Translate the literal message FIRST. If it says `X is set but ignored, use Y` → set Y. If it returns `HRESULT 0x80070005` → look up the HRESULT before forming hypotheses. If `az group show` returns 404 → confirm the resource group exists in the current subscription before assuming auth is broken. The cheapest discriminator is always the explicit signal the tool already gave you.

**Anti-pattern.** Spending 30 minutes (or 1 hour) on a hypothesis tree — eligibility windows, token binding, stale cache, plugin SDK bug — when the output's first warning line literally said "use VARIABLE_X, not VARIABLE_Y" or "this resource group doesn't exist in this subscription." Theorizing past a message that names the fix is the most expensive bug shape worker repeatedly walks into.

**Cross-link.** Pairs with `../runtime-symptom-investigation/SKILL.md`'s "narrow hypothesis space; pick cheap discriminators" principle — this rule is the cheapest possible discriminator (read the literal output).

## State outcomes definitively

**One-sentence statement.** When worker (or worker-authored scripts) emits an operator-facing outcome message, the writer KNOWS the outcome at write-time — branch on the determinate signal and print one of two crisp messages, never a hedge that asks the reader to guess.

**Trigger phrase.** A worker-authored script or chat reply is about to emit a final-status line of the shape "X done, Y if Z succeeded" / "this should now be ready" / "this may have worked" / "I think this worked" / "if the push succeeded, ...". Anywhere worker is the message author and the determinate outcome is reachable from the caller's local state (an exit code, an HTTP response, a file the script just wrote).

**What to do.**

1. **Identify the determinate signal.** The script holds a boolean, the tool returned a status, the API responded with a body, the file is on disk or it isn't. The signal is in the caller's hand at write-time.
2. **Branch on it.** Print one of exactly two messages — "succeeded, here's where the artifact is" (green / actionable success) OR "failed, here's the fallback path" (yellow / actionable failure). Both lines name the next operator move.
3. **Cut every "if X succeeded" / "should be" / "may have" hedge** before the message ships. If the writer can't reach the signal, that's a separate bug (fix the determinacy gap) — not a license to hedge.

**Anti-pattern.** Final-guidance line in a setup script: *"Note the password (one-time print). Key vault has it too if push succeeded."* — useless. The script's own `$KvPushed` (or equivalent) boolean has the answer. Branch on it: *"Password also in key vault: <name>"* (green) OR *"Password is NOT in key vault (push failed). Marker file is the fallback — note the password now."* (yellow + actionable). Same shape extends to any chat reply where worker says "this worked, I think" / "it should now be ready" — look at the exit code, the API response, the file state, and state the result.

**Generalizes** beyond scripts to every worker output surface: chat replies to the operator, PR comments, status updates, dashboard tiles, log messages worker writes to artifacts. Anywhere worker is the message author and the outcome is locally determinable, hedge-language is a bug.

**Cross-link.** Sibling to "Messages over models" — that rule says *read* what the message in front of you says before theorizing. This rule is the flip side: *write* what you know when you're the one composing the message. Both rest on the same discipline (respect the actual signal, don't substitute speculation).

## Fixtures or refusal

**One-sentence statement.** When asked to estimate duration / cost / scope, OR when composing operator-facing content that contains a numeric estimate from any source, worker first checks for reachable fixtures (past run records, stage definitions, telemetry, prior estimates) — and if they exist, cites them; if they don't, strips the estimate rather than guessing or letting an upstream guess pass through unchallenged.

**Trigger phrase.** "How long will X take?" or "What's the cost of Y?" or any answer worker is about to give that contains a numeric duration / cost / scope estimate not anchored to a specific source. ALSO triggers when worker is composing a plan, summary, draft reply, or any operator-facing artifact that contains numeric estimates — whether the estimate originated with worker or was inherited from another agent's output, an upstream tool, or a prior conversation turn. Inheritance does NOT excuse the estimate; if the source had no fixture, strip it at composition time.

**What to do.** Before quoting a number: (1) check the relevant skill or runbook for stage definitions; (2) check past run records (experiment logs, prior-run histories under whatever per-run directory the system uses); (3) check telemetry / logs from prior runs. If you find them, cite the file path and line range. If you don't, the answer is "I don't have a fixture for that — want me to spend N minutes measuring, or proceed without an estimate?" When relaying or adjusting another agent's plan, scrub the inherited estimates the same way — don't let "another agent gave me this number" pass as the fixture. Stripping is the default; the operator can ask for a measurement if they want one.

**Anti-patterns.**

- Quoting "10-30 min per iteration" when fixtures showed 2.5 hr per iteration, because the fixtures weren't checked. Distorts every downstream plan that depends on the estimate; only surfaces hours later when the supervised runtime fails to match the imagined cadence.
- Relaying another agent's plan to the operator with the estimates intact ("~10 min", "~45 min", "~2 hr total") because they came from upstream and worker treated them as data rather than as fabrication. Inherited estimates are still fabrication if no one had a fixture; worker is responsible for stripping them at composition time.

**Cross-link.** Pairs with the `preflight-actions` skill — estimating-without-fixtures is itself a judgment-call substitution that should preflight if the estimate drives an irreversible-ish decision. Reinforced at draft-time by `operator-voice-comments` (No fabrication → Numeric duration / cost / scope estimates) and at response-composition-time by `interaction-style` §7 (Strip fabricated estimates from response prose).

## Discover before invent

**One-sentence statement.** Before implementing a wrapper / orchestrator / helper / config-knob / script around an existing system, find that system's **canonical entry-point documentation** (`RUN_PATH.md` / `scripts/README.md` / `agents/<name>/manifest.yaml` / equivalent) and read it — there's a non-trivial chance the thing you're about to build already exists, blessed, battle-tested, and updated by the system's owners.

**Trigger phrase.** Worker is about to write new code or scripts that *orchestrate* an existing system (call its CLI in a loop, chain its phases, parse its outputs, schedule it). Before the first new line of orchestration code: check.

**What to do.**
1. **Find the canonical entry-point doc** for the system. Common names: `RUN_PATH.md`, `scripts/README.md`, `<plugin>/scripts/`, top-level `README.md` "Automation" / "Cron" / "CI" sections, `Makefile` / `justfile`.
2. **Read it** — specifically: does the system already expose an entry point that does what you're about to build? What does it do conditionally (e.g., "Phase 2 runs only if verdict is failed")? What env vars + exit codes does it document?
3. If the canonical entry-point covers your need: **call it** instead of reimplementing. Your code becomes a thin wrapper; the maintained logic stays where the system's owners can evolve it.
4. If it doesn't cover your need: write your code, and consider opening a discussion with the system's owners about extending the canonical entry point so the next caller doesn't re-reinvent.

**Anti-pattern.** Building a custom orchestration loop that calls a CLI, parses `summary.json`, conditionally chains follow-up steps on failure verdicts, and writes its own output capture — when the underlying system already ships a canonical entry-point script doing exactly that, designed to be "identical interactively and headlessly" with documented env vars + exit codes. Two planning waves and an implementation pass can stage the custom version before a "did we not already have this scripted?" nudge surfaces it.

**Generalizes beyond scripts.** The rule applies to any "I'm about to build orchestration around X" decision: helper functions, config knobs, sub-agent workflows, dashboard widgets. Look for the existing version first. The cost of *checking* is minutes; the cost of *duplicating + then migrating* is hours and a code-debt commit. Reading a NEW plugin's / tool's README BEFORE drafting any install / invocation command is the rule's literal application.

**Cross-link.** Sibling to "messages over models" (read the explicit documentation that's right there) — "discover before invent" extends the same discipline from error-message-content to system-entry-point-content.

## Sniff before transferring auth state

**One-sentence statement.** Before believing any plan that copies auth tokens / sessions / credentials between users (or between machines), sniff the source file's first 20 bytes — Windows DPAPI user-scope cipher is a non-starter for cross-user copy and the failure mode is silent.

**Trigger phrase.** A bootstrap / setup / migration plan says "copy the token cache" / "copy the SSO state" / "copy the auth file" between users on Windows (or, by analogy, between users on macOS / Linux where credentials may be in a per-user encrypted store). Common scenario: a Windows-VM bootstrap that transfers an interactive operator's auth state to a service-principal account.

**What to do.** Read the source file's first 20 bytes (`Get-Content -Encoding Byte -TotalCount 20`, `xxd | head -1`, `head -c 20 | xxd`). Three signals:

- Starts with `01 00 00 00 D0 8C 9D DF 01 15 D1 11 8C 7A 00 C0 4F C2 97 EB` → DPAPI user-scope on Windows. Cross-user copy WILL fail at first decrypt; the decrypt is silent so the failure surfaces only when a cached token expires (could be hours or days later). **Pivot to per-user re-auth** (the user logs in once as themselves, the auth library re-creates the cache under their own DPAPI keys).
- Starts with PEM `-----BEGIN` or JSON `{` → plaintext or structured credential. Copy-safe (still treat as sensitive: lock down ACLs, scrub from logs).
- Anything else → unknown encryption envelope. Investigate before believing the plan.

macOS Keychain has analogous per-user encryption (the cipher is in a SQLite store, not file-bytes, but same per-user-scope semantics — copying the file between users produces unreadable cipher). Linux varies by store (libsecret / kwallet / file-based). Same heuristic applies: assume per-user encryption until the file's bytes prove otherwise.

**Anti-pattern.** Treating "copy the token cache" as mechanical based on a directive's phrasing, attempting the copy, having it appear to succeed (file present + readable), and only discovering failure hours later when the cached access-token expires and the next call gets prompted for interactive auth. Silent because DPAPI decrypts to garbage rather than throwing — the file IS there, it just doesn't decrypt under the new user's keys.

**Cross-link.** Pairs with "messages over models" — both are cheap-discriminator rules where the source artifact already encodes the answer. The DPAPI signature byte sequence is the cheapest possible discriminator for "is this cross-user-copyable?"

## Test it twice

**One-sentence statement.** When validating an infrastructure mechanism whose value proposition is "durable across event N" (reboot survival, token refresh, network reconnect, scheduled-task restart, anything-that-claims-to-self-heal), worker runs **at least two consecutive instances of event N** before declaring the mechanism confirmed.

**Trigger phrase.** "I'm about to mark this as working / shipping / done because event N produced the desired outcome." Or: "I just saw the system recover from a reboot — looks good!"

**What to do.** Don't ship on one success. Cycle event N a second time (issue a second reboot, force a second token refresh, sever the network a second time). If both succeed, mechanism is durable. If the second fails, it was a one-shot fluke and the architecture needs revision. Capture the two-cycle evidence in the experiment doc's Outcome table.

**Anti-pattern.** A first reboot fires the recovery path successfully and looks confirmed. It was actually a fresh-secret one-shot fluke — reboots 2/3/4 all fail identically. If the test had stopped at one success, a broken mechanism would have shipped and surfaced as an OS-update reboot weeks later. The two-cycle gate catches this inside the experiment instead of in production.

**Cross-link.** Pairs with "smoke before infinity" — smoke validates one-shot correctness BEFORE registering a supervised wrapper; test-it-twice validates DURABILITY across the supervisor's recovery events.

## Process tree, not process name

**One-sentence statement.** When cleaning up child processes from a loop / iter / supervisor, worker filters by **lineage** (parent PID chain, Job Object membership, tracked-PID list) — never by process name pattern alone — to avoid catching unrelated processes that happen to share the name.

**Trigger phrase.** Worker is about to write a cleanup that uses `Get-Process <name1>, <name2>` / `pkill <name>` / `taskkill /IM <name>.exe` / equivalent name-pattern process selectors.

**What to do.** Pick one of:
1. **Tracked-PID list** — record children spawned by THIS iter at spawn-time; iterate that list to kill, ignore everything else.
2. **Win32 Job Objects** (Windows) — bind children to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; when the parent process exits, all children die automatically. No explicit kill needed.
3. **Process group / PG kill** (Linux) — spawn children in a new process group; `kill -- -<pgid>` cleanly terminates the group at end-of-iter.
4. **Skip the cleanup entirely** if the spawned tool already handles its own subprocess cleanup (e.g., a script with its own ERR-trap on subprocess exit).

**Anti-pattern.** `Get-Process <name1>, <name2>, <name3> | Where-Object { $_.StartTime -lt (Get-Date).AddSeconds(-2) } | Stop-Process -Force` at the end of every iter — kills every matching process on the host older than 2 seconds. In a single-tenant context this looks fine. The moment another tenant exists on the same host (the operator's own interactive sessions, a sibling agent's processes, a supervisor probing for diagnostics), it's a host-wide footgun: their processes get terminated within 2 seconds of starting. **No fault, no antimalware hit, no crash report event** — `Stop-Process -Force` is a silent external kill. Multiple layers of crash-diagnostic come up empty because the kill leaves no fingerprint.

**Generalizable.** The principle applies beyond process kills — anywhere "all the X-shaped things" might catch X-shaped things you didn't spawn: file deletion by glob, registry-key deletion by prefix, network-rule cleanup by tag. Lineage > label.

**Cross-link.** Sibling to "messages over models" + "discover before invent" — same family ("respect signals other than your assumptions"). Process name is a label, not a signal of ownership.

## Verify precedent against HEAD

**One-sentence statement.** Before claiming a past PR / commit / feature / RFC established a particular precedent, grep HEAD for the precedent's actual current state — what was *proposed* in the cited reference and what's *in HEAD now* often diverge (reverted partially, narrowed during review, superseded by a later change), and acting on the original claim builds the next layer of work on a wrong premise.

**Trigger phrase.** Worker is about to author a task prompt, planning doc, design discussion, or directly invoke a subagent with content that contains a sentence like "this extends PR #1234's pattern" / "per PR #5678 we already migrated X to Y" / "the convention established by feature Z is..." — any claim that grounds the current work in a previously-shipped artifact.

**What to do.**

1. **Identify the load-bearing precedent claim** in the prompt / doc / framing.
2. **Verify against HEAD.** Cheap methods, in order:
   - `git show <ref> -- <file>` for "what did that PR actually change in this file?"
   - `git log --all --grep "<feature>" --format="%h %s"` for "what subsequent changes touched this?"
   - Plain `grep` against current source files for the precedent's claimed effect (the env var supposedly set, the field supposedly added, the API supposedly migrated).
3. **If HEAD matches the claim**, proceed. If it doesn't, fix the framing before invoking — either narrow the claim ("PR #1234 *proposed* X but HEAD shows Y"), pick a different precedent, or drop the precedent-grounding entirely.

**Anti-pattern.** A task prompt cites "PR #640 was the sidecar LocalSystem migration precedent" → subagents fan out to extend that pattern → one subagent catches that the cited PR actually kept `LogonType=Interactive` (the LocalSystem migration was never landed). Without that catch, multiple downstream changes would have been built on a fabricated convention. The fix is single-author: the prompt-author (operator or worker) checks HEAD before invoking, not after.

**Cross-link.** Sibling to "messages over models" and "discover before invent" — same family (respect what's actually there, not what you remember / assume). The precedent is a kind of system-state-claim; HEAD is the canonical truth, not the PR title.

## Test coverage — the 7 categories

**Folded in from AIDLC's test-generation skill 2026-05-18.** When generating or auditing tests for a code change, cover these 7 categories deliberately. Missing categories indicate test-coverage gaps that compound over time.

**One-sentence statement.** A change-under-test should have explicit test cases across seven categories: happy path, edge cases, null/empty inputs, state-based behavior, caching, authorization, exception handling. Each category present means the agent thought about that class of behavior; each missing category means an unverified assumption shipped.

**Trigger phrase.** Worker is generating tests for a new code change, or auditing existing test coverage of a code path.

**What to do.** Walk the categories explicitly:

1. **Happy path** — the canonical successful flow. The simplest input + the expected output, asserting on the value plus any side-effects.
2. **Edge cases** — values at boundary conditions: maximum length, minimum length, zero, max-int, unusually-shaped inputs. Each edge case is a separate test (not bundled into the happy-path assertion).
3. **Null / empty** — null inputs where the API permits null; empty-string / empty-list / empty-dict inputs. Asserts the change doesn't throw on absence-of-value when absence is a legal input.
4. **State-based** — when the code-under-test interacts with state (database, cache, external service), test the state transitions: initial state → operation → expected state. Includes both "operation should change state" and "operation should be idempotent" cases.
5. **Caching** — when caching is involved (memo, TTL, cache invalidation), test cache hit, cache miss, cache invalidation, and stale-cache-after-mutation. Caching bugs are typically failures-after-second-call, not first-call failures.
6. **Authorization** — when the code-under-test gates on identity, test authorized callers (succeed), unauthorized callers (fail with expected status), and edge cases like expired tokens, wrong tenant, missing scopes.
7. **Exception handling** — for each catch block in the change, assert the exception is caught + the expected fallback behavior fires. For each `throw` site, assert the right exception type is raised under the conditions that trigger it.

**Test naming convention** (also from AIDLC): BDD-style `{Given}_{When}_{Method}_{Assertion}`. Example: `GivenValidPayload_WhenSavedTwice_AddDocument_ReturnsIdempotent`.

**Anti-pattern.** Shipping a change with only happy-path tests + maybe one edge case. The remaining 5 categories accumulate as silent assumptions. Each missing test is a future bug that the test suite cannot catch.

**Generalizable.** The 7 categories are a checklist, not a rigid template — some categories are inapplicable per change (e.g., a pure function has no state-based or caching tests). Mark inapplicable categories explicitly (`N/A: pure function, no state`) so the audit shows the deliberation happened.

**Cross-link.** Pairs with `pr-self-review`'s coverage evaluator + AIDLC's test-generation skill (where this taxonomy originated). Folded into desk so non-coding-agent consumers can skip (description-gated; only fires on coding-task contexts).
