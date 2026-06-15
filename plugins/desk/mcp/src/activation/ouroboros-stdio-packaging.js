const OUROBOROS_HOST = "ouroboros-autonomous-agent"
const GENERIC_STDIO_HOST = "generic-stdio"
const REQUIRED_OUROBOROS_CAPABILITIES = ["agents", "skills", "mcp"]
const REQUIRED_OUROBOROS_BUNDLE_SOURCES = [
  "plugins/desk/plugin.json",
  "plugins/work-suite/plugin.json",
]
const GENERIC_STDIO_UNSUPPORTED = [
  "agent-defaults",
  "plugin-dependency-resolution",
]
const REQUIRED_GENERIC_STDIO_EVIDENCE_SOURCES = [
  "plugins/desk/.mcp.json",
  "plugins/desk/mcp/README.md",
  "plugins/desk/activation/README.md",
]

export function validateOuroborosStdioPackagingContract(input) {
  const errors = []
  validateOuroborosHost({
    host: findHostSupport(input, OUROBOROS_HOST),
    evidence: findEvidenceRow(input, OUROBOROS_HOST),
    readmeSection: input?.ouroborosReadmeSection ?? "",
  }, errors)
  validateGenericStdioHost({
    host: findHostSupport(input, GENERIC_STDIO_HOST),
    evidence: findEvidenceRow(input, GENERIC_STDIO_HOST),
    readmeSection: input?.genericStdioReadmeSection ?? "",
    activationSection: input?.genericStdioActivationSection ?? "",
  }, errors)
  return errors
}

function validateOuroborosHost({ host, evidence, readmeSection }, errors) {
  if (host === undefined) {
    errors.push("Ouroboros host support row is required")
  } else {
    if (host.dependency_resolution !== "flattened") {
      errors.push("Ouroboros host support must use flattened dependency resolution")
    }
    if (!includesAll(host.capabilities, REQUIRED_OUROBOROS_CAPABILITIES)) {
      errors.push("Ouroboros host support must expose agents, skills, and mcp")
    }
    if (!arrayIncludes(host.unsupported_primitives, "host-native-plugin-install")) {
      errors.push("Ouroboros host support must mark host-native-plugin-install unsupported")
    }
  }

  if (evidence === undefined) {
    errors.push("Ouroboros evidence row is required")
  } else {
    if (evidence.disposition !== "supported-flattened") {
      errors.push("Ouroboros evidence must record supported-flattened disposition")
    }
    if (!includesAll(evidence.source_paths, REQUIRED_OUROBOROS_BUNDLE_SOURCES)) {
      errors.push("Ouroboros evidence must reference bundle metadata sources")
    }
    if (!arrayIncludes(evidence.unsupported_primitives, "host-native-plugin-install")) {
      errors.push("Ouroboros evidence must mark host-native-plugin-install unsupported")
    }
    const fallbackBehavior = evidence.fallback_behavior ?? ""
    if (!/bundle Desk \+ Work Suite/u.test(fallbackBehavior)) {
      errors.push("Ouroboros evidence fallback must describe bundled Desk and Work Suite")
    }
    if (!/\$DESK/u.test(fallbackBehavior)) {
      errors.push("Ouroboros evidence fallback must describe $DESK binding")
    }
  }

  if (!readmeSection.includes("bundle.json")) {
    errors.push("Ouroboros docs must define bundle.json plugin metadata")
  }
  const bundleMetadata = readBundleMetadata(readmeSection)
  if (bundleMetadata.invalidJson) {
    errors.push("Ouroboros bundle metadata must be valid JSON")
  } else {
    if (!bundleMetadata.plugins.includes("desk")) {
      errors.push("Ouroboros bundle metadata must include desk plugin")
    }
    if (!bundleMetadata.plugins.includes("work-suite")) {
      errors.push("Ouroboros bundle metadata must include work-suite plugin")
    }
  }
  if (!/\$DESK\s*=\s*~\/AgentBundles\/<agent>\.ouro\/desk\//u.test(readmeSection)) {
    errors.push("Ouroboros preamble must bind $DESK to ~/AgentBundles/<agent>.ouro/desk/")
  }
  if (/npm install/u.test(readmeSection)) {
    errors.push("Ouroboros healthy path must not require npm install")
  }
}

function validateGenericStdioHost({ host, evidence, readmeSection, activationSection }, errors) {
  if (host === undefined) {
    errors.push("Generic stdio host support row is required")
  } else {
    if (host.status !== "degraded") {
      errors.push("Generic stdio host support must be degraded")
    }
    if (host.dependency_resolution !== "manual-host") {
      errors.push("Generic stdio host support must use manual-host dependency resolution")
    }
    if (!sameList(host.capabilities, ["mcp"])) {
      errors.push("Generic stdio host support must expose MCP only")
    }
    if (!arrayIncludes(host.unsupported_primitives, GENERIC_STDIO_UNSUPPORTED[0])) {
      errors.push("Generic stdio host support must mark agent-defaults unsupported")
    }
    if (!arrayIncludes(host.unsupported_primitives, GENERIC_STDIO_UNSUPPORTED[1])) {
      errors.push("Generic stdio host support must mark plugin-dependency-resolution unsupported")
    }
    const fallbackBehavior = host.fallback_behavior ?? ""
    if (!/no worker activation/u.test(fallbackBehavior)) {
      errors.push("Generic stdio fallback must state no worker activation")
    } else {
      if (claimsGenericStdioWorkerActivation(fallbackBehavior)) {
        errors.push("Generic stdio fallback must not claim worker activation")
      }
      if (claimsGenericStdioDependencyResolution(fallbackBehavior)) {
        errors.push("Generic stdio fallback must not claim plugin dependency resolution")
      }
    }
  }

  if (evidence === undefined) {
    errors.push("Generic stdio evidence row is required")
  } else {
    if (evidence.disposition !== "degraded-mcp-only") {
      errors.push("Generic stdio evidence must record degraded-mcp-only disposition")
    }
    if (!includesAll(evidence.source_paths, REQUIRED_GENERIC_STDIO_EVIDENCE_SOURCES)) {
      errors.push("Generic stdio evidence must reference MCP launch docs and activation docs")
    }
    if (!arrayIncludes(evidence.unsupported_primitives, GENERIC_STDIO_UNSUPPORTED[0])) {
      errors.push("Generic stdio evidence must mark agent-defaults unsupported")
    }
    if (!arrayIncludes(evidence.unsupported_primitives, GENERIC_STDIO_UNSUPPORTED[1])) {
      errors.push("Generic stdio evidence must mark plugin-dependency-resolution unsupported")
    }
    const fallbackBehavior = evidence.fallback_behavior ?? ""
    if (!/no worker activation/u.test(fallbackBehavior)) {
      errors.push("Generic stdio evidence fallback must state no worker activation")
    } else {
      if (claimsGenericStdioWorkerActivation(fallbackBehavior)) {
        errors.push("Generic stdio evidence fallback must not claim worker activation")
      }
      if (claimsGenericStdioDependencyResolution(fallbackBehavior)) {
        errors.push("Generic stdio evidence fallback must not claim plugin dependency resolution")
      }
    }
  }

  if (!/--root/u.test(readmeSection)) {
    errors.push("Generic stdio launch docs must pass an explicit --root")
  }
  if (!/(?:^|\n)DESK=~\/desk\s*\nnode[^\n]*mcp\/index\.js[^\n]*--root "\$DESK"/u.test(readmeSection)) {
    errors.push("Generic stdio launch docs must bind $DESK before invoking node")
  }
  if (/DESK=[^\n]+--root "\$DESK"/u.test(readmeSection)) {
    errors.push("Generic stdio launch must not use inline DESK assignment with --root \"$DESK\"")
  }
  if (!/MCP-only/u.test(readmeSection)) {
    errors.push("Generic stdio docs must state MCP-only behavior")
  }
  if (!/no worker activation/u.test(readmeSection)) {
    errors.push("Generic stdio docs must state no worker activation")
  }
  const supportClaimSections = `${readmeSection}\n${activationSection}`
  if (claimsGenericStdioWorkerActivation(supportClaimSections)) {
    errors.push("Generic stdio docs must not claim worker activation")
  }
  if (claimsGenericStdioDependencyResolution(supportClaimSections)) {
    errors.push("Generic stdio docs must not claim plugin dependency resolution")
  }
}

function findHostSupport(input, hostId) {
  if (!Array.isArray(input?.activationManifest?.host_support)) {
    return undefined
  }
  return input.activationManifest.host_support.find((entry) => entry?.host === hostId)
}

function findEvidenceRow(input, hostId) {
  if (!Array.isArray(input?.evidenceRows)) {
    return undefined
  }
  return input.evidenceRows.find((entry) => entry?.host_id === hostId)
}

function readBundleMetadata(readmeSection) {
  const block = readmeSection.match(/```json\s*\n(?<json>[\s\S]*?)```/u)
  if (block === null) {
    return { invalidJson: false, plugins: [] }
  }
  const parsed = parseJson(block.groups.json)
  if (parsed === undefined) {
    return { invalidJson: true, plugins: [] }
  }
  return {
    invalidJson: false,
    plugins: Array.isArray(parsed.plugins)
      ? parsed.plugins.filter((plugin) => typeof plugin === "string")
      : [],
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function claimsGenericStdioWorkerActivation(readmeSection) {
  return hasGenericStdioSupportClaim({
    readmeSection,
    action: /\b(?:activates?|activated|activating|starts?|started|starting|launches?|launched|launching|loads?|loaded|loading|runs?|running|includes?|included|including|installs?|installed|installing|preloads?|preloaded|preloading|brings?\s+in|brought\s+in|bringing\s+in|comes?\s+with|came\s+with|coming\s+with|gives?\s+you|gave\s+you|giving\s+you|has|have|had|having|built\s+into|supports?|supported|supporting|provides?|provided|providing|exposes?|exposed|exposing|enables?|enabled|enabling|handles?|handled|handling|manages?|managed|managing|wires?|wired|wiring|bootstraps?|bootstrapped|bootstrapping|configures?|configured|configuring|prepares?|prepared|preparing|supplies|supply|supplied|supplying|delivers?|delivered|delivering|sets?\s+up|set\s+up|setting\s+up|ships?|shipped|shipping|spawns?|spawned|spawning|bundles?|bundled|bundling)\b/u,
    target: /\b(?:desk worker|worker activation|agent defaults?|default agent|worker)\b/u,
  })
}

function claimsGenericStdioDependencyResolution(readmeSection) {
  return hasGenericStdioSupportClaim({
    readmeSection,
    action: /\b(?:resolves?|resolved|resolving|loads?|loaded|loading|includes?|included|including|installs?|installed|installing|preloads?|preloaded|preloading|brings?\s+in|brought\s+in|bringing\s+in|comes?\s+with|came\s+with|coming\s+with|gives?\s+you|gave\s+you|giving\s+you|has|have|had|having|built\s+into|activates?|activated|activating|supports?|supported|supporting|provides?|provided|providing|exposes?|exposed|exposing|enables?|enabled|enabling|handles?|handled|handling|manages?|managed|managing|wires?|wired|wiring|bootstraps?|bootstrapped|bootstrapping|configures?|configured|configuring|prepares?|prepared|preparing|supplies|supply|supplied|supplying|delivers?|delivered|delivering|sets?\s+up|set\s+up|setting\s+up|ships?|shipped|shipping|spawns?|spawned|spawning|bundles?|bundled|bundling)\b/u,
    target: /\b(?:plugin dependencies|plugin dependency resolution|plugin dependency support|work suite dependency closure|work suite dependency resolution|work suite dependency support|dependency closure|dependency resolution|dependency support|transitive dependencies|work suite)\b/u,
  })
}

function hasGenericStdioSupportClaim({ readmeSection, action, target }) {
  return readmeStatements(readmeSection)
    .some((statement) => readmeClauses(statement)
      .some((clause) => hasPositiveSupportClaim({ clause, action, target })))
}

function hasPositiveSupportClaim({ clause, action, target }) {
  const normalizedClause = normalizeClaimText(clause)
  const actionMatches = allMatches(action, normalizedClause)
  const targetMatches = allMatches(target, normalizedClause)
  return actionMatches.some((actionMatch) => (
    !isSupportNounPhrase(normalizedClause, actionMatch)
    && !isSupportActionNegated(normalizedClause, actionMatch.index)
    && targetMatches.some((targetMatch) => (
      !isSupportTargetNegated({
        clause: normalizedClause,
        actionIndex: actionMatch.index,
        targetIndex: targetMatch.index,
      })
      && isSupportActionTargetCompatible({
        clause: normalizedClause,
        actionMatch,
        targetMatch,
      })
      && !isUnsupportedTargetClassification(normalizedClause, targetMatch)
      && !isExternalSupportAssignment({
        clause: normalizedClause,
        targetMatch,
      })
    ))
  ))
}

function isSupportNounPhrase(clause, actionMatch) {
  if (actionMatch[0] !== "support") {
    return false
  }
  const afterAction = clause.slice(actionMatch.index + actionMatch[0].length)
  return /^\s+(?:matrix|matrices|table|tables|row|rows|column|columns|entry|entries|status|evidence|docs?|documentation|section|sections)\b/u
    .test(afterAction)
}

function isSupportActionTargetCompatible({ clause, actionMatch, targetMatch }) {
  if (!/^(?:has|have|had|having)$/u.test(actionMatch[0])) {
    return true
  }
  const beforeTarget = clause.slice(actionMatch.index + actionMatch[0].length, targetMatch.index)
  const afterTarget = clause.slice(targetMatch.index + targetMatch[0].length)
  return /^\s+(?:an?\s+)?built\s+in\s*$/u.test(beforeTarget)
    || /^\s+built\s+in\b/u.test(afterTarget)
}

function isExternalSupportAssignment({ clause, targetMatch }) {
  const beforeTarget = clause.slice(0, targetMatch.index)
  const afterTarget = clause.slice(targetMatch.index + targetMatch[0].length)
  return /^(?:a\s+|an\s+)?(?:separate|external|another)\s+(?:host|overlay)(?:\s+or\s+(?:host|overlay))*\b/u
    .test(clause)
    || /^(?:(?:generic\s+stdio|this\s+path|the\s+generic\s+stdio\s+path)\s+)?(?:requires?|needs?|depends\s+on)\s+(?:a\s+|an\s+)?(?:separate|external|another)\s+(?:host|overlay)(?:\s+or\s+(?:host|overlay))*\s+to\s+(?:(?:manually|explicitly|separately|externally|independently|directly)\s+)*(?:activate|start|launch|load|run|support|provide|expose|enable|handle|manage|wire|bootstrap|configure|prepare|supply|deliver|set\s+up|ship|spawn|bundle|resolve|include|install|preload|bring\s+in|come\s+with|give\s+you|have\s+(?:an?\s+)?built\s+in)\s*$/u
      .test(beforeTarget)
    || /^(?:(?:generic\s+stdio|this\s+path|the\s+generic\s+stdio\s+path)\s+)?relies\s+on\s+(?:a\s+|an\s+)?(?:separate|external|another)\s+(?:host|overlay)(?:\s+or\s+(?:host|overlay))*\s+(?:that|which)\s+(?:(?:manually|explicitly|separately|externally|independently|directly)\s+)*(?:activates?|starts?|launches?|loads?|runs?|supports?|provides?|exposes?|enables?|handles?|manages?|wires?|bootstraps?|configures?|prepares?|supplies|supply|delivers?|sets?\s+up|ships?|spawns?|bundles?|resolves?|includes?|installs?|preloads?|brings?\s+in|brought\s+in|bringing\s+in|comes?\s+with|came\s+with|coming\s+with|gives?\s+you|gave\s+you|giving\s+you|(?:has|have|had|having)\s+(?:an?\s+)?built\s+in)\s*$/u
      .test(beforeTarget)
    || /^\s+(?:(?:dependency\s+(?:closure|resolution|support)|activation)\s+)?(?:(?:must|should|can|could|will|would|may|might)\s+)?(?:be\s+)?(?:provided|supplied|installed|loaded|configured|handled|managed|resolved|bundled|wired|bootstrapped|prepared|delivered|enabled|exposed)\s+by\s+(?:a\s+|an\s+)?(?:separate|external|another)\s+(?:host|overlay)(?:\s+or\s+(?:host|overlay))*\b/u
      .test(afterTarget)
}

function readmeStatements(readmeSection) {
  return readmeSection
    .split(/[\n.]+/u)
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function readmeClauses(statement) {
  return statement
    .split(/(?:,|:\s+|\s+-\s+|\s+\b(?:but|and|yet|though|although|while|however|because|since|as(?!\s+(?:an?\s+)?unsupported\b)|so|then)\b\s+|;\s*)/iu)
    .map((clause) => clause.trim())
    .filter(Boolean)
}

function isNegativeSupportBoundary(statement) {
  return /\b(?:(?:does|do|did|will|would|can|could|should|must|may|might|is|are|was|were)\s+not|doesn't|don't|didn't|wouldn't|couldn't|shouldn't|mustn't|isn't|aren't|wasn't|weren't|cannot|can't|won't|never|without|neither|nor|no\s+longer)(?:\s+(?:automatically|currently|directly|implicitly|silently|itself|also|ever|actually|fully|natively|locally|manually|still|now|yet))*\s*$/u
    .test(statement)
}

function isSupportActionNegated(clause, actionIndex) {
  return isNegativeSupportBoundary(clause.slice(0, actionIndex))
}

function isSupportTargetNegated({ clause, actionIndex, targetIndex }) {
  const beforeTarget = clause.slice(0, targetIndex)
  const betweenActionAndTarget = clause.slice(actionIndex, targetIndex)
  return /\b(?:not|no|without)\s*$/u.test(beforeTarget)
    || /\bneither\b/u.test(beforeTarget)
    || /\b(?:neither|nor|not|no|without)\b/u.test(betweenActionAndTarget)
}

function isUnsupportedTargetClassification(clause, targetMatch) {
  const afterTarget = clause.slice(targetMatch.index + targetMatch[0].length)
  return /^\s+(?:as\s+)?(?:an?\s+)?unsupported\b/u.test(afterTarget)
}

function allMatches(pattern, text) {
  return [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))]
}

function normalizeClaimText(text) {
  return text
    .toLowerCase()
    .replace(/[`*_]/gu, "")
    .replace(/[:_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
}

function arrayIncludes(value, expected) {
  return Array.isArray(value) && value.includes(expected)
}

function includesAll(value, expectedValues) {
  return expectedValues.every((expected) => arrayIncludes(value, expected))
}

function sameList(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}
