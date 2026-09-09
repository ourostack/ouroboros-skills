import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { repository, workRoot } from "./helpers/paths.mjs";

function setup() {
  const root = workRoot("native-cli");
  const input = path.join(root, "input");
  const parent = path.join(root, "output");
  const bin = path.join(root, "bin");
  for (const directory of [input, parent, bin]) mkdirSync(directory);
  const invoked = path.join(root, "provider-invoked");
  writeFileSync(path.join(bin, "gh"), `#!${process.execPath}\nrequire("node:assert/strict").equal(process.env.GH_TOKEN,undefined);require("node:assert/strict").equal(process.env.GITHUB_TOKEN,undefined);require("node:fs").writeFileSync(${JSON.stringify(invoked)},"named provider invoked");process.exitCode=1;\n`);
  chmodSync(path.join(bin, "gh"), 0o755);
  const plan = {
    schemaVersion: 1, kind: "offline_runtime_qualification", id: "cli-control", model: "gpt-6-astra", reasoningEffort: "high", contextTier: "default", scenario: "terminal-semantic-fail",
    runtime: { imageId: `sha256:${"a".repeat(64)}`, platform: "linux/amd64", nodeVersion: "22.23.2", cliVersion: "1.0.84-1", sdkVersion: "1.0.13" },
    credentialProvider: { kind: "gh-named-entitlement", hostname: "github.com", account: "explicit-fixture-account" },
    limits: { startupSendWorkMs: 30000, commandMs: 10000, cleanupMs: 10000, maxStreamBytes: 1000000 },
  };
  const filename = path.join(input, "plan.json");
  const output = path.join(parent, "attempt");
  const execute = value => {
    writeFileSync(filename, JSON.stringify(value));
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_TOKEN: "ambient-fixture", GITHUB_TOKEN: "ambient-fixture" };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(process.execPath, [path.join(repository, "scripts/skill-evals.cjs"), "offline", "qualify-runtime", "--plan", filename, "--output", output], { env, encoding: "utf8", shell: false, timeout: 30000 });
  };
  return { plan, output, invoked, execute };
}

test("the shipping offline command invokes the fixed native route and preserves actual provider failure", () => {
  const fixture = setup();
  const result = fixture.execute(fixture.plan);
  assert.equal(result.status, 3, result.stderr);
  assert.equal(existsSync(fixture.invoked), true);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "credential_provider_failed");
  assert.equal(output.qualified, false);
  assert.equal(output.grade, null);
  assert.equal(JSON.parse(readFileSync(path.join(fixture.output, "receipt.json"))).grade, null);
});

test("a malformed native plan is rejected before the executable provider boundary", () => {
  const fixture = setup();
  fixture.plan.credentialProvider.account = "";
  const result = fixture.execute(fixture.plan);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(existsSync(fixture.invoked), false);
  assert.equal(existsSync(fixture.output), false);
});
