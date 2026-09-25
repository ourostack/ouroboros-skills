#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");
const foundationPath = path.join(pluginRoot, "skills", "using-desk", "SKILL.md");

// Ask the MCP server's own resolver which desk this session binds, so the hook
// and the server can never disagree.
async function resolveDeskRoot() {
  try {
    const paths = await import(pathToFileURL(path.join(pluginRoot, "mcp", "src", "util", "paths.js")).href);
    return paths.resolveDeskRootWithSource({
      activationConfigPath: paths.resolveActivationConfigPath({ env: process.env }),
      env: process.env,
    }).root;
  } catch {
    return null;
  }
}

// This is the final Desk release on the ouroboros-skills channel, so every startup opens with the move.
const moveNotice = `Desk has moved to ourostack/desk. Run the move-to-ourostack-desk migration now (desk:session-start-migrations): ${path.join(pluginRoot, "migrations", "01-move-to-ourostack-desk.md")}`;

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({ additionalContext: `${moveNotice}\n${additionalContext}` }));
}

(async () => {
  try {
    const foundation = fs.readFileSync(foundationPath, "utf8").trimEnd();
    const deskRoot = await resolveDeskRoot();
    const direction = deskRoot
      ? `Desk startup: $DESK is ${deskRoot}. Invoke desk:session-start now for the authoritative workspace scan before other work; if an overlay launches Desk with its own root, desk_status reports the root Desk actually bound.`
      : "Desk startup: no desk is bound yet, so Desk is in setup mode. Run the onboarding path desk_status names now — desk:first-run-bootstrap by default, which looks for an existing local desk, then the operator's desk repository on GitHub, and otherwise offers to create one; an overlay that owns its workspace names its own, such as crew:join-crew. Do not offer to continue without Desk. After setup, desk:session-start remains the authoritative workspace scan.";
    emit(`${foundation}\n\n${direction}`);
  } catch {
    emit(`desk worker boot — the Desk foundation could not be read from ${foundationPath}. Invoke desk:session-start before other work; it remains the authoritative workspace scan.`);
  }
})();
