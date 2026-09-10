import { createRequire, register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const packageRoot = process.env.OFFLINE_COVERAGE_PACKAGE_ROOT || path.join(repository, "plugins/desk/mcp");
const require = createRequire(path.join(packageRoot, "package.json"));
const option = `--import=${import.meta.url}`;
if (!(process.env.NODE_OPTIONS || "").includes(option)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} ${option}`.trim();
register(pathToFileURL(require.resolve("@istanbuljs/esm-loader-hook")).href);
register(new URL("./coverage-format.mjs", import.meta.url), {
  data: { urls: ["src/agent/validators.ts", "src/context/scoped-read.ts", "src/types.ts"].map(filename => pathToFileURL(path.join(repository, "evals/offline/vendor/gauntlet", filename)).href) },
});
