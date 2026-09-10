import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { PassThrough } from "node:stream"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const validator = require("../../../../../scripts/test-desk-docs.cjs")

for (const name of [
  "validateHealthyPathLanguage", "validatePrivacyNotes", "validateTopicCoverage",
  "validateWorkflowWiring", "validateMcpReadmeToolSurface", "validateBrowserFocusPolicy",
  "validateValidatorFixtures",
]) {
  test(`${name} supports its omitted-options API against the actual maintained source`, () => {
    const errors = []
    validator[name](errors)
    assert.deepEqual(errors, [])
  })
}

test("default markdown parsing and fixture records retain their complete public shape", () => {
  const file = "plugins/desk/README.md"
  const source = readFileSync(fileURLToPath(new URL("../../../../../plugins/desk/README.md", import.meta.url)), "utf8")
  const records = validator.markdownLines(file)
  assert.equal(records.map((record) => record.text).join("\n"), source.replace(/\r\n/gu, "\n"))
  records.forEach((record, index) => {
    assert.equal(record.file, file)
    assert.equal(record.line, index + 1)
  })
  assert.deepEqual(validator.fixtureRecord("Read only"), {
    file: "fixture.md", line: 1, text: "Read only", lower: "read only", headingPath: [], inFence: false,
  })
})

test("the default docs runner uses ambient success and error streams without source changes", (t) => {
  const output = new PassThrough()
  const errors = new PassThrough()
  let stdout = ""
  let stderr = ""
  output.on("data", (chunk) => { stdout += chunk })
  errors.on("data", (chunk) => { stderr += chunk })
  const out = t.mock.getter(process, "stdout", () => output)
  const err = t.mock.getter(process, "stderr", () => errors)
  let success
  let failure
  try {
    success = validator.run()
    failure = validator.run({ readFile: () => "" })
  } finally {
    out.mock.restore()
    err.mock.restore()
  }
  assert.equal(success, 0)
  assert.equal(failure, 1)
  assert.equal(stdout, "Desk docs validation passed.\n")
  assert.ok(stderr.startsWith("Desk docs validation failed:\n"))
  assert.ok(stderr.includes(`plugins/desk/mcp/README.md must advertise ${validator.MCP_TOOL_NAMES.length} exposed tools`))
})
