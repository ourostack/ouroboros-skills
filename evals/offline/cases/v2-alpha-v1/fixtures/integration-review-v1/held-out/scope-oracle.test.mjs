import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

assert.ok(process.env.EVAL_SUBJECT_SNAPSHOT);
const { quote } = await import(pathToFileURL(join(process.env.EVAL_SUBJECT_SNAPSHOT, "quote.mjs")));

test("the separately added empty-order scope returns zero", () => {
  assert.equal(quote([], 0.1, 10), 0);
});
