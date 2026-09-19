#!/usr/bin/env node
"use strict";

// Installs each plugin in this repository's marketplace into its own
// throwaway Claude Code profile and fails if Claude Code reports any install
// or load error. Separate profiles keep each check to one plugin plus the
// dependencies it declares, so no check enables two workflow methods (for
// example Superpowers and the legacy Work Suite) together.
// `claude plugin validate` checks manifest shape only; this checks that
// Claude Code actually loads what it installs.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const defaultRepoRoot = path.resolve(__dirname, "..");

function claudeRunner({ claude, repoRoot }) {
  return (args, env) => execFileSync(claude, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function checkPlugin(id, { run, repoRoot, baseEnv, tmpDir }) {
  const scratch = fs.mkdtempSync(path.join(tmpDir, "claude-plugin-load-"));
  const home = path.join(scratch, "home");
  fs.mkdirSync(home);
  const env = { ...baseEnv, HOME: home, CLAUDE_CONFIG_DIR: path.join(scratch, "config") };

  try {
    run(["plugin", "marketplace", "add", repoRoot], env);
    try {
      run(["plugin", "install", id], env);
    } catch (error) {
      return { failures: [`${id}: install failed: ${(error.stderr || error.message).trim()}`] };
    }

    // Report errors for the plugin and every dependency it pulled in.
    const installed = JSON.parse(run(["plugin", "list", "--json"], env));
    const failures = [];
    if (!installed.some((plugin) => plugin.id === id)) {
      failures.push(`${id}: not installed`);
    }
    for (const plugin of installed) {
      for (const error of plugin.errors ?? []) {
        failures.push(plugin.id === id ? `${id}: ${error}` : `${id} (dependency ${plugin.id}): ${error}`);
      }
    }
    const loaded = installed.map((plugin) => `${plugin.id} ${plugin.version}`).join(", ");
    return { failures, loaded };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function run({
  repoRoot = defaultRepoRoot,
  env = process.env,
  tmpDir = os.tmpdir(),
  runClaude = claudeRunner({ claude: env.CLAUDE_BIN || "claude", repoRoot }),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  stdout.write(`Claude Code ${runClaude(["--version"], env).trim()}\n`);

  const failures = [];
  for (const plugin of marketplace.plugins) {
    const id = `${plugin.name}@${marketplace.name}`;
    const result = checkPlugin(id, { run: runClaude, repoRoot, baseEnv: env, tmpDir });
    if (result.failures.length === 0) {
      stdout.write(`ok ${id} (loaded ${result.loaded})\n`);
    }
    failures.push(...result.failures);
  }

  if (failures.length === 0) {
    return 0;
  }
  stderr.write(`\nClaude Code failed to load ${failures.length} plugin(s) or dependencies:\n`);
  for (const failure of failures) {
    stderr.write(`  ${failure}\n`);
  }
  return 1;
}

function startCli({
  isMain = require.main === module,
  runFn = run,
  setExitCode = (code) => {
    process.exitCode = code;
  },
} = {}) {
  if (!isMain) return null;
  const code = runFn();
  setExitCode(code);
  return code;
}

module.exports = {
  checkPlugin,
  claudeRunner,
  run,
  startCli,
};

startCli();
