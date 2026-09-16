import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(fileURLToPath(new URL("../../../../..", import.meta.url)))
const skillPath = path.join(repoRoot, "plugins", "desk", "skills", "content-routing", "SKILL.md")
const workerPaths = [
  "worker.md",
  "worker.agent.md",
  "worker.toml",
].map((file) => path.join(repoRoot, "plugins", "desk", "agents", file))

test("content routing sends product contracts to the product repository", () => {
  const skill = readFileSync(skillPath, "utf8")
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? ""

  assert.match(skill, /product repository/u)
  assert.match(
    skill,
    /behavior, interfaces, installation contracts, defaults, compatibility promises, and release rules/u,
  )
  assert.match(skill, /source, documentation, and executable tests/u)
  for (const trigger of [
    "behavior",
    "interfaces",
    "installation contracts",
    "defaults",
    "compatibility promises",
    "release rules",
  ]) {
    assert.match(frontmatter, new RegExp(trigger, "u"), `frontmatter must trigger on ${trigger}`)
  }

  const productRule = skill.indexOf("Product-defining")
  const operatorRule = skill.indexOf("Specific to THIS operator")
  const pluginRule = skill.indexOf("General — would a *different* operator")
  assert.ok(productRule >= 0, "the routing decision must name product-defining content")
  assert.ok(
    productRule < operatorRule,
    "product-defining content must be routed before operator-specific context is considered",
  )
  assert.ok(
    productRule < pluginRule,
    "product-defining content must be routed before general plugin placement is considered",
  )
  for (const workerPath of workerPaths) {
    assert.match(readFileSync(workerPath, "utf8"), /content-routing.*product repository/u)
  }
})
