import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../../../", import.meta.url))
const expected = {
  id: "prime-radiant-inc-gauntlet-evaluation-leaves",
  repository: "prime-radiant-inc/gauntlet",
  commit: "187a9af979a7cf096c0890d0eeb998cc3008343a",
  license: "Apache-2.0",
  files: [
    { sourcePath: "LICENSE", generatedPath: "evals/offline/vendor/gauntlet/LICENSE", sha256: "bab74adbfbcdc79e08e43573584ef6e0bc067354e8306aa4128c245967ee549f" },
    { sourcePath: "src/agent/validators.ts", generatedPath: "evals/offline/vendor/gauntlet/src/agent/validators.ts", sha256: "618d14e3a42b4a68de30fcff7943da18db57c8ecc563e8f1ea08a7dda222df57" },
    { sourcePath: "src/context/scoped-read.ts", generatedPath: "evals/offline/vendor/gauntlet/src/context/scoped-read.ts", sha256: "009068020308d6078f5306e0c85ba904159fd315619d22b69dc0ba2a9804ef9b" },
    { sourcePath: "src/types.ts", generatedPath: "evals/offline/vendor/gauntlet/src/types.ts", sha256: "37d34c4f54dc1952be51a3711840fd03a08c3cc875b5639d8061be817bdb5391" },
  ],
}

test("the Gauntlet lock contains only the exact approved identity, pin, license and four-file entry", () => {
  const lock = JSON.parse(readFileSync(path.join(root, "upstream-sources.lock.json"), "utf8"))
  const gauntlet = lock.sources.filter((entry) => entry.repository === expected.repository || entry.id === expected.id)
  assert.deepEqual(gauntlet, [expected])
})

test("the vendored Gauntlet payload is exactly the four pristine locked files without logger, writer or provider code", () => {
  const vendorRoot = path.join(root, "evals/offline/vendor/gauntlet")
  const actual = readdirSync(vendorRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort()
  assert.deepEqual(actual, expected.files.map((file) => file.generatedPath).sort())
  for (const file of expected.files) {
    assert.equal(createHash("sha256").update(readFileSync(path.join(root, file.generatedPath))).digest("hex"), file.sha256, file.generatedPath)
  }
})
