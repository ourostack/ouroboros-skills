import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after } from "node:test";

export const repository = fileURLToPath(new URL("../../../../", import.meta.url));
export const dataRoot = join(repository, "evals/offline/cases/v2-alpha-v1");
export function workRoot(name) {
  const directory = join(repository, "evals/offline/.test-work", `${name}-${process.pid}`);
  mkdirSync(directory, { recursive: true });
  after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
