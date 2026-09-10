import assert from "node:assert/strict";
import test from "node:test";
import { itemTotal, quote } from "./quote.mjs";

test("item discount works when delivery is free", () => {
  assert.equal(itemTotal([100], 0.1), 90);
  assert.equal(quote([100], 0.1, 0), 90);
});

test("an undiscounted order includes delivery", () => {
  assert.equal(quote([100], 0, 10), 110);
});
