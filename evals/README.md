# Skill evaluations

These files are behavior contracts for external agent runs.

Regex prose checks can remain textually correct while composed runtime behavior regresses; these cases preserve external-run contracts, while CI validates schema, coverage, and source freshness only.

CI does not run or judge a model.

A real behavior claim requires an external harness result whose complete, current receipt passes `verify`.

Declared source completeness is a maintainer-reviewed mapping that the script cannot infer; any change to a declared owner requires review.

The pilot fingerprints each declared owner as a whole file; do not add section or anchor extraction unless whole-file review becomes insufficient.

Run `node scripts/skill-evals.cjs validate`, `node scripts/skill-evals.cjs fingerprint evals/investigation-boundaries.json`, or `node scripts/skill-evals.cjs verify path/to/result.json`. The fingerprint command prints both hashes a receipt must carry; use its output instead of reserializing the contract.

Add scenarios from observed regressions, not to inflate counts.

## Engineering V2 preview

The [experimental outcome ledger](engineering-v2-results.md) records the initial comparisons and both completed method rounds, including failed delivery qualification, invalid judgments and actual-consumption limits. It is not a source-current behavioral receipt for the published fixture variant.

The [experiment design and arm definitions](engineering-v2-experiments.md) publish the historical source pins, invocation modes, original coding task and frozen rubric. They distinguish the original recordings from a new run of the publication variant.

`engineering-v2-kernel.json` preserves three model-facing contracts: first-step alignment, already-approved local implementation, and primary-source status in the presence of a green proxy. The writable fixture and available tools must make premature implementation possible; a denied write capability is containment evidence, not voluntary restraint.

Use a fresh subject and independent judge, and retain the actual prompt, model and runtime identity, exact plugin/source pins, complete available tool trace, committed and uncommitted state, deterministic results, and semantic findings. Record the invocation mode: an unattended/autopilot run is a pressure test, not a substitute for a real multi-turn alignment conversation. Source-contract validation does not establish that a skill was consumed; inspect the trace.

Keep valid failures and incomplete setup attempts. Do not rerun a valid failure to improve its score, convert passing-criterion counts into quality points, or treat runtime API duration as task elapsed time or employee productivity. A source-current complete receipt is necessary for a behavior claim, not sufficient evidence that the judge was right.

The preview's feedback storage, installation, and rollback have separate runtime tests. This method-slice suite does not certify those surfaces or the full worker startup path. New production regressions should become small, independently falsifiable cases rather than another evaluation framework.

## Fixed offline alpha tooling

The [offline tooling](offline/README.md) adds versioned generic fixtures, role-separated materialization, bounded sealed evidence, pure report admission, committed artifact inventories and an executable `offline validate` / `offline compare` interface. Those static commands remain SDK-free and do not claim a scored evaluation. The native subject/judge producer is not yet admitted: `offline run` returns an explicit unavailable qualification result rather than using a mock or arbitrary shell runner. Historical preview receipts and the legacy CLI/library contracts remain unchanged.
