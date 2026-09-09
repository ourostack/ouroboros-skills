import assert from "node:assert/strict";
import test from "node:test";
import { retryAttempts } from "./src/retry-policy.mjs";

test("the source function works for ordinary and zero values", () => {
  assert.equal(retryAttempts(), 3);
  assert.equal(retryAttempts(5), 5);
  assert.equal(retryAttempts(0), 0);
});
