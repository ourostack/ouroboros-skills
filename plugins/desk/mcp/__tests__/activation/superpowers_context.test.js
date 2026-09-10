import { test, beforeEach, afterEach } from "node:test"
import { strict as assert } from "node:assert"
import * as path from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolveWriteTarget } from "../../src/util/paths.js"

let fixtureRoot
beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "superpowers-context-"))
  mkdirSync(path.join(fixtureRoot, "desk", "desks", "member"), { recursive: true })
  seedCanonicalFiles(context())
})
afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }))

async function loadResolver() {
  const { resolveSuperpowersContext } = await import("../../src/activation/superpowers-context.js")
  return resolveSuperpowersContext
}

async function resolve(input) {
  const before = snapshotTree()
  try {
    return await (await loadResolver())(input)
  } finally {
    assert.deepEqual(snapshotTree(), before, "context resolution must preserve the complete existing tree and file bytes")
  }
}

function snapshotTree() {
  return readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name)
      return [path.relative(fixtureRoot, file), entry.isDirectory() ? null : readFileSync(file)]
    })
    .sort(([left], [right]) => left.localeCompare(right))
}

function seedCanonicalFiles(input) {
  for (const [file, bytes] of [
    [path.join(input.taskPath, "task.md"), `---\ntitle: ${path.basename(input.taskPath)}\nstatus: doing\n---\n`],
    [input.planPath, "# Fixture plan\n\nPreserve the approved fixture scope.\n"],
    [path.join(input.iterationPath, "doing.md"), "# Fixture progress\n\nRetain the recorded ruling.\n"],
  ]) {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
}

function context(overrides = {}) {
  const deskRoot = path.join(fixtureRoot, "desk")
  const taskPath = path.join(deskRoot, "desks", "member", "track", "outcome")
  const iterationPath = path.join(taskPath, "repository", "2026-09-09-initial-impl")
  return {
    deskRoot,
    person: "member",
    taskPath,
    iterationPath,
    planPath: path.join(iterationPath, "planning.md"),
    evidenceRoot: path.join(fixtureRoot, "protected-evidence"),
    step: 1,
    attempt: 1,
    ...overrides,
  }
}

test("Superpowers context prints exact paths without introducing a second progress or ruling store", async () => {
  const input = context()
  const output = await resolve(input)
  const artifactDirectory = path.join(input.evidenceRoot, path.relative(input.deskRoot, input.iterationPath), "superpowers", "step-1", "attempt-1")
  assert.deepEqual(output, {
    taskCardPath: path.join(input.taskPath, "task.md"),
    iterationPath: input.iterationPath,
    planPath: input.planPath,
    progressPath: path.join(input.iterationPath, "doing.md"),
    rulingsPath: path.join(input.iterationPath, "doing.md"),
    artifactDirectory,
    briefPath: path.join(artifactDirectory, "brief.md"),
    implementationReportPath: path.join(artifactDirectory, "implementation-report.md"),
    reviewPackagePath: path.join(artifactDirectory, "review.patch"),
    reviewReportPath: path.join(artifactDirectory, "review-report.md"),
    cleanupPaths: [],
  })
  assert.equal(JSON.stringify(output).includes(".superpowers"), false)
})

test("same-basename planning files in different tasks never share artifacts", async () => {
  const first = context()
  const taskPath = path.join(first.deskRoot, "desks", "member", "track", "other-outcome")
  const iterationPath = path.join(taskPath, "repository", "2026-09-09-initial-impl")
  const second = context({ taskPath, iterationPath, planPath: path.join(iterationPath, "planning.md") })
  seedCanonicalFiles(second)
  const left = await resolve(first)
  const right = await resolve(second)
  assert.equal(path.basename(left.planPath), path.basename(right.planPath))
  assert.notEqual(left.artifactDirectory, right.artifactDirectory)
  assert.notEqual(left.progressPath, right.progressPath)
})

test("different iterations of one task retain distinct same-basename plans and evidence", async () => {
  const first = context()
  const iterationPath = path.join(first.taskPath, "repository", "2026-09-09-review-pass-1")
  const second = context({ iterationPath, planPath: path.join(iterationPath, "planning.md") })
  seedCanonicalFiles(second)
  assert.notEqual((await resolve(first)).artifactDirectory, (await resolve(second)).artifactDirectory)
})

test("interruption recovery keeps canonical progress and preserves the earlier attempt's evidence", async () => {
  const input = context()
  const priorDirectory = path.join(input.evidenceRoot, path.relative(input.deskRoot, input.iterationPath), "superpowers", "step-1", "attempt-1")
  mkdirSync(priorDirectory, { recursive: true })
  writeFileSync(path.join(priorDirectory, "implementation-report.md"), "Preserved earlier attempt.\n")
  const first = await resolve(input)
  assert.deepEqual(await resolve(context()), first)
  const resumed = await resolve(context({ attempt: 2 }))
  assert.equal(resumed.progressPath, first.progressPath)
  assert.equal(resumed.rulingsPath, first.rulingsPath)
  assert.notEqual(resumed.artifactDirectory, first.artifactDirectory)
  assert.deepEqual(resumed.cleanupPaths, [])
})

test("an explicit cross-repository Desk plan is preserved rather than rebound by basename", async () => {
  const input = context()
  input.planPath = path.join(input.deskRoot, "desks", "member", "track", "_planning", "planning.md")
  seedCanonicalFiles(input)
  assert.equal((await resolve(input)).planPath, input.planPath)
})

for (const [label, overrides, message] of [
  ["missing protected-evidence root", { evidenceRoot: undefined }, "Superpowers context: evidenceRoot is required"],
  ["invalid step", { step: 0 }, "Superpowers context: step must be a positive integer"],
  ["invalid attempt", { attempt: 0 }, "Superpowers context: attempt must be a positive integer"],
  ["task outside Desk", { taskPath: path.join(tmpdir(), "outside-task") }, "Superpowers context: taskPath must be within the effective Desk scope"],
  ["iteration outside task", { iterationPath: path.join(tmpdir(), "outside-iteration") }, "Superpowers context: iterationPath must be within taskPath"],
  ["plan outside Desk", { planPath: path.join(tmpdir(), "outside-plan.md") }, "Superpowers context: planPath must be within Desk"],
]) {
  test(`context fails closed for ${label}`, async () => {
    const resolveContext = await loadResolver()
    await assert.rejects(() => resolveContext(context(overrides)), { message })
  })
}

test("operational evidence is never mapped into the git-backed Desk", async () => {
  const input = context()
  input.evidenceRoot = path.join(input.deskRoot, "_private-looking-but-tracked")
  const resolveContext = await loadResolver()
  await assert.rejects(() => resolveContext(input), { message: "Superpowers context: evidenceRoot must be outside Desk" })
})

test("context canonical paths agree with existing Desk write-target authority", async () => {
  const input = context()
  const output = await resolve(input)
  const shared = { deskRoot: input.deskRoot, person: input.person, createPersonRoot: false }
  assert.equal(output.taskCardPath, await resolveWriteTarget({ ...shared, segments: ["track", "outcome", "task.md"] }))
  assert.equal(output.planPath, await resolveWriteTarget({ ...shared, segments: ["track", "outcome", "repository", "2026-09-09-initial-impl", "planning.md"] }))
  assert.equal(output.progressPath, await resolveWriteTarget({ ...shared, segments: ["track", "outcome", "repository", "2026-09-09-initial-impl", "doing.md"] }))
  assert.equal(existsSync(input.evidenceRoot), false)
  assert.equal(existsSync(input.taskPath), true)
})

for (const [label, kind, canonicalPath] of [
  ["task.md", "task card", (input) => path.join(input.taskPath, "task.md")],
  ["planning.md", "plan", (input) => input.planPath],
  ["doing.md", "progress", (input) => path.join(input.iterationPath, "doing.md")],
]) {
  test(`context refuses missing canonical ${label} without modifying remaining files`, async () => {
    const input = context()
    const missing = canonicalPath(input)
    rmSync(missing)
    const before = snapshotTree()
    const resolveContext = await loadResolver()
    await assert.rejects(() => resolveContext(input), { message: `Superpowers context: canonical ${kind} does not exist: ${missing}` })
    assert.deepEqual(snapshotTree(), before)
    assert.equal(existsSync(missing), false)
    assert.equal(existsSync(input.evidenceRoot), false)
  })
}

test("context refuses a directory in place of a canonical file", async () => {
  const input = context()
  const notFile = path.join(input.iterationPath, "doing.md")
  rmSync(notFile)
  mkdirSync(notFile)
  const before = snapshotTree()
  const resolveContext = await loadResolver()
  await assert.rejects(() => resolveContext(input), { message: `Superpowers context: canonical progress must be a regular file: ${notFile}` })
  assert.deepEqual(snapshotTree(), before)
  assert.equal(existsSync(input.evidenceRoot), false)
})

test("context refuses a missing person root without provisioning it", async () => {
  const input = context()
  const personRoot = path.join(input.deskRoot, "desks", "member")
  rmSync(personRoot, { recursive: true })
  const resolveContext = await loadResolver()
  await assert.rejects(() => resolveContext(input), { message: `desk-mcp: effective write root does not exist: ${personRoot}` })
  assert.equal(existsSync(personRoot), false)
})

test("context rejects a different person's task instead of broadening write authority", async () => {
  const input = context({ person: "other" })
  const resolveContext = await loadResolver()
  await assert.rejects(() => resolveContext(input), { message: "Superpowers context: taskPath must be within the effective Desk scope" })
})

test("person-off context retains the ordinary Desk path authority", async () => {
  const input = context({ person: null })
  input.taskPath = path.join(input.deskRoot, "track", "outcome")
  input.iterationPath = path.join(input.taskPath, "repository", "2026-09-09-initial-impl")
  input.planPath = path.join(input.iterationPath, "planning.md")
  seedCanonicalFiles(input)
  const output = await resolve(input)
  assert.equal(output.taskCardPath, await resolveWriteTarget({
    deskRoot: input.deskRoot,
    person: null,
    createPersonRoot: false,
    segments: ["track", "outcome", "task.md"],
  }))
})

function commandArgs(input) {
  const helper = fileURLToPath(new URL("../../src/activation/superpowers-context.js", import.meta.url))
  return [
    helper,
    "--desk-root", input.deskRoot,
    "--person", input.person,
    "--task-path", input.taskPath,
    "--iteration-path", input.iterationPath,
    "--plan-path", input.planPath,
    "--evidence-root", input.evidenceRoot,
    "--step", "1",
    "--attempt", "1",
  ]
}

function runCommand(args) {
  return spawnSync(process.execPath, args, {
    cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
    encoding: "utf8",
  })
}

test("the read-only helper emits the exact bound paths through its command interface", async () => {
  const input = context()
  const before = snapshotTree()
  const result = runCommand(commandArgs(input))
  assert.deepEqual(snapshotTree(), before, "CLI resolution must preserve canonical bytes and create no evidence")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), await resolve(input))
})

test("CLI missing evidence root fails with its own diagnostic and no partial output or writes", () => {
  const args = commandArgs(context())
  args.splice(args.indexOf("--evidence-root"), 2)
  const before = snapshotTree()
  const result = runCommand(args)
  assert.deepEqual(snapshotTree(), before)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr.trim(), "Superpowers context: evidenceRoot is required")
})

test("CLI unknown option fails with its own diagnostic and no partial output or writes", () => {
  const before = snapshotTree()
  const result = runCommand([...commandArgs(context()), "--unexpected"])
  assert.deepEqual(snapshotTree(), before)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr.trim(), "Superpowers context: unknown argument --unexpected")
})
