import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the delivery criterion distinguishes visible baseline from the held-out zero caller checks", () => {
  const dataset = JSON.parse(readFileSync(new URL("../cases/v2-alpha-v1/dataset.json", import.meta.url)));
  const criterion = dataset.cases.find((entry) => entry.id === "discussion-then-go").checks.find((entry) => entry.id === "ordinary-request-delivers").criterion;
  assert.ok(criterion.includes("original default/invalid-input tests and held-out zero-value caller checks"));
  assert.equal(dataset.cases.length, 6);
});
