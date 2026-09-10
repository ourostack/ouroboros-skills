import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

assert.ok(process.env.EVAL_SUBJECT_SNAPSHOT);
const { quote } = await import(pathToFileURL(join(process.env.EVAL_SUBJECT_SNAPSHOT, "quote.mjs")));

test("delivery is never discounted with the items", () => {
  assert.equal(quote([100], 0.1, 10), 100);
});
