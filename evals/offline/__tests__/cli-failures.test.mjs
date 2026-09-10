import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { repository } from "./helpers/paths.mjs";

const cli = path.join(repository, "scripts/skill-evals.cjs");
const preload = path.join(repository, "evals/offline/__tests__/helpers/cli-fault-preload.mjs");
for (const scenario of ["undefined-return", "invalid-return", "null-rejection", "undefined-rejection", "string-rejection", "zero-error-code", "large-error-code", "typed-error"]) {
  test(`the actual CJS boundary handles the explicit ${scenario} dependency fault`, () => {
    const result = spawnSync(process.execPath, ["--import", preload, cli, "offline", "help"], { cwd: repository, env: { ...process.env, OFFLINE_CLI_FAULT: scenario }, encoding: "utf8", timeout: 15000 });
    assert.equal(result.status, scenario === "typed-error" ? 2 : 3, result.stderr);
    const error = JSON.parse(result.stderr);
    assert.equal(error.kind, "offline_error");
    assert.equal(error.artifacts, scenario === "typed-error" ? "synthetic-artifact-reference" : null);
    if (scenario === "typed-error") assert.equal(error.status, "inconclusive");
  });
}
