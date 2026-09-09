# Fixed offline evaluation contracts

This alpha slice provides executable dataset validation, role-filtered fixtures, bounded evidence readers, report admission, committed run artifacts and source-compatible run-set inspection. It does not yet provide an admitted native subject/judge producer. `offline run` returns `NATIVE_QUALIFICATION_REQUIRED` with exit 3 and starts no model. Static validity, unit-test success and a compatible inventory are not evaluation passes.

## Commands

Run from the repository root with Node 22.23.2 or later:

```sh
node scripts/skill-evals.cjs offline help
node scripts/skill-evals.cjs offline validate --dataset evals/offline/cases/v2-alpha-v1/dataset.json --fixtures evals/offline/cases/v2-alpha-v1/fixture-manifest.json
node scripts/skill-evals.cjs offline compare --left /absolute/left/run-set.json --right /absolute/right/run-set.json
node scripts/skill-evals.cjs offline run --plan /absolute/plan.json --output /absolute/fresh-output-root
node scripts/skill-evals.cjs offline qualify-runtime --plan /absolute/runtime-qualification.json --output /separate/authorized/fresh-output-root
```

The legacy `validate`, `fingerprint`, `verify` and synchronous library exports remain separate and SDK-free. Offline static commands also require no Copilot SDK installation or inference credentials. The filesystem mechanisms target POSIX filesystems; they are not an OS sandbox.

| Exit | Meaning |
| --- | --- |
| 0 | Static validation, complete compatible inventories or the labelled unscored runtime control. Not an evaluation pass. |
| 1 | Reserved for an admitted product failure from the qualified producer. |
| 2 | Incomplete or incompatible comparison. No winner is selected. |
| 3 | Unavailable native qualification or infrastructure/protocol failure. |
| 4 | Invalid invocation, input or sealed-artifact contract. |

Errors from the executable entry point are JSON on stderr with `kind: "offline_error"` and an artifact reference or null. An undefined or invalid return from the offline entry point is an infrastructure error, not implicit success.

`validate` reports the raw dataset hash, case count, each fixture's subject/held-out/canonical-input file counts and `requiresAdmittedProducerBinding`. Its output always states `behavior: "unverified"` and `execution.assessment: "not_performed"`.

`compare` verifies the referenced plan, exact expected-cell matrix, every journaled attempt and published receipt inventory. It retains failed, pending, unpublished and unstarted cells. It also uses the committed-artifact reader, rejects duplicated comparison inputs and rejects receipts re-labelled against another plan. Output is explicitly `scored: false`; retained statuses are not fresh model judgments.

`qualify-runtime` is the fixed, unscored Docker/SDK control route, not an arbitrary shell-command interface. It consumes an explicitly available immutable Linux/amd64 image containing Node 22.23.2, CLI 1.0.84-1 and SDK 1.0.13. The [example plan](runtime-qualification.example.json) requires an authorized named account and the actual locally available image identity. The output parent must already exist and be separate from the plan root. The initial envelope binds every controller archive member, the host/bootstrap hashes and the predeclared ownership name before invoking the named provider. The validated plan is snapshotted before callbacks run. The credential remains in memory and travels separately from file members through the controller's private stdin. No host bind mount, automatic image pull, identity switch or default installation change is performed.

This command currently checks one narrowly labelled control: delivered execution success for a semantically failing report, with root-idle/history/raw-event and owned-exit evidence. Exit zero means that component's evidence was observed, not that the runtime or product was admitted; `qualified`, `scored` and `grade` remain false, false and null. Success/failure/correction/batch/cancellation contrasts, effective-model/effort qualification, subject process-state protection, installed composition and the actual independent-review route are still separate obligations. A constant successful JSON record without the matching SDK/schema/history/process records is refused. Provider failure, a timed-out pending container name, unavailable cleanup and capture/publication failures remain explicit non-success receipts.

Failed RPC delivery and truncated output retain complete, hash-verified observed root requests, their call IDs, schema dispatch and validator counts without a grade. `verified_observed_prefix` is not a completeness claim. Raw SDK records are SDK capture, not raw provider HTTP data. Decoded strings cannot substitute for raw transport buffers. Schema replay is deduplicated by actual event identity; conflicting payloads remain a capture failure. Callback records preserve their actual invocation session and whether the work window was still open.

The control waits for an observed root turn after its own dispatch and an interactive, non-aborted root idle. Startup, child, other-mode and aborted idle events stay in the raw capture but do not end the work window. A child error is not relabelled as a root session error.

Native capture checks the 48 MiB aggregate and 240-file budget before each new write, with a separate 16 MiB/single-file reserve for final failure metadata inside the publisher's 128 MiB/256-file limit. Owned cleanup commands remain bounded and continue after capture failure, but missing raw cleanup evidence remains unavailable and prevents a final commit marker. Timeout stays primary when cleanup or publication also fails. Transport children use a bounded hard-stop signal; that is not proof of the separate SDK/container process tree's exit.

## Six ordinary fixed cases

The versioned [dataset](cases/v2-alpha-v1/dataset.json) covers discussion followed by explicit implementation authority, actual enforcement by a maintained checker, an installed package consumed outside its source tree, independent review/rework/restart with a scope update, truthful status against the approved target without mutation authority, and protected recording boundaries.

These are public, fixed generic cases, not a statistical benchmark or unseen training data. Subject-visible baseline tests are not held out. The maintained-checker canary and installed-package omitted/positive/zero matrix have distinct expectations; a deliberately red capability oracle must remain red when mutation is forbidden. Do not turn every oracle into “repair to green,” substitute keyword checks, expand the rubric after seeing an outcome or rerun a valid failure for a better result.

Dataset and fixture version 1.0.1 correct the capability witness before scored use: the plausible sibling has a genuinely successful challenge, while the handoff names only the authorized target and does not disclose the sibling's oracle role. The exact authorized target still fails its held-out zero-value check without mutation. The six-case rubric is unchanged.

## Producer and role boundary

`materializeFixture` reads the frozen manifest twice without retaining all payload buffers, verifies raw hashes and source identity, creates fresh nonoverlapping actor/checker/canonical roots and seeds a real local Git repository with the configured author and committer. It has no remote or inherited hooks. Its actor view excludes held-out and canonical fixture input and removes `CONFIG_FILE`, `EVAL_SUBJECT_SNAPSHOT` and `CHECKER_CANARY_TOKEN`.

The native integration must enforce those views at the OS boundary, assign the actual role identities, demonstrate that the subject can write its intended workspace and keep controller/evidence roots inaccessible. It must not place the complete fixture source tree or held-out payload in the actor-readable installation. Privileged checker inputs and canary injection belong to checks after the actor and its writers have stopped. Directory policy tests alone do not prove isolation.

The review/rework and protected-recording cases require real admitted producers. An absent reviewer or recording route is unavailable, never a passing mock. The native path must exercise actual source-bound review, repair and re-review. Reviewer credentials must be supplied explicitly for that phase; ambient host/keychain discovery is not a credential route. Copilot CLI's `--secret-env-vars` strips listed values from shell and MCP environments, so hiding a token that way does not automatically authenticate a reviewer child.

An explicitly authorized named `gh auth token --hostname <host> --user <account>` provider may be invoked at the trusted controller's initial launch boundary, before any subject starts. Clear `GH_TOKEN` and `GITHUB_TOKEN` for that provider call, keep its result in memory and pass it only to the phase-scoped child/callback environment. This is not account discovery, cache copying, subject-side secret recovery or permission to disable stripping. Provider failure remains a failed attempt; credential values and hashes never belong in artifacts.

Native source/agent activation, both-model terminal success/failure/correction/batch/cancellation behavior, the outer startup/send/work deadline and complete owned-runtime cleanup remain qualification requirements. Only the real Copilot CLI/SDK with the pinned `gpt-6-astra` and `claude-opus-5` configurations is in scope. No direct provider API, replacement conversation loop or arbitrary caller-supplied shell runner is provided.

## Evidence and admission

`createEvidenceReader` uses maintained Gauntlet index validation followed by confined, single-link regular-file reads. It rejects symbolic/ancestor links, hard links, NUL-bearing or invalid UTF-8 text, changed seals and unindexed paths. It limits each file to 16 MiB and each page to 1–16000 UTF-16 code units. File descriptors are nonblocking and checked before and after reading. Raw-byte seals do not use the legacy BOM/CRLF-normalized `sourceFingerprint`.

`createReportAdmission` keeps complete root requests, partial/unobserved arguments, excluded child requests, schema observations, handler entries and delivered SDK completion references distinct. Call identity includes the observed root window; supported turn IDs are retained, and missing IDs stay null. Stable replays do not create another request. Conflicting payloads, ambiguous scope or incomplete coverage cannot admit a grade. History reconciliation uses the actual hashed response and the observed request scope, not a bare reconciliation boolean.

The four counters are `observedRequests`, `schemaAcceptedHandlers`, `validatorAcceptedReports` and `admittedGrades`. They count their named, correlated observations, not unseen activity; unqualified handler scope cannot be counted as an accepted root handler. Raw records and scope ambiguity remain visible in the attempts. A successful handler return is not delivered RPC success. A semantic fail is a successful terminal tool result and, with complete evidence, becomes `product_failure`.

Exactly one validator-accepted terminal request can be admitted. Multiple valid reports invalidate the run instead of selecting the favorable one. Malformed requests receive typed execution failures and may be corrected before the deadline, with all attempts retained. Ordinary SDK per-invocation finally-abort is not run cancellation. A late report cannot rescue a timeout or cancellation.

The fixed rubric requires an actual failed criterion for overall fail and an unclear criterion for investigate. Extra-rubric observations remain `unexpectedConcerns` without changing the fixed score. Syntax and citation validation do not prove that a quotation or judgment is true. The pure admission API consumes collector verification decisions; passing synthetic booleans to it is not native qualification.

## Artifact and comparison contracts

`openRunOutput` creates a null-grade incomplete envelope before work. Raw stdout/stderr remain lossless and separate from decoded text views. Stream overflow and write failures preserve available evidence and permanently prevent commit. Error annotation is atomic so a second disk failure cannot truncate the original envelope. Presentation files are not the grade authority.

Successful publication writes the receipt and file inventory, then atomically renames `COMMITTED.json` last. The reader verifies all named raw hashes, lengths and modes and rejects missing, changed, linked or extra files. Inventory traversal retains metadata rather than all payload buffers and checks file count and aggregate bytes before reading another file. Limits include 4096 files, 8192 directory entries, depth 64, 16 MiB per file and at most the frozen 1 GiB aggregate ceiling. JSON artifacts are bounded to depth 64 and 100000 values.

`captureBoundedCommand` accepts an executable, argv and explicit environment, never a shell command string. It retains raw stream prefixes, separates timeout/cancellation/infrastructure outcomes and bounds direct-child cleanup. Its process observations cover only that captured direct child; they are not the SDK's complete owned-runtime cleanup proof. `validateCleanupReceipt` requires run-bound, hashed spawn and exit observations, not a boolean or PID alone.

The [schemas](schemas/) freeze plans, expected cells, run sets, journals and schema events. Journal hashes bind compact `JSON.stringify(record)` bytes plus one newline per record; do not reformat a retained journal. The inventory-only library helper is not a native grade validator.

Candidate comparisons require the same dataset, checks, admission/tooling/runtime/binding/limit configuration and complete subject **and** judge configurations. Method comparison additionally requires matching non-method source and actual source/method partitions. The CLI reads `source-manifest.json`, `non-method-source-manifest.json` and the plan's method-manifest reference from each run-set root. Each manifest is `{schemaVersion: 1, files: [{path, mode, bytes, sha256}]}` over raw source bytes. Model-ranking dimensions are unsupported in alpha, even when both families qualify in separate cells.

Offline receipts may be linked by reference to an existing work record. This evaluator creates no online work item, measurement database, price conversion or transcript import. A protected work store is never an evidence root.

## Maintained leaves and verification

The pristine four-file payload is from [Gauntlet at `187a9af979a7cf096c0890d0eeb998cc3008343a`](https://github.com/prime-radiant-inc/gauntlet/tree/187a9af979a7cf096c0890d0eeb998cc3008343a), under its retained [Apache-2.0 license](vendor/gauntlet/LICENSE): `validators.ts`, `scoped-read.ts`, `types.ts` and `LICENSE`. No NOTICE or COPYING file exists at that pin. The shared provenance checker/lock integration owns the narrow per-entry Apache allowance.

Production consumes `parseReportResult`, `parseReportCriteria`, `checkCriteriaConsistency`, `parseEvidenceIndex` and `validateEvidenceIndex`. It does not use Gauntlet's native assessment/model loop, writer/logger, salvage path, unbounded read helpers or provider-shaped usage reporting. Characterizing retained exports for coverage does not adopt those exports as production routes.

```sh
node --test 'evals/offline/__tests__/*.test.mjs' scripts/test-skill-evals.cjs
node evals/offline/__tests__/coverage.mjs
```

Coverage uses the matching repository development package's maintained `nyc` 18.0.0 and `@istanbuljs/esm-loader-hook` 0.3.0, including the declared `test-exclude` override. An optional path argument selects an existing installation of that development package; the command installs nothing. The test-only resolver identifies the three pinned ESM TypeScript leaves as modules so the maintained TypeScript/Babel instrumenter actually sees them. It supplies no counters or instrumentation of its own. Native Node line coverage and c8 line aliases are not statement proof.

The gate includes every evaluator production module, the modified legacy dispatcher and all shipped executable Gauntlet leaves, with 100% statement, branch and function thresholds. Test-only dependency faults are labelled and separate from the real CLI controls. The legacy byte goldens were recorded from the pinned pre-dispatch source, with SDK imports denied, and must not be regenerated from a changed dispatcher.
