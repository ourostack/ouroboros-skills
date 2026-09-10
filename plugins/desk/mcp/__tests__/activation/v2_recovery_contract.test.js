import { test } from "node:test"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"

const pluginRoot = new URL("../../../", import.meta.url)
const read = (relativePath) => readFileSync(new URL(relativePath, pluginRoot), "utf8")

for (const agent of ["agents/worker.md", "agents/worker.agent.md"]) {
  test(`${agent} binds long-running work to bounded process continuity`, () => {
    const source = read(agent)
    assert.match(source, /Long-lived work, bounded processes/u)
    assert.match(source, /session-resumption.*checkpoint|checkpoint.*session-resumption/u)
    assert.match(source, /process exit is not task completion/u)
  })
}

test("resumption preserves actual source and unfinished work before a handoff", () => {
  const source = read("skills/session-resumption/SKILL.md")
  assert.match(source, /## Checkpoint before handoff/u)
  for (const requirement of [
    /same work-item identity/u,
    /exact repository.*revisions/u,
    /uncommitted.*untracked/u,
    /local-only commits/u,
    /pending external side effects/u,
    /hashes.*read-back/u,
    /same-host.*not.*off-host/u,
  ]) assert.match(source, requirement)
})

test("recovery admission distinguishes owner release from stale process labels", () => {
  const source = read("skills/session-resumption/SKILL.md")
  assert.match(source, /## Fresh-process recovery/u)
  for (const requirement of [
    /process generation/u,
    /descendants/u,
    /before.*writer/u,
    /fresh process.*bounded handoff/u,
    /do not replay.*transcript/u,
    /reconcile.*external side effects/u,
    /missing, corrupt, stale/u,
  ]) assert.match(source, requirement)
})

test("the selected lifecycle checkpoints at real boundaries without creating a second owner", () => {
  const source = read("skills/superpowers-integration/SKILL.md")
  assert.match(source, /## Bounded execution and recovery/u)
  assert.match(source, /completed integration.*delegation/u)
  assert.match(source, /before.*unattended/u)
  assert.match(source, /compaction.*failure/u)
  assert.match(source, /outside.*worker process/u)
  assert.match(source, /two consecutive.*interruption.*recovery/u)
  assert.match(source, /session-resumption/u)
})

test("continuation does not require keeping an exhausted runtime alive", () => {
  const source = read("principles.md")
  assert.match(source, /Verified resource exhaustion is not a phantom limit/u)
  assert.match(source, /process handoff continues.*mandate/u)
  assert.match(source, /not permission to return control/u)
})
