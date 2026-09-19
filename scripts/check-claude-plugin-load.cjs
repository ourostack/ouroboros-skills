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

const repoRoot = path.resolve(__dirname, "..");
const claude = process.env.CLAUDE_BIN || "claude";

function run(args, env) {
  return execFileSync(claude, args, { cwd: repoRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function checkPlugin(id) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugin-load-"));
  const home = path.join(scratch, "home");
  fs.mkdirSync(home);
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(scratch, "config") };

  try {
    run(["plugin", "marketplace", "add", repoRoot], env);
    try {
      run(["plugin", "install", id], env);
    } catch (error) {
      return [`${id}: install failed: ${(error.stderr || error.message).trim()}`];
    }

    // Report errors for the plugin and every dependency it pulled in.
    const failures = [];
    const installed = JSON.parse(run(["plugin", "list", "--json"], env));
    if (!installed.some((plugin) => plugin.id === id)) {
      failures.push(`${id}: not installed`);
    }
    for (const plugin of installed) {
      for (const error of plugin.errors ?? []) {
        failures.push(plugin.id === id ? `${id}: ${error}` : `${id} (dependency ${plugin.id}): ${error}`);
      }
    }
    if (failures.length === 0) {
      const loaded = installed.map((plugin) => `${plugin.id} ${plugin.version}`).join(", ");
      console.log(`ok ${id} (loaded ${loaded})`);
    }
    return failures;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function main() {
  const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "marketplace.json"), "utf8"));
  console.log(`Claude Code ${execFileSync(claude, ["--version"], { encoding: "utf8" }).trim()}`);

  const failures = marketplace.plugins.flatMap((plugin) => checkPlugin(`${plugin.name}@${marketplace.name}`));
  if (failures.length > 0) {
    console.error(`\nClaude Code failed to load ${failures.length} plugin(s) or dependencies:`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exitCode = 1;
  }
}

main();
