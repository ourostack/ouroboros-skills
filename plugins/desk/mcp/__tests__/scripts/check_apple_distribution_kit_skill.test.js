import { strict as assert } from "node:assert"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const require = createRequire(import.meta.url)
const checker = require(path.join(repoRoot, "scripts", "check-apple-distribution-kit-skill.cjs"))

function withFixtureSkill(body, fn) {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "apple-distribution-kit-skill-"))
  const skillPath = path.join(tempRoot, "skills", "sign-apple-apps", "SKILL.md")
  mkdirSync(path.dirname(skillPath), { recursive: true })
  writeFileSync(skillPath, body, "utf8")
  try {
    return fn(tempRoot, skillPath)
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
}

function completeSkillBody() {
  return [
    "---",
    "name: sign-apple-apps",
    "description: fixture skill",
    "---",
    "# sign-apple-apps",
    ...checker.requiredNeedles,
    "",
  ].join("\n")
}

test("apple distribution kit skill checker accepts complete guidance", () => {
  withFixtureSkill(completeSkillBody(), (fixtureRoot, skillPath) => {
    const stdout = []
    const stderr = []

    assert.equal(checker.skillPathFor(fixtureRoot), skillPath)
    assert.equal(checker.readSkill(fixtureRoot), completeSkillBody())
    assert.deepEqual(checker.findMissingNeedles(checker.readSkill(fixtureRoot)), [])
    assert.equal(
      checker.checkAppleDistributionKitSkill({
        repoRoot: fixtureRoot,
        stdout: { write: (text) => stdout.push(text) },
        stderr: { write: (text) => stderr.push(text) },
      }),
      0,
    )
    assert.equal(stdout.join(""), "sign-apple-apps apple distribution kit guidance ok\n")
    assert.equal(stderr.join(""), "")
  })
})

test("apple distribution kit skill checker reports missing required guidance", () => {
  withFixtureSkill("apple-distribution-kit\n", (fixtureRoot) => {
    const stdout = []
    const stderr = []

    assert.deepEqual(
      checker.findMissingNeedles("apple-distribution-kit\n", [
        "apple-distribution-kit",
        "APP_STORE_CONNECT_PROVIDER_PUBLIC_ID",
      ]),
      ["APP_STORE_CONNECT_PROVIDER_PUBLIC_ID"],
    )
    assert.equal(
      checker.checkAppleDistributionKitSkill({
        repoRoot: fixtureRoot,
        stdout: { write: (text) => stdout.push(text) },
        stderr: { write: (text) => stderr.push(text) },
      }),
      1,
    )
    assert.equal(stdout.join(""), "")
    assert.match(stderr.join(""), /missing Apple distribution kit guidance/u)
    assert.match(stderr.join(""), /APP_STORE_CONNECT_PROVIDER_PUBLIC_ID/u)
  })
})

test("apple distribution kit skill checker exposes a CLI entrypoint", () => {
  const exitCodes = []

  checker.startCli({ isMain: false, setExitCode: (code) => exitCodes.push(code) })
  assert.deepEqual(exitCodes, [])

  checker.startCli({
    isMain: true,
    run: () => 7,
    setExitCode: (code) => exitCodes.push(code),
  })
  assert.deepEqual(exitCodes, [7])

  const previousExitCode = process.exitCode
  checker.startCli({ isMain: true, run: () => 0 })
  assert.equal(process.exitCode, 0)
  process.exitCode = previousExitCode
})
