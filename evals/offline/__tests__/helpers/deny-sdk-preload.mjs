import { createRequire, register } from "node:module";

createRequire(import.meta.url)("./deny-sdk.cjs");
register("./deny-sdk-loader.mjs", import.meta.url);
