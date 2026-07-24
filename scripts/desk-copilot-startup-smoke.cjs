#!/usr/bin/env node
"use strict";

const path = require("node:path");

const STARTUP_PROMPT = "This is an automated startup acceptance check. You must call the desk_status MCP tool exactly once. After the tool succeeds, reply with exactly DESK_STARTUP_READY and nothing else. Do not call any other tool.";
const PINNED_COPILOT_PREFIX = [
  "--yes",
  "-p",
  "node@22.23.1",
  "-p",
  "@github/copilot@1.0.72-0",
  "copilot",
  "--no-auto-update",
];
const ARGUMENT_FIELDS = new Map([
  ["--candidate-root", "candidateRoot"],
  ["--raw-root", "rawRoot"],
  ["--safe-root", "safeRoot"],
]);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const field = ARGUMENT_FIELDS.get(argument);
    if (!field) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${argument} requires a value`);
    }
    result[field] = value;
  }
  for (const [argument, field] of ARGUMENT_FIELDS) {
    if (result[field] === undefined) {
      throw new Error(`${argument} is required`);
    }
  }
  return result;
}

function requiredPath(value, label) {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  return path.resolve(value);
}

function pathsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return !leftToRight.startsWith("..") || !rightToLeft.startsWith("..");
}

function buildPaths({ candidateRoot, rawRoot, safeRoot }) {
  const resolvedCandidateRoot = requiredPath(candidateRoot, "candidateRoot");
  const resolvedRawRoot = requiredPath(rawRoot, "rawRoot");
  const resolvedSafeRoot = requiredPath(safeRoot, "safeRoot");
  if (pathsOverlap(resolvedRawRoot, resolvedSafeRoot)) {
    throw new Error("raw and safe roots must be separate non-overlapping directories");
  }
  if (
    pathsOverlap(resolvedCandidateRoot, resolvedRawRoot) ||
    pathsOverlap(resolvedCandidateRoot, resolvedSafeRoot)
  ) {
    throw new Error("candidate checkout and output roots must be separate non-overlapping directories");
  }
  return {
    candidateRoot: resolvedCandidateRoot,
    copilotHome: path.join(resolvedRawRoot, "copilot-home"),
    cwd: path.join(resolvedRawRoot, "workspace"),
    deskRoot: path.join(resolvedRawRoot, "desk"),
    homeRoot: path.join(resolvedRawRoot, "home"),
    jsonlPath: path.join(resolvedRawRoot, "copilot.jsonl"),
    logRoot: path.join(resolvedRawRoot, "copilot-logs"),
    rawRoot: resolvedRawRoot,
    runtimeCacheRoot: path.join(resolvedRawRoot, "runtime-cache"),
    safeRoot: resolvedSafeRoot,
    stderrPath: path.join(resolvedRawRoot, "copilot.stderr.log"),
    summaryPath: path.join(resolvedSafeRoot, "summary.json"),
    xdgCacheHome: path.join(resolvedRawRoot, "xdg", "cache"),
    xdgConfigHome: path.join(resolvedRawRoot, "xdg", "config"),
    xdgDataHome: path.join(resolvedRawRoot, "xdg", "data"),
  };
}

function validateCandidateRoot(candidateRoot, fsOps) {
  let candidateStat;
  try {
    candidateStat = fsOps.statSync(candidateRoot);
  } catch (error) {
    throw new Error(`candidate checkout is not a directory: ${candidateRoot}`, { cause: error });
  }
  if (!candidateStat.isDirectory()) {
    throw new Error(`candidate checkout is not a directory: ${candidateRoot}`);
  }
}

function hasSecret(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSecrets(env) {
  if (!hasSecret(env.GITHUB_TOKEN) && !hasSecret(env.GH_TOKEN)) {
    throw new Error("a non-empty GITHUB_TOKEN or GH_TOKEN is required");
  }
}

function createIsolatedRoots(paths, fsOps) {
  const directories = [
    paths.rawRoot,
    paths.safeRoot,
    paths.homeRoot,
    paths.copilotHome,
    paths.xdgConfigHome,
    paths.xdgCacheHome,
    paths.xdgDataHome,
    paths.deskRoot,
    paths.runtimeCacheRoot,
    paths.cwd,
    paths.logRoot,
  ];
  for (const directory of directories) {
    try {
      fsOps.mkdirSync(directory, { mode: 0o700, recursive: true });
    } catch (error) {
      throw new Error(`unable to create isolated root ${directory}: ${error.code}`, { cause: error });
    }
  }
  fsOps.writeFileSync(
    paths.summaryPath,
    `${JSON.stringify({
      failure_codes: [],
      phase: "initializing",
      schema_version: 1,
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function buildEnvironments(paths, env) {
  const live = {
    ...env,
    COPILOT_HOME: paths.copilotHome,
    DESK: paths.deskRoot,
    DESK_RUNTIME_CACHE_DIR: paths.runtimeCacheRoot,
    HOME: paths.homeRoot,
    XDG_CACHE_HOME: paths.xdgCacheHome,
    XDG_CONFIG_HOME: paths.xdgConfigHome,
    XDG_DATA_HOME: paths.xdgDataHome,
  };
  const setup = { ...live };
  delete setup.GH_TOKEN;
  delete setup.GITHUB_TOKEN;
  return { live, setup };
}

function command(commandName, args, cwd, env) {
  return {
    command: commandName,
    args,
    options: { cwd, env },
  };
}

function buildCommands(paths, environments) {
  return {
    copilotLive: command(
      "npx",
      [
        ...PINNED_COPILOT_PREFIX,
        "--agent=desk:worker",
        "--model=claude-sonnet-5",
        "--disable-builtin-mcps",
        "--available-tools=desk-desk_status",
        "--allow-all-tools",
        "--no-ask-user",
        "--no-remote",
        "--no-remote-export",
        "--secret-env-vars=GITHUB_TOKEN,GH_TOKEN",
        "--log-level=debug",
        `--log-dir=${paths.logRoot}`,
        "--output-format=json",
        "-p",
        STARTUP_PROMPT,
      ],
      paths.cwd,
      environments.live,
    ),
    gitInit: command(
      "git",
      ["init", "--initial-branch=main", "."],
      paths.cwd,
      environments.setup,
    ),
    marketplaceAdd: command(
      "npx",
      [...PINNED_COPILOT_PREFIX, "plugin", "marketplace", "add", paths.candidateRoot],
      paths.cwd,
      environments.setup,
    ),
    pluginInstall: command(
      "npx",
      [...PINNED_COPILOT_PREFIX, "plugin", "install", "desk@ouroboros-skills"],
      paths.cwd,
      environments.setup,
    ),
  };
}

function buildSmokePlan(input, { fsOps }) {
  const paths = buildPaths(input);
  validateCandidateRoot(paths.candidateRoot, fsOps);
  validateSecrets(input.env);
  createIsolatedRoots(paths, fsOps);
  const environments = buildEnvironments(paths, input.env);
  return {
    commands: buildCommands(paths, environments),
    environments,
    paths,
  };
}

async function startCli({
  argv,
  isMain,
  run,
  setExitCode,
  writeStderr,
} = {}) {
  if (!isMain) {
    return null;
  }
  try {
    const code = await run(argv);
    setExitCode(code);
    return code;
  } catch (error) {
    writeStderr(`desk-copilot-startup-smoke: ${error.message}\n`);
    setExitCode(1);
    return 1;
  }
}

module.exports = {
  STARTUP_PROMPT,
  buildSmokePlan,
  parseArgs,
  startCli,
};

startCli();
