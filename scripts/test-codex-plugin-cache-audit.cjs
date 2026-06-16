#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  auditCodexPluginCache,
  run,
} = require("./audit-codex-plugin-cache.cjs");

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, value) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function manifest(name, version, extra = {}) {
  return {
    name,
    version,
    skills: "./skills/",
    activation: {
      codex: {
        marker: `${name}-${version}`,
      },
    },
    ...extra,
  };
}

function writePlugin(root, name, version, extra = {}) {
  writeJson(
    path.join(root, "plugins", name, ".codex-plugin", "plugin.json"),
    manifest(name, version, extra),
  );
}

function writeCache(codexHome, name, version, value) {
  writeJson(
    path.join(codexHome, "plugins", "cache", "ourostack", name, version, ".codex-plugin", "plugin.json"),
    value,
  );
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-plugin-cache-audit-"));
  const repoRoot = path.join(root, "repo");
  const codexHome = path.join(root, "codex-home");
  mkdirp(repoRoot);
  writePlugin(repoRoot, "desk", "1.7.3");
  writePlugin(repoRoot, "work-suite", "1.4.9");
  writeJson(path.join(repoRoot, ".agents", "plugins", "marketplace.json"), {
    name: "ourostack",
    plugins: [
      {
        name: "desk",
        source: { source: "local", path: "./plugins/desk" },
      },
      {
        name: "work-suite",
        source: { source: "local", path: "./plugins/work-suite" },
      },
    ],
  });
  writeCache(codexHome, "desk", "1.7.3", manifest("desk", "1.7.3"));
  writeCache(codexHome, "work-suite", "1.4.9", manifest("work-suite", "1.4.9"));
  return { root, repoRoot, codexHome };
}

function testCurrentFixture() {
  const fixture = makeFixture();
  try {
    const report = auditCodexPluginCache({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
    });
    assert.equal(report.status, "current");
    assert.equal(report.plugins.length, 2);
    for (const plugin of report.plugins) {
      assert.equal(plugin.repo_source_current, true);
      assert.equal(plugin.installed_cache_current, true);
      assert.equal(plugin.active_session_visible, "not_checked");
    }
    assert.match(
      report.evidence_states.active_session_visible,
      /requires host\/session reload/u,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function testStaleSourceAndCache() {
  const fixture = makeFixture();
  try {
    writePlugin(fixture.repoRoot, "desk", "1.7.3", { description: "new source" });
    writeCache(fixture.codexHome, "work-suite", "1.4.9", manifest("work-suite", "1.4.9", {
      description: "old cache",
    }));

    const report = auditCodexPluginCache({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
    });
    const desk = report.plugins.find((plugin) => plugin.name === "desk");
    const workSuite = report.plugins.find((plugin) => plugin.name === "work-suite");

    assert.equal(report.status, "stale");
    assert.equal(desk.repo_source_current, true);
    assert.equal(desk.installed_cache_current, false);
    assert.equal(desk.installed_cache_reason, "manifest-drift");
    assert.equal(workSuite.repo_source_current, true);
    assert.equal(workSuite.installed_cache_current, false);
    assert.equal(workSuite.installed_cache_reason, "manifest-drift");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function testMissingMarketplaceSource() {
  const fixture = makeFixture();
  try {
    writeJson(path.join(fixture.repoRoot, ".agents", "plugins", "marketplace.json"), {
      name: "ourostack",
      plugins: [
        {
          name: "desk",
          source: { source: "local", path: "./missing-desk" },
        },
      ],
    });
    const report = auditCodexPluginCache({
      repoRoot: fixture.repoRoot,
      codexHome: fixture.codexHome,
      plugins: ["desk"],
    });
    assert.equal(report.status, "stale");
    assert.equal(report.plugins[0].repo_source_current, false);
    assert.equal(report.plugins[0].repo_source_reason, "missing");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function testCliStrictMode() {
  const fixture = makeFixture();
  try {
    fs.rmSync(path.join(fixture.codexHome, "plugins", "cache"), { recursive: true, force: true });
    const stdout = [];
    const stderr = [];
    const exitCode = run({
      argv: ["--repo-root", fixture.repoRoot, "--codex-home", fixture.codexHome, "--strict"],
      stdout: { write: (text) => stdout.push(text) },
      stderr: { write: (text) => stderr.push(text) },
    });
    const report = JSON.parse(stdout.join(""));
    assert.equal(exitCode, 1);
    assert.equal(report.status, "stale");
    assert.equal(stderr.join(""), "");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

testCurrentFixture();
testStaleSourceAndCache();
testMissingMarketplaceSource();
testCliStrictMode();

console.log("Codex plugin cache audit tests passed.");
