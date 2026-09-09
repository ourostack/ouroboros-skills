import {
  readFileSync,
  writeFileSync,
} from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { selectEngineeringMethod } from "./validate.js"

export const COPILOT_BUNDLE_SCHEMA_VERSION = 1

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(moduleDir, "..", "..", "..", "..", "..")
const activationManifestPath = "plugins/desk/activation/desk.activation.json"
const deskPluginPath = "plugins/desk/plugin.json"
const plainLanguagePluginPath = "plugins/plain-language/plugin.json"
const ponytailPluginPath = "plugins/ponytail-upstream/plugin.json"
const outputPath = "plugins/desk/activation/copilot-root.flattened-bundle.json"
const generatorCommand =
  "npm --prefix plugins/desk/mcp run activation:copilot-bundle:generate"
const copilotWorkerSource = "agents/worker.agent.md"
const copilotMcpSource = "plugins/desk/.mcp.copilot.json"

export function buildCopilotBundle({ activation }) {
  const methodId = copilotMethod(activation)
  const methodPluginPath = `plugins/${methodId}/plugin.json`
  const methodDependency = activation.dependencies.find((dependency) => (
    dependency.id === methodId
  ))
  if (methodDependency === undefined) {
    throw new Error(`missing ${methodId === "superpowers" ? "Superpowers" : "Work Suite"} dependency in activation manifest`)
  }
  const plainLanguageDependency = activation.dependencies.find((dependency) => (
    dependency.id === "plain-language"
  ))
  const ponytailDependency = activation.dependencies.find((dependency) => (
    dependency.id === "ponytail-upstream"
  ))

  return {
    schema_version: COPILOT_BUNDLE_SCHEMA_VERSION,
    host: "copilot-root",
    generated_by: generatorCommand,
    generated_from: {
      activation_manifest: activationManifestPath,
      desk_plugin: deskPluginPath,
      [methodId === "superpowers" ? "superpowers_plugin" : "work_suite_plugin"]: methodPluginPath,
      plain_language_plugin: plainLanguagePluginPath,
      ponytail_plugin: ponytailPluginPath,
    },
    launch: {
      agent: `plugins/desk/${copilotWorkerSource}`,
      mcp: copilotMcpSource,
    },
    dependency_closure: [
      {
        id: "desk",
        version: activation.version,
        plugin: deskPluginPath,
        skills: "plugins/desk/skills/",
        agents: "plugins/desk/agents/",
        mcpServers: copilotMcpSource,
      },
      {
        id: methodId,
        version: methodDependency.lock.version,
        plugin: methodPluginPath,
        skills: `plugins/${methodId}/skills/`,
      },
      {
        id: "plain-language",
        version: plainLanguageDependency.lock.version,
        plugin: plainLanguagePluginPath,
        skills: "plugins/plain-language/skills/",
      },
      {
        id: "ponytail-upstream",
        version: ponytailDependency.lock.version,
        plugin: ponytailPluginPath,
        skills: "plugins/ponytail-upstream/skills/",
      },
    ],
    manual_steps: [],
  }
}

export function validateCopilotPackagingContract(input) {
  const errors = []
  const activation = asObject(input?.activation)
  const bundle = asObject(input?.bundle)
  const deskPlugin = asObject(input?.deskPlugin)
  let methodId
  try {
    methodId = copilotMethod(activation)
  } catch (error) {
    return [error.message]
  }
  const methodLabel = methodId === "superpowers" ? "Superpowers" : "Work Suite"
  const methodPlugin = asObject(input?.[methodId === "superpowers" ? "superpowersPlugin" : "workSuitePlugin"])
  const plainLanguagePlugin = asObject(input?.plainLanguagePlugin)
  const ponytailPlugin = asObject(input?.ponytailPlugin)
  const activationDependencies = Array.isArray(activation.dependencies)
    ? activation.dependencies
    : []
  const methodDependency = activationDependencies.find((dependency) => (
    dependency?.id === methodId
  ))
  const lockedMethodVersion = methodDependency?.lock?.version
  const plainLanguageDependency = activationDependencies.find((dependency) => (
    dependency?.id === "plain-language"
  ))
  const lockedPlainLanguageVersion = plainLanguageDependency?.lock?.version
  const ponytailDependency = activationDependencies.find((dependency) => (
    dependency?.id === "ponytail-upstream"
  ))
  const lockedPonytailVersion = ponytailDependency?.lock?.version

  if (deskPlugin.agents !== "./agents/") {
    errors.push("Copilot root plugin metadata must expose ./agents/")
  }
  if (deskPlugin.skills !== "./skills/") {
    errors.push("Copilot root plugin metadata must expose ./skills/")
  }
  if (deskPlugin.mcpServers !== "./.mcp.copilot.json") {
    errors.push("Copilot root plugin metadata must expose ./.mcp.copilot.json")
  }
  if (deskPlugin.version !== activation.version) {
    errors.push(`Copilot root Desk version must match activation version ${activation.version}`)
  }
  if (lockedMethodVersion === undefined) {
    errors.push(`Copilot activation must lock ${methodLabel} dependency`)
  } else if (methodPlugin.version !== lockedMethodVersion) {
    errors.push(`Copilot root ${methodLabel} version must match activation lock ${lockedMethodVersion}`)
  }
  if (!hasBundleDependency(bundle, methodId)) {
    errors.push(`Copilot flattened bundle must include ${methodId} dependency closure`)
  }
  if (methodId === "superpowers" && hasBundleDependency(bundle, "work-suite")) {
    errors.push("Copilot alpha bundle must not include Work Suite as a second lifecycle owner")
  }
  if (lockedPlainLanguageVersion === undefined) {
    errors.push("Copilot activation must lock Plain Language dependency")
  } else if (plainLanguagePlugin.version !== lockedPlainLanguageVersion) {
    errors.push(`Copilot root Plain Language version must match activation lock ${lockedPlainLanguageVersion}`)
  }
  if (!hasBundleDependency(bundle, "plain-language")) {
    errors.push("Copilot flattened bundle must include plain-language dependency closure")
  }
  if (lockedPonytailVersion === undefined) {
    errors.push("Copilot activation must lock Ponytail dependency")
  } else if (ponytailPlugin.version !== lockedPonytailVersion) {
    errors.push(`Copilot root Ponytail version must match activation lock ${lockedPonytailVersion}`)
  }
  if (!hasBundleDependency(bundle, "ponytail-upstream")) {
    errors.push("Copilot flattened bundle must include ponytail-upstream dependency closure")
  }
  if (
    deskPlugin.activation?.copilot?.dependencies?.[methodId]?.bundleMetadata
      !== outputPath
  ) {
    errors.push(`Copilot ${methodLabel} dependency must point to generated flattened bundle metadata`)
  }
  if (
    deskPlugin.activation?.copilot?.dependencies?.["plain-language"]?.bundleMetadata
      !== outputPath
  ) {
    errors.push("Copilot Plain Language dependency must point to generated flattened bundle metadata")
  }
  if (
    deskPlugin.activation?.copilot?.dependencies?.["ponytail-upstream"]?.bundleMetadata
      !== outputPath
  ) {
    errors.push("Copilot Ponytail dependency must point to generated flattened bundle metadata")
  }
  if (deskPlugin.activation?.copilot?.targets?.["desk:worker"]?.source !== copilotWorkerSource) {
    errors.push("Copilot desk:worker target must use agents/worker.agent.md")
  }

  return errors
}

function copilotMethod(activation) {
  const target = activation.provides?.activation_targets?.find((entry) => entry.id === "desk:worker")
  return selectEngineeringMethod(target?.depends_on ?? [])
}

export function generateCopilotBundleArtifact() {
  const activation = readJson(activationManifestPath)
  const bundle = buildCopilotBundle({ activation })
  writeFileSync(repoPath(outputPath), `${JSON.stringify(bundle, null, 2)}\n`, "utf8")
  return {
    outputPath,
    bundle,
  }
}

export function runCopilotBundleGenerator() {
  const result = generateCopilotBundleArtifact()
  process.stdout.write(`wrote ${result.outputPath}\n`)
  return 0
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(repoPath(relativePath), "utf8"))
}

function repoPath(relativePath) {
  return path.join(defaultRepoRoot, relativePath)
}

function asObject(value) {
  return value !== null && typeof value === "object" ? value : {}
}

function hasBundleDependency(bundle, id) {
  return Array.isArray(bundle.dependency_closure)
    && bundle.dependency_closure.some((entry) => entry?.id === id)
}
