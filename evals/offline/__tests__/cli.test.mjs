import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { repository, dataRoot, workRoot } from "./helpers/paths.mjs";

const root = dataRoot;
const scratch = workRoot("cli");
const cli = join(repository, "scripts/skill-evals.cjs");
const preload = fileURLToPath(new URL("./helpers/deny-sdk-preload.mjs", import.meta.url));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const run = (script, args) => spawnSync(process.execPath, ["--import", preload, script, ...args], { cwd: repository, encoding: "utf8", shell: false, timeout: 10000 });

test("static validation exposes role counts and producer-binding requirements without claiming runnable behavior", () => {
  const result = run(cli, ["offline", "validate", "--dataset", join(root, "dataset.json"), "--fixtures", join(root, "fixture-manifest.json")]);
  assert.equal(result.status, 0, result.stderr);
  const dataset = JSON.parse(readFileSync(join(root, "dataset.json")));
  const manifest = JSON.parse(readFileSync(join(root, "fixture-manifest.json")));
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    status: "validated",
    behavior: "unverified",
    dataset: { id: dataset.id, version: dataset.version, sha256: sha(join(root, "dataset.json")), cases: dataset.cases.length },
    fixtures: manifest.fixtures.map((fixture) => ({
      id: fixture.id,
      subjectFiles: fixture.files.filter((file) => file.role === "subject").length,
      heldOutFiles: fixture.files.filter((file) => file.role === "held_out").length,
      canonicalInputFiles: fixture.files.filter((file) => file.role === "canonical_fixture_input").length,
      requiresAdmittedProducerBinding: fixture.requiresAdmittedProducerBinding,
    })),
    execution: { assessment: "not_performed", requiresAdmittedNativeBinding: true },
  });
});

test("malformed offline invocation returns structured exit four without the SDK", () => {
  const result = run(cli, ["offline", "--unknown"]);
  assert.equal(result.status, 4, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.kind, "offline_error");
  assert.equal(error.artifacts, null);
});

test("legacy CLI remains usable without SDK loading", () => {
  const result = run(cli, ["validate"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /behavior: UNVERIFIED/u);
});

test("legacy exported library functions retain synchronous results and errors without the SDK", () => {
  const code = "const a=require('node:assert/strict'); const m=require(process.argv[1]); a.equal(m.normalizeSource('\\ufeffalpha\\r\\n'),'alpha\\n'); a.match(m.contractFingerprint({x:1}),/^[a-f0-9]{64}$/); a.throws(()=>m.sourceFingerprint([],process.cwd()));";
  const result = spawnSync(process.execPath, ["--import", preload, "-e", code, cli], { cwd: repository, encoding: "utf8", shell: false, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

for (const exitCode of [3, 4]) {
  test(`the actual offline dispatch preserves asynchronous exit ${exitCode}`, () => {
    const fixture = join(scratch, `dispatch-${exitCode}`);
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    mkdirSync(join(fixture, "evals/offline"), { recursive: true });
    cpSync(cli, join(fixture, "scripts/skill-evals.cjs"));
    writeFileSync(join(fixture, "evals/offline/cli.mjs"), `export async function main(){await Promise.resolve();throw Object.assign(new Error("controlled asynchronous failure"),{exitCode:${exitCode},code:"CONTROLLED_FAILURE"});}\n`);
    const result = run(join(fixture, "scripts/skill-evals.cjs"), ["offline", "controlled-fault"]);
    writeFileSync(join(fixture, "observation.json"), JSON.stringify({ expectedExitCode: exitCode, actualExitCode: result.status, stderr: result.stderr }));
    assert.equal(result.status, exitCode, result.stderr);
  });
}
