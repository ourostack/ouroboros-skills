import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"

const pluginRoot = new URL("../../../", import.meta.url)
const read = path => readFileSync(new URL(path, pluginRoot), "utf8")

test("checkpoint admission binds a complete generation and preserves the previous one", () => {
  const source = read("skills/session-resumption/SKILL.md")
  for (const requirement of [
    /handoff manifest/u,
    /checkpoint generation/u,
    /storage.*before.*capture/u,
    /atomically.*ready/u,
    /previous complete generation/u,
    /current authority.*source.*ownership/u,
    /intervening.*source/u,
  ]) assert.match(source, requirement)
})

test("host recovery has bounded armed intent and requires observed work after launch", () => {
  const source = read("skills/superpowers-integration/SKILL.md")
  for (const requirement of [
    /armed.*disarmed/u,
    /persisted.*consecutive recoveries.*progress/u,
    /disarm.*intentional stop/u,
    /non-ready.*do not launch/u,
    /acknowledgement.*next.*step/u,
  ]) assert.match(source, requirement)
})

test("the recovery exercise cannot pass through two idle restarts", () => {
  const source = read("skills/superpowers-integration/SKILL.md")
  for (const requirement of [
    /graceful.*abrupt/u,
    /uncommitted.*external/u,
    /operation identity.*before.*issue/u,
    /read-back.*replay/u,
    /surviving.*writer/u,
  ]) assert.match(source, requirement)
})
