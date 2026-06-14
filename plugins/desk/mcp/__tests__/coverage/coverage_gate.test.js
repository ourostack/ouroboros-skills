// Unit 0a: red tests for the coverage gate that protects new Desk MCP work.

import { test } from "node:test"
import { strict as assert } from "node:assert"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(
  fileURLToPath(new URL("../../../../..", import.meta.url)),
)
const mcpRoot = path.join(repoRoot, "plugins", "desk", "mcp")

async function loadGate() {
  return import(pathToFileURL(path.join(mcpRoot, "src", "coverage", "gate.js")))
}

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), "desk-coverage-gate-"))
}

function metrics({ lines = 100, branches = 100, functions = 100, statements = 100 } = {}) {
  return {
    lines: { pct: lines },
    branches: { pct: branches },
    functions: { pct: functions },
    statements: { pct: statements },
  }
}

function writeCoverageSummary(dir, entries) {
  const file = path.join(dir, "coverage-summary.json")
  writeFileSync(
    file,
    JSON.stringify({ total: metrics(), ...entries }, null, 2),
    "utf8",
  )
  return file
}

function writeFixture(dir, name, text) {
  const file = path.join(dir, name)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text, "utf8")
  return file
}

function normalizePaths(paths) {
  return [...paths].map((file) => file.replaceAll(path.sep, "/")).sort()
}

test("coverage gate reports a missing coverage report as a hard failure", async () => {
  const { evaluateCoverageReport } = await loadGate()
  const tmp = makeTempDir()
  try {
    const result = evaluateCoverageReport({
      repoRoot,
      reportPath: path.join(tmp, "missing-coverage-summary.json"),
      requiredFiles: ["plugins/desk/mcp/src/activation/schema.js"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    })

    assert.equal(result.ok, false)
    assert.match(result.issues.join("\n"), /coverage report.*missing/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage gate requires 100% coverage for new MCP source, MCP scripts, and root scripts", async () => {
  const { evaluateCoverageReport } = await loadGate()
  const tmp = makeTempDir()
  try {
    const coveredSource = "plugins/desk/mcp/src/activation/schema.js"
    const uncoveredSource = "plugins/desk/mcp/src/activation/validate.js"
    const coveredMcpScript = "plugins/desk/mcp/scripts/activation-support-matrix.js"
    const uncoveredRootScript = "scripts/validate-desk-activation.cjs"
    const reportPath = writeCoverageSummary(tmp, {
      [path.join(repoRoot, coveredSource)]: metrics(),
      [path.join(repoRoot, uncoveredSource)]: metrics({ lines: 99.99 }),
      [path.join(repoRoot, coveredMcpScript)]: metrics(),
      [path.join(repoRoot, uncoveredRootScript)]: metrics({ branches: 50 }),
    })

    const result = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles: [
        coveredSource,
        uncoveredSource,
        coveredMcpScript,
        uncoveredRootScript,
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    })

    assert.equal(result.ok, false)
    assert.deepEqual(result.checkedFiles.sort(), [
      coveredMcpScript,
      coveredSource,
      uncoveredRootScript,
      uncoveredSource,
    ].sort())
    assert.match(result.issues.join("\n"), /activation\/validate\.js.*lines.*99\.99/i)
    assert.match(result.issues.join("\n"), /validate-desk-activation\.cjs.*branches.*50/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage gate fails when a required new file is absent from the report", async () => {
  const { evaluateCoverageReport } = await loadGate()
  const tmp = makeTempDir()
  try {
    const reportPath = writeCoverageSummary(tmp, {
      [path.join(repoRoot, "plugins/desk/mcp/src/activation/schema.js")]: metrics(),
    })

    const result = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles: [
        "plugins/desk/mcp/src/activation/schema.js",
        "plugins/desk/mcp/src/activation/validate.js",
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    })

    assert.equal(result.ok, false)
    assert.match(result.issues.join("\n"), /missing coverage.*activation\/validate\.js/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage exclusions require an explicit owner and reason", async () => {
  const { evaluateCoverageReport } = await loadGate()
  const tmp = makeTempDir()
  try {
    const generatedFile = "plugins/desk/mcp/src/activation/generated-support-matrix.js"
    const reportPath = writeCoverageSummary(tmp, {})

    const allowed = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles: [generatedFile],
      exclusions: [
        {
          path: generatedFile,
          owner: "Unit 0 coverage gate",
          reason: "generated fixture intentionally verified by freshness tests",
        },
      ],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    })
    assert.equal(allowed.ok, true)
    assert.deepEqual(allowed.excludedFiles, [generatedFile])

    const undocumented = evaluateCoverageReport({
      repoRoot,
      reportPath,
      requiredFiles: [generatedFile],
      exclusions: [{ path: generatedFile }],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    })
    assert.equal(undocumented.ok, false)
    assert.match(undocumented.issues.join("\n"), /exclusion.*owner.*reason/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage command parity rejects CI/local drift", async () => {
  const { assertCoverageCommandParity } = await loadGate()
  const tmp = makeTempDir()
  try {
    const packageJsonPath = writeFixture(
      tmp,
      "package.json",
      JSON.stringify({
        scripts: {
          "test:coverage": "node scripts/run-coverage.js",
        },
      }, null, 2),
    )
    const goodWorkflowPath = writeFixture(
      tmp,
      "good.yml",
      [
        "jobs:",
        "  desk-mcp-tests:",
        "    steps:",
        "      - name: Run Desk MCP coverage",
        "        run: npm run test:coverage",
      ].join("\n"),
    )
    const badWorkflowPath = writeFixture(
      tmp,
      "bad.yml",
      [
        "jobs:",
        "  desk-mcp-tests:",
        "    steps:",
        "      - name: Run Desk MCP tests",
        "        run: npm test",
      ].join("\n"),
    )

    const good = assertCoverageCommandParity({ packageJsonPath, workflowPath: goodWorkflowPath })
    assert.equal(good.ok, true)

    const bad = assertCoverageCommandParity({ packageJsonPath, workflowPath: badWorkflowPath })
    assert.equal(bad.ok, false)
    assert.match(bad.issues.join("\n"), /test:coverage/i)
    assert.match(bad.issues.join("\n"), /npm test/i)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage required-file discovery includes production targets and excludes tests", async () => {
  const { collectCoverageRequiredFiles } = await loadGate()
  const tmp = makeTempDir()
  try {
    const fixtureRoot = path.join(tmp, "repo")
    const included = [
      "plugins/desk/mcp/src/activation/schema.js",
      "plugins/desk/mcp/src/activation/validate.js",
      "plugins/desk/mcp/scripts/activation-support-matrix.js",
      "scripts/validate-desk-activation.cjs",
    ]
    const excluded = [
      "plugins/desk/mcp/__tests__/coverage/coverage_gate.test.js",
      "plugins/desk/mcp/src/activation/validate.test.js",
      "plugins/desk/mcp/scripts/activation-support-matrix.test.js",
      "scripts/test-desk-activation.cjs",
    ]

    for (const file of [...included, ...excluded]) {
      writeFixture(fixtureRoot, file, "export {}\n")
    }

    assert.equal(typeof collectCoverageRequiredFiles, "function")
    assert.deepEqual(
      normalizePaths(collectCoverageRequiredFiles({ repoRoot: fixtureRoot })),
      included.sort(),
    )
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("coverage runner exists and delegates to the coverage gate", () => {
  const runnerPath = path.join(mcpRoot, "scripts", "run-coverage.js")

  assert.ok(
    existsSync(runnerPath),
    "scripts/run-coverage.js must exist as the non-recursive local coverage entrypoint",
  )

  const runner = readFileSync(runnerPath, "utf8")
  assert.match(
    runner,
    /(?:from\s+["'][^"']*src\/coverage\/gate\.js["']|import\([^)]*src\/coverage\/gate\.js[^)]*\))/,
    "coverage runner must import the coverage gate module",
  )
  assert.match(
    runner,
    /\bcollectCoverageRequiredFiles\s*\(/,
    "coverage runner must discover required files through the gate",
  )
  assert.match(
    runner,
    /\bevaluateCoverageReport\s*\(/,
    "coverage runner must evaluate the generated coverage report through the gate",
  )
  assert.match(
    runner,
    /\bassertCoverageCommandParity\s*\(/,
    "coverage runner must keep local and CI coverage commands in parity through the gate",
  )
  assert.doesNotMatch(
    runner,
    /\bnpm\s+(?:run\s+)?test:coverage\b/,
    "coverage runner must not recursively invoke npm run test:coverage",
  )
})

test("Desk MCP package exposes the local test:coverage command contract", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(mcpRoot, "package.json"), "utf8"),
  )

  assert.equal(
    packageJson.scripts?.["test:coverage"],
    "node scripts/run-coverage.js",
  )
})

test("Desk MCP CI uses the same local coverage command", () => {
  const workflow = readFileSync(
    path.join(repoRoot, ".github", "workflows", "desk-mcp-tests.yml"),
    "utf8",
  )

  assert.match(workflow, /npm run test:coverage/)
  assert.doesNotMatch(workflow, /run:\s*npm test\b/)
})
