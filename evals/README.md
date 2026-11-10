# Skill evaluations

These files are behavior contracts for external agent runs.

Regex prose checks can remain textually correct while composed runtime behavior regresses; these cases preserve external-run contracts, while CI validates schema, coverage, and source freshness only.

CI does not run or judge a model.

A real behavior claim requires an external harness result whose complete, current receipt passes `verify`.

Declared source completeness is a maintainer-reviewed mapping that the script cannot infer; any change to a declared owner requires review.

The pilot fingerprints each declared owner as a whole file; do not add section or anchor extraction unless whole-file review becomes insufficient.

Run `node scripts/skill-evals.cjs validate`, `node scripts/skill-evals.cjs fingerprint evals/core-meeting-capture.json`, or `node scripts/skill-evals.cjs verify path/to/result.json`. The fingerprint command prints both hashes a receipt must carry; use its output instead of reserializing the contract.

Add scenarios from observed regressions, not to inflate counts.

`core-meeting-capture.json` exercises receipt-only publication, useful recording
stills, excluded private screens, unknown multipart clocks, and absent,
unavailable or irrelevant video. Its inputs are synthetic. Run fresh-context
no-guidance controls before guided samples; manually inspect each output for
invented decisions, progress, pixels and completion. Simulated adapter plans
prove instruction-following only, not actual media retrieval or visual inspection.

The absent-price-catalogue case uses a real synthetic PNG in `evals/fixtures/`.
Its external run must actually supply that approved raster to an available
economical capable visual model. Exact price remains unknown; it is not an
inspection prerequisite. The source-contract regression runs with
`node scripts/test-skill-evals.cjs`; CI still does not run a model.
