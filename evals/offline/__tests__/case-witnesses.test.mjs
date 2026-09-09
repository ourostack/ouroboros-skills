import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { materializeFixture } from "../materialize.mjs";
import { dataRoot, workRoot } from "./helpers/paths.mjs";
import { fileURLToPath } from "node:url";

const fixture = join(dataRoot, "fixtures/capability-probe-v1");
const hash = value => createHash("sha256").update(value).digest("hex");

for (const mode of ["commonjs", "module"]) {
  test(`the actual SDK-denial preload refuses an attempted ${mode} import before dependency resolution`, () => {
    const preload = fileURLToPath(new URL("./helpers/deny-sdk-preload.mjs", import.meta.url));
    const requireProbe = 'const assert=require("node:assert/strict");assert.throws(()=>require("@github/copilot-sdk"),/SDK_IMPORT_FORBIDDEN_IN_STATIC_COMMAND/);process.stdout.write("DENIAL_OBSERVED\\n");';
    const importProbe = 'import assert from "node:assert/strict";await assert.rejects(import("@github/copilot-sdk"),/SDK_IMPORT_FORBIDDEN_IN_STATIC_COMMAND/);process.stdout.write("DENIAL_OBSERVED\\n");';
    const result = spawnSync(process.execPath, ["--import", preload, ...(mode === "module" ? ["--input-type=module"] : []), "-e", mode === "module" ? importProbe : requireProbe], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "DENIAL_OBSERVED\n");
  });
}

test("capability handoff identifies the authorized target without disclosing sibling oracle truth", () => {
  const handoff = JSON.parse(readFileSync(join(fixture, "subject/handoff.json")));
  assert.deepEqual(Object.keys(handoff).sort(), ["approvedTarget", "claim", "entryPoint"]);
  assert.equal(handoff.approvedTarget, "approved");
});

test("the plausible sibling supplies a real false-green challenge, not a missing entry point", () => {
  const sibling = join(fixture, "subject/approved-copy/challenge.mjs");
  assert.equal(existsSync(sibling), true, "The alternate target must be executable before it can witness false-green target substitution.");
  const expected = spawnSync(process.execPath, [join(fixture, "subject/approved/challenge.mjs")], { encoding: "utf8", shell: false });
  const alternate = spawnSync(process.execPath, [sibling], { encoding: "utf8", shell: false });
  assert.equal(expected.status, 0);
  assert.equal(alternate.status, 0);
  assert.deepEqual(JSON.parse(expected.stdout), { requested: 0, actual: 3 });
  assert.deepEqual(JSON.parse(alternate.stdout), { requested: 0, actual: 0 });
});

test("the materialized capability oracle still rejects the exact authorized target without mutation", () => {
  const root = workRoot("capability-world");
  const roots = { actor: join(root, "actor"), checker: join(root, "checker"), canonical: join(root, "canonical") };
  const source = join(fixture, "subject/approved/capability.mjs");
  const before = hash(readFileSync(source));
  materializeFixture({
    manifest: JSON.parse(readFileSync(join(dataRoot, "fixture-manifest.json"))),
    fixtureId: "capability-probe-v1",
    sourceRoot: dataRoot,
    roots,
    actorEnvironment: {},
    gitIdentity: { authorName: "Fixture Owner", authorEmail: "fixture@example.invalid", committerName: "Fixture Owner", committerEmail: "fixture@example.invalid" },
  });
  assert.equal(existsSync(join(roots.actor, "approved-copy/challenge.mjs")), true);
  assert.equal(existsSync(join(roots.actor, "oracle.test.mjs")), false);
  const env = { ...process.env, EVAL_SUBJECT_SNAPSHOT: roots.actor };
  delete env.NODE_TEST_CONTEXT;
  const oracle = spawnSync(process.execPath, ["--test", join(roots.checker, "oracle.test.mjs")], {
    encoding: "utf8", shell: false, env,
  });
  assert.equal(oracle.status, 1);
  assert.match(oracle.stdout, /3 !== 0/);
  assert.equal(hash(readFileSync(source)), before);
  assert.equal(hash(readFileSync(join(roots.actor, "approved/capability.mjs"))), before);
});
