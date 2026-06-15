# Vector Pack Fixtures

Unit 12 tests generate concrete `.jsonl`, `.manifest.json`, and `.sha256`
packs in temporary plugin roots from this contract so checksum sidecars always
match the rows under test. The canonical production path is:

`plugins/desk/artifacts/vector-packs/<embedding-spec-id>/<pack-id>.jsonl`
