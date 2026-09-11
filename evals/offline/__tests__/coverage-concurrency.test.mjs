import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { workRoot } from "./helpers/paths.mjs";

for (const [cores, expected] of [[1, 1], [2, 1], [3, 2], [8, 4]]) {
  test(`the maintained coverage runner caps native test workers at ${expected} on ${cores} available CPUs`, async t => {
    const root = workRoot(`coverage-concurrency-${cores}`);
    const put = (name, value) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value); };
    put("package.json", "{}");
    put("node_modules/nyc/package.json", JSON.stringify({ name: "nyc", version: "18.0.0" }));
    put("node_modules/nyc/bin/nyc.js", "");
    put("node_modules/@istanbuljs/esm-loader-hook/package.json", JSON.stringify({ name: "@istanbuljs/esm-loader-hook", version: "0.3.0", main: "index.js" }));
    put("node_modules/@istanbuljs/esm-loader-hook/index.js", "");
    const argv = process.argv;
    const exitCode = process.exitCode;
    let captured;
    t.mock.method(os, "availableParallelism", () => cores);
    t.mock.method(childProcess, "spawnSync", (_command, args, options) => { captured = { args, options }; return { status: 0 }; });
    syncBuiltinESMExports();
    try {
      process.argv = [process.execPath, "coverage.mjs", root];
      await import(`./coverage.mjs?cores=${cores}`);
      assert.equal(captured.args.includes(`--test-concurrency=${expected}`), true);
      assert.equal(captured.args.some(value => value.endsWith("evals/offline/__tests__/*.test.mjs")), true);
      assert.equal(captured.args.some(value => value.endsWith("scripts/test-skill-evals.cjs")), true);
      assert.equal(captured.args.includes("--nycrc-path"), true);
    } finally {
      process.argv = argv;
      process.exitCode = exitCode;
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });
}
