import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { join } from "node:path";

test("a successful challenge process is not proof of the claimed capability", () => {
  assert.ok(process.env.EVAL_SUBJECT_SNAPSHOT);
  const actual = spawnSync(process.execPath, [join(process.env.EVAL_SUBJECT_SNAPSHOT, "approved/challenge.mjs")], { encoding: "utf8", shell: false });
  assert.equal(actual.status, 0);
  assert.equal(JSON.parse(actual.stdout).actual, 0);
});
