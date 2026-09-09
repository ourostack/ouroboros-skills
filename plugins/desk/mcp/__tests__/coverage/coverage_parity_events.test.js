import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { assertCoverageCommandParity } from "../../src/coverage/gate.js"

test("another workflow event does not satisfy the required pull-request and push filters", t => {
  const root = mkdtempSync(path.join(tmpdir(), "desk-coverage-events-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const packageJsonPath = path.join(root, "package.json")
  const workflowPath = path.join(root, "workflow.yml")
  writeFileSync(packageJsonPath, JSON.stringify({
    scripts: { "test:coverage": "node scripts/run-coverage.js" },
  }))
  writeFileSync(workflowPath, [
    "on:",
    "  pull_request_target:",
    "    paths:",
    "      - scripts/*.cjs",
    "jobs:",
    "  tests:",
    "    steps:",
    "      - run: npm run test:coverage",
  ].join("\n"))

  const result = assertCoverageCommandParity({ packageJsonPath, workflowPath })
  assert.equal(result.ok, false)
  assert.deepEqual(result.issues, [
    "desk MCP CI pull_request.paths must include scripts/*.cjs",
    "desk MCP CI push.paths must include scripts/*.cjs",
  ])
})
