#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const defaultRepoRoot = path.resolve(__dirname, "..");
const defaultMcpRoot = path.join(defaultRepoRoot, "plugins", "desk", "mcp");
const activationManifestPath = "plugins/desk/activation/desk.activation.json";
const copilotBundlePath = "plugins/desk/activation/copilot-root.flattened-bundle.json";
const evidencePath =
  "desk/tasks/2026-06-14-1335-doing-desk-dependency-activation/host-capability-evidence.md";
const supportMatrixPath = "plugins/desk/activation/support-matrix.json";
const requiredEvidenceColumns = [
  "host_id",
  "surface",
  "disposition",
  "source_paths",
  "evidence_command_or_doc",
  "unsupported_primitives",
  "fallback_behavior",
];

function readText(repoRoot, relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(repoRoot, relativePath) {
  return JSON.parse(readText(repoRoot, relativePath));
}

function splitMarkdownRow(row) {
  return row.trim().replace(/^\|/u, "").replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function splitList(value) {
  if (value === "none") return [];
  return value.replace(/^none$/u, "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEvidenceTable(content) {
  const tableRows = content.split(/\r?\n/u).filter((line) => line.startsWith("|"));
  const columns = splitMarkdownRow(tableRows[0] ?? "");
  if (!sameJson(columns, requiredEvidenceColumns)) {
    throw new Error(`support-matrix evidence columns drifted in ${evidencePath}`);
  }
  return tableRows.slice(2).map((line) => {
    const values = splitMarkdownRow(line);
    const row = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
    return {
      ...row,
      source_paths: splitList(row.source_paths),
      unsupported_primitives: splitList(row.unsupported_primitives),
    };
  });
}

function expectedSupportMatrix(repoRoot) {
  return {
    schema_version: 1,
    generated_from: {
      activation_manifest: activationManifestPath,
      host_capability_evidence: evidencePath,
    },
    hosts: parseEvidenceTable(readText(repoRoot, evidencePath)),
  };
}

function expectedCopilotBundle(repoRoot) {
  const activation = readJson(repoRoot, activationManifestPath);
  const workSuiteDependency = activation.dependencies.find((dependency) => (
    dependency.id === "work-suite"
  ));
  return {
    schema_version: 1,
    host: "copilot-root",
    generated_by: "npm --prefix plugins/desk/mcp run activation:copilot-bundle:generate",
    generated_from: {
      activation_manifest: activationManifestPath,
      desk_plugin: "plugins/desk/plugin.json",
      work_suite_plugin: "plugins/work-suite/plugin.json",
      plain_language_plugin: "plugins/plain-language/plugin.json",
      ponytail_plugin: "plugins/ponytail-upstream/plugin.json",
    },
    launch: {
      agent: "plugins/desk/agents/worker.agent.md",
      mcp: "plugins/desk/.mcp.copilot.json",
    },
    dependency_closure: [
      {
        id: "desk",
        version: activation.version,
        plugin: "plugins/desk/plugin.json",
        skills: "plugins/desk/skills/",
        agents: "plugins/desk/agents/",
        mcpServers: "plugins/desk/.mcp.copilot.json",
      },
      {
        id: "work-suite",
        version: workSuiteDependency?.lock?.version,
        plugin: "plugins/work-suite/plugin.json",
        skills: "plugins/work-suite/skills/",
      },
      {
        id: "plain-language",
        version: findActivationDependency(activation, "plain-language")?.lock?.version,
        plugin: "plugins/plain-language/plugin.json",
        skills: "plugins/plain-language/skills/",
      },
      {
        id: "ponytail-upstream",
        version: findActivationDependency(activation, "ponytail-upstream")?.lock?.version,
        plugin: "plugins/ponytail-upstream/plugin.json",
        skills: "plugins/ponytail-upstream/skills/",
      },
    ],
    manual_steps: [],
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function normalizeNewlines(value) {
  return value.replaceAll("\r\n", "\n");
}

function countOccurrences(value, phrase) {
  return value.split(phrase).length - 1;
}

function skillBody(value) {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "").trim();
}

function withoutDeskFoundation(repoRoot, value) {
  const foundation = skillBody(readText(
    repoRoot,
    "plugins/desk/skills/using-desk/SKILL.md",
  ));
  return value.replace(`${foundation}\n\n`, "");
}

function pushMismatch(errors, label, actual, expected) {
  if (!sameJson(actual, expected)) {
    errors.push(`${label} drift: committed host-facing artifact does not match generated expectation`);
  }
}

function findActivationDependency(activation, id) {
  return activation.dependencies.find((dependency) => dependency.id === id);
}

function checkSupportMatrix({ repoRoot, errors, checked }) {
  checked.push("support-matrix");
  const activation = readJson(repoRoot, activationManifestPath);
  const evidenceRows = parseEvidenceTable(readText(repoRoot, evidencePath));
  const matrix = readJson(repoRoot, supportMatrixPath);
  pushMismatch(errors, "support-matrix", matrix, expectedSupportMatrix(repoRoot));

  for (const hostSupport of activation.host_support) {
    const row = evidenceRows.find((candidate) => candidate.host_id === hostSupport.host);
    if (!row) {
      errors.push(`support-matrix missing evidence row for ${hostSupport.host}`);
    } else {
      if (!row.disposition.startsWith(`${hostSupport.status}-`)) {
        errors.push(`support-matrix evidence disposition drift for ${hostSupport.host}`);
      }
      if (row.fallback_behavior !== hostSupport.fallback_behavior) {
        errors.push(`support-matrix fallback drift for ${hostSupport.host}`);
      }
    }
  }
}

async function checkCopilotBundle({ repoRoot, mcpRoot, errors, checked }) {
  checked.push("copilot-bundle");
  const { buildCopilotBundle, validateCopilotPackagingContract } = await import(pathToFileURL(
    path.join(mcpRoot, "src", "activation", "copilot-bundle.js"),
  ).href);
  const activation = readJson(repoRoot, activationManifestPath);
  const bundle = readJson(repoRoot, copilotBundlePath);
  pushMismatch(errors, "copilot-bundle", bundle, buildCopilotBundle({ activation }));

  checked.push("copilot-plugin-metadata");
  const contractErrors = validateCopilotPackagingContract({
    activation,
    bundle,
    deskPlugin: readJson(repoRoot, "plugins/desk/plugin.json"),
    workSuitePlugin: readJson(repoRoot, "plugins/work-suite/plugin.json"),
    plainLanguagePlugin: readJson(repoRoot, "plugins/plain-language/plugin.json"),
    ponytailPlugin: readJson(repoRoot, "plugins/ponytail-upstream/plugin.json"),
  });
  if (contractErrors.length > 0) {
    errors.push(`copilot-plugin-metadata drift: ${contractErrors.join("; ")}`);
  }
}

function checkCodexPlugin({ repoRoot, errors, checked }) {
  checked.push("codex-plugin");
  const activation = readJson(repoRoot, activationManifestPath);
  const deskPlugin = readJson(repoRoot, "plugins/desk/.codex-plugin/plugin.json");
  const workSuitePlugin = readJson(repoRoot, "plugins/work-suite/.codex-plugin/plugin.json");
  const plainLanguagePlugin = readJson(repoRoot, "plugins/plain-language/.codex-plugin/plugin.json");
  const ponytailPlugin = readJson(repoRoot, "plugins/ponytail-upstream/.codex-plugin/plugin.json");
  const workSuiteLock = findActivationDependency(activation, "work-suite")?.lock?.version;
  const plainLanguageLock = findActivationDependency(activation, "plain-language")?.lock?.version;
  const ponytailLock = findActivationDependency(activation, "ponytail-upstream")?.lock?.version;
  const codex = deskPlugin.activation?.codex;

  if (deskPlugin.version !== activation.version) {
    errors.push("codex-plugin Desk version drift");
  }
  if (deskPlugin.skills !== "./skills/" || deskPlugin.mcpServers !== "./.mcp.json") {
    errors.push("codex-plugin Desk surfaces drift");
  }
  if (codex?.defaultMode !== "global-personal") {
    errors.push("codex-plugin default activation mode drift");
  }
  if (!sameJson(codex?.optOutModes, ["project-local", "manual-only"])) {
    errors.push("codex-plugin opt-out modes drift");
  }
  if (codex?.targets?.["desk:worker"]?.source !== "agents/worker.toml") {
    errors.push("codex-plugin desk:worker source drift");
  }
  if (codex?.targets?.["desk:worker"]?.default !== true) {
    errors.push("codex-plugin desk:worker default drift");
  }
  if (codex?.mcpServers?.desk?.manualRegistration !== false) {
    errors.push("codex-plugin Desk MCP manual-registration drift");
  }
  if (!sameJson(codex?.manualSetupSteps ?? [], [])) {
    errors.push("codex-plugin manual setup steps drift");
  }
  if (codex?.dependencies?.["work-suite"]?.version !== workSuitePlugin.version) {
    errors.push("codex-plugin Work Suite dependency version drift");
  }
  if (workSuitePlugin.version !== workSuiteLock) {
    errors.push("codex-plugin Work Suite provider lock drift");
  }
  if (codex?.dependencies?.["plain-language"]?.version !== plainLanguagePlugin.version) {
    errors.push("codex-plugin Plain Language dependency version drift");
  }
  if (plainLanguagePlugin.version !== plainLanguageLock) {
    errors.push("codex-plugin Plain Language provider lock drift");
  }
  if (codex?.dependencies?.["ponytail-upstream"]?.version !== ponytailPlugin.version) {
    errors.push("codex-plugin Ponytail dependency version drift");
  }
  if (ponytailPlugin.version !== ponytailLock) {
    errors.push("codex-plugin Ponytail provider lock drift");
  }
}

function checkClaudePlugin({ repoRoot, errors, checked }) {
  checked.push("claude-plugin");
  const activation = readJson(repoRoot, activationManifestPath);
  const deskPlugin = readJson(repoRoot, "plugins/desk/.claude-plugin/plugin.json");
  const workSuitePlugin = readJson(repoRoot, "plugins/work-suite/.claude-plugin/plugin.json");
  const plainLanguagePlugin = readJson(repoRoot, "plugins/plain-language/.claude-plugin/plugin.json");
  const ponytailPlugin = readJson(repoRoot, "plugins/ponytail-upstream/.claude-plugin/plugin.json");
  const claudeActivation = activation.host_activation?.claude;
  const workSuiteLock = findActivationDependency(activation, "work-suite")?.lock?.version;
  const plainLanguageLock = findActivationDependency(activation, "plain-language")?.lock?.version;
  const ponytailLock = findActivationDependency(activation, "ponytail-upstream")?.lock?.version;

  if (deskPlugin.version !== activation.version) {
    errors.push("claude-plugin Desk version drift");
  }
  if (!Array.isArray(deskPlugin.agents) || !deskPlugin.agents.includes("./agents/worker.md")) {
    errors.push("claude-plugin worker exposure drift");
  }
  if (deskPlugin.skills !== "./skills/" || deskPlugin.mcpServers !== "./.mcp.json") {
    errors.push("claude-plugin Desk surfaces drift");
  }
  if (deskPlugin.outputStyles !== "./output-styles/") {
    errors.push("claude-plugin output style surface drift");
  }
  if (deskPlugin.dependencies?.[0]?.name !== "work-suite" || deskPlugin.dependencies?.[0]?.version !== "^3.0.0") {
    errors.push("claude-plugin Work Suite dependency drift");
  }
  if (workSuitePlugin.version !== workSuiteLock) {
    errors.push("claude-plugin Work Suite provider lock drift");
  }
  if (
    deskPlugin.dependencies?.[1]?.name !== "plain-language" ||
    deskPlugin.dependencies?.[1]?.version !== plainLanguagePlugin.version
  ) {
    errors.push("claude-plugin Plain Language dependency drift");
  }
  if (plainLanguagePlugin.version !== plainLanguageLock) {
    errors.push("claude-plugin Plain Language provider lock drift");
  }
  if (
    deskPlugin.dependencies?.[2]?.name !== "ponytail-upstream" ||
    deskPlugin.dependencies?.[2]?.version !== "4.9.0"
  ) {
    errors.push("claude-plugin Ponytail dependency drift");
  }
  if (ponytailPlugin.version !== ponytailLock) {
    errors.push("claude-plugin Ponytail provider lock drift");
  }
  if (claudeActivation?.targets?.["desk:worker"]?.source !== "agents/worker.md") {
    errors.push("claude-plugin activation worker source drift");
  }
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) return {};
  return Object.fromEntries(match[1]
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split(":");
      return [key.trim(), rest.join(":").trim().replace(/^"|"$/gu, "")];
    }));
}

function tomlStringValue(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "mu"));
  return match?.[1];
}

function checkWorkerSources({ repoRoot, errors, checked }) {
  checked.push("worker-sources");
  const claudeWorker = readText(repoRoot, "plugins/desk/agents/worker.md");
  const codexWorker = readText(repoRoot, "plugins/desk/agents/worker.toml");
  const copilotWorker = readText(repoRoot, "plugins/desk/agents/worker.agent.md");
  const outputStyleWorker = readText(repoRoot, "plugins/desk/output-styles/worker.md");
  const principles = readText(repoRoot, "plugins/desk/principles.md");
  const codexAdapter = readText(repoRoot, "plugins/desk/mcp/src/activation/adapters/codex.js");
  const workerFacts = [
    ["claude", parseFrontmatter(claudeWorker).name],
    ["codex", tomlStringValue(codexWorker, "name")],
    ["copilot", parseFrontmatter(copilotWorker).name],
  ];

  for (const [host, name] of workerFacts) {
    if (name !== "worker") {
      errors.push(`worker-sources ${host} worker name drift`);
    }
  }
  for (const [host, body] of [
    ["claude", claudeWorker],
    ["codex", codexWorker],
    ["copilot", copilotWorker],
  ]) {
    if (!body.includes("I'm **worker**") || !body.includes("$DESK")) {
      errors.push(`worker-sources ${host} body drift`);
    }
  }
  if (!claudeWorker.includes("desk:session-start")) {
    errors.push("worker-sources claude session-start prompt drift");
  }
  for (const [surface, body] of [
    ["claude", claudeWorker],
    ["codex-subagent", codexWorker],
    ["copilot", copilotWorker],
    ["claude-output-style", outputStyleWorker],
  ]) {
    if (!body.includes("using-desk")) {
      errors.push(`worker-sources ${surface} using-desk activation drift`);
    }
    if (!body.includes("Never hard-wrap authored prose") || !body.includes("authored/changed prose")) {
      errors.push(`worker-sources ${surface} no-hard-wrap invariant drift`);
    }
  }
  if (!principles.includes("## Invariant 10 — Authored prose never hard-wraps") || !principles.includes("Fail-closed authoring check")) {
    errors.push("worker-sources principles no-hard-wrap invariant drift");
  }
  if (!codexAdapter.includes("Never hard-wrap authored prose") || !codexAdapter.includes("authored/changed prose")) {
    errors.push("worker-sources codex activation no-hard-wrap invariant drift");
  }
  if (!codexAdapter.includes("Apply the \\`plain-language\\` skill to every human-readable response and artifact")) {
    errors.push("worker-sources codex activation Plain Language invariant drift");
  }
  if (!codexAdapter.includes("Apply \\`ponytail\\` to coding and \\`ponytail-review\\`")) {
    errors.push("worker-sources codex activation Ponytail invariant drift");
  }
}

function checkHumanizePackaging({ repoRoot, errors, checked }) {
  checked.push("humanize-skill");
  const deskSkillRoot = path.join(repoRoot, "plugins", "desk", "skills", "humanize");
  const standaloneSkillRoot = path.join(repoRoot, "skills", "humanize");
  const manifest = readJson(repoRoot, "manifest.json");

  for (const file of ["SKILL.md", "LICENSE"]) {
    if (!fs.existsSync(path.join(deskSkillRoot, file))) {
      errors.push(`humanize-skill Desk bundle missing ${file}`);
    }
  }
  if (fs.existsSync(standaloneSkillRoot)) {
    errors.push("humanize-skill remains in the standalone skill catalog");
  }
  if (manifest.skills.some((skill) => skill.name === "humanize")) {
    errors.push("humanize-skill remains exported from the standalone manifest");
  }
}

function effectiveClaudeStartup(repoRoot) {
  const deskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "desk-claude-startup-"));
  try {
    const result = spawnSync(
      "bash",
      [path.join(repoRoot, "plugins", "desk", "hooks", "session-start.sh")],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PLUGIN_ROOT: path.join(repoRoot, "plugins", "desk"),
          DESK: deskRoot,
        },
      },
    );
    if (result.status !== 0) {
      throw new Error(`Claude SessionStart hook failed: ${result.stderr.trim()}`);
    }
    const payload = JSON.parse(result.stdout);
    return payload.hookSpecificOutput?.additionalContext ?? "";
  } finally {
    fs.rmSync(deskRoot, { recursive: true, force: true });
  }
}

function effectiveCopilotStartup(repoRoot) {
  const pluginRoot = path.join(repoRoot, "plugins", "desk");
  const plugin = readJson(repoRoot, "plugins/desk/plugin.json");
  if (plugin.hooks !== "./hooks/copilot-hooks.json") {
    throw new Error("Desk Copilot plugin must register ./hooks/copilot-hooks.json");
  }

  const hookManifest = readJson(repoRoot, path.posix.join("plugins/desk", plugin.hooks));
  if (hookManifest.version !== 1) {
    throw new Error("Desk Copilot hook manifest must use version 1");
  }

  const sessionStartHooks = hookManifest.hooks?.sessionStart;
  if (!Array.isArray(sessionStartHooks) || sessionStartHooks.length !== 1) {
    throw new Error("Desk Copilot hook manifest must configure exactly one sessionStart hook");
  }

  const command = sessionStartHooks[0]?.bash;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("Desk Copilot sessionStart hook must configure a bash command");
  }

  const pluginData = fs.mkdtempSync(path.join(os.tmpdir(), "desk-copilot-startup-"));
  try {
    const result = spawnSync("bash", ["-lc", command], {
      cwd: pluginRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        COPILOT_PLUGIN_DATA: pluginData,
        DESK: path.join(pluginData, "desk"),
        PLUGIN_ROOT: pluginRoot,
      },
    });
    if (result.status !== 0) {
      throw new Error(`Copilot sessionStart hook failed: ${result.stderr.trim()}`);
    }
    const payload = JSON.parse(result.stdout);
    return payload.additionalContext ?? "";
  } finally {
    fs.rmSync(pluginData, { recursive: true, force: true });
  }
}

function codexActivationInput(manifest, mode) {
  return {
    manifest,
    mode,
    existingConfig: [
      "# user-authored Codex config",
      "model = \"gpt-5.4\"",
      "approval_policy = \"on-request\"",
      "",
    ].join("\n"),
    existingInstructions: [
      "# user-authored Codex guidance",
      "Keep repo-local rules intact.",
      "",
    ].join("\n"),
    pluginRoot: "plugins/desk",
    workSuitePluginRoot: "plugins/work-suite",
    deskRoot: mode === "project-local" ? ".desk" : "~/desk",
    runtimeCacheDir: mode === "project-local"
      ? ".codex/desk-runtime-cache"
      : "~/.cache/ouroboros-skills/desk",
  };
}

async function checkStartupComposition({ repoRoot, mcpRoot, errors, checked }) {
  checked.push("startup-composition");
  const { materializeCodexActivation } = await import(pathToFileURL(
    path.join(mcpRoot, "src", "activation", "adapters", "codex.js"),
  ).href);
  const manifest = readJson(repoRoot, activationManifestPath);
  const activationTarget = manifest.provides.activation_targets.find((target) => (
    target.id === "desk:worker"
  ));
  if (!sameJson(activationTarget?.startup, {
    foundation: "skills/using-desk/SKILL.md",
    authoritative_scan: "skills/session-start/SKILL.md",
  })) {
    errors.push("startup-composition desk:worker startup contract drift");
  }
  const startups = [
    ["claude", effectiveClaudeStartup(repoRoot)],
    [
      "codex",
      materializeCodexActivation(codexActivationInput(manifest, "global-personal"))
        .generatedInstructions,
    ],
  ];
  try {
    startups.splice(1, 0, ["copilot", effectiveCopilotStartup(repoRoot)]);
  } catch (error) {
    errors.push(`startup-composition copilot hook execution failed: ${error.message}`);
  }
  const foundation = skillBody(readText(
    repoRoot,
    "plugins/desk/skills/using-desk/SKILL.md",
  ));
  for (const [host, startup] of startups) {
    const foundationCount = countOccurrences(startup, foundation);
    if (foundationCount !== 1) {
      errors.push(`startup-composition ${host} must include the canonical using-desk body exactly once; found ${foundationCount}`);
    }
    for (const phrase of [
      "The human supplies intent",
      "The agent owns execution",
      "must not be silently confused",
    ]) {
      const count = countOccurrences(startup, phrase);
      if (count !== 1) {
        errors.push(`startup-composition ${host} must include "${phrase}" exactly once; found ${count}`);
      }
    }
  }

  const copilotWorker = readText(repoRoot, "plugins/desk/agents/worker.agent.md");
  if (copilotWorker.includes(foundation)) {
    errors.push("startup-composition Copilot agent body must not duplicate the canonical using-desk body");
  }

  const sessionStartHook = readText(repoRoot, "plugins/desk/hooks/session-start.sh");
  // A hook-side partial scan duplicates desk:session-start, adds boot work, and can disagree with synchronized workspace state.
  if (/find\s+.*task\.md|(^|[;&|]\s*|\$\()\s*(git|gh|curl)\s/mu.test(sessionStartHook)) {
    errors.push("startup-composition Claude hook must not scan tasks or run git, gh, or curl");
  }
  const sessionStartSkill = readText(repoRoot, "plugins/desk/skills/session-start/SKILL.md");
  if (!/authoritative.*scan/iu.test(sessionStartSkill)) {
    errors.push("startup-composition desk:session-start must declare the authoritative scan");
  }
}

async function expectedCodexFixtures({ repoRoot, mcpRoot }) {
  const { materializeCodexActivation } = await import(pathToFileURL(
    path.join(mcpRoot, "src", "activation", "adapters", "codex.js"),
  ).href);
  const manifest = readJson(repoRoot, activationManifestPath);
  return {
    "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-config.toml":
      materializeCodexActivation(codexActivationInput(manifest, "global-personal")).generatedConfig,
    "plugins/desk/mcp/__tests__/fixtures/activation/codex/global-personal/generated-instructions.md":
      withoutDeskFoundation(
        repoRoot,
        materializeCodexActivation(codexActivationInput(manifest, "global-personal")).generatedInstructions,
      ),
    "plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-config.toml":
      materializeCodexActivation(codexActivationInput(manifest, "project-local")).generatedConfig,
    "plugins/desk/mcp/__tests__/fixtures/activation/codex/project-local/generated-instructions.md":
      withoutDeskFoundation(
        repoRoot,
        materializeCodexActivation(codexActivationInput(manifest, "project-local")).generatedInstructions,
      ),
    "plugins/desk/mcp/__tests__/fixtures/activation/codex/manual-only/generated-config.toml":
      materializeCodexActivation(codexActivationInput(manifest, "manual-only")).generatedConfig,
  };
}

async function checkCodexFixtures({ repoRoot, mcpRoot, errors, checked }) {
  checked.push("codex-fixtures");
  const expected = await expectedCodexFixtures({ repoRoot, mcpRoot });
  for (const [relativePath, content] of Object.entries(expected)) {
    if (normalizeNewlines(readText(repoRoot, relativePath)) !== normalizeNewlines(content)) {
      errors.push(`codex-fixtures drift: ${relativePath}`);
    }
  }
}

async function verifyDeskHostManifests(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const mcpRoot = options.mcpRoot ?? path.join(repoRoot, "plugins", "desk", "mcp");
  const io = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
  };
  const errors = [];
  const checked = [];

  try {
    checkSupportMatrix({ repoRoot, errors, checked });
    await checkCopilotBundle({ repoRoot, mcpRoot, errors, checked });
    checkCodexPlugin({ repoRoot, errors, checked });
    checkClaudePlugin({ repoRoot, errors, checked });
    checkWorkerSources({ repoRoot, errors, checked });
    checkHumanizePackaging({ repoRoot, errors, checked });
    await checkStartupComposition({ repoRoot, mcpRoot, errors, checked });
    await checkCodexFixtures({ repoRoot, mcpRoot, errors, checked });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  if (errors.length > 0) {
    io.stderr.write("Desk host manifest verification failed\n");
    for (const error of errors) io.stderr.write(`- ${error}\n`);
  } else {
    io.stdout.write(`Desk host manifests verified for ${checked.join(", ")}\n`);
  }
  return {
    ok: errors.length === 0,
    errors,
    checked,
  };
}

async function runCli(options = {}) {
  try {
    const result = await verifyDeskHostManifests(options);
    return result.ok ? 0 : 1;
  } catch (error) {
    const io = options.io ?? { stderr: process.stderr };
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  defaultMcpRoot,
  defaultRepoRoot,
  runCli,
  verifyDeskHostManifests,
};
