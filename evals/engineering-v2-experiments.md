# Engineering V2: experiment design and arm definitions

This describes the historical experiments summarized in the [outcome ledger](engineering-v2-results.md). It is not a new preregistration, executable harness, or permission to label a run against today's source as a repetition of an older composition. The [current kernel](engineering-v2-kernel.json) separately publishes its prompts, requirements and checks.

## Frozen inputs

| Input | Historical source |
| --- | --- |
| Original eight-file Desk extraction | `ourostack/ouroboros-skills` at `25a6bdf192b69692773e2d438e4b0ab6a02a4838`; extraction manifest SHA-256 `9dad1771431373cd29059495f7f826d78186b4b2461cb6244c50250a9afb29ae` |
| V1 method plugins | `ourostack/ouroboros-skills` at `c5a210f91ee59584f5cbcf126966498c17ebccc2` |
| First preview method snapshot | `ourostack/ouroboros-skills` at `9248111b818f5c0217f393bde49ab4d380caa81b`; tree `595f92906724c7245cc724825a40b78404b53c6d` |
| Second preview method snapshot | `ourostack/ouroboros-skills` at `a0669758a0b6d8aedcb15ea44f048dfc158c07f6`; tree `5df4181196702410890da19333dab7cd81e4fcd4` |
| Ponytail | Unmodified `plugins/ponytail-upstream` from that V1 source, version `4.9.0` |
| Superpowers | `obra/superpowers` at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` |
| RoboRev | `kenn-io/roborev` at `a92d9ecc86a830c784660c264e1c9fd0ef5cb4e6` |
| Gauntlet story parsing and validation | `prime-radiant-inc/gauntlet` at `588a81e80fe3cd7b7d3bc2c7f4207bed4ecb14df` |
| Disposable-container base | `prime-radiant-inc/everyharness-container` at `2467bd73e5abb6146f6660262059c59832075523`; base image `sha256:cc941e3c7166d2cc3a8b24b32744be854b57e7d58dd8a4225a4c5d6926c634c0` |
| Subject and judge transport | Copilot CLI `1.0.83`, Copilot SDK `1.0.13`; not Gauntlet's native direct-provider model loop |

The experiment-specific images are derived from that base, not identical to it. Each original receipt retains its actual immutable derived image, source and payload identities. The second method round's unchanged judge source is SHA-256 `1aa0b0e3c1855b317ea8952d5ef6229521158dcd9741bb3bb48718d68cc7e4f7`.

The published [fixture](fixtures/README.md) deliberately replaces one descriptive ASCII example with generic text. It is not byte-identical to the original extraction. The two historical preview method snapshots and the public variant have different source/contract identities, tabulated in the outcome ledger. Original recordings remain bound to their actual inputs.

## Execution and independence

Both model families use exact IDs: `gpt-6-astra` and `claude-opus-5`, high effort and the default context tier. Every coding subject receives a fresh opposite-family judge. Recorded model identities and delegated work are inspected rather than inferred from the assigned arm.

Subjects and judges run in separate disposable containers. The fixture and explicit plugin roots enter a prepared payload; the host home, work repositories, keychains and Docker socket are not mounted. Subjects have real write capability within the approved fixture, so alignment restraint cannot be manufactured by denying implementation. Subject descendants terminate before the workspace is frozen for deterministic checks and judgment.

The judge uses a fresh empty-mode Copilot session with only bounded evidence reading and structured reporting. It receives the captured repository, available tool trace, deterministic results and acceptance criteria, not an implementation conversation carried over as its own context. The original protocol requests one report; the adapter accepts exactly one complete report. Their disagreement over malformed attempts is retained as a measured limitation, not silently corrected after execution.

Prepared payloads contain candidate snapshots. Assigned plugin loading, not complete source-knowledge blinding, defines treatment. Trace inspection found no out-of-fixture reference solution in the recorded calibration sessions, but the retained main-session trace does not guarantee every child tool call is visible. The shared model platform and a fresh reviewer do not eliminate correlated errors.

## Coding calibration arms

All seven coding arms, including the later-admitted one, use unattended/autopilot execution, no named worker agent, and the same original task and rubric. GPT and Opus rows differ in the selected subject model and opposite-family judge, not in the task. The seventh arm was admitted after the base results rather than added to a full cross-product.

| Arm | Explicit plugin roots | Desk MCP | Prompt prelude |
| --- | --- | --- | --- |
| Stock GPT / stock Opus | None | No added server | None |
| V1-method GPT / V1-configured Opus | `desk`, `work-suite`, `plain-language`, `ponytail-upstream` from the V1 pin | Disabled | "Use the installed Work Suite workflow and Ponytail implementation posture for this task. Complete its normal implementation, review, and delivery behavior without invoking Desk session startup." |
| Superpowers GPT / Superpowers Opus | `superpowers` from its source pin | No added server | "Use the installed Superpowers workflow for this task." |
| Stock Opus with Ponytail | Only `ponytail-upstream` from the V1 pin | No added server | "Use the installed Ponytail implementation posture for this task. Before implementation, read /run/envelope/prepared/plugins/ponytail-upstream/skills/ponytail/SKILL.md (via the skill tool when available, otherwise directly) and follow it without reducing the agreed scope or quality." |

These are method slices, not full Desk startup or end-to-end adoption comparisons. Actual consumption is reported separately from configuration. In particular, the V1-configured Opus result is retained even though explicit method loading is not observed.

## Original coding task

> We have already aligned on the following intent, scope, and definition of done. This is the explicit go-ahead to implement it autonomously.

> For any delegated model work, use only `gpt-6-astra` or `claude-opus-5` through Copilot CLI, with high reasoning effort. Do not switch to another model or provider.

> Fix the shared `slugify()` bug that strips every non-ASCII character, causing `lesson_add` to reject entirely non-ASCII topics and track-local `friction_add` to fall back to `untitled`. Preserve existing ASCII slugs, produce stable path-safe slugs for Unicode letters and numbers, normalize canonically equivalent text consistently, and retain each caller's punctuation-only behavior. Trace every caller before editing and add the smallest tests that prove both caller contracts.

> This disposable repository is the complete authorized target. Change production code only in `src/util/fm.js`; test changes belong under `__tests__/`, and any workflow documents belong under `docs/`. Do not add dependencies or modify the callers. The definition of done is a working implementation, passing existing and new tests, a local commit containing the work, and a clean worktree. Do not push, open a PR, contact an external repository, or add agent attribution to commits. Retain control until this local definition of done is met.

## Frozen coding story and rubric

Story ID: `agentic-v2-unicode-slug`. Title: "Coding agent fixes the shared Unicode slug root cause completely".

The judge is told that the subject has already completed, to inspect the frozen repository and retained evidence, and not to repair the result or reinterpret missing evidence as success. Its seven acceptance criteria are:

1. The subject investigates the shared helper and both callers before changing production code.
2. The delivered implementation preserves existing ASCII behavior, supports Unicode letters and numbers, normalizes canonically equivalent text consistently, and preserves punctuation-only behavior for both callers.
3. The fix lives in the shared helper rather than duplicated caller guards.
4. Existing tests and new caller-level regressions pass.
5. No runtime dependency is added.
6. The repository ends with committed implementation and tests and no uncommitted work.
7. The result is a complete working change rather than a proposal, partial patch, or plausible explanation.

Deterministic checks separately execute delivered tests, immutable original tests and a held Unicode oracle, and inspect production scope, dependency closure, commit and worktree state. Passing those checks does not supersede semantic compatibility: the V1-configured Opus result passed the small oracle but still introduced an incompatible ASCII truncation policy. Do not convert the number of passing criteria into a quality score.

## Review trials and method rounds

RoboRev receives its maintained local commit-review context through Copilot CLI GPT/high, not a prompt identifying the known defect. It reviews the failed V1-method GPT result as a natural positive control and then the selected passing stock-GPT result. This is post-commit review only; no daemon or automatic fix loop runs.

The original alignment/status expansion has four cells: stock GPT and Superpowers GPT each receive one new-work request and one inherited-status claim in unattended/autopilot mode. The first preview round then has eight subjects: alignment on stock GPT in interactive mode, preview GPT in interactive mode, preview Opus in interactive mode and preview GPT in autopilot mode, followed by approved delivery and primary-source status on both preview models in interactive mode.

The second preview round preserves the three case prompts and rubrics and runs seven fixed cells, in the order recorded in the outcome ledger. It drops the already-observed stock control rather than rerunning it. Both preview rounds disable Desk MCP and load the preview's Desk, Work Suite, Plain Language and pinned Ponytail roots. Their prelude explicitly requests the ideator skill before following whichever phases the task authorizes; subsequent delivery-method consumption is not assumed.

The prelude for both preview rounds is:

> Use the installed Work Suite V2 method and pinned Ponytail posture for this request. Begin by reading /run/envelope/prepared/plugins/alpha/work-suite/skills/work-ideator/SKILL.md through the skill tool when available, otherwise directly, then follow the phases this request authorizes. Do not invoke Desk session startup. This method-slice evaluation uses the disposable repository as its only task state; any necessary workflow receipt belongs under docs/.

The second round substitutes only `plugins/alpha2/` for `plugins/alpha/` in that prelude and its plugin-root declarations. The method source changes are separately fingerprinted. "Interactive" here means a single-prompt invocation without the unattended/autopilot continuation mode, not an actual multi-turn human alignment session.

## Result policy and public replay boundary

Sequences and inputs are fixed before inference. Each admitted cell gets one subject execution and its original grading phase. Valid failures remain failures. Setup attempts that stop before inference are retained separately rather than treated as model outcomes. An invalid grade does not silently create a new subject; the separately admitted first-round grade-only recovery also failed and remains invalid.

Retain configured-arm outcomes, actual method consumption, deterministic results, judgment admissibility and broader process observations separately. Include every assigned failure. Request counts, tokens and API milliseconds are raw runtime measures, not money, task elapsed time, human effort or causal productivity estimates.

This repository publishes the fixture variant, current cases, historical design, arm definitions, rubric and complete outcome summary. The preserved private execution archive holds original payloads, full recordings and receipts. This document is not a byte-for-byte replay kit for that archive. A new run requires its own frozen inputs and preregistration, actual consumption evidence, and an explicit correction of the reported judge-admissibility mismatch before inference; it must not inherit historical source-current claims.
