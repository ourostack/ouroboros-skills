import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { repository, workRoot } from "./helpers/paths.mjs";

const root = workRoot("publication");
const moduleUrl = pathToFileURL(resolve(repository, "evals/offline/output.mjs"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const context = { runId: "attempt", cellId: "cell", planSha256: hash("frozen plan") };
const limits = { maxStreamBytes: 1024, maxFileBytes: 8192, maxTotalBytes: 65536, maxFiles: 32 };
const receipt = { schemaVersion: 1, runId: "attempt", status: "infrastructure_failure", grade: null, counts: { observedRequests: 0, schemaAcceptedHandlers: 0, validatorAcceptedReports: 0, admittedGrades: 0 } };
let fixtureNumber = 0;

function directories() {
  const base = join(root, "prospective-work", `${process.pid}-${++fixtureNumber}`);
  fs.mkdirSync(base, { recursive: true });
  const authorizedRoot = join(base, "artifacts");
  const source = join(base, "source");
  fs.mkdirSync(authorizedRoot);
  fs.mkdirSync(source);
  fs.writeFileSync(join(source, "sentinel"), "unchanged");
  return { base, authorizedRoot, source, outputRoot: join(authorizedRoot, "run") };
}

async function setup(overrides = {}) {
  const api = await import(moduleUrl);
  const dirs = directories();
  const output = api.openRunOutput({ outputRoot: dirs.outputRoot, authorizedRoot: dirs.authorizedRoot, protectedRoots: [dirs.source], runContext: context, limits, ...overrides });
  return { ...api, ...dirs, output };
}

test("raw stdout and stderr bytes remain distinct and lossless", async () => {
  const { output, outputRoot } = await setup();
  const stdout = Buffer.from([0xff, 0, 0x80]);
  const stderr = Buffer.from([0xfe, 0x0a]);
  output.appendRaw("stdout", stdout);
  output.appendRaw("stderr", stderr);
  assert.ok(fs.existsSync(join(outputRoot, "stdout.raw")), "appendRaw must create the raw stdout member");
  assert.ok(fs.existsSync(join(outputRoot, "stderr.raw")), "appendRaw must create the raw stderr member");
  assert.deepEqual(fs.readFileSync(join(outputRoot, "stdout.raw")), stdout);
  assert.deepEqual(fs.readFileSync(join(outputRoot, "stderr.raw")), stderr);
  assert.equal(fs.existsSync(join(outputRoot, "COMMITTED.json")), false);
});

test("overflow preserves a marked prefix and permanently blocks commit", async () => {
  const { output, outputRoot, readCommittedRun } = await setup({ limits: { ...limits, maxStreamBytes: 4 } });
  assert.throws(() => output.appendRaw("stdout", Buffer.from("abcdef")), { code: "OUTPUT_STREAM_OVERFLOW" });
  const envelope = JSON.parse(fs.readFileSync(join(outputRoot, "receipt.incomplete.json")));
  assert.equal(envelope.captureComplete, false);
  assert.equal(envelope.grade, null);
  assert.equal(envelope.counts.admittedGrades, 0);
  assert.ok(fs.readFileSync(join(outputRoot, "stdout.raw")).length <= 4);
  assert.throws(() => output.commit(receipt), { code: "OUTPUT_NOT_COMMITTABLE" });
  assert.throws(() => readCommittedRun(outputRoot));
});

test("mid-write failure leaves an incomplete envelope and no committed result", async () => {
  const io = {
    appendFileSync(path, value, options) {
      if (String(path).endsWith("stdout.raw")) {
        fs.appendFileSync(path, Buffer.from(value).subarray(0, 2), options);
        throw Object.assign(new Error("Injected short write then disk failure"), { code: "ENOSPC" });
      }
      return fs.appendFileSync(path, value, options);
    },
  };
  const { output, outputRoot, readCommittedRun } = await setup({ io });
  assert.throws(() => output.appendRaw("stdout", Buffer.from("abcdef")), { code: "OUTPUT_WRITE_FAILED" });
  assert.equal(fs.existsSync(join(outputRoot, "COMMITTED.json")), false);
  assert.equal(JSON.parse(fs.readFileSync(join(outputRoot, "receipt.incomplete.json"))).grade, null);
  assert.throws(() => readCommittedRun(outputRoot));
});

test("native presentation failure prevents committed output and cannot leave a readable grade", async () => {
  const io = {
    writeFileSync(path, value, options) {
      if (String(path).includes("result.md")) throw Object.assign(new Error("Injected Markdown write failure"), { code: "ENOSPC" });
      return fs.writeFileSync(path, value, options);
    },
  };
  const { output, outputRoot, readCommittedRun } = await setup({ io });
  assert.throws(() => output.commit(receipt), { code: "OUTPUT_WRITE_FAILED" });
  assert.equal(fs.existsSync(join(outputRoot, "COMMITTED.json")), false);
  assert.throws(() => output.commit(receipt), { code: "OUTPUT_NOT_COMMITTABLE" });
  assert.throws(() => readCommittedRun(outputRoot));
});

test("final marker publication failure cannot leave a readable success", async () => {
  const io = {
    renameSync(from, to) {
      if (String(to).endsWith("COMMITTED.json")) throw Object.assign(new Error("Injected final publication failure"), { code: "EIO" });
      return fs.renameSync(from, to);
    },
  };
  const { output, outputRoot, readCommittedRun } = await setup({ io });
  output.appendRaw("stdout", Buffer.from("captured"));
  assert.throws(() => output.commit(receipt), { code: "OUTPUT_FINAL_PUBLISH_FAILED" });
  assert.equal(fs.existsSync(join(outputRoot, "COMMITTED.json")), false);
  assert.throws(() => readCommittedRun(outputRoot));
});

test("a committed inventory is invalidated by any later raw-byte mutation", async () => {
  const { output, outputRoot, readCommittedRun } = await setup();
  output.appendRaw("stdout", Buffer.from("original"));
  output.commit(receipt);
  assert.ok(fs.existsSync(join(outputRoot, "COMMITTED.json")), "commit must publish the final marker");
  assert.doesNotThrow(() => readCommittedRun(outputRoot));
  fs.writeFileSync(join(outputRoot, "stdout.raw"), "changed");
  assert.throws(() => readCommittedRun(outputRoot));
});

test("an orphan passing presentation without marker and inventory is unreadable", async () => {
  const { readCommittedRun } = await import(moduleUrl);
  const dirs = directories();
  fs.mkdirSync(dirs.outputRoot, { recursive: true });
  fs.writeFileSync(join(dirs.outputRoot, "result.json"), '{"status":"pass"}\n');
  assert.throws(() => readCommittedRun(dirs.outputRoot));
});

for (const kind of ["outside-authorized-root", "equal-source", "ancestor-source", "descendant-source", "existing-output", "ancestor-link"]) {
  test(`${kind} is rejected before an output mutation`, async () => {
    const { openRunOutput } = await import(moduleUrl);
    const dirs = directories();
    let outputRoot = dirs.outputRoot;
    let authorizedRoot = dirs.authorizedRoot;
    if (kind === "outside-authorized-root") outputRoot = join(dirs.base, "outside");
    if (kind === "equal-source") { authorizedRoot = dirs.base; outputRoot = dirs.source; }
    if (kind === "ancestor-source") { authorizedRoot = dirs.base; outputRoot = dirs.base; }
    if (kind === "descendant-source") { authorizedRoot = dirs.base; outputRoot = join(dirs.source, "nested"); }
    if (kind === "existing-output") fs.mkdirSync(outputRoot);
    if (kind === "ancestor-link") {
      fs.mkdirSync(join(dirs.authorizedRoot, "inside"));
      fs.symlinkSync(join(dirs.authorizedRoot, "inside"), join(dirs.authorizedRoot, "linked"));
      outputRoot = join(dirs.authorizedRoot, "linked", "nested");
    }
    assert.throws(() => openRunOutput({ outputRoot, authorizedRoot, protectedRoots: [dirs.source], runContext: context, limits }));
    assert.equal(fs.readFileSync(join(dirs.source, "sentinel"), "utf8"), "unchanged");
    assert.equal(fs.existsSync(join(dirs.source, "nested")), false);
    assert.equal(fs.existsSync(join(dirs.authorizedRoot, "inside", "nested")), false);
  });
}

for (const kind of ["symbolic", "hard"]) {
  test(`a ${kind} link cannot replace a committed member even with identical bytes`, async () => {
    const { output, outputRoot, base, readCommittedRun } = await setup();
    output.appendRaw("stdout", Buffer.from("same bytes"));
    output.commit(receipt);
    assert.ok(fs.existsSync(join(outputRoot, "stdout.raw")), "a committed raw member must exist");
    const mirror = join(base, "mirror.raw");
    fs.writeFileSync(mirror, "same bytes");
    fs.unlinkSync(join(outputRoot, "stdout.raw"));
    if (kind === "symbolic") fs.symlinkSync(mirror, join(outputRoot, "stdout.raw"));
    else fs.linkSync(mirror, join(outputRoot, "stdout.raw"));
    assert.throws(() => readCommittedRun(outputRoot));
  });
}

test("argv-only execution preserves shell metacharacters as one literal argument", async () => {
  const { captureBoundedCommand } = await import(moduleUrl);
  const dirs = directories();
  const literal = "literal; touch UNAUTHORIZED_SENTINEL";
  const result = await captureBoundedCommand({
    executable: process.execPath,
    argv: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", literal],
    cwd: dirs.base,
    env: {},
    limits: { maxStreamBytes: 1024, timeoutMs: 1000 },
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout.bytes.toString("utf8")), [literal]);
  assert.equal(fs.existsSync(join(dirs.base, "UNAUTHORIZED_SENTINEL")), false);
});

test("a second disk failure cannot truncate the original null-grade incomplete envelope", async () => {
  let envelopeWrites = 0;
  let annotationFailed = false;
  const io = {
    appendFileSync() { throw Object.assign(new Error("capture failed"), { code: "ENOSPC" }); },
    writeFileSync(filename, value, options) {
      if (String(filename).includes("receipt.incomplete") && ++envelopeWrites > 1) {
        annotationFailed = true;
        fs.writeFileSync(filename, "{", options);
        throw Object.assign(new Error("annotation failed"), { code: "ENOSPC" });
      }
      return fs.writeFileSync(filename, value, options);
    },
  };
  const { output, outputRoot } = await setup({ io });
  assert.throws(() => output.appendRaw("stdout", Buffer.from("data")));
  assert.equal(annotationFailed, true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(join(outputRoot, "receipt.incomplete.json"))));
  assert.equal(JSON.parse(fs.readFileSync(join(outputRoot, "receipt.incomplete.json"))).grade, null);
});

test("same-length raw mutation before final publication cannot become a newly sealed result", async () => {
  const { output, outputRoot } = await setup();
  output.appendRaw("stdout", Buffer.from("original"));
  fs.writeFileSync(join(outputRoot, "stdout.raw"), "tampered");
  assert.throws(() => output.commit(receipt));
});

test("success-shaped status without an admitted grade cannot be published", async () => {
  const { output } = await setup();
  assert.throws(() => output.commit({ ...receipt, status: "passed" }));
});

test("raw SDK and schema channels use separate bounded files under the default limits", async () => {
  const { output, outputRoot } = await setup({ limits: undefined });
  output.appendRaw("sdk-events", Buffer.from('{"id":"one"}\n'));
  output.appendRaw("schema-events", Buffer.from('{"id":"schema-one"}\n'));
  assert.equal(fs.readFileSync(join(outputRoot, "sdk-events.jsonl"), "utf8"), '{"id":"one"}\n');
  assert.equal(fs.readFileSync(join(outputRoot, "schema-events.jsonl"), "utf8"), '{"id":"schema-one"}\n');
  output.commit(receipt);
});

test("failure creating the initial incomplete envelope returns a structured I/O failure", async () => {
  await assert.rejects(() => setup({ io: { writeFileSync() { throw Object.assign(new Error("initial write denied"), { code: "EACCES" }); } } }), { code: "OUTPUT_WRITE_FAILED", exitCode: 3 });
});

test("publication accepts the frozen one-GiB aggregate ceiling without reading or allocating that amount", async () => {
  await assert.doesNotReject(() => setup({ limits: { ...limits, maxTotalBytes: 1073741824 } }));
});
