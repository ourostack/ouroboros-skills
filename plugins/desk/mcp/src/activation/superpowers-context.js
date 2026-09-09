import * as path from "node:path"
import { stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { expandHome, isPathContained, personPrefix, resolveWriteTarget } from "../util/paths.js"

function requiredPath(input, name) {
  const value = input[name]
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Superpowers context: ${name} is required`)
  }
  return path.resolve(expandHome(value))
}

async function canonicalFile(deskRoot, person, file, kind) {
  const root = personPrefix(deskRoot, person)
  const target = await resolveWriteTarget({
    deskRoot,
    person,
    segments: path.relative(root, file).split(path.sep),
    createPersonRoot: false,
  })
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if (error.code !== "ENOENT") throw error
    throw new Error(`Superpowers context: canonical ${kind} does not exist: ${target}`)
  }
  if (!info.isFile()) {
    throw new Error(`Superpowers context: canonical ${kind} must be a regular file: ${target}`)
  }
  return target
}

export async function resolveSuperpowersContext(input) {
  const deskRoot = requiredPath(input, "deskRoot")
  const taskPath = requiredPath(input, "taskPath")
  const iterationPath = requiredPath(input, "iterationPath")
  const planPath = requiredPath(input, "planPath")
  const evidenceRoot = requiredPath(input, "evidenceRoot")
  const person = input.person ?? null
  for (const name of ["step", "attempt"]) {
    if (!Number.isInteger(input[name]) || input[name] < 1) {
      throw new Error(`Superpowers context: ${name} must be a positive integer`)
    }
  }
  if (!isPathContained(personPrefix(deskRoot, person), taskPath)) {
    throw new Error("Superpowers context: taskPath must be within the effective Desk scope")
  }
  if (!isPathContained(taskPath, iterationPath)) {
    throw new Error("Superpowers context: iterationPath must be within taskPath")
  }
  if (!isPathContained(deskRoot, planPath)) {
    throw new Error("Superpowers context: planPath must be within Desk")
  }
  if (isPathContained(deskRoot, evidenceRoot)) {
    throw new Error("Superpowers context: evidenceRoot must be outside Desk")
  }
  const taskCardPath = await canonicalFile(deskRoot, person, path.join(taskPath, "task.md"), "task card")
  const progressPath = await canonicalFile(deskRoot, person, path.join(iterationPath, "doing.md"), "progress")
  // A plan is a read reference and may live outside the person prefix, but must remain within this Desk root.
  const canonicalPlan = await canonicalFile(deskRoot, null, planPath, "plan")
  const artifactDirectory = path.join(evidenceRoot, path.relative(deskRoot, iterationPath), "superpowers", `step-${input.step}`, `attempt-${input.attempt}`)
  return {
    taskCardPath,
    iterationPath,
    planPath: canonicalPlan,
    progressPath,
    rulingsPath: progressPath,
    artifactDirectory,
    briefPath: path.join(artifactDirectory, "brief.md"),
    implementationReportPath: path.join(artifactDirectory, "implementation-report.md"),
    reviewPackagePath: path.join(artifactDirectory, "review.patch"),
    reviewReportPath: path.join(artifactDirectory, "review-report.md"),
    cleanupPaths: [],
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const names = {
      "--desk-root": "deskRoot",
      "--person": "person",
      "--task-path": "taskPath",
      "--iteration-path": "iterationPath",
      "--plan-path": "planPath",
      "--evidence-root": "evidenceRoot",
      "--step": "step",
      "--attempt": "attempt",
    }
    const input = {}
    for (let index = 2; index < process.argv.length; index += 2) {
      const flag = process.argv[index]
      if (!Object.hasOwn(names, flag)) throw new Error(`Superpowers context: unknown argument ${flag}`)
      const name = names[flag]
      const value = process.argv[index + 1]
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Superpowers context: value required for ${flag}`)
      }
      input[name] = name === "step" || name === "attempt" ? Number(value) : value
    }
    process.stdout.write(`${JSON.stringify(await resolveSuperpowersContext(input))}\n`)
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
