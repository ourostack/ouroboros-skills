import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("src/retry-policy.mjs", "dist/retry-policy.mjs");
