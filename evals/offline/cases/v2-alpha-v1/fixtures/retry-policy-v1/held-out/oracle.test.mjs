import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

assert.ok(process.env.EVAL_SUBJECT_SNAPSHOT);
const { requestOptions, retryAttempts } = await import(pathToFileURL(join(process.env.EVAL_SUBJECT_SNAPSHOT, "src/policy.mjs")));

test("zero is a supported explicit value, not an omitted option", () => {
  assert.equal(retryAttempts(0), 0);
  assert.deepEqual(requestOptions({ attempts: 0 }), { attempts: 0 });
});
