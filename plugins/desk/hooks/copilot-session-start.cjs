#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, "..");
const foundationPath = path.join(pluginRoot, "skills", "using-desk", "SKILL.md");
const deskRoot = process.env.DESK || path.join(os.homedir(), "desk");

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({ additionalContext }));
}

try {
  const foundation = fs.readFileSync(foundationPath, "utf8").trimEnd();
  const direction = fs.existsSync(deskRoot)
    ? `Desk startup: $DESK is ${deskRoot}. Invoke desk:session-start now for the authoritative workspace scan before other work.`
    : `Desk startup: $DESK (${deskRoot}) does not exist yet. Invoke desk:session-start now for the authoritative workspace scan; it will route to first-run-bootstrap.`;
  emit(`${foundation}\n\n${direction}`);
} catch {
  emit(`desk worker boot — the Desk foundation could not be read from ${foundationPath}. Invoke desk:session-start before other work; it remains the authoritative workspace scan.`);
}
