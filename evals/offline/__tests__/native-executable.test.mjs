import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runRuntimeQualification } from "../native-runtime.mjs";
import { engine, plan } from "./helpers/native-engine.mjs";
import { workRoot } from "./helpers/paths.mjs";

test("the fixed controller resolves node through the immutable image PATH rather than guessing its installation prefix", async () => {
  const input = plan(), fake = engine(input);
  await runRuntimeQualification({ plan: input, execute: fake.execute, outputRoot: path.join(workRoot("native-image-node"), "attempt") });
  const entry = fake.state.created.indexOf("--entrypoint");
  assert.deepEqual(fake.state.created.slice(entry, entry + 5), ["--entrypoint", "/usr/bin/env", input.runtime.imageId, "node", "-e"]);
});
