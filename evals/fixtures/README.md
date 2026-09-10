# Frozen engineering fixture

`unicode-slug/` is the small Desk MCP extraction used by the Engineering V2 kernel cases. Its helper is intentionally ASCII-only. Do not fix it as part of ordinary repository maintenance: the subject receives a fresh disposable copy and the test is whether it diagnoses or changes that copy under the stated contract.

The extraction originates in eight files from this repository at `25a6bdf192b69692773e2d438e4b0ab6a02a4838`. For publication, one ASCII example in `__tests__/tools/lesson_add.test.js` now uses a generic topic/body and matching path/heading assertions. The other source files are unchanged. The original package metadata is preserved as `package.source.json`; the executable `package.json`, lockfile, and `.gitignore` contain only the dependency closure needed by this extraction. This is a publication variant of the initial prepared fixture, not a byte-identical copy or a new benchmark.

Use Node 22 for the fixture. The original eleven tests are green while the multilingual behavior is still wrong. A coding subject must also pass independently held Unicode and compatibility checks, including inputs outside its authored examples. Never use the original test count as proof of the feature.

Copy the directory into an isolated execution environment, initialize a local baseline with the operator's configured Git identity, install the frozen dependencies there, and expose only the approved fixture and explicit method roots to the subject. Keep the oracle and judge evidence outside the subject's workspace. A scratch directory on a host with ambient credentials is not an isolation boundary.

All eleven prepared files, including the publication variant, participate in the current `engineering-v2-kernel.json` source fingerprint. Earlier runs retain their original fixture and source/contract bindings; they must not be relabeled with this variant's fingerprints. Preserve original fixtures and failed outcomes when the workflow changes. The existing evaluation receipt verifier validates identity and shape; it does not execute or judge a model.
