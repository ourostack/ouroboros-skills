#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const WORK_SUITE_SKILLS = [
  "autopilot",
  "deep-research",
  "inch-worm",
  "stay-in-turn",
  "visual-qa-dogfood",
  "work-doer",
  "work-ideator",
  "work-merger",
  "work-planner",
];

function usage() {
  return [
    "Usage: node scripts/audit-work-suite-runtime.cjs [options]",
    "",
    "Options:",
    "  --repo-root <path>          Repository root. Defaults to current directory.",
    "  --skill-root <path>         Installed skills root to audit. Repeatable.",
    "  --active-skills <list>      Comma-separated active host-menu skill names.",
    "  --active-skills-file <path> JSON file containing active skill names or objects with name.",
    "  --strict-installed          Exit non-zero when an installed root is missing/stale.",
    "  --strict-active             Exit non-zero when provided active skills miss work-suite skills.",
    "  --json                      Emit machine-readable JSON.",
    "  --help                      Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    repoRoot: process.cwd(),
    skillRoots: [],
    activeSkills: null,
    activeSkillsFiles: [],
    strictInstalled: false,
    strictActive: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--strict-installed") {
      args.strictInstalled = true;
    } else if (arg === "--strict-active") {
      args.strictActive = true;
    } else if (arg === "--repo-root") {
      args.repoRoot = requireValue(argv, ++index, arg);
    } else if (arg === "--skill-root") {
      args.skillRoots.push(requireValue(argv, ++index, arg));
    } else if (arg === "--active-skills") {
      const value = requireValue(argv, ++index, arg);
      args.activeSkills = new Set(splitNames(value));
    } else if (arg === "--active-skills-file") {
      args.activeSkillsFiles.push(requireValue(argv, ++index, arg));
    } else {
      throw new Error(`unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function splitNames(value) {
  return value.split(",").flatMap(normalizeSkillName);
}

function expandHome(inputPath) {
  if (inputPath === "~") {
    return require("node:os").homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(require("node:os").homedir(), inputPath.slice(2));
  }
  return inputPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function gitLastCommit(repoRoot, relativePath) {
  const result = spawnSync("git", ["-C", repoRoot, "log", "-1", "--format=%H", "--", relativePath], {
    encoding: "utf8",
  });
  if ((result.status ?? 1) !== 0) {
    return {
      commit: null,
      error: (result.stderr || result.stdout || "git log failed").trim(),
    };
  }
  const commit = result.stdout.trim() || null;
  return {
    commit,
    error: commit ? null : "git log returned no commit",
  };
}

function normalizeActiveNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeActiveNames);
  }
  if (typeof value === "string") {
    return normalizeSkillName(value);
  }
  if (value && typeof value === "object") {
    if (typeof value.name === "string") {
      return normalizeSkillName(value.name);
    }
    if (Array.isArray(value.skills)) {
      return normalizeActiveNames(value.skills);
    }
    if (Array.isArray(value.availableSkills)) {
      return normalizeActiveNames(value.availableSkills);
    }
    if (Array.isArray(value.activeSkills)) {
      return normalizeActiveNames(value.activeSkills);
    }
  }
  return [];
}

function normalizeSkillName(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const workSuitePrefixes = ["work-suite:", "work-suite/", "work-suite."];
  for (const prefix of workSuitePrefixes) {
    if (trimmed.startsWith(prefix)) {
      return [trimmed.slice(prefix.length)];
    }
  }
  return [trimmed];
}

function collectActiveSkills(args, repoRoot) {
  let active = args.activeSkills ? new Set(args.activeSkills) : null;
  for (const file of args.activeSkillsFiles) {
    const absolute = path.resolve(repoRoot, expandHome(file));
    const names = normalizeActiveNames(readJson(absolute));
    active = active ?? new Set();
    for (const name of names) {
      active.add(name);
    }
  }
  return active;
}

function auditSource(repoRoot) {
  const manifestPath = path.join(repoRoot, "manifest.json");
  const manifest = readJson(manifestPath);
  const entries = new Map((manifest.skills ?? []).map((skill) => [skill.name, skill]));
  const pluginSkillsDir = path.join(repoRoot, "plugins", "work-suite", "skills");
  const pluginSkillNames = fs.existsSync(pluginSkillsDir)
    ? fs.readdirSync(pluginSkillsDir)
      .filter((skillName) => fs.statSync(path.join(pluginSkillsDir, skillName)).isDirectory())
      .sort()
    : [];
  const sourceSkills = {};
  const issues = [];

  const missingPluginSkills = WORK_SUITE_SKILLS.filter((name) => !pluginSkillNames.includes(name));
  const extraPluginSkills = pluginSkillNames.filter((name) => !WORK_SUITE_SKILLS.includes(name));
  if (missingPluginSkills.length > 0 || extraPluginSkills.length > 0) {
    issues.push(`work-suite skill set mismatch: missing=[${missingPluginSkills.join(", ")}] extra=[${extraPluginSkills.join(", ")}]`);
  }

  for (const name of WORK_SUITE_SKILLS) {
    const entry = entries.get(name);
    const canonicalPath = path.join(repoRoot, "skills", name, "SKILL.md");
    const pluginPath = path.join(repoRoot, "plugins", "work-suite", "skills", name, "SKILL.md");
    const canonicalRelative = path.relative(repoRoot, canonicalPath);
    const pluginRelative = path.relative(repoRoot, pluginPath);
    const canonical = readTextIfExists(canonicalPath);
    const pluginCopy = readTextIfExists(pluginPath);
    const frontmatter = canonical?.match(/^---\n([\s\S]*?)\n---/);
    const frontmatterName = frontmatter?.[1].match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1] ?? null;
    const latestCommit = canonical ? gitLastCommit(repoRoot, canonicalRelative) : { commit: null, error: "canonical skill is missing" };

    if (!entry) {
      issues.push(`${name}: missing manifest entry`);
    }
    if (!canonical) {
      issues.push(`${name}: missing canonical ${canonicalRelative}`);
    }
    if (!pluginCopy) {
      issues.push(`${name}: missing work-suite plugin copy ${pluginRelative}`);
    }
    if (entry && entry.path !== `skills/${name}/SKILL.md`) {
      issues.push(`${name}: manifest path is ${entry.path}`);
    }
    if (canonical && frontmatterName !== name) {
      issues.push(`${name}: frontmatter name is ${frontmatterName ?? "missing"}`);
    }
    if (canonical && pluginCopy && canonical !== pluginCopy) {
      issues.push(`${name}: work-suite plugin copy differs from canonical skill`);
    }

    sourceSkills[name] = {
      manifest: Boolean(entry),
      canonicalPath: canonicalRelative,
      pluginPath: pluginRelative,
      canonicalHash: canonical ? sha256(canonical) : null,
      pluginHash: pluginCopy ? sha256(pluginCopy) : null,
      frontmatterName,
      latestCommit: latestCommit.commit,
      latestCommitError: latestCommit.error,
    };
  }

  return {
    status: issues.length === 0 ? "pass" : "fail",
    issues,
    pluginSkillNames,
    skills: sourceSkills,
  };
}

function auditSkillRoot(repoRoot, skillRootInput, source) {
  const skillRoot = path.resolve(repoRoot, expandHome(skillRootInput));
  const registryPath = path.join(skillRoot, "_registry.json");
  const registry = fs.existsSync(registryPath) ? readJson(registryPath) : null;
  const skills = {};
  const issues = [];
  const warnings = [];

  if (!registry) {
    warnings.push(`${skillRootInput}: missing _registry.json`);
  }

  for (const name of WORK_SUITE_SKILLS) {
    const installedPath = path.join(skillRoot, name, "SKILL.md");
    const installed = readTextIfExists(installedPath);
    const installedHash = installed ? sha256(installed) : null;
    const sourceHash = source.skills[name]?.canonicalHash ?? null;
    const expectedCommit = source.skills[name]?.latestCommit ?? null;
    const expectedCommitError = source.skills[name]?.latestCommitError ?? null;
    const registryEntry = registry?.[name] ?? null;
    const matchesSource = Boolean(installedHash && sourceHash && installedHash === sourceHash);

    if (!installed) {
      issues.push(`${skillRootInput}: missing ${name}/SKILL.md`);
    } else if (!matchesSource) {
      warnings.push(`${skillRootInput}: ${name}/SKILL.md differs from repo source`);
    }
    if (registry && !registryEntry) {
      warnings.push(`${skillRootInput}: _registry.json lacks ${name}`);
    }
    if (registryEntry) {
      if (registryEntry.selfAuthored !== false) {
        warnings.push(`${skillRootInput}: _registry.json ${name}.selfAuthored is ${registryEntry.selfAuthored ?? "missing"}, expected false for shared work-suite skills`);
      }
      if (!expectedCommit) {
        warnings.push(`${skillRootInput}: cannot verify _registry.json ${name}.commit because source commit is unavailable: ${expectedCommitError ?? "unknown git error"}`);
      } else if (registryEntry.commit !== expectedCommit) {
        warnings.push(`${skillRootInput}: _registry.json ${name}.commit is ${registryEntry.commit ?? "missing"}, expected ${expectedCommit}`);
      }
    }

    skills[name] = {
      installed: Boolean(installed),
      path: path.relative(skillRoot, installedPath),
      hash: installedHash,
      matchesSource,
      expectedCommit,
      expectedCommitError,
      registry: registryEntry ? {
        source: registryEntry.source ?? null,
        commit: registryEntry.commit ?? null,
        installed: registryEntry.installed ?? null,
        selfAuthored: registryEntry.selfAuthored ?? null,
      } : null,
    };
  }

  return {
    root: skillRoot,
    registryPath: fs.existsSync(registryPath) ? registryPath : null,
    status: issues.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    issues,
    warnings,
    skills,
  };
}

function auditActiveSkills(activeSkills) {
  if (!activeSkills) {
    return {
      provided: false,
      status: "not_provided",
      missing: [],
      present: [],
      guidance: "No active host-menu snapshot was provided. Installed files can still be authoritative mid-session, but visibility was not proven.",
    };
  }

  const missing = WORK_SUITE_SKILLS.filter((name) => !activeSkills.has(name));
  const present = WORK_SUITE_SKILLS.filter((name) => activeSkills.has(name));
  return {
    provided: true,
    status: missing.length === 0 ? "pass" : "warn",
    missing,
    present,
    guidance: missing.length === 0
      ? "All work-suite skills were visible in the active host menu snapshot."
      : "Some installed work-suite skills were not visible in the active host menu snapshot. Re-read installed SKILL.md files directly for this run, record the mismatch in durable state, and refresh/restart the host before relying on menu discovery.",
  };
}

function summarize(result, args) {
  const lines = [];
  lines.push(`work-suite runtime audit: ${result.status}`);
  lines.push(`source: ${result.source.status}`);
  for (const issue of result.source.issues) {
    lines.push(`  source issue: ${issue}`);
  }

  if (result.installedRoots.length === 0) {
    lines.push("installed roots: not provided");
  } else {
    lines.push("installed roots:");
    for (const root of result.installedRoots) {
      lines.push(`  ${root.status}: ${root.root}`);
      for (const issue of root.issues) {
        lines.push(`    issue: ${issue}`);
      }
      for (const warning of root.warnings) {
        lines.push(`    warning: ${warning}`);
      }
    }
  }

  lines.push(`active host menu: ${result.active.status}`);
  if (result.active.provided) {
    lines.push(`  present: ${result.active.present.join(", ") || "(none)"}`);
    lines.push(`  missing: ${result.active.missing.join(", ") || "(none)"}`);
  }
  lines.push(`  guidance: ${result.active.guidance}`);

  if (args.strictInstalled && result.installedRoots.some((root) => root.status !== "pass")) {
    lines.push("strict-installed: fail");
  }
  if (args.strictActive && result.active.status !== "pass") {
    lines.push("strict-active: fail");
  }
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const repoRoot = path.resolve(expandHome(args.repoRoot));
  const source = auditSource(repoRoot);
  const installedRoots = args.skillRoots.map((root) => auditSkillRoot(repoRoot, root, source));
  const active = auditActiveSkills(collectActiveSkills(args, repoRoot));

  const sourceFailed = source.status !== "pass";
  const installedFailed = args.strictInstalled && installedRoots.some((root) => root.status !== "pass");
  const activeFailed = args.strictActive && active.status !== "pass";
  const status = sourceFailed || installedFailed || activeFailed ? "fail" : "pass";

  const result = {
    schemaVersion: 1,
    status,
    repoRoot,
    workSuiteSkills: WORK_SUITE_SKILLS,
    source,
    installedRoots,
    active,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(summarize(result, args));
  }

  return status === "pass" ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
