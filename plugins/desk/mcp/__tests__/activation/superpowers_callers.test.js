import { test } from "node:test"
import { strict as assert } from "node:assert"
import { existsSync, readFileSync } from "node:fs"
import { materializeCodexActivation } from "../../src/activation/adapters/codex.js"

const repoRoot = new URL("../../../../../", import.meta.url)
const read = (relativePath) => readFileSync(new URL(relativePath, repoRoot), "utf8")
const json = (relativePath) => JSON.parse(read(relativePath))
const integration = "plugins/desk/skills/superpowers-integration/SKILL.md"

for (const file of [
  "plugins/desk/agents/worker.md",
  "plugins/desk/agents/worker.agent.md",
  "plugins/desk/agents/worker.toml",
  "plugins/desk/output-styles/worker.md",
]) {
  test(`${file} selects the sole method and independent-review contracts`, () => {
    const text = read(file)
    assert.match(text, /desk:superpowers-integration/u)
    assert.match(text, /desk:independent-review/u)
  })
}

const retiredWorkerDirectives = [
  ["plugins/desk/agents/worker.md", /Skills come from the Desk and Work Suite plugins/u],
  ["plugins/desk/agents/worker.md", /\*\*work-suite\*\* \(declared dep\)/u],
  ["plugins/desk/agents/worker.md", /Verify Desk, Work Suite, Plain Language/u],
  ["plugins/desk/agents/worker.md", /use `work-ideator` to agree/u],
  ["plugins/desk/agents/worker.md", /^\| `(?:work-ideator|work-planner|work-doer|work-merger|autopilot|stay-in-turn|inch-worm)` \|/mu],
  ["plugins/desk/agents/worker.agent.md", /Skills come from the Desk and Work Suite plugins/u],
  ["plugins/desk/agents/worker.agent.md", /\*\*work-suite\*\* \(declared dep\)/u],
  ["plugins/desk/agents/worker.agent.md", /Verify Desk, Work Suite, Plain Language/u],
  ["plugins/desk/agents/worker.agent.md", /use `work-ideator` to agree/u],
  ["plugins/desk/agents/worker.agent.md", /^\| `(?:work-ideator|work-planner|work-doer|work-merger|autopilot|stay-in-turn|inch-worm)` \|/mu],
  ["plugins/desk/agents/worker.toml", /The work-suite plugin registers risk-scaled workflow skills/u],
  ["plugins/desk/agents/worker.toml", /^- `work-ideator`, `work-planner`, `work-doer`, `work-merger`/mu],
  ["plugins/desk/output-styles/worker.md", /dispatches to desk \+ work-suite skills/u],
  ["plugins/desk/output-styles/worker.md", /risk-scaled workflow skills come from \*\*work-suite\*\*/u],
  ["plugins/desk/output-styles/worker.md", /Clear work can go directly to `work-doer` and `work-merger`/u],
]
for (const [file, directive] of retiredWorkerDirectives) {
  test(`${file} removes its specific retired directive ${directive.source}`, () => {
    assert.doesNotMatch(read(file), directive)
  })
}

for (const [file, retiredDirective] of [
  ["plugins/desk/skills/work-orchestration/SKILL.md", /New engineering work enters `work-ideator`|`work-doer` → `work-merger`/u],
  ["plugins/desk/skills/task-lifecycle/SKILL.md", /otherwise establish the missing agreement through `work-ideator`|Work-doer decides its own dispatch/u],
  ["plugins/desk/skills/start-task/SKILL.md", /explicit go-ahead through `work-ideator`/u],
  ["plugins/desk/skills/session-resumption/SKILL.md", /dispatch `work-doer`|Resume `work-merger`/u],
  ["plugins/desk/skills/codex-onboarding/SKILL.md", /`work-suite@<marketplace-name>` enabled|Desk and Work Suite are installed/u],
]) {
  test(`${file} routes active choreography through the alpha integration contract`, () => {
    const text = read(file)
    assert.match(text, /desk:superpowers-integration/u)
    assert.doesNotMatch(text, retiredDirective)
  })
}

for (const mode of ["global-personal", "project-local"]) {
  test(`${mode} owned instructions contain no active retired lifecycle dispatch`, () => {
    const golden = read(`plugins/desk/mcp/__tests__/fixtures/activation/codex/${mode}/generated-instructions.md`)
    const owned = golden.split("# BEGIN desk activation:")[1]?.split("# END desk activation")[0]
    assert.ok(owned)
    assert.doesNotMatch(owned, /\b(?:use|invoke|run|dispatch to)\s+(?:the\s+)?(?:Work Suite(?: skills)?|`?work-(?:ideator|planner|doer|merger))/iu)
  })
  test(`the ${mode} owned block and golden fixture select the same alpha lifecycle`, () => {
    const input = {
      manifest: json("plugins/desk/activation/desk.activation.json"),
      mode,
      existingConfig: '# user-authored Codex config\nmodel = "gpt-5.4"\napproval_policy = "on-request"\n',
      existingInstructions: "# user-authored Codex guidance\nKeep repo-local rules intact.\n",
      pluginRoot: "plugins/desk",
      deskRoot: mode === "project-local" ? ".desk" : "~/desk",
      runtimeCacheDir: mode === "project-local" ? ".codex/desk-runtime-cache" : "~/.cache/ouroboros-skills/desk",
    }
    const rendered = materializeCodexActivation(input).generatedInstructions
    const golden = read(`plugins/desk/mcp/__tests__/fixtures/activation/codex/${mode}/generated-instructions.md`)
    assert.equal(golden, rendered)
    assert.match(golden, /Selected engineering lifecycle: Superpowers\./u)
    assert.match(golden, /desk:superpowers-integration/u)
    assert.match(golden, /desk:independent-review/u)
  })
}

test("activation background disclosure names the selected provider without upgrading unsupported capability", () => {
  const background = json("plugins/desk/activation/desk.activation.json").host_activation.claude.backgroundSessionInheritance
  assert.equal(background.status, "unsupported")
  assert.equal(background.inheritsPluginContext, false)
  assert.match(background.reason, /Superpowers/u)
  assert.doesNotMatch(background.reason, /Work Suite skills/u)
})

test("the technical preview guide preflights selected source paths rather than retired lifecycle skills", () => {
  const guide = read("AGENTIC-ENGINEERING-V2.md")
  const current = guide.split("## Roll back without moving your desk")[0]
  assert.match(current, /plugins\/superpowers\/skills\//u)
  assert.match(current, /desk:superpowers-integration/u)
  assert.doesNotMatch(current, /Require the enabled Work Suite skills|copilot plugin install work-suite@/u)
  assert.doesNotMatch(guide.split("## The proposal")[0], /interactive RFC/iu)
  assert.doesNotMatch(read("README.md").split("\n").slice(0, 10).join("\n"), /interactive RFC/iu)
})

test("catalog metadata selects Superpowers while explicitly retaining Work Suite as legacy", () => {
  const catalog = json(".claude-plugin/marketplace.json")
  assert.match(catalog.metadata.description, /Superpowers/u)
  assert.doesNotMatch(catalog.metadata.description, /Work Suite routes work/u)
  assert.equal(catalog.plugins.find((plugin) => plugin.name === "superpowers")?.source, "./plugins/superpowers")
  const legacy = catalog.plugins.find((plugin) => plugin.name === "work-suite")
  assert.ok(legacy, "the legacy Work Suite marketplace entry must remain present")
  assert.equal(legacy.source, "./plugins/work-suite")
  assert.match(legacy.description, /legacy/iu)
})

test("the independent-review skill ships with valid named frontmatter", () => {
  const file = "plugins/desk/skills/independent-review/SKILL.md"
  assert.ok(existsSync(new URL(file, repoRoot)), `${file} must ship`)
  const frontmatter = read(file).match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  assert.ok(frontmatter, "independent-review must have YAML frontmatter")
  assert.match(frontmatter[1], /^name: independent-review$/mu)
  assert.match(frontmatter[1], /^description: .+$/mu)
})

test("integration preserves prior approval, delegation, alpha endpoint and a single remediation owner", () => {
  const contract = read(integration)
  for (const invariant of [
    "Prior approval remains valid; do not reopen it without a scope change.",
    "Delegation remains limited by the recorded authority.",
    "An intentional alpha or PR-only delivery endpoint does not authorize main promotion.",
    "One implementation owner handles all remediation and re-review findings.",
  ]) {
    assert.ok(contract.includes(invariant), `missing integration invariant: ${invariant}`)
  }
})

const successors = [
  ["work-ideator", "superpowers:brainstorming"],
  ["work-planner", "superpowers:writing-plans"],
  ["work-doer", "superpowers:subagent-driven-development"],
  ["work-merger", "superpowers:verification-before-completion"],
  ["autopilot", "native continuation"],
  ["stay-in-turn", "native notifications"],
  ["inch-worm", "approved backlog"],
  ["watchdog-mode", "native monitoring"],
  ["visual-qa-dogfood", "screenshots"],
  ["deep-research", "firsthand evidence"],
]

for (const [retired, successor] of successors) {
  test(`retired capability ${retired} has a named successor, not a second lifecycle dependency`, () => {
    const row = read(integration).split("\n").find((line) => line.startsWith(`| \`${retired}\` |`))
    assert.ok(row, `missing capability disposition for ${retired}`)
    assert.ok(row.includes(successor), `${retired} must name ${successor}`)
  })
}

for (const [retired, owner, requiredLimit] of [
  ["autopilot", "superpowers:executing-plans", "host continuation"],
  ["stay-in-turn", "superpowers:executing-plans", "host wait tools"],
  ["inch-worm", "desk:start-task", "approved backlog"],
  ["watchdog-mode", "desk:runtime-symptom-investigation", "persistent monitoring is not bundled"],
  ["visual-qa-dogfood", "superpowers:verification-before-completion", "visual tools"],
  ["deep-research", "superpowers:brainstorming", "exhaustive research requires a consumer-provided entrypoint"],
]) {
  test(`${retired} discloses its owning entrypoint, conditional capability and unproven runtime status`, () => {
    const row = read(integration).split("\n").find((line) => line.startsWith(`| \`${retired}\` |`))
    assert.ok(row)
    assert.ok(row.includes(`Owner: \`${owner}\``), `${retired} must identify its actual owning entrypoint`)
    assert.ok(row.includes("Capability: conditional"), `${retired} must not imply unconditional availability`)
    assert.ok(row.includes("Proof: runtime qualification required"), `${retired} must not treat source characterization as consumption proof`)
    assert.ok(row.includes(requiredLimit), `${retired} must disclose its material capability limit`)
    const [plugin, skill] = owner.split(":")
    assert.ok(existsSync(new URL(`plugins/${plugin}/skills/${skill}/SKILL.md`, repoRoot)), `${owner} must be a shipped skill, not an invented entrypoint`)
  })
}
