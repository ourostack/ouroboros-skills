#!/usr/bin/env node
"use strict";

// Installs every plugin in this repository's marketplace into a throwaway
// Claude Code profile and fails if Claude Code reports any load error.
// `claude plugin validate` checks manifest shape only; this checks that
// Claude Code actually loads what it installs.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const claude = process.env.CLAUDE_BIN || "claude";

function run(args, env) {
  return execFileSync(claude, args, { cwd: repoRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function main() {
  const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  const pluginIds = marketplace.plugins.map((plugin) => `${plugin.name}@${marketplace.name}`);

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugin-load-"));
  const home = path.join(scratch, "home");
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(scratch, "config") };

  try {
    console.log(`Claude Code ${run(["--version"], env).trim()}`);
    run(["plugin", "marketplace", "add", repoRoot], env);
    const failures = [];
    for (const id of pluginIds) {
      try {
        run(["plugin", "install", id], env);
      } catch (error) {
        failures.push(`${id}: install failed: ${(error.stderr || error.message).trim()}`);
      }
    }

    const installed = new Map(JSON.parse(run(["plugin", "list", "--json"], env)).map((plugin) => [plugin.id, plugin]));
    for (const id of pluginIds) {
      const plugin = installed.get(id);
      if (!plugin) {
        if (!failures.some((failure) => failure.startsWith(`${id}:`))) {
          failures.push(`${id}: not installed`);
        }
        continue;
      }
      for (const error of plugin.errors ?? []) {
        failures.push(`${id}: ${error}`);
      }
      if (!failures.some((failure) => failure.startsWith(`${id}:`))) {
        console.log(`ok ${id} ${plugin.version}`);
      }
    }

    if (failures.length > 0) {
      console.error(`\nClaude Code failed to load ${failures.length} plugin(s):`);
      for (const failure of failures) {
        console.error(`  ${failure}`);
      }
      process.exitCode = 1;
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main();
