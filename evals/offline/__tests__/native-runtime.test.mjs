import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { validateRuntimeQualification, runRuntimeQualification } from "../native-runtime.mjs";
import { workRoot } from "./helpers/paths.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const sentinel = "synthetic-qualified-provider-sentinel-not-a-credential";
const plan = () => ({
  schemaVersion: 1, kind: "offline_runtime_qualification", id: "terminal-control",
  model: "gpt-6-astra", reasoningEffort: "high", contextTier: "default",
  scenario: "terminal-semantic-fail",
  runtime: { imageId: `sha256:${"a".repeat(64)}`, platform: "linux/amd64", nodeVersion: "22.23.2", cliVersion: "1.0.84-1", sdkVersion: "1.0.13" },
  credentialProvider: { kind: "gh-named-entitlement", hostname: "github.com", account: "explicit-fixture-account" },
  limits: { startupSendWorkMs: 1000, commandMs: 100, cleanupMs: 300, maxStreamBytes: 1000000 },
});
const result = (stdout = "", status = 0, stderr = "") => ({ status, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });

test("the runtime plan rejects arbitrary commands, unpinned transports and unspecified identities before work", () => {
  for (const modify of [
    value => { value.command = "arbitrary shell"; },
    value => { value.runtime.platform = "darwin/arm64"; },
    value => { value.runtime.cliVersion = "1.0.84-3"; },
    value => { value.credentialProvider.account = ""; },
    value => { value.model = "unapproved"; },
    value => { value.limits.cleanupMs = 0; },
  ]) {
    const value = plan();
    modify(value);
    assert.throws(() => validateRuntimeQualification(value));
  }
});

test("the fixed controller acquires only the named provider and preserves credential-provider failure", async () => {
  const outputRoot = join(workRoot("native-provider-failure"), "attempt");
  const calls = [];
  const returned = await runRuntimeQualification({
    plan: plan(), outputRoot, env: { PATH: "/fixture/bin", GH_TOKEN: "ambient-gh", GITHUB_TOKEN: "ambient-github" },
    execute: (command, argv, options) => {
      calls.push({ command, argv, options });
      return result("", 1, "The named entitlement is unavailable.");
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gh");
  assert.deepEqual(calls[0].argv, ["auth", "token", "--hostname", "github.com", "--user", "explicit-fixture-account"]);
  assert.equal(Object.hasOwn(calls[0].options.env, "GH_TOKEN"), false);
  assert.equal(Object.hasOwn(calls[0].options.env, "GITHUB_TOKEN"), false);
  assert.equal(returned.status, "credential_provider_failed");
  assert.equal(returned.grade, null);
  assert.equal(returned.qualified, false);
  assert.equal(returned.exitCode, 3);
  assert.equal(JSON.parse(readFileSync(join(outputRoot, "receipt.incomplete.json"))).grade, null);
});

test("creation timeout retains predeclared ownership and checks that exact name rather than claiming cleanup", async () => {
  const outputRoot = join(workRoot("native-create-timeout"), "attempt");
  const calls = [];
  let ownerName;
  const returned = await runRuntimeQualification({
    plan: plan(), outputRoot,
    execute: (command, argv, options) => {
      calls.push({ command, argv, options });
      if (command === "gh") return result(sentinel);
      if (argv[0] === "create") {
        ownerName = argv[argv.indexOf("--name") + 1];
        return { ...result("", 143), error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) };
      }
      assert.deepEqual(argv, ["inspect", ownerName]);
      return { ...result("", 143), error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) };
    },
  });
  assert.ok(ownerName);
  assert.equal(returned.status, "cleanup_unverified");
  assert.equal(returned.cleanup.containerName, ownerName);
  assert.equal(returned.cleanup.absenceObserved, false);
  assert.equal(returned.qualified, false);
  assert.equal(returned.grade, null);
  assert.equal(calls.filter(call => call.command === "gh").length, 1);
  const incomplete = JSON.parse(readFileSync(join(outputRoot, "receipt.incomplete.json")));
  assert.equal(incomplete.containerName, ownerName);
});

test("a valid provider value never enters Docker argv or artifacts, including hashes of its value", async () => {
  const outputRoot = join(workRoot("native-secret-boundary"), "attempt");
  let create;
  const returned = await runRuntimeQualification({
    plan: plan(), outputRoot,
    execute: (command, argv) => {
      assert.equal(JSON.stringify(argv).includes(sentinel), false);
      if (command === "gh") return result(sentinel);
      if (argv[0] === "create") { create = argv; return result("", 1, "Controlled create failure."); }
      return result("", 1, "Error: No such object");
    },
  });

  assert.ok(create, "The fixed runtime must reach the owned create boundary.");
  assert.ok(create.includes("--read-only"));
  assert.equal(create[create.indexOf("--cap-drop") + 1], "ALL");
  assert.equal(create.some(argument => argument === "--mount" || argument === "--volume" || argument === "-v"), false);
  assert.equal(returned.cleanup.absenceObserved, true);
  for (const name of readdirSync(outputRoot)) {
    if (!name.endsWith(".json") && !name.endsWith(".raw")) continue;
    const raw = readFileSync(join(outputRoot, name));
    assert.equal(raw.includes(Buffer.from(sentinel)), false);
    assert.equal(raw.includes(Buffer.from(hash(sentinel))), false);
  }
  if (existsSync(join(outputRoot, "COMMITTED.json"))) {
    const receipt = JSON.parse(readFileSync(join(outputRoot, "receipt.json")));
    assert.equal(receipt.grade, null);
    assert.equal(receipt.status, "infrastructure_failure");
  }
});

function engine(stdout, assertions = () => {}) {
  const id = "b".repeat(64);
  let created;
  let removed = false;
  return (command, argv, options) => {
    if (command === "gh") return result(sentinel);
    assertions(argv, options);
    if (argv[0] === "create") { created = argv; return result(`${id}\n`); }
    if (argv[0] === "start") return result(stdout);
    if (argv[0] === "rm") { removed = true; return result(`${id}\n`); }
    if (removed) return result("", 1, "No such object");
    const labels = Object.fromEntries(created.flatMap((value, index) => value === "--label" ? [created[index + 1].split("=")] : []));
    return result(JSON.stringify([{
      Id: id, Name: `/${created[created.indexOf("--name") + 1]}`, Image: plan().runtime.imageId,
      Config: { Labels: labels },
      HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"] },
      Mounts: [], State: { Running: false, Status: "exited", Pid: 0, ExitCode: 0, FinishedAt: "2026-09-09T00:00:00Z" },
    }]));
  };
}

test("the fixed executable archive includes the protocol module's complete source closure", async () => {
  const outputRoot = join(workRoot("native-source-closure"), "attempt");
  let files;
  await runRuntimeQualification({
    plan: plan(), outputRoot,
    execute: engine('{"kind":"probe-finished","ok":false}\n', (argv, options) => {
      if (argv[0] === "start") files = JSON.parse(options.input).files;
    }),
  });
  assert.ok(files);
  for (const expected of ["native-protocol.mjs", "core.mjs", "admission.mjs", "copilot-runner.mjs", "vendor/gauntlet/LICENSE", "vendor/gauntlet/src/agent/validators.ts", "vendor/gauntlet/src/context/scoped-read.ts", "vendor/gauntlet/src/types.ts"]) {
    assert.ok(files.some(file => file.path === expected), `Missing fixed runtime source member: ${expected}`);
  }
});

test("Docker inherits neither ambient provider credentials nor an enclosing Node test-runner context", async () => {
  const outputRoot = join(workRoot("native-child-environment"), "attempt");
  const seen = [];
  await runRuntimeQualification({
    plan: plan(), outputRoot,
    env: { PATH: "/fixture/bin", HOME: "/fixture/home", GH_TOKEN: "ambient", GITHUB_TOKEN: "ambient", COPILOT_GITHUB_TOKEN: "ambient", NODE_TEST_CONTEXT: "child-v8" },
    execute: engine('{"kind":"probe-finished","ok":false}\n', (argv, options) => { seen.push(options.env); }),
  });
  assert.ok(seen.length > 0);
  for (const env of seen) for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "COPILOT_GITHUB_TOKEN", "NODE_TEST_CONTEXT"]) assert.equal(Object.hasOwn(env, key), false, key);
});

test("a constant successful final JSON record cannot impersonate SDK execution and cleanup evidence", async () => {
  const outputRoot = join(workRoot("native-false-completion"), "attempt");
  const returned = await runRuntimeQualification({ plan: plan(), outputRoot, execute: engine('{"kind":"probe-finished","ok":true}\n') });
  assert.notEqual(returned.status, "component_observed");
  assert.equal(returned.exitCode, 3);
  assert.equal(returned.qualified, false);
  assert.equal(returned.grade, null);
});
