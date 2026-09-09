import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { legacyCases, makeLegacyFixture } from "./helpers/legacy-fixture.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, "../../..");
const cli = join(repo, "scripts/skill-evals.cjs");
const preload = join(root, "helpers/deny-sdk-preload.mjs");
const goldens = JSON.parse(readFileSync(join(root, "legacy-goldens.json")));
const work = join(repo, "evals/offline/.test-work", `legacy-${process.pid}`);
mkdirSync(work, { recursive: true });
after(() => rmSync(work, { recursive: true, force: true }));

for (const [id, argv] of legacyCases) test(`SDK-denied legacy ${id} retains exact stdout/stderr/status`, () => {
  const cwd = join(work, id);
  makeLegacyFixture(cwd, id);
  const run = spawnSync(process.execPath, ["--import", preload, cli, ...argv], { cwd, encoding: null, timeout: 10000 });
  assert.equal(run.error, undefined);
  assert.equal(run.status, goldens.cases[id].status);
  assert.deepEqual(run.stdout, Buffer.from(goldens.cases[id].stdoutBase64, "base64"));
  assert.deepEqual(run.stderr, Buffer.from(goldens.cases[id].stderrBase64, "base64"));
});

test("SDK denial is active for both module systems", () => {
  for (const code of [
    "try { require('@github/copilot-sdk'); process.exitCode=9; } catch(e) { if(!e.message.includes('SDK_IMPORT_FORBIDDEN')) throw e; process.stdout.write('denied\\n'); }",
    "import('@github/copilot-sdk').then(()=>{process.exitCode=9},e=>{if(!e.message.includes('SDK_IMPORT_FORBIDDEN'))throw e;process.stdout.write('denied\\n')});",
  ]) {
    const run = spawnSync(process.execPath, ["--import", preload, "-e", code], { cwd: work, encoding: null });
    assert.equal(run.status, 0);
    assert.deepEqual(run.stdout, Buffer.from("denied\n"));
    assert.deepEqual(run.stderr, Buffer.alloc(0));
  }
});

test("legacy exported library stays synchronous and SDK-free", () => {
  const code = "const a=require('node:assert/strict'),m=require(process.argv[1]);a.equal(m.normalizeSource('\\ufeffa\\r\\n'),'a\\n');a.equal(typeof m.contractFingerprint({a:1}),'string');a.throws(()=>m.sourceFingerprint([]));process.stdout.write('sync\\n');";
  const run = spawnSync(process.execPath, ["--import", preload, "-e", code, cli], { cwd: work, encoding: null });
  assert.equal(run.status, 0);
  assert.deepEqual(run.stdout, Buffer.from("sync\n"));
  assert.deepEqual(run.stderr, Buffer.alloc(0));
});
