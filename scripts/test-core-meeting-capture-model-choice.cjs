"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "skills/core-meeting-capture/SKILL.md"), "utf8");
const reference = fs.readFileSync(path.join(root, "skills/core-meeting-capture/references/capture-contract.md"), "utf8");

assert.doesNotMatch(reference, /model choice stays pending/iu,
  "Unknown pricing must not put an otherwise permitted visual inspection on hold.");
assert.match(source, /economical.*capable/iu);
assert.match(reference, /runtime.*model\/tier/iu);
assert.match(reference, /exact pric(?:e|ing)[\s\S]*unknown/iu);
assert.match(reference, /(?:does not|must not|never)\s+block inspection/iu);
assert.match(reference, /before[\s\S]*model input/iu);
assert.match(reference, /Unverified mapping means no target frame/u);
const fixture = fs.readFileSync(path.join(root, "evals/fixtures/core-meeting-capture-diagram.png"));
assert.equal(crypto.createHash("sha256").update(fixture).digest("hex"),
  "43ec9d1fadc380badb3c0822f87fbd3428d42e13f90f1a6bc7140d66020b7199",
  "The inspected synthetic raster must match the behavior scenario fixture.");
console.log("Core meeting capture model-choice source contract passed (not a model behavior test).");
