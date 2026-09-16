import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const skillPath = path.join(repoRoot, "plugins", "desk", "skills", "content-routing", "SKILL.md")
const workerPath = path.join(repoRoot, "plugins", "desk", "agents", "worker.md")

test("content routing sends product contracts to the product repository", () => {
  const skill = readFileSync(skillPath, "utf8")
  const worker = readFileSync(workerPath, "utf8")

  assert.match(skill, /product repository/u)
  assert.match(
    skill,
    /behavior, interfaces, installation contracts, defaults, compatibility promises, and release rules/u,
  )
  assert.match(skill, /source, documentation, and executable tests/u)

  const productRule = skill.indexOf("Product-defining")
  const operatorRule = skill.indexOf("Specific to THIS operator")
  assert.ok(productRule >= 0, "the routing decision must name product-defining content")
  assert.ok(
    productRule < operatorRule,
    "product-defining content must be routed before operator-specific context is considered",
  )
  assert.match(worker, /product repository/u)
})
