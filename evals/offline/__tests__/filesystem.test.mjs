import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { MAX_FILE_BYTES, absoluteRoot, canonicalJson, confinedPath, exactKeys, listRegularFiles, parseRawJson, pathIdentities, readRawReference, readRegular, relativeName, sha256, textBytes } from "../core.mjs";
import { createEvidenceReader } from "../evidence.mjs";
import { authorizeRolePath, materializeFixture } from "../materialize.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";

const base = workRoot("filesystem");
let number = 0;
function fixture(content = "abcdef") {
  const root = path.join(base, String(++number));
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "proof.txt"), content);
  return root;
}
const reader = root => createEvidenceReader({ root, index: { files: ["proof.txt"] } });

test("bounded evidence paging preserves UTF-16 offsets and immutable raw bytes", () => {
  const content = "\ufeff😀ab\r\nend";
  const root = fixture(content);
  const evidence = reader(root);
  assert.deepEqual(evidence.read("proof.txt"), { text: content, totalCharacters: content.length, nextOffset: null });
  assert.deepEqual(evidence.read("proof.txt", 1, 1), { text: content.slice(1, 2), totalCharacters: content.length, nextOffset: 2 });
  assert.deepEqual(evidence.read("proof.txt", content.length, 1), { text: "", totalCharacters: content.length, nextOffset: null });
  assert.equal(evidence.read("proof.txt", Number.MAX_SAFE_INTEGER, 1).text, "");
  assert.equal(evidence.seal[0].sha256, sha256(Buffer.from(content)));
  assert.notEqual(evidence.seal[0].sha256, sha256(Buffer.from(content.replace(/^\ufeff/, "").replaceAll("\r\n", "\n"))));
  assert.throws(() => { evidence.seal[0].sha256 = "0".repeat(64); }, TypeError);
  for (const offset of [-1, 0.5, NaN, Infinity, "0"]) assert.throws(() => evidence.read("proof.txt", offset, 1), { code: "INVALID_EVIDENCE_PAGE" });
  for (const length of [0, -1, 0.5, 16001, Infinity, "1"]) assert.throws(() => evidence.read("proof.txt", 0, length), { code: "INVALID_EVIDENCE_PAGE" });
  assert.throws(() => evidence.read("unindexed.txt"), { code: "UNINDEXED_EVIDENCE_PATH" });
  fs.writeFileSync(path.join(root, "proof.txt"), "changed");
  assert.throws(() => evidence.read("proof.txt"), { code: "EVIDENCE_CHANGED" });
  fs.writeFileSync(path.join(root, "proof.txt"), content);
  assert.throws(() => evidence.read("proof.txt"), { code: "EVIDENCE_CHANGED" });
});

test("reader rejects malformed indexes, binary data and over-limit files", () => {
  const root = fixture();
  for (const index of [null, [], {}, { files: "proof.txt" }, { files: [1] }, { files: ["proof.txt"], notes: null }, { files: ["proof.txt"], notes: [1] }]) assert.throws(() => createEvidenceReader({ root, index }));
  assert.equal(createEvidenceReader({ root, index: { files: ["proof.txt"], notes: ["controller note"] } }).read("proof.txt").text, "abcdef");
  assert.deepEqual(createEvidenceReader({ root, index: { files: [] } }).seal, []);
  assert.throws(() => createEvidenceReader({ root, index: { files: ["proof.txt", "proof.txt"] } }));
  const binary = fixture(Buffer.from([0, 1]));
  assert.throws(() => reader(binary), { code: "BINARY_NOT_ALLOWED" });
  assert.throws(() => reader(fixture(Buffer.from([0xff]))));
  const oversized = fixture("");
  fs.truncateSync(path.join(oversized, "proof.txt"), MAX_FILE_BYTES + 1);
  assert.throws(() => reader(oversized), { code: "FILE_TOO_LARGE" });
  assert.equal(reader(fixture("")).read("proof.txt").totalCharacters, 0);
});

test("reader denies absolute, traversal, symbolic, hard and ancestor-linked evidence", () => {
  const root = fixture();
  for (const name of ["../outside", "./proof.txt", path.join(root, "proof.txt"), "x\\proof.txt", "x//proof.txt", "proof.txt\0"]) assert.throws(() => createEvidenceReader({ root, index: { files: [name] } }));
  fs.symlinkSync(path.join(root, "proof.txt"), path.join(root, "symbolic.txt"));
  assert.throws(() => createEvidenceReader({ root, index: { files: ["symbolic.txt"] } }));
  fs.linkSync(path.join(root, "proof.txt"), path.join(root, "hard.txt"));
  assert.throws(() => reader(root), { code: "REGULAR_FILE_REQUIRED" });
  fs.unlinkSync(path.join(root, "hard.txt"));
  fs.mkdirSync(path.join(root, "real"));
  fs.writeFileSync(path.join(root, "real", "inside.txt"), "inside");
  fs.symlinkSync(path.join(root, "real"), path.join(root, "linked"));
  assert.throws(() => createEvidenceReader({ root, index: { files: ["linked/inside.txt"] } }), { code: "LINK_NOT_ALLOWED" });
});

test("a changing file cannot pass a regular-file read race check", t => {
  const root = fixture();
  const original = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    const count = original(...args);
    if (!changed) { changed = true; fs.writeFileSync(path.join(root, "proof.txt"), "changed"); }
    return count;
  });
  assert.throws(() => readRegular(root, "proof.txt"), { code: "FILE_CHANGED" });
});

test("regular-file reads reject a real FIFO before attempting an open", t => {
  const root = fixture();
  const fifo = path.join(root, "fifo");
  execFileSync("mkfifo", [fifo]);
  const original = fs.openSync;
  t.mock.method(fs, "openSync", (filename, ...args) => {
    if (filename === fifo) throw Object.assign(new Error("FIFO_OPEN_WOULD_BLOCK"), { code: "UNSAFE_FIFO_OPEN" });
    return original(filename, ...args);
  });
  assert.throws(() => readRegular(root, "fifo"), { code: "REGULAR_FILE_REQUIRED" });
});

test("the opened descriptor is nonblocking against a regular-to-FIFO race", t => {
  const root = fixture();
  const original = fs.openSync;
  t.mock.method(fs, "openSync", (filename, flags, ...args) => {
    assert.notEqual(flags & fs.constants.O_NONBLOCK, 0, "The descriptor must not block if the last path changes to a FIFO");
    return original(filename, flags, ...args);
  });
  assert.equal(readRegular(root, "proof.txt").bytes.toString(), "abcdef");
});

test("JSON artifact structure is bounded independently of its byte size", () => {
  assert.throws(() => parseRawJson(Buffer.from(`${"[".repeat(80)}0${"]".repeat(80)}`)), { code: "JSON_STRUCTURE_LIMIT" });
});

test("JSON artifact node count is bounded even when nesting is shallow", () => {
  assert.throws(() => parseRawJson(Buffer.from(JSON.stringify(Array(100000).fill(0)))), { code: "JSON_STRUCTURE_LIMIT" });
});

test("regular artifacts and role views retain their explicit validation boundaries", () => {
  const root = fixture();
  assert.equal(absoluteRoot(root), root);
  for (const value of [null, "", "relative", `${root}/../outside`]) assert.throws(() => absoluteRoot(value));
  for (const value of ["", "..", ".", "/absolute", "a\\b", "a//b", "a/../b", "\0", "x".repeat(4097)]) assert.throws(() => relativeName(value));
  assert.equal(confinedPath(root, "proof.txt"), path.join(root, "proof.txt"));
  assert.throws(() => pathIdentities(path.join(root, "absent")));
  assert.throws(() => readRegular(root, "proof.txt", -1));
  assert.throws(() => readRegular(root, "proof.txt", 2), { code: "FILE_TOO_LARGE" });
  assert.equal(canonicalJson({ b: [2, 1], a: null }), '{"a":null,"b":[2,1]}');
  assert.equal(exactKeys({ a: 1, b: 2 }, ["a"], ["b"]), true);
  assert.equal(exactKeys({ a: 1, extra: 2 }, ["a"]), false);
  assert.throws(() => textBytes(Buffer.from([0])));
  assert.throws(() => readRawReference(null, () => Buffer.alloc(0)));
  assert.throws(() => readRawReference({ path: "proof", sha256: "0".repeat(64) }, () => "not bytes"));
  const bytes = Buffer.from("proof");
  assert.equal(readRawReference({ path: "proof", sha256: sha256(bytes) }, () => bytes), bytes);
  const view = { readRoots: [root], writeRoots: [root] };
  assert.equal(authorizeRolePath(view, path.join(root, "proof.txt"), "read"), true);
  assert.equal(authorizeRolePath(view, path.join(root, "not-yet-created"), "write"), true);
  assert.throws(() => authorizeRolePath(view, root, "execute"));
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "more.txt"), "more");
  assert.deepEqual(listRegularFiles(root).map(file => file.path), ["nested/more.txt", "proof.txt"]);
  fs.symlinkSync(path.join(root, "proof.txt"), path.join(root, "link"));
  assert.throws(() => listRegularFiles(root), { code: "LINK_NOT_ALLOWED" });
});

test("materialization refuses unowned, overlapping, reused and malformed source inputs before writes", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, "fixture-manifest.json")));
  const identity = { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" };
  const make = () => {
    const parent = fixture();
    return { manifest: structuredClone(manifest), fixtureId: "retry-policy-v1", sourceRoot: dataRoot, roots: { actor: path.join(parent, "actor"), checker: path.join(parent, "checker"), canonical: path.join(parent, "canonical") }, gitIdentity: identity };
  };
  const mutations = [
    value => { value.manifest = null; },
    value => { value.fixtureId = "unknown"; },
    value => { value.roots.checker = value.roots.actor; },
    value => { fs.mkdirSync(value.roots.actor); },
    value => { value.gitIdentity = null; },
    value => { value.gitIdentity = { ...identity, authorName: "bad\nidentity" }; },
    value => { value.manifest.fixtures[0].files[0].sha256 = "0".repeat(64); },
    value => { value.manifest.fixtures[0].files[0].targetPath = ".git/config"; },
    value => { value.manifest.fixtures[0].files.push({ ...value.manifest.fixtures[0].files[0] }); },
    value => { value.manifest.fixtures[0].files[0].role = "unknown"; },
  ];
  for (const mutate of mutations) {
    const options = make();
    mutate(options);
    await assert.rejects(() => materializeFixture(options));
    assert.equal(fs.existsSync(path.join(options.roots.actor, ".git")), false);
  }
});

test("artifact inventory enforces the aggregate byte limit before reading another payload", t => {
  const root = fixture("abc");
  fs.writeFileSync(path.join(root, "second.txt"), "def");
  const original = fs.readSync;
  let readBytes = 0;
  t.mock.method(fs, "readSync", (...args) => { const count = original(...args); readBytes += count; return count; });
  assert.throws(() => listRegularFiles(root, { maxTotalBytes: 3 }), { code: "INVENTORY_LIMIT" });
  assert.ok(readBytes <= 3);
});

test("artifact inventory bounds file count before opening the extra file", () => {
  const root = fixture("abc");
  fs.writeFileSync(path.join(root, "second.txt"), "def");
  assert.throws(() => listRegularFiles(root, { maxFiles: 1 }), { code: "INVENTORY_LIMIT" });
});

test("artifact inventory retains file metadata rather than accumulating every payload buffer", () => {
  const root = fixture("abc");
  const result = listRegularFiles(root);
  assert.equal(result[0].bytes, 3);
  assert.equal(Buffer.isBuffer(result[0].bytes), false);
  assert.equal(result[0].sha256, sha256("abc"));
});

test("artifact directory traversal is bounded even without regular files", () => {
  const root = fixture("");
  let directory = root;
  for (let depth = 0; depth < 66; depth += 1) {
    directory = path.join(directory, "d");
    fs.mkdirSync(directory);
  }
  assert.throws(() => listRegularFiles(root), { code: "INVENTORY_LIMIT" });
});

test("source mutation between validation and materialization cannot silently seed a different input epoch", async t => {
  const parent = fixture();
  const source = path.join(parent, "source");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "input.txt"), "original");
  const roots = { actor: path.join(parent, "actor"), checker: path.join(parent, "checker"), canonical: path.join(parent, "canonical") };
  const original = fs.mkdirSync;
  let mutated = false;
  t.mock.method(fs, "mkdirSync", (filename, ...args) => {
    const result = original(filename, ...args);
    if (filename === roots.actor && !mutated) {
      mutated = true;
      fs.writeFileSync(path.join(source, "input.txt"), "changed");
    }
    return result;
  });
  const manifest = { schemaVersion: 1, fixtures: [{ id: "fixture", requiresAdmittedProducerBinding: false, files: [{ role: "subject", sourcePath: "input.txt", targetPath: "input.txt", sha256: sha256("original") }] }] };
  await assert.rejects(() => materializeFixture({ manifest, fixtureId: "fixture", sourceRoot: source, roots, gitIdentity: { authorName: "Ari Mendelow", authorEmail: "ari@mendelow.me", committerName: "Ari Mendelow", committerEmail: "ari@mendelow.me" } }), { code: "FIXTURE_SOURCE_CHANGED" });
});

test("bounded traversal does not first allocate an unbounded readdir result", t => {
  const root = fixture("abc");
  t.mock.method(fs, "readdirSync", () => { throw new Error("UNBOUNDED_DIRECTORY_MATERIALIZATION"); });
  let result;
  assert.doesNotThrow(() => { result = listRegularFiles(root); });
  assert.deepEqual(result.map(entry => entry.path), ["proof.txt"]);
});
