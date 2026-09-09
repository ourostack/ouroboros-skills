import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = path.resolve(process.argv[2] || path.join(repository, "plugins/desk/mcp"));
const require = createRequire(path.join(packageRoot, "package.json"));
const nyc = require.resolve("nyc/bin/nyc.js");
const hook = require.resolve("@istanbuljs/esm-loader-hook");
for (const [filename, version] of [[path.join(path.dirname(nyc), "../package.json"), "18.0.0"], [path.join(path.dirname(hook), "package.json"), "0.3.0"]]) {
  if (JSON.parse(readFileSync(filename)).version !== version) throw new Error(`Coverage requires the qualified maintained version ${version}`);
}
const temporary = path.join(repository, "evals/offline/.test-work/coverage/tool-work");
mkdirSync(temporary, { recursive: true });
const result = spawnSync(process.execPath, [
  nyc, "--cwd", repository, "--nycrc-path", path.join(repository, "evals/offline/nyc.json"),
  process.execPath, "--import", fileURLToPath(new URL("./helpers/register-coverage.mjs", import.meta.url)),
  "--test", path.join(repository, "evals/offline/__tests__/*.test.mjs"), path.join(repository, "scripts/test-skill-evals.cjs"),
], {
  cwd: packageRoot, stdio: "inherit",
  env: { ...process.env, OFFLINE_COVERAGE_PACKAGE_ROOT: packageRoot, NODE_PATH: [path.join(packageRoot, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(path.delimiter), TMPDIR: temporary },
});
process.exitCode = result.status ?? 1;
