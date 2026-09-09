import { readFileSync } from "node:fs"

export const packageMetadata = Object.freeze(JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
))
