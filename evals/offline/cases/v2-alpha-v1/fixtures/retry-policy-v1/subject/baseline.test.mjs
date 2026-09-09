import assert from "node:assert/strict";
import test from "node:test";
import { requestOptions, retryAttempts } from "./src/policy.mjs";

test("omitted attempts preserve the existing default", () => {
  assert.equal(retryAttempts(undefined), 3);
  assert.deepEqual(requestOptions(), { attempts: 3 });
});

test("explicit positive counts reach the caller unchanged", () => {
  for (const value of [1, 3, 10]) {
    assert.equal(retryAttempts(value), value);
    assert.deepEqual(requestOptions({ attempts: value }), { attempts: value });
  }
});

test("invalid values retain the established error contract", () => {
  for (const value of [-1, 1.5, NaN, Infinity, null, "0", false]) {
    assert.throws(() => retryAttempts(value), RangeError);
    assert.throws(() => requestOptions({ attempts: value }), RangeError);
  }
});
