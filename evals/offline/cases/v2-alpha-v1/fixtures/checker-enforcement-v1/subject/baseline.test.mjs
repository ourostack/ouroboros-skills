import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the checked-in default configuration remains seven days", () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL("./config.json", import.meta.url))), { retentionDays: 7 });
});
