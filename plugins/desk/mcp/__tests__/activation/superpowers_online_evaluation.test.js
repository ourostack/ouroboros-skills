import { test } from "node:test"
import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const repoRoot = new URL("../../../../../", import.meta.url)
const read = (file) => readFileSync(new URL(file, repoRoot), "utf8")
const integration = () => read("plugins/desk/skills/superpowers-integration/SKILL.md")

test("selected-method integration invokes the named evaluation skill at the agreed horizon or request", () => {
  assert.match(integration(), /At an agreed evaluation endpoint or observation horizon, or for a requested work-item evaluation or retrospective, invoke `desk:online-evaluation` when it is present in the admitted selected-method composition\./u)
})

test("the evaluation trigger preserves absent-skill, disabled-recording and collection-authority boundaries", () => {
  const text = integration()
  assert.match(text, /Otherwise report evaluation unavailable\./u)
  assert.match(text, /Delegate ledger capability checks, recording-off behavior and storage authorization to that skill; invocation grants no collection consent or presumed ledger availability\./u)
  assert.match(text, /This is a trigger, not another engine, store or lifecycle\./u)
})

test("the packaged evaluation skill is the exact parent-approved body", () => {
  const body = readFileSync(new URL("plugins/desk/skills/online-evaluation/SKILL.md", repoRoot))
  assert.equal(createHash("sha256").update(body).digest("hex"), "06a6c36d0ca2873a5733048e6d715a094fecc6cf331b3f05c328746122f82fa3")
})
